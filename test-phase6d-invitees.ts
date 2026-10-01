/**
 * Phase 6D — Event Invitees & Individual Event Access Verification Suite
 * Tests:
 * 1. Database schema, table definition, indexes, foreign keys
 * 2. Event status restriction (only APPROVED events allow invitees)
 * 3. Validation & input normalization (full name required, whitespace trimmed, email format)
 * 4. Duplicate email detection per event (duplicate email rejected, identical names permitted)
 * 5. Role-based access control (ADMIN & SUPER_ADMIN allowed, STAFF denied with 403)
 * 6. Cross-event boundary protection (cannot access/modify Invitee from Event A via Event B)
 * 7. Individual access pass generation (pass_type=EVENT, event start_at -> end_at window, single use)
 * 8. Zero cryptographic raw token leakage (raw tokens never in DB or audit logs)
 * 9. QR verification integration (opaque token & display code)
 * 10. Invitee access revocation (retains invitee record, reverts to INVITED, revokes pass)
 * 11. Invitee cancellation (marks CANCELLED, revokes active pass, retains history)
 * 12. Audit trail verification (all 5 audit action types recorded)
 */

import { getDatabase } from './server/db/index.ts';
import { inviteeService } from './server/services/invitee.service.ts';
import { accessService } from './server/services/access.service.ts';
import { eventService } from './server/services/event.service.ts';
import { buildVerificationUrl, generateQrDataUrl } from './src/utils/qr.ts';
import {
  InviteeStatus,
  AccessPassStatus,
  PassType,
  UserRole,
  EventStatus,
  SafeUser,
} from './src/types/index.ts';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`✅ [PASS] ${message}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${message}`);
    failed++;
  }
}

async function runPhase6dTests() {
  console.log('================================================================');
  console.log('   PHASE 6D — EVENT INVITEES & INDIVIDUAL ACCESS TESTS          ');
  console.log('================================================================');

  const db = getDatabase();

  // 1. Database Schema & Table Structure
  console.log('\n--- 1. Database Schema & Table Structure ---');
  const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='event_invitees'").get() as { sql: string } | undefined;
  assert(!!tableInfo, 'event_invitees table exists in database');
  assert(tableInfo?.sql.includes('event_id'), 'event_invitees has event_id column');
  assert(tableInfo?.sql.includes('full_name'), 'event_invitees has full_name column');
  assert(tableInfo?.sql.includes('phone'), 'event_invitees has phone column');
  assert(tableInfo?.sql.includes('email'), 'event_invitees has email column');
  assert(tableInfo?.sql.includes('organization'), 'event_invitees has organization column');
  assert(tableInfo?.sql.includes('notes'), 'event_invitees has notes column');
  assert(tableInfo?.sql.includes('status'), 'event_invitees has status column');
  assert(tableInfo?.sql.includes('access_pass_id'), 'event_invitees has access_pass_id column');
  assert(tableInfo?.sql.includes('invited_by'), 'event_invitees has invited_by column');

  // Verify indexes
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='event_invitees'").all() as { name: string }[];
  const indexNames = indexes.map((i) => i.name);
  assert(indexNames.includes('idx_event_invitees_event_id'), 'Index on event_id exists');
  assert(indexNames.includes('idx_event_invitees_status'), 'Index on status exists');
  assert(indexNames.includes('idx_event_invitees_access_pass_id'), 'Index on access_pass_id exists');
  assert(indexNames.includes('idx_event_invitees_email'), 'Index on email exists');

  // 2. Test User Setup
  console.log('\n--- 2. Test User Setup ---');
  const superAdmin = db.prepare("SELECT * FROM users WHERE role = 'SUPER_ADMIN' AND status = 'ACTIVE' LIMIT 1").get() as any;
  const admin = db.prepare("SELECT * FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE' LIMIT 1").get() as any;
  const staff = db.prepare("SELECT * FROM users WHERE role = 'STAFF' AND status = 'ACTIVE' LIMIT 1").get() as any;

  assert(!!superAdmin, 'Super Admin user present');
  assert(!!admin, 'Admin user present');
  assert(!!staff, 'Staff user present');

  const superAdminUser: SafeUser = {
    id: superAdmin.id,
    email: superAdmin.email,
    firstName: superAdmin.first_name,
    lastName: superAdmin.last_name,
    department: superAdmin.department,
    role: UserRole.SUPER_ADMIN,
    status: superAdmin.status,
  };

  const adminUser: SafeUser = {
    id: admin.id,
    email: admin.email,
    firstName: admin.first_name,
    lastName: admin.last_name,
    department: admin.department,
    role: UserRole.ADMIN,
    status: admin.status,
  };

  const staffUser: SafeUser = {
    id: staff.id,
    email: staff.email,
    firstName: staff.first_name,
    lastName: staff.last_name,
    department: staff.department,
    role: UserRole.STAFF,
    status: staff.status,
  };

  // 3. Test Event Setup (Approved and Unapproved)
  console.log('\n--- 3. Event Setup for Invitees ---');
  const now = new Date();
  // Valid active event window: started 30 mins ago, ends in 2 hours
  const startAt = new Date(now.getTime() - 1800 * 1000).toISOString();
  const endAt = new Date(now.getTime() + 7200 * 1000).toISOString();

  // Create Event A (Will be APPROVED)
  const eventARes = eventService.createEvent(adminUser, {
    title: 'Phase 6D Annual Gala',
    location: 'Main Ballroom',
    startAt,
    endAt,
  });
  assert(eventARes.success && !!eventARes.event, 'Event A created in DRAFT');
  const eventA = eventARes.event!;

  // Try creating invitee on DRAFT event (MUST BE REJECTED)
  const draftInviteeRes = inviteeService.createInvitee(eventA.id, adminUser, {
    fullName: 'Premature Guest',
  });
  assert(!draftInviteeRes.success, 'Invitee creation on DRAFT event is rejected');
  assert(draftInviteeRes.error?.includes('APPROVED') || false, 'Error mentions event must be APPROVED');

  // Submit and Approve Event A
  eventService.submitEvent(eventA.id, adminUser);
  const approveRes = eventService.approveEvent(eventA.id, superAdminUser);
  assert(approveRes.success, 'Event A successfully approved by Super Admin');

  // Create Event B (Also APPROVED, to test cross-event protection)
  const eventBRes = eventService.createEvent(adminUser, {
    title: 'Phase 6D Private Symposium',
    location: 'Executive Boardroom',
    startAt,
    endAt,
  });
  eventService.submitEvent(eventBRes.event!.id, adminUser);
  eventService.approveEvent(eventBRes.event!.id, superAdminUser);
  const eventB = eventBRes.event!;

  // 4. Invitee Input Validation & Normalization
  console.log('\n--- 4. Invitee Input Validation & Normalization ---');
  // Missing full name
  const emptyNameRes = inviteeService.createInvitee(eventA.id, adminUser, {
    fullName: '   ',
  });
  assert(!emptyNameRes.success, 'Empty full name is rejected');

  // Valid Invitee 1
  const inv1Res = inviteeService.createInvitee(eventA.id, adminUser, {
    fullName: '  Dr. Ngozi Okonjo  ',
    email: '  Ngozi.Okonjo@WTO.ORG  ',
    phone: ' +234 801 111 2222 ',
    organization: '  World Trade Organization  ',
    notes: '  Keynote Speaker  ',
  });
  assert(inv1Res.success && !!inv1Res.invitee, 'Invitee 1 created successfully');
  const inv1 = inv1Res.invitee!;
  assert(inv1.fullName === 'Dr. Ngozi Okonjo', 'Full name is trimmed of whitespace');
  assert(inv1.email === 'ngozi.okonjo@wto.org', 'Email is normalized to lowercase and trimmed');
  assert(inv1.phone === '+234 801 111 2222', 'Phone is normalized and trimmed');
  assert(inv1.organization === 'World Trade Organization', 'Organization is trimmed');
  assert(inv1.notes === 'Keynote Speaker', 'Notes are trimmed');
  assert(inv1.status === InviteeStatus.INVITED, 'Initial status is INVITED');
  assert(inv1.accessPassId === null, 'Initial access_pass_id is null');

  // Duplicate email detection on same event
  const duplicateEmailRes = inviteeService.createInvitee(eventA.id, adminUser, {
    fullName: 'Different Name Same Email',
    email: 'NGOZI.OKONJO@WTO.ORG',
  });
  assert(!duplicateEmailRes.success, 'Duplicate email in same event is rejected');
  assert(duplicateEmailRes.status === 409, 'Rejection status code is 409 Conflict');

  // Same email on DIFFERENT event (Event B) MUST BE ALLOWED
  const diffEventEmailRes = inviteeService.createInvitee(eventB.id, adminUser, {
    fullName: 'Dr. Ngozi Okonjo',
    email: 'ngozi.okonjo@wto.org',
  });
  assert(diffEventEmailRes.success, 'Same email on different event is permitted');

  // Identical name with different email MUST BE ALLOWED per spec
  const sameNameRes = inviteeService.createInvitee(eventA.id, adminUser, {
    fullName: 'Dr. Ngozi Okonjo',
    email: 'another.ngozi@example.com',
  });
  assert(sameNameRes.success, 'Identical full name with distinct email is permitted');

  // Invitee without email (only name and phone) MUST BE ALLOWED
  const noEmailRes = inviteeService.createInvitee(eventA.id, adminUser, {
    fullName: 'Hon. Aliko Dangote',
    phone: '+234 802 333 4444',
  });
  assert(noEmailRes.success && !!noEmailRes.invitee, 'Invitee without email is permitted');

  // 5. Role-Based Access Control (RBAC)
  console.log('\n--- 5. Invitee RBAC Boundaries ---');
  // Staff cannot list invitees
  const staffList = inviteeService.listInvitees(eventA.id, staffUser);
  assert(!staffList.success, 'Staff member cannot list invitees (Forbidden)');

  // Staff cannot create invitees
  const staffCreate = inviteeService.createInvitee(eventA.id, staffUser, {
    fullName: 'Staff Guest',
  });
  assert(!staffCreate.success && staffCreate.status === 403, 'Staff member cannot create invitee (403 Forbidden)');

  // Staff cannot get invitee
  const staffGet = inviteeService.getInviteeById(eventA.id, inv1.id, staffUser);
  assert(!staffGet.success && staffGet.status === 403, 'Staff member cannot view invitee details (403 Forbidden)');

  // Staff cannot generate access pass
  const staffPass = inviteeService.generateInviteeAccessPass(eventA.id, inv1.id, staffUser);
  assert(!staffPass.success && staffPass.status === 403, 'Staff member cannot issue access pass (403 Forbidden)');

  // Staff cannot cancel invitee
  const staffCancel = inviteeService.cancelInvitee(eventA.id, inv1.id, staffUser);
  assert(!staffCancel.success && staffCancel.status === 403, 'Staff member cannot cancel invitee (403 Forbidden)');

  // Super Admin CAN manage invitees
  const superAdminList = inviteeService.listInvitees(eventA.id, superAdminUser);
  assert(superAdminList.success && superAdminList.total >= 3, 'Super Admin can list event invitees');

  // 6. Cross-Event Boundary Protection
  console.log('\n--- 6. Cross-Event Boundary Protection ---');
  // Invitee 1 belongs to Event A. Try accessing or modifying Invitee 1 through Event B's routes
  const crossGet = inviteeService.getInviteeById(eventB.id, inv1.id, adminUser);
  assert(!crossGet.success && crossGet.status === 403, 'Cross-event retrieval blocked with 403');

  const crossUpdate = inviteeService.updateInvitee(eventB.id, inv1.id, adminUser, {
    fullName: 'Malicious Update',
  });
  assert(!crossUpdate.success && crossUpdate.status === 403, 'Cross-event update blocked with 403');

  const crossPass = inviteeService.generateInviteeAccessPass(eventB.id, inv1.id, adminUser);
  assert(!crossPass.success && crossPass.status === 403, 'Cross-event pass generation blocked with 403');

  const crossCancel = inviteeService.cancelInvitee(eventB.id, inv1.id, adminUser);
  assert(!crossCancel.success && crossCancel.status === 403, 'Cross-event cancellation blocked with 403');

  // Valid update of invitee details
  const updateRes = inviteeService.updateInvitee(eventA.id, inv1.id, adminUser, {
    notes: 'Keynote Speaker (Confirmed VIP)',
  });
  assert(updateRes.success && updateRes.invitee?.notes === 'Keynote Speaker (Confirmed VIP)', 'Invitee notes updated successfully');

  // 7. Individual Access Pass Generation & Security
  console.log('\n--- 7. Individual Access Pass Generation & Security ---');
  const issuePassRes = inviteeService.generateInviteeAccessPass(eventA.id, inv1.id, adminUser);
  assert(issuePassRes.success && !!issuePassRes.pass && !!issuePassRes.invitee, 'Individual access pass generated successfully');

  const issuedPass = issuePassRes.pass!;
  const updatedInv1 = issuePassRes.invitee!;

  assert(updatedInv1.status === InviteeStatus.ACCESS_ISSUED, 'Invitee status transitioned to ACCESS_ISSUED');
  assert(updatedInv1.accessPassId === issuedPass.id, 'Invitee access_pass_id matches issued pass ID');
  assert(issuedPass.passType === PassType.EVENT, 'Pass type is strictly EVENT');
  assert(issuedPass.eventId === eventA.id, 'Pass event_id strictly matches approved event');
  assert(issuedPass.validFrom === eventA.startAt, 'Pass valid_from strictly matches event start_at');
  assert(issuedPass.validUntil === eventA.endAt, 'Pass valid_until strictly matches event end_at');
  assert(issuedPass.maxUses === 1, 'Pass max_uses is set to 1 for individual guest access');
  assert(issuedPass.useCount === 0, 'Initial pass use_count is 0');
  assert(issuedPass.status === AccessPassStatus.ACTIVE, 'Initial pass status is ACTIVE');

  // Verify display code format (EVT-XXXX-XXXX)
  assert(/^EVT-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/.test(issuedPass.displayCode), 'Display code matches unambiguous format');

  // 8. Zero Cryptographic Token Leakage
  console.log('\n--- 8. Zero Raw Token Leakage Verification ---');
  assert(!!issuedPass.rawToken, 'Raw token returned to authorized administrator upon creation');
  const rawToken = issuedPass.rawToken!;

  // Verify database record: raw token MUST NOT be stored in DB
  const passInDb = db.prepare('SELECT * FROM access_passes WHERE id = ?').get(issuedPass.id) as any;
  assert(passInDb.token_hash === accessService.hashToken(rawToken), 'Stored token_hash matches SHA-256 computation');
  assert(!('raw_token' in passInDb) && !('rawToken' in passInDb), 'Raw token column does not exist in access_passes table');

  // Verify audit logs: raw token MUST NOT be present in audit logs
  const auditEntries = db.prepare("SELECT * FROM audit_logs WHERE action = 'EVENT_INVITEE_ACCESS_ISSUED'").all() as any[];
  assert(auditEntries.length > 0, 'EVENT_INVITEE_ACCESS_ISSUED audit log recorded');
  let tokenLeaked = false;
  for (const entry of auditEntries) {
    if (entry.metadata && entry.metadata.includes(rawToken)) {
      tokenLeaked = true;
      break;
    }
  }
  assert(!tokenLeaked, 'Raw token strictly absent from audit log metadata');

  // 9. QR Verification URL
  console.log('\n--- 9. QR Verification URL & Code ---');
  const qrUrl = buildVerificationUrl({ token: rawToken, code: issuedPass.displayCode });
  assert(qrUrl.includes('/access/verify?t='), 'QR verification URL uses opaque token parameter');
  assert(!qrUrl.includes('Ngozi'), 'QR verification URL strictly excludes invitee full name');
  assert(!qrUrl.includes('wto.org'), 'QR verification URL strictly excludes invitee email');

  const qrDataUrl = await generateQrDataUrl(qrUrl);
  assert(qrDataUrl.startsWith('data:image/png;base64,'), 'QR DataURL generated cleanly for access card');

  // 10. Pass Verification via Phase 6C Infrastructure
  console.log('\n--- 10. Invitee Access Pass Verification ---');
  accessService.resetRateLimiter();
  const verifyRes = accessService.verifyAccessPass({
    token: rawToken,
    consumeUse: true,
    ipAddress: '102.129.144.1',
  });
  assert(verifyRes.valid, 'Verification succeeds for individual invitee pass');
  assert(verifyRes.event?.title === eventA.title, 'Verified event matches Event A');
  assert(verifyRes.invitee?.fullName === 'Dr. Ngozi Okonjo', 'Verified pass correctly identifies associated invitee');
  assert(verifyRes.useCount === 1, 'Use count incremented to 1');
  assert(verifyRes.remainingUses === 0, 'Remaining uses is now 0');

  // Second use on single-use pass rejected as EXHAUSTED
  const secondVerify = accessService.verifyAccessPass({
    token: rawToken,
    consumeUse: true,
    ipAddress: '102.129.144.1',
  });
  assert(!secondVerify.valid && secondVerify.code === 'ACCESS_EXHAUSTED', 'Second use rejected as ACCESS_EXHAUSTED');

  // 11. Revoke Invitee Access Pass
  console.log('\n--- 11. Invitee Access Revocation Workflow ---');
  // Create another invitee and issue access
  const inv2Res = inviteeService.createInvitee(eventA.id, adminUser, {
    fullName: 'Ambassador Amina Mohammed',
    email: 'amina.mohammed@un.org',
  });
  const inv2 = inv2Res.invitee!;
  const pass2Res = inviteeService.generateInviteeAccessPass(eventA.id, inv2.id, adminUser);
  const pass2 = pass2Res.pass!;

  // Revoke access
  const revokeRes = inviteeService.revokeInviteeAccess(
    eventA.id,
    inv2.id,
    adminUser,
    'Security request to cancel VIP access pass'
  );
  assert(revokeRes.success && !!revokeRes.invitee, 'Invitee access pass revoked successfully');
  const revokedInv2 = revokeRes.invitee!;

  assert(revokedInv2.status === InviteeStatus.INVITED, 'Invitee status reverted to INVITED');
  // Verify historical invitee record was NOT deleted
  const invInDb = db.prepare('SELECT * FROM event_invitees WHERE id = ?').get(inv2.id) as any;
  assert(!!invInDb, 'Historical invitee record is preserved in database');

  // Verify pass is revoked in access_passes
  const passCheck = db.prepare('SELECT status, revoke_reason FROM access_passes WHERE id = ?').get(pass2.id) as any;
  assert(passCheck.status === AccessPassStatus.REVOKED, 'Pass status in database is REVOKED');
  assert(passCheck.revoke_reason === 'Security request to cancel VIP access pass', 'Revocation reason recorded');

  // 12. Cancel Invitee Workflow
  console.log('\n--- 12. Cancel Invitee Workflow ---');
  // Create invitee 3 with access pass
  const inv3Res = inviteeService.createInvitee(eventA.id, adminUser, {
    fullName: 'Guest To Cancel',
    email: 'guest.cancel@example.com',
  });
  const inv3 = inv3Res.invitee!;
  const pass3Res = inviteeService.generateInviteeAccessPass(eventA.id, inv3.id, adminUser);
  const pass3 = pass3Res.pass!;

  // Cancel invitee
  const cancelRes = inviteeService.cancelInvitee(
    eventA.id,
    inv3.id,
    adminUser,
    'Guest unable to attend due to scheduling conflict'
  );
  assert(cancelRes.success && !!cancelRes.invitee, 'Invitee cancelled successfully');
  const cancelledInv3 = cancelRes.invitee!;

  assert(cancelledInv3.status === InviteeStatus.CANCELLED, 'Invitee status updated to CANCELLED');

  // Invitee record MUST STILL EXIST in DB (non-destructive)
  const cancelledInDb = db.prepare('SELECT * FROM event_invitees WHERE id = ?').get(inv3.id) as any;
  assert(!!cancelledInDb, 'Cancelled invitee record is preserved in database (no deletion)');

  // Associated active pass MUST BE REVOKED
  const pass3InDb = db.prepare('SELECT status, revoke_reason FROM access_passes WHERE id = ?').get(pass3.id) as any;
  assert(pass3InDb.status === AccessPassStatus.REVOKED, 'Active access pass was automatically revoked upon invitee cancellation');
  assert(pass3InDb.revoke_reason?.includes('Cancelled invitee'), 'Revoke reason documents invitee cancellation');

  // Cannot issue pass to cancelled invitee
  const passAfterCancel = inviteeService.generateInviteeAccessPass(eventA.id, inv3.id, adminUser);
  assert(!passAfterCancel.success, 'Cannot issue access pass to CANCELLED invitee');

  // 13. Audit Log Coverage
  console.log('\n--- 13. Audit Log Coverage ---');
  const auditLogs = db.prepare("SELECT * FROM audit_logs WHERE action LIKE 'EVENT_INVITEE%'").all() as any[];
  assert(auditLogs.length >= 5, `Recorded ${auditLogs.length} event invitee audit entries`);

  const actions = new Set(auditLogs.map((l) => l.action));
  assert(actions.has('EVENT_INVITEE_CREATED'), 'Audit log contains EVENT_INVITEE_CREATED');
  assert(actions.has('EVENT_INVITEE_UPDATED'), 'Audit log contains EVENT_INVITEE_UPDATED');
  assert(actions.has('EVENT_INVITEE_ACCESS_ISSUED'), 'Audit log contains EVENT_INVITEE_ACCESS_ISSUED');
  assert(actions.has('EVENT_INVITEE_ACCESS_REVOKED'), 'Audit log contains EVENT_INVITEE_ACCESS_REVOKED');
  assert(actions.has('EVENT_INVITEE_CANCELLED'), 'Audit log contains EVENT_INVITEE_CANCELLED');

  // 14. List & Filtering Verification
  console.log('\n--- 14. Summary & Filter Verification ---');
  const listResult = inviteeService.listInvitees(eventA.id, adminUser);
  assert(listResult.success, 'listInvitees succeeded');
  assert(listResult.summary.total >= 4, `Total invitees count is ${listResult.summary.total}`);
  assert(listResult.summary.cancelled >= 1, `Cancelled count is ${listResult.summary.cancelled}`);

  const filteredByStatus = inviteeService.listInvitees(eventA.id, adminUser, { status: InviteeStatus.CANCELLED });
  assert(filteredByStatus.invitees.every((i) => i.status === InviteeStatus.CANCELLED), 'Status filter returns only CANCELLED invitees');

  const filteredBySearch = inviteeService.listInvitees(eventA.id, adminUser, { search: 'Ngozi' });
  assert(filteredBySearch.invitees.some((i) => i.fullName.includes('Ngozi')), 'Search query filters by full name');

  console.log('\n================================================================');
  console.log(`   PHASE 6D TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase6dTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
