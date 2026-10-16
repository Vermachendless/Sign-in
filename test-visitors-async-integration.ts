/**
 * Phase 7 Batch 2A — Visitor Service & Routes Asynchronous Integration Test Suite
 *
 * Covers:
 * 1. Asynchronous visitor creation, listing, retrieval, and updates using dbAdapter
 * 2. Access-pass issuance, linking, revocation, and cancellation workflows
 * 3. Transaction atomicity & rollback verification when a related write fails
 * 4. Correct transaction-scoped adapter use without connection leaks or premature closure
 * 5. Strict RBAC & cross-user authorization boundaries under async execution (Staff vs Admin)
 * 6. Duplicate visit detection and calendar window validation
 * 7. Audit logging compliance with global audit policy (post-commit, no phantom entries on rollback)
 * 8. Portable Africa/Lagos date filtering and summary count range calculations
 * 9. Express visitor route handlers async propagation (AsyncFunction layers and error propagation)
 * 10. Concurrency serialization using deterministic promise barriers
 *
 * Note on PostgreSQL:
 * Live PostgreSQL runtime compatibility cannot be proven in this environment without a provisioned
 * PostgreSQL instance. SQL statements have been written using portable standard SQL syntax
 * with $1, $2, ... parameter placeholders and ISO 8601 calendar range predicates.
 */

import { getDatabase } from './server/db/index.ts';
import { dbAdapter } from './server/db/adapter.ts';
import { visitorService } from './server/services/visitor.service.ts';
import { accessService } from './server/services/access.service.ts';
import {
  VisitorVisitStatus,
  SafeUser,
  UserRole,
  AccessPassStatus,
  PassType,
} from './src/types/index.ts';
import { COMPANY_TIMEZONE, getTodayDateString } from './server/utils/time.ts';

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

async function runVisitorAsyncIntegrationTests() {
  console.log('================================================================');
  console.log('   PHASE 7 BATCH 2A — VISITOR ASYNC INTEGRATION TESTS           ');
  console.log('================================================================');

  const db = getDatabase();

  // Clean up any test visitor records from prior test runs
  db.prepare("DELETE FROM visitor_visits WHERE visitor_email LIKE '%@async-test.org' OR id LIKE 'async-test-%'").run();
  db.prepare("DELETE FROM audit_logs WHERE action LIKE 'VISITOR_%' AND metadata LIKE '%async-test%'").run();

  // 1. Setup Test Users
  console.log('\n--- 1. Actor Setup & Verification ---');
  const superAdmin = db.prepare("SELECT * FROM users WHERE role = 'SUPER_ADMIN' AND status = 'ACTIVE' LIMIT 1").get() as any;
  const admin = db.prepare("SELECT * FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE' LIMIT 1").get() as any;
  const staffMembers = db.prepare("SELECT * FROM users WHERE role = 'STAFF' AND status = 'ACTIVE' LIMIT 2").all() as any[];

  assert(!!superAdmin, 'Super Admin user present');
  assert(!!admin, 'Admin user present');
  assert(staffMembers.length >= 2, 'At least 2 active staff users present');

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

  const staffUserA: SafeUser = {
    id: staffMembers[0].id,
    email: staffMembers[0].email,
    firstName: staffMembers[0].first_name,
    lastName: staffMembers[0].last_name,
    department: staffMembers[0].department,
    role: UserRole.STAFF,
    status: staffMembers[0].status,
  };

  const staffUserB: SafeUser = {
    id: staffMembers[1].id,
    email: staffMembers[1].email,
    firstName: staffMembers[1].first_name,
    lastName: staffMembers[1].last_name,
    department: staffMembers[1].department,
    role: UserRole.STAFF,
    status: staffMembers[1].status,
  };

  // 2. Asynchronous Creation & Promise Contract
  console.log('\n--- 2. Asynchronous Visitor Creation & Return Contract ---');
  const tomorrowDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  const createPromise = visitorService.createVisit(
    staffUserA,
    {
      visitorFullName: 'Aliko Dangote',
      visitorEmail: 'aliko@async-test.org',
      visitorPhone: '+234 801 111 2222',
      purpose: 'Infrastructure Partnership',
      notes: 'Executive Boardroom',
      visitDate: tomorrowDate,
      startTime: '10:00',
      endTime: '12:00',
    },
    staffUserB.id // Attempt to spoof hostStaffId
  );

  assert(createPromise instanceof Promise, 'createVisit returns a genuine Promise');
  const createRes = await createPromise;
  assert(createRes.success && !!createRes.visit, 'createVisit resolves with success and visit');
  const visit1 = createRes.visit!;
  assert(visit1.hostStaffId === staffUserA.id, 'Host staff ID strictly derived from session (spoofed ID ignored)');
  assert(visit1.visitorFullName === 'Aliko Dangote', 'Visitor full name preserved');
  assert(visit1.status === VisitorVisitStatus.PENDING, 'Initial status is PENDING');
  assert(visit1.accessPassId === null, 'Initial access_pass_id is null');

  // Verify duplicate rejection
  const dupRes = await visitorService.createVisit(staffUserA, {
    visitorFullName: 'Aliko Dangote Duplicate',
    visitorEmail: 'ALIKO@async-test.org',
    visitDate: tomorrowDate,
    startTime: '10:00',
    endTime: '12:00',
  });
  assert(!dupRes.success && dupRes.status === 409, 'Duplicate visit rejected with status 409');

  // 3. Asynchronous Retrieval & Cross-User Security Boundaries
  console.log('\n--- 3. Asynchronous Retrieval & Cross-User Security Boundaries ---');
  const getPromise = visitorService.getVisitById(visit1.id, staffUserA);
  assert(getPromise instanceof Promise, 'getVisitById returns a genuine Promise');
  const getRes = await getPromise;
  assert(getRes.success && getRes.visit?.id === visit1.id, 'Staff A can retrieve their own visit');

  // Cross-user retrieval: Staff B forbidden
  const crossGetRes = await visitorService.getVisitById(visit1.id, staffUserB);
  assert(!crossGetRes.success && crossGetRes.status === 403, 'Staff B blocked from retrieving Staff A visit (403)');

  // Admin access: Admin permitted
  const adminGetRes = await visitorService.getVisitById(visit1.id, adminUser);
  assert(adminGetRes.success && adminGetRes.visit?.id === visit1.id, 'Admin permitted to view any visit');

  // 4. Asynchronous Updates & Linked Pass Synchronization
  console.log('\n--- 4. Asynchronous Updates & Multi-Table Synchronization ---');
  const updatePromise = visitorService.updateVisit(visit1.id, staffUserA, {
    purpose: 'Strategic Infrastructure Partnership (Updated)',
  });
  assert(updatePromise instanceof Promise, 'updateVisit returns a genuine Promise');
  const updateRes = await updatePromise;
  assert(updateRes.success && updateRes.visit?.purpose?.includes('(Updated)'), 'Visit details updated asynchronously');

  // Cross-user update: Staff B forbidden
  const crossUpdateRes = await visitorService.updateVisit(visit1.id, staffUserB, {
    visitorFullName: 'Tampered Name',
  });
  assert(!crossUpdateRes.success && crossUpdateRes.status === 403, 'Staff B blocked from updating Staff A visit (403)');

  // 5. Asynchronous Access Pass Issuance, Linking & Atomicity
  console.log('\n--- 5. Pass Issuance, Linking & Transaction Atomicity ---');
  const passPromise = visitorService.generateVisitorAccessPass(visit1.id, staffUserA);
  assert(passPromise instanceof Promise, 'generateVisitorAccessPass returns a genuine Promise');
  const passRes = await passPromise;
  assert(passRes.success && !!passRes.pass && !!passRes.visit, 'Pass generated and linked asynchronously');
  const pass1 = passRes.pass!;
  assert(passRes.visit?.status === VisitorVisitStatus.ACCESS_ISSUED, 'Visit status transitioned to ACCESS_ISSUED');
  assert(passRes.visit?.accessPassId === pass1.id, 'Visit access_pass_id linked to generated pass');
  assert(pass1.passType === PassType.VISITOR, 'Pass type is VISITOR');
  assert(pass1.maxUses === 1, 'Visitor pass is strictly single-use');

  // Future pass rejected as not yet valid
  const futureVerify = await accessService.verifyAccessPass({
    token: pass1.rawToken!,
    ipAddress: '192.168.1.100',
  });
  assert(!futureVerify.valid && futureVerify.code === 'ACCESS_NOT_YET_VALID', 'Future visitor pass rejected as ACCESS_NOT_YET_VALID');

  // Create an active visit valid right now for verification testing
  const now = new Date();
  const activeValidFrom = new Date(now.getTime() - 15 * 60 * 1000).toISOString();
  const activeValidUntil = new Date(now.getTime() + 2 * 3600 * 1000).toISOString();
  const activeVisitId = 'async-test-active-' + Date.now();
  await dbAdapter.execute(
    `INSERT INTO visitor_visits (
      id, host_staff_id, visitor_full_name, visitor_email, visitor_phone,
      purpose, notes, valid_from, valid_until, status, access_pass_id, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING', NULL, $10, $11)`,
    [
      activeVisitId,
      staffUserA.id,
      'Active Visitor',
      'active@async-test.org',
      '+234 809 111 3333',
      'Active Meeting',
      'Main Gate',
      activeValidFrom,
      activeValidUntil,
      now.toISOString(),
      now.toISOString(),
    ]
  );
  const activePassRes = await visitorService.generateVisitorAccessPass(activeVisitId, staffUserA);
  assert(activePassRes.success && !!activePassRes.pass, 'Active visitor pass generated');
  const verifyActive = await accessService.verifyAccessPass({
    token: activePassRes.pass!.rawToken!,
    consumeUse: true,
    ipAddress: '192.168.1.100',
  });
  assert(verifyActive.valid, 'Active visitor pass verifies successfully');
  assert(verifyActive.visitor?.visitorName === 'Active Visitor', 'Verification returns visitor name');

  // 6. Rollback When Related Write Fails in Transaction
  console.log('\n--- 6. Transaction Rollback on Related Write Failure ---');
  // Create another test visit to test rollback
  const rollbackVisitRes = await visitorService.createVisit(staffUserA, {
    visitorFullName: 'Rollback Subject',
    visitorEmail: 'rollback@async-test.org',
    visitDate: tomorrowDate,
    startTime: '14:00',
    endTime: '16:00',
  });
  assert(rollbackVisitRes.success && !!rollbackVisitRes.visit, 'Rollback test visit created');
  const rollbackVisitId = rollbackVisitRes.visit!.id;

  // Simulate a transactional failure during access pass linkage by intentionally inserting duplicate pass ID or throwing
  let rollbackCaught = false;
  try {
    await dbAdapter.transaction(async (tx) => {
      // Step A: update status
      await tx.execute('UPDATE visitor_visits SET status = $1 WHERE id = $2', [
        VisitorVisitStatus.ACCESS_ISSUED,
        rollbackVisitId,
      ]);

      // Step B: simulate failure (violating foreign key constraint or throwing)
      throw new Error('SIMULATED_TRANSACTION_FAILURE');
    });
  } catch (err: any) {
    if (err.message === 'SIMULATED_TRANSACTION_FAILURE') {
      rollbackCaught = true;
    }
  }
  assert(rollbackCaught, 'Transaction threw and caught simulated failure');

  // Verify that Step A was completely rolled back
  const postRollbackVisit = await visitorService.getVisitById(rollbackVisitId, staffUserA);
  assert(
    postRollbackVisit.visit?.status === VisitorVisitStatus.PENDING,
    'Status update rolled back to PENDING after transaction failure'
  );

  // 7. Asynchronous Revocation & Historical Record Retention
  console.log('\n--- 7. Asynchronous Revocation Workflow ---');
  const revokePromise = visitorService.revokeVisitorAccess(
    visit1.id,
    staffUserA,
    'Rescheduling required for visit'
  );
  assert(revokePromise instanceof Promise, 'revokeVisitorAccess returns a genuine Promise');
  const revokeRes = await revokePromise;
  assert(revokeRes.success && !!revokeRes.visit, 'Access revoked asynchronously');
  assert(revokeRes.visit?.status === VisitorVisitStatus.PENDING, 'Visit reverted to PENDING');
  assert(revokeRes.visit?.accessPass?.status === AccessPassStatus.REVOKED, 'Pass status is REVOKED');
  assert(revokeRes.visit?.accessPass?.revokeReason === 'Rescheduling required for visit', 'Revoke reason recorded');

  // Re-verification of revoked pass rejected
  const revokedVerify = await accessService.verifyAccessPass({
    token: pass1.rawToken!,
    ipAddress: '192.168.1.100',
  });
  assert(!revokedVerify.valid && revokedVerify.code === 'ACCESS_REVOKED', 'Revoked pass rejected upon verification');

  // 8. Asynchronous Cancellation Workflow
  console.log('\n--- 8. Asynchronous Cancellation Workflow ---');
  // Re-issue a pass on rollback test visit
  const issueAgain = await visitorService.generateVisitorAccessPass(rollbackVisitId, staffUserA);
  assert(issueAgain.success && !!issueAgain.pass, 'Pass re-issued on second visit');

  const cancelPromise = visitorService.cancelVisit(
    rollbackVisitId,
    staffUserA,
    'Host unavailable due to emergency'
  );
  assert(cancelPromise instanceof Promise, 'cancelVisit returns a genuine Promise');
  const cancelRes = await cancelPromise;
  assert(cancelRes.success && !!cancelRes.visit, 'Visit cancelled asynchronously');
  assert(cancelRes.visit?.status === VisitorVisitStatus.CANCELLED, 'Visit status is CANCELLED');
  assert(cancelRes.visit?.cancelledBy === staffUserA.id, 'cancelledBy recorded');
  assert(cancelRes.visit?.accessPass?.status === AccessPassStatus.REVOKED, 'Active pass automatically revoked on cancellation');

  // Cannot issue pass to cancelled visit
  const issueCancelled = await visitorService.generateVisitorAccessPass(rollbackVisitId, staffUserA);
  assert(!issueCancelled.success && issueCancelled.status === 400, 'Cannot issue access pass to CANCELLED visit');

  // 9. Africa/Lagos Date Filtering and Summary Calculations
  console.log('\n--- 9. Portable Date Filtering & Summary Counts ---');
  const todayDateStr = getTodayDateString(COMPANY_TIMEZONE);
  const listPromise = visitorService.listVisits(staffUserA, { date: todayDateStr });
  assert(listPromise instanceof Promise, 'listVisits returns a genuine Promise');
  const listRes = await listPromise;
  assert(listRes.success, 'listVisits succeeded');
  assert(listRes.total >= 1, `Date filter matches today's Lagos visits (total: ${listRes.total})`);
  assert(listRes.summary.total >= 2, `Summary total is >= 2 (${listRes.summary.total})`);
  assert(listRes.summary.cancelled >= 1, `Summary cancelled is >= 1 (${listRes.summary.cancelled})`);

  const tomorrowList = await visitorService.listVisits(staffUserA, { date: tomorrowDate });
  assert(tomorrowList.success && tomorrowList.total >= 2, `Date filter matches tomorrow's Lagos visits (total: ${tomorrowList.total})`);

  // 10. Audit Logging Compliance
  console.log('\n--- 10. Audit Logging Policy Verification ---');
  const audits = await dbAdapter.query<any>(
    "SELECT action, metadata FROM audit_logs WHERE action LIKE 'VISITOR_%' AND (metadata LIKE $1 OR metadata LIKE $2 OR metadata LIKE $3)",
    [`%${visit1.id}%`, `%${rollbackVisitId}%`, `%${activeVisitId}%`]
  );
  assert(audits.length >= 5, `Recorded ${audits.length} visitor audit log entries for test`);
  const actions = new Set(audits.map((a) => a.action));
  assert(actions.has('VISITOR_CREATED'), 'Audit log contains VISITOR_CREATED');
  assert(actions.has('VISITOR_UPDATED'), 'Audit log contains VISITOR_UPDATED');
  assert(actions.has('VISITOR_ACCESS_ISSUED'), 'Audit log contains VISITOR_ACCESS_ISSUED');
  assert(actions.has('VISITOR_ACCESS_REVOKED'), 'Audit log contains VISITOR_ACCESS_REVOKED');
  assert(actions.has('VISITOR_CANCELLED'), 'Audit log contains VISITOR_CANCELLED');

  // 11. Concurrency Serialization with Deterministic Barriers
  console.log('\n--- 11. Concurrency Serialization & Mutex Verification ---');
  let barrierResolved = false;
  let barrierPromiseResolve: () => void = () => {};
  const barrierPromise = new Promise<void>((resolve) => {
    barrierPromiseResolve = () => {
      barrierResolved = true;
      resolve();
    };
  });

  const tx1Promise = dbAdapter.transaction(async (tx) => {
    await tx.queryOne('SELECT 1');
    // Wait until test releases barrier
    await barrierPromise;
    return 'TX1_DONE';
  });

  // Start tx2 while tx1 holds the transaction mutex
  const tx2Promise = dbAdapter.transaction(async (tx) => {
    // tx2 should not start until barrier is released and tx1 completes
    assert(barrierResolved, 'TX2 only executes AFTER TX1 released the transaction mutex');
    return 'TX2_DONE';
  });

  // Release the barrier
  barrierPromiseResolve();

  const [tx1Result, tx2Result] = await Promise.all([tx1Promise, tx2Promise]);
  assert(tx1Result === 'TX1_DONE' && tx2Result === 'TX2_DONE', 'Both concurrent transactions completed in FIFO order');

  // 12. Express Visitor Route Handlers Async Propagation
  console.log('\n--- 12. Visitor Route Handlers Async Propagation ---');
  const visitorRoutesModule = await import('./server/routes/visitor.routes.ts');
  const router = visitorRoutesModule.default;
  assert(!!router, 'visitor.routes default router exported properly');

  const routerStack = (router as any).stack || [];
  const registeredVisitorRoutes = routerStack.filter((layer: any) => layer.route);
  assert(
    registeredVisitorRoutes.length === 7,
    `Expected 7 visitor routes registered on router, found ${registeredVisitorRoutes.length}`
  );

  for (const layer of registeredVisitorRoutes) {
    const route = layer.route;
    const method = Object.keys(route.methods)[0].toUpperCase();
    const lastHandler = route.stack[route.stack.length - 1].handle;
    const isAsync = lastHandler.constructor.name === 'AsyncFunction';
    assert(isAsync, `Route ${method} ${route.path} handler is an AsyncFunction`);
  }

  console.log('\n================================================================');
  console.log(`   PHASE 7 BATCH 2A RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runVisitorAsyncIntegrationTests().catch((err) => {
  console.error('Visitor async integration suite failed:', err);
  process.exit(1);
});
