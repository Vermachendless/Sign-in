/**
 * Focused Test Suite: Invitee & Access Pass Transactional Consistency and Rollback Verification
 *
 * Verifies:
 * 1. A failed invitee-link update rolls back the newly created access pass.
 * 2. A failed invitee status update during revocation rolls back the pass revocation.
 * 3. A failed cancellation update rolls back pass revocation.
 * 4. Successful generation links the pass and sets status to ACCESS_ISSUED.
 * 5. Successful revocation sets the pass to REVOKED and the invitee to INVITED.
 * 6. Successful cancellation sets the invitee to CANCELLED and revokes an active pass.
 * 7. Verification of actual database state after rollback (no orphaned or desynchronized records).
 * 8. Zero unhandled promise rejections occur.
 */

import { getDatabase } from './server/db/index.ts';
import { dbAdapter } from './server/db/adapter.ts';
import { inviteeService } from './server/services/invitee.service.ts';
import { eventService } from './server/services/event.service.ts';
import {
  InviteeStatus,
  SafeUser,
  UserRole,
  AccessPassStatus,
} from './src/types/index.ts';

let passed = 0;
let failed = 0;
let unhandledRejections = 0;

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection detected:', reason);
  unhandledRejections++;
});

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`✅ [PASS] ${message}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${message}`);
    failed++;
  }
}

async function runRollbackConsistencyTests() {
  console.log('================================================================');
  console.log('   PHASE 7 — INVITEES & PASS TRANSACTIONAL CONSISTENCY TESTS    ');
  console.log('================================================================');

  const db = getDatabase();
  (globalThis as any).db = db;

  // 1. Setup Test Users
  console.log('\n--- 1. Setup Actors ---');
  const superAdminRow = db.prepare("SELECT * FROM users WHERE role = 'SUPER_ADMIN' AND status = 'ACTIVE' LIMIT 1").get() as any;
  const adminRow = db.prepare("SELECT * FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE' LIMIT 1").get() as any;

  const superAdminUser: SafeUser = {
    id: superAdminRow.id,
    email: superAdminRow.email,
    firstName: superAdminRow.first_name,
    lastName: superAdminRow.last_name,
    department: superAdminRow.department,
    role: UserRole.SUPER_ADMIN,
    status: superAdminRow.status,
  };

  const adminUser: SafeUser = {
    id: adminRow.id,
    email: adminRow.email,
    firstName: adminRow.first_name,
    lastName: adminRow.last_name,
    department: adminRow.department,
    role: UserRole.ADMIN,
    status: adminRow.status,
  };

  assert(!!superAdminUser && !!adminUser, 'Admin & Super Admin users present');

  // 2. Setup Approved Event
  console.log('\n--- 2. Approved Event Setup ---');
  const now = new Date();
  const startAt = new Date(now.getTime() - 1000 * 3600).toISOString();
  const endAt = new Date(now.getTime() + 1000 * 7200).toISOString();

  const eventRes = await eventService.createEvent(adminUser, {
    title: 'Transactional Consistency Summit',
    location: 'Security Hall Alpha',
    startAt,
    endAt,
  });
  assert(eventRes.success && !!eventRes.event, 'Event created');
  const event = eventRes.event!;
  await eventService.submitEvent(event.id, adminUser);
  await eventService.approveEvent(event.id, superAdminUser);

  // 3. Setup Test Invitee
  console.log('\n--- 3. Invitee Setup ---');
  const invRes = await inviteeService.createInvitee(event.id, adminUser, {
    fullName: 'Dr. Chidi Anagonye',
    email: 'chidi.ethics@summit.org',
    organization: 'Moral Philosophy Dept',
  });
  assert(invRes.success && !!invRes.invitee, 'Invitee created in INVITED status');
  const invitee = invRes.invitee!;
  assert(invitee.status === InviteeStatus.INVITED, 'Initial invitee status is INVITED');
  assert(invitee.accessPassId === null, 'Initial access_pass_id is null');

  // 4. Test Scenario 1: Failure during pass linking rolls back pass creation
  console.log('\n--- 4. Scenario 1: Pass Linking Failure Triggers Full Rollback ---');
  const initialPassCountRow = await dbAdapter.queryOne<{ count: number | string }>('SELECT count(*) as count FROM access_passes');
  const initialPassCount = Number(initialPassCountRow?.count || 0);

  // Intercept execute to simulate database error during invitee link update
  const originalExecute = dbAdapter.execute.bind(dbAdapter);
  let failLink = true;

  dbAdapter.execute = (async (sql: string, params: any[] = []) => {
    if (failLink && sql.includes('UPDATE event_invitees') && sql.includes('access_pass_id = $1')) {
      throw new Error('SIMULATED_DB_FAILURE_LINKING_PASS');
    }
    return originalExecute(sql, params);
  }) as any;

  const failedGenRes = await inviteeService.generateInviteeAccessPass(event.id, invitee.id, adminUser);
  failLink = false; // Disable failure injection
  dbAdapter.execute = originalExecute; // Restore original

  assert(!failedGenRes.success, 'generateInviteeAccessPass reported failure on DB error');
  assert(failedGenRes.status === 500, 'Returned 500 status code');

  // VERIFY DATABASE STATE AFTER ROLLBACK
  const postFailPassCountRow = await dbAdapter.queryOne<{ count: number | string }>('SELECT count(*) as count FROM access_passes');
  const postFailPassCount = Number(postFailPassCountRow?.count || 0);
  assert(
    postFailPassCount === initialPassCount,
    `No orphaned pass created in database: count remains ${initialPassCount} (was ${postFailPassCount})`
  );

  const inviteeAfterFailedGen = await dbAdapter.queryOne<any>('SELECT * FROM event_invitees WHERE id = $1', [invitee.id]);
  assert(inviteeAfterFailedGen.status === InviteeStatus.INVITED, 'Invitee status remains INVITED');
  assert(inviteeAfterFailedGen.access_pass_id === null, 'Invitee access_pass_id remains null');

  // 5. Test Scenario 2: Successful pass generation
  console.log('\n--- 5. Scenario 2: Successful Pass Generation & Atomic Linking ---');
  const successGenRes = await inviteeService.generateInviteeAccessPass(event.id, invitee.id, adminUser);
  assert(successGenRes.success && !!successGenRes.pass && !!successGenRes.invitee, 'generateInviteeAccessPass succeeded');
  const pass = successGenRes.pass!;
  assert(pass.status === AccessPassStatus.ACTIVE, 'Pass status is ACTIVE');
  assert(successGenRes.invitee?.status === InviteeStatus.ACCESS_ISSUED, 'Invitee status updated to ACCESS_ISSUED');
  assert(successGenRes.invitee?.accessPassId === pass.id, 'Invitee linked to pass ID');

  // Verify DB state
  const dbPass = await dbAdapter.queryOne<any>('SELECT * FROM access_passes WHERE id = $1', [pass.id]);
  assert(dbPass && dbPass.status === AccessPassStatus.ACTIVE, 'Database confirms pass is ACTIVE');
  const dbInvitee = await dbAdapter.queryOne<any>('SELECT * FROM event_invitees WHERE id = $1', [invitee.id]);
  assert(dbInvitee.status === InviteeStatus.ACCESS_ISSUED, 'Database confirms invitee status is ACCESS_ISSUED');
  assert(dbInvitee.access_pass_id === pass.id, 'Database confirms invitee access_pass_id matches');

  // 6. Test Scenario 3: Failure during invitee status update on revocation rolls back pass revocation
  console.log('\n--- 6. Scenario 3: Revocation Invitee Update Failure Triggers Rollback ---');
  let failRevokeInvitee = true;
  dbAdapter.execute = (async (sql: string, params: any[] = []) => {
    if (failRevokeInvitee && sql.includes('UPDATE event_invitees') && sql.includes('status = $1') && params[0] === InviteeStatus.INVITED) {
      throw new Error('SIMULATED_DB_FAILURE_REVERTING_INVITEE');
    }
    return originalExecute(sql, params);
  }) as any;

  const failedRevokeRes = await inviteeService.revokeInviteeAccess(event.id, invitee.id, adminUser, 'Testing rollback');
  failRevokeInvitee = false;
  dbAdapter.execute = originalExecute;

  assert(!failedRevokeRes.success, 'revokeInviteeAccess reported failure');
  assert(failedRevokeRes.status === 500, 'Returned 500 status code');

  // VERIFY DATABASE STATE AFTER ROLLBACK
  const passAfterFailedRevoke = await dbAdapter.queryOne<any>('SELECT * FROM access_passes WHERE id = $1', [pass.id]);
  assert(passAfterFailedRevoke.status === AccessPassStatus.ACTIVE, 'Database confirms pass status rolled back to ACTIVE');
  const inviteeAfterFailedRevoke = await dbAdapter.queryOne<any>('SELECT * FROM event_invitees WHERE id = $1', [invitee.id]);
  assert(inviteeAfterFailedRevoke.status === InviteeStatus.ACCESS_ISSUED, 'Database confirms invitee status remains ACCESS_ISSUED');

  // 7. Test Scenario 4: Successful pass revocation
  console.log('\n--- 7. Scenario 4: Successful Pass Revocation ---');
  const successRevokeRes = await inviteeService.revokeInviteeAccess(event.id, invitee.id, adminUser, 'Legitimate administrative revocation');
  assert(successRevokeRes.success && !!successRevokeRes.invitee, 'revokeInviteeAccess succeeded');
  assert(successRevokeRes.invitee?.status === InviteeStatus.INVITED, 'Invitee status reverted to INVITED');

  // Verify DB state
  const dbPassRevoked = await dbAdapter.queryOne<any>('SELECT * FROM access_passes WHERE id = $1', [pass.id]);
  assert(dbPassRevoked.status === AccessPassStatus.REVOKED, 'Database confirms pass is REVOKED');
  const dbInviteeRevoked = await dbAdapter.queryOne<any>('SELECT * FROM event_invitees WHERE id = $1', [invitee.id]);
  assert(dbInviteeRevoked.status === InviteeStatus.INVITED, 'Database confirms invitee is INVITED');

  // 8. Test Scenario 5: Failure during cancellation rolls back pass revocation
  console.log('\n--- 8. Scenario 5: Cancellation Update Failure Triggers Rollback of Pass Revocation ---');
  // Re-issue a pass to Dr. Chidi to test cancellation with an active pass
  const secondPassRes = await inviteeService.generateInviteeAccessPass(event.id, invitee.id, adminUser);
  assert(secondPassRes.success && !!secondPassRes.pass, 'Second pass issued for cancellation test');
  const pass2 = secondPassRes.pass!;

  let failCancelInvitee = true;
  dbAdapter.execute = (async (sql: string, params: any[] = []) => {
    if (failCancelInvitee && sql.includes('UPDATE event_invitees') && sql.includes('status = $1') && params[0] === InviteeStatus.CANCELLED) {
      throw new Error('SIMULATED_DB_FAILURE_CANCELLING_INVITEE');
    }
    return originalExecute(sql, params);
  }) as any;

  const failedCancelRes = await inviteeService.cancelInvitee(event.id, invitee.id, adminUser, 'Testing cancellation rollback');
  failCancelInvitee = false;
  dbAdapter.execute = originalExecute;

  assert(!failedCancelRes.success, 'cancelInvitee reported failure');
  assert(failedCancelRes.status === 500, 'Returned 500 status code');

  // VERIFY DATABASE STATE AFTER ROLLBACK
  const pass2AfterFailedCancel = await dbAdapter.queryOne<any>('SELECT * FROM access_passes WHERE id = $1', [pass2.id]);
  assert(pass2AfterFailedCancel.status === AccessPassStatus.ACTIVE, 'Database confirms pass 2 rolled back to ACTIVE');
  const inviteeAfterFailedCancel = await dbAdapter.queryOne<any>('SELECT * FROM event_invitees WHERE id = $1', [invitee.id]);
  assert(inviteeAfterFailedCancel.status === InviteeStatus.ACCESS_ISSUED, 'Database confirms invitee remains ACCESS_ISSUED');

  // 9. Test Scenario 6: Successful cancellation with active pass
  console.log('\n--- 9. Scenario 6: Successful Cancellation with Auto-Revocation ---');
  const successCancelRes = await inviteeService.cancelInvitee(event.id, invitee.id, adminUser, 'Final guest cancellation');
  assert(successCancelRes.success && !!successCancelRes.invitee, 'cancelInvitee succeeded');
  assert(successCancelRes.invitee?.status === InviteeStatus.CANCELLED, 'Invitee status set to CANCELLED');

  // Verify DB state: both pass is REVOKED and invitee is CANCELLED
  const pass2Final = await dbAdapter.queryOne<any>('SELECT * FROM access_passes WHERE id = $1', [pass2.id]);
  assert(pass2Final.status === AccessPassStatus.REVOKED, 'Database confirms pass 2 was REVOKED during cancellation');
  const inviteeFinal = await dbAdapter.queryOne<any>('SELECT * FROM event_invitees WHERE id = $1', [invitee.id]);
  assert(inviteeFinal.status === InviteeStatus.CANCELLED, 'Database confirms invitee status is CANCELLED');

  // 10. Cannot generate pass for cancelled invitee
  console.log('\n--- 10. Scenario 7: Guardrail Against Re-issuing to Cancelled Invitee ---');
  const reIssueRes = await inviteeService.generateInviteeAccessPass(event.id, invitee.id, adminUser);
  assert(!reIssueRes.success && reIssueRes.status === 400, 'Pass issuance to cancelled invitee blocked with 400');

  // 11. Unhandled Rejection Audit
  console.log('\n--- 11. Unhandled Promise Rejection Audit ---');
  assert(unhandledRejections === 0, `Zero unhandled promise rejections detected (count: ${unhandledRejections})`);

  console.log('\n================================================================');
  console.log(`   ROLLBACK CONSISTENCY TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0 || unhandledRejections > 0) {
    process.exit(1);
  }
}

runRollbackConsistencyTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
