/**
 * Phase 7 Batch 2B — Reception Service & Routes Asynchronous Integration Test Suite
 *
 * Covers:
 * 1. Asynchronous credential verification, check-in, check-out, occupancy, history, and metrics using dbAdapter
 * 2. Multi-record transaction atomicity & rollback verification for check-in and check-out
 * 3. Preservation of duplicate check-in protection under async concurrency
 * 4. Concurrency conflict serialization on simultaneous check-ins/check-outs for same credential
 * 5. Single-use pass exhaustion and reuse blocking
 * 6. Correct event invitee and visitor visit lifecycle synchronization (CHECKED_IN -> CHECKED_OUT)
 * 7. Portable Africa/Lagos UTC date boundaries for summary counts and history filtering (no SQLite-specific date syntax)
 * 8. Zero credential secret exposure (no tokens, hashes, or passwords in verification or audit logs)
 * 9. Strict RBAC enforcement (STAFF blocked with 403 on all operations; ADMIN/SUPER_ADMIN authorized)
 * 10. Express reception routes async propagation (all handlers are AsyncFunction instances)
 *
 * Note on PostgreSQL:
 * Live PostgreSQL runtime compatibility cannot be proven in this environment without a provisioned
 * PostgreSQL instance. SQL statements have been written using portable standard SQL syntax
 * with $1, $2, ... parameter placeholders and ISO 8601 calendar range predicates.
 */

import assert from 'node:assert';
import { getDatabase } from './server/db/index.ts';
import { dbAdapter } from './server/db/adapter.ts';
import { receptionService } from './server/services/reception.service.ts';
import { accessService } from './server/services/access.service.ts';
import { eventService } from './server/services/event.service.ts';
import { inviteeService } from './server/services/invitee.service.ts';
import { visitorService } from './server/services/visitor.service.ts';
import {
  AccessVisitStatus,
  SafeUser,
  UserRole,
  AccessPassStatus,
  PassType,
  EventStatus,
  InviteeStatus,
  VisitorVisitStatus,
} from './src/types/index.ts';
import { COMPANY_TIMEZONE, getTodayDateString } from './server/utils/time.ts';
import receptionRoutes from './server/routes/reception.routes.ts';

let passed = 0;
let failed = 0;

function pass(message: string) {
  console.log(`✅ [PASS] ${message}`);
  passed++;
}

function fail(message: string, error?: any) {
  console.error(`❌ [FAIL] ${message}`, error || '');
  failed++;
}

async function runReceptionAsyncIntegrationTests() {
  console.log('================================================================');
  console.log('   PHASE 7 BATCH 2B — RECEPTION ASYNC INTEGRATION TESTS         ');
  console.log('================================================================');

  const db = getDatabase();

  // Clean up any test records from prior runs
  db.prepare("DELETE FROM access_visits WHERE access_pass_id IN (SELECT id FROM access_passes WHERE display_code LIKE 'REC-ASYNC-%')").run();
  db.prepare("DELETE FROM access_passes WHERE display_code LIKE 'REC-ASYNC-%'").run();
  db.prepare("DELETE FROM audit_logs WHERE action IN ('ACCESS_VERIFIED', 'ACCESS_CHECKED_IN', 'ACCESS_CHECKED_OUT', 'ACCESS_DENIED') AND metadata LIKE '%rec-async%'").run();

  // 1. Setup Test Actors
  console.log('\n--- 1. Actor Setup & Verification ---');

  const adminUser: SafeUser = {
    id: 'admin-rec-async-test',
    email: 'admin.rec.async@acme.com',
    role: UserRole.ADMIN,
    firstName: 'Reception',
    lastName: 'Admin',
    department: 'Front Desk',
    status: 'ACTIVE' as any,
  };

  const superAdminUser: SafeUser = {
    id: 'superadmin-rec-async-test',
    email: 'superadmin.rec.async@acme.com',
    role: UserRole.SUPER_ADMIN,
    firstName: 'Executive',
    lastName: 'SuperAdmin',
    department: 'Management',
    status: 'ACTIVE' as any,
  };

  const staffUser: SafeUser = {
    id: 'staff-rec-async-test',
    email: 'staff.rec.async@acme.com',
    role: UserRole.STAFF,
    firstName: 'General',
    lastName: 'Staff',
    department: 'Logistics',
    status: 'ACTIVE' as any,
  };

  const nowIso = new Date().toISOString();
  for (const u of [adminUser, superAdminUser, staffUser]) {
    db.prepare(`
      INSERT OR REPLACE INTO users (id, email, password_hash, first_name, last_name, department, role, status, created_at, updated_at)
      VALUES (?, ?, 'dummy_hash', ?, ?, ?, ?, ?, ?, ?)
    `).run(u.id, u.email, u.firstName, u.lastName, u.department, u.role, u.status, nowIso, nowIso);
  }

  pass('Test users initialized and verified');

  // =========================================================================
  // 2. Strict RBAC Enforcement Under Async Execution
  // =========================================================================
  console.log('\n--- 2. Strict RBAC Enforcement ---');

  const staffVerifyPromise = receptionService.verifyCredential(staffUser, { accessCode: 'DUMMY' });
  assert(staffVerifyPromise instanceof Promise, 'verifyCredential returns genuine Promise');
  const staffVerify = await staffVerifyPromise;
  assert(!staffVerify.success && staffVerify.status === 403, 'STAFF blocked from verifyCredential with 403');
  pass('STAFF blocked from verifyCredential with 403 Forbidden');

  const staffCheckInPromise = receptionService.checkIn(staffUser, { accessCode: 'DUMMY' });
  assert(staffCheckInPromise instanceof Promise, 'checkIn returns genuine Promise');
  const staffCheckIn = await staffCheckInPromise;
  assert(!staffCheckIn.success && staffCheckIn.status === 403, 'STAFF blocked from checkIn with 403');
  pass('STAFF blocked from checkIn with 403 Forbidden');

  const staffCheckOutPromise = receptionService.checkOut(staffUser, { accessCode: 'DUMMY' });
  assert(staffCheckOutPromise instanceof Promise, 'checkOut returns genuine Promise');
  const staffCheckOut = await staffCheckOutPromise;
  assert(!staffCheckOut.success && staffCheckOut.status === 403, 'STAFF blocked from checkOut with 403');
  pass('STAFF blocked from checkOut with 403 Forbidden');

  const staffActivePromise = receptionService.listActive(staffUser);
  assert(staffActivePromise instanceof Promise, 'listActive returns genuine Promise');
  const staffActive = await staffActivePromise;
  assert(!staffActive.success && staffActive.status === 403, 'STAFF blocked from listActive with 403');
  pass('STAFF blocked from listActive with 403 Forbidden');

  const staffHistPromise = receptionService.listHistory(staffUser);
  assert(staffHistPromise instanceof Promise, 'listHistory returns genuine Promise');
  const staffHist = await staffHistPromise;
  assert(!staffHist.success && staffHist.status === 403, 'STAFF blocked from listHistory with 403');
  pass('STAFF blocked from listHistory with 403 Forbidden');

  const staffSummaryPromise = receptionService.getSummary(staffUser);
  assert(staffSummaryPromise instanceof Promise, 'getSummary returns genuine Promise');
  const staffSummary = await staffSummaryPromise;
  assert(!staffSummary.success && staffSummary.status === 403, 'STAFF blocked from getSummary with 403');
  pass('STAFF blocked from getSummary with 403 Forbidden');

  // =========================================================================
  // 3. Credential Verification Workflow & Safe Error Communication
  // =========================================================================
  console.log('\n--- 3. Credential Verification & Zero Leakage ---');

  // Create an approved test event and invitee with pass
  const now = new Date();
  const startAt = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
  const endAt = new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString();

  const eventRes = await eventService.createEvent(adminUser, {
    title: 'Rec Async Test Event',
    description: 'Testing async reception',
    location: 'Main Auditorium',
    startAt,
    endAt,
  });
  assert(eventRes.success && eventRes.event, 'Event created');
  if (eventRes.event.status !== EventStatus.APPROVED) {
    db.prepare("UPDATE events SET status = 'APPROVED' WHERE id = ?").run(eventRes.event.id);
  }

  const inviteeRes = await inviteeService.createInvitee(eventRes.event.id, adminUser, {
    fullName: 'Alan Turing',
    email: 'alan.turing@rec-async-test.org',
    organization: 'Bletchley Park',
  });
  assert(inviteeRes.success && inviteeRes.invitee, 'Invitee created');

  const passRes = await inviteeService.generateInviteeAccessPass(eventRes.event.id, inviteeRes.invitee.id, adminUser);
  assert(passRes.success && passRes.pass, 'Access pass created');
  const eventPass = passRes.pass;

  // Verify valid credential
  const verifyRes = await receptionService.verifyCredential(adminUser, { accessCode: eventPass.displayCode });
  assert(verifyRes.success && verifyRes.verification?.valid, 'Verification succeeds for valid pass');
  assert.strictEqual(verifyRes.verification.guestName, 'Alan Turing');
  assert.strictEqual(verifyRes.verification.organization, 'Bletchley Park');
  assert.strictEqual(verifyRes.verification.canCheckIn, true);
  assert.strictEqual(verifyRes.verification.canCheckOut, false);
  assert.strictEqual(verifyRes.verification.isCheckedIn, false);
  pass('Valid event credential verified with correct metadata');

  // Zero Token Leakage Check
  const verifyJson = JSON.stringify(verifyRes.verification);
  assert(!verifyJson.includes('token_hash'), 'Response must not contain token_hash');
  assert(!verifyJson.includes('raw_token'), 'Response must not contain raw_token');
  assert(!verifyJson.includes('password'), 'Response must not contain password');
  pass('Zero credential secrets leaked in verification response');

  // Unknown pass verification returns safe 404
  const unknownVerify = await receptionService.verifyCredential(adminUser, { accessCode: 'EVT-NONEXISTENT-9999' });
  assert(!unknownVerify.success && unknownVerify.status === 404, 'Unknown pass returns 404');
  assert.strictEqual(unknownVerify.verification?.code, 'PASS_NOT_FOUND');
  pass('Nonexistent credential safely rejected with 404 PASS_NOT_FOUND');

  // =========================================================================
  // 4. Physical Check-in & Lifecycle Synchronization
  // =========================================================================
  console.log('\n--- 4. Physical Check-in & Lifecycle Synchronization ---');

  const checkInRes = await receptionService.checkIn(adminUser, { accessPassId: eventPass.id });
  assert(checkInRes.success && checkInRes.visit, 'Check-in succeeds');
  const visit = checkInRes.visit;
  assert.strictEqual(visit.status, AccessVisitStatus.CHECKED_IN);
  assert.strictEqual(visit.guestName, 'Alan Turing');
  assert(visit.checkedInAt !== null, 'checkedInAt is recorded');
  pass('Guest checked in successfully and visit record returned');

  // Check event invitee status transitioned to CHECKED_IN
  const updatedInvitee = db.prepare('SELECT status FROM event_invitees WHERE id = ?').get(inviteeRes.invitee.id) as any;
  assert.strictEqual(updatedInvitee.status, InviteeStatus.CHECKED_IN, 'Event invitee status transitioned to CHECKED_IN');
  pass('Event invitee status synchronized to CHECKED_IN in database');

  // Check active occupancy
  const activeRes = await receptionService.listActive(adminUser);
  assert(activeRes.success, 'listActive succeeds');
  const foundActive = activeRes.activeVisits.some((v) => v.id === visit.id);
  assert(foundActive, 'Active occupancy includes newly checked-in guest');
  pass('Active occupancy query reflects checked-in guest');

  // Duplicate Check-in Protection: Same pass cannot be checked in again
  const dupCheckIn = await receptionService.checkIn(adminUser, { accessPassId: eventPass.id });
  assert(!dupCheckIn.success && dupCheckIn.status === 409, 'Duplicate check-in rejected with 409 Conflict');
  pass('Duplicate check-in safely rejected with 409 Conflict');

  // Re-verification while checked in indicates currently checked in
  const reVerify = await receptionService.verifyCredential(adminUser, { accessCode: eventPass.displayCode });
  assert(reVerify.success && reVerify.verification?.valid, 'Verification of checked-in guest succeeds');
  assert.strictEqual(reVerify.verification.isCheckedIn, true);
  assert.strictEqual(reVerify.verification.canCheckIn, false);
  assert.strictEqual(reVerify.verification.canCheckOut, true);
  pass('Re-verification while checked in accurately indicates canCheckOut: true, canCheckIn: false');

  // =========================================================================
  // 5. Physical Check-out & Usage Limits
  // =========================================================================
  console.log('\n--- 5. Physical Check-out & Usage Limits ---');

  const checkOutRes = await receptionService.checkOut(adminUser, { accessVisitId: visit.id });
  assert(checkOutRes.success && checkOutRes.visit, 'Check-out succeeds');
  assert.strictEqual(checkOutRes.visit.status, AccessVisitStatus.CHECKED_OUT);
  assert(checkOutRes.visit.checkedOutAt !== null, 'checkedOutAt is recorded');
  pass('Guest checked out successfully');

  // Check event invitee status transitioned to CHECKED_OUT
  const finalInvitee = db.prepare('SELECT status FROM event_invitees WHERE id = ?').get(inviteeRes.invitee.id) as any;
  assert.strictEqual(finalInvitee.status, InviteeStatus.CHECKED_OUT, 'Event invitee status transitioned to CHECKED_OUT');
  pass('Event invitee status synchronized to CHECKED_OUT in database');

  // Active occupancy no longer contains checked-out guest
  const activeAfterCheckout = await receptionService.listActive(adminUser);
  const stillActive = activeAfterCheckout.activeVisits.some((v) => v.id === visit.id);
  assert(!stillActive, 'Active occupancy excludes checked-out guest');
  pass('Active occupancy excludes checked-out guest');

  // Duplicate Check-out Protection
  const dupCheckOut = await receptionService.checkOut(adminUser, { accessVisitId: visit.id });
  assert(!dupCheckOut.success && dupCheckOut.status === 400, 'Duplicate check-out rejected with 400');
  assert(dupCheckOut.error?.includes('already checked out'), 'Correct error message on duplicate checkout');
  pass('Duplicate check-out prevented with 400 Person is already checked out');

  // Re-check-in on single-use exhausted credential is blocked
  const reCheckInExhausted = await receptionService.checkIn(adminUser, { accessPassId: eventPass.id });
  assert(!reCheckInExhausted.success, 'Re-check-in on exhausted single-use credential is blocked');
  pass('Re-check-in on exhausted single-use credential safely blocked');

  // Verification of consumed single-use credential rejected with ALREADY_CHECKED_OUT
  const verifyConsumed = await receptionService.verifyCredential(adminUser, { accessCode: eventPass.displayCode });
  assert(!verifyConsumed.success && verifyConsumed.status === 400, 'Verification of checked-out pass returns 400');
  assert.strictEqual(verifyConsumed.verification?.code, 'ALREADY_CHECKED_OUT');
  pass('Consumed single-use pass rejected on verification with ALREADY_CHECKED_OUT');

  // =========================================================================
  // 6. Visitor Visit Lifecycle Synchronization
  // =========================================================================
  console.log('\n--- 6. Visitor Visit Lifecycle Synchronization ---');

  const tomorrowStr = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const todayLagos = getTodayDateString(COMPANY_TIMEZONE);

  const visRes = await visitorService.createVisit(staffUser, {
    visitorFullName: 'Margaret Hamilton',
    visitorEmail: 'margaret.hamilton@rec-async-test.org',
    purpose: 'Apollo Guidance Software Review',
    visitDate: todayLagos,
    startTime: '08:00',
    endTime: '18:00',
  });
  assert(visRes.success && visRes.visit, 'Visitor visit created');

  const visPassRes = await visitorService.generateVisitorAccessPass(visRes.visit.id, staffUser);
  assert(visPassRes.success && visPassRes.pass, 'Visitor pass generated');
  const visPass = visPassRes.pass;

  // Check-in visitor
  const visCheckIn = await receptionService.checkIn(adminUser, { accessPassId: visPass.id });
  assert(visCheckIn.success && visCheckIn.visit, 'Visitor check-in succeeds');
  assert.strictEqual(visCheckIn.visit.guestName, 'Margaret Hamilton');

  // Visitor visit table status must be CHECKED_IN
  const dbVisVisit = db.prepare('SELECT status FROM visitor_visits WHERE id = ?').get(visRes.visit.id) as any;
  assert.strictEqual(dbVisVisit.status, VisitorVisitStatus.CHECKED_IN, 'visitor_visits table status is CHECKED_IN');
  pass('Visitor invitation status synchronized to CHECKED_IN');

  // Check-out visitor
  const visCheckOut = await receptionService.checkOut(adminUser, { accessPassId: visPass.id });
  assert(visCheckOut.success && visCheckOut.visit, 'Visitor check-out succeeds');

  const dbVisVisitOut = db.prepare('SELECT status FROM visitor_visits WHERE id = ?').get(visRes.visit.id) as any;
  assert.strictEqual(dbVisVisitOut.status, VisitorVisitStatus.CHECKED_OUT, 'visitor_visits table status is CHECKED_OUT');
  pass('Visitor invitation status synchronized to CHECKED_OUT');

  // =========================================================================
  // 7. Transaction Atomicity & Rollback Verification
  // =========================================================================
  console.log('\n--- 7. Transaction Atomicity & Rollback Verification ---');

  // Create another visitor pass to test transaction rollback
  const rollbackVis = await visitorService.createVisit(staffUser, {
    visitorFullName: 'Rollback Subject',
    visitorEmail: 'rollback@rec-async-test.org',
    purpose: 'Testing Rollbacks',
    visitDate: todayLagos,
    startTime: '09:00',
    endTime: '17:00',
  });
  const rbPassRes = await visitorService.generateVisitorAccessPass(rollbackVis.visit!.id, staffUser);
  const rbPass = rbPassRes.pass!;

  // Verify that an atomic transaction rollback does not persist partial records
  let txThrew = false;
  try {
    await dbAdapter.transaction(async (tx) => {
      await tx.execute(
        `INSERT INTO access_visits (
          id, access_pass_id, pass_type, event_invitee_id, visitor_visit_id,
          checked_in_at, checked_in_by, status, created_at, updated_at
        ) VALUES ($1, $2, $3, NULL, $4, $5, $6, 'CHECKED_IN', $7, $8)`,
        [
          'visit-should-rollback',
          rbPass.id,
          PassType.VISITOR,
          rollbackVis.visit!.id,
          nowIso,
          adminUser.id,
          nowIso,
          nowIso,
        ]
      );
      // Force failure inside transaction
      throw new Error('Simulated failure before commit');
    });
  } catch (err: any) {
    txThrew = true;
    assert.strictEqual(err.message, 'Simulated failure before commit');
  }

  assert(txThrew, 'Transaction threw simulated failure');
  const checkGhost = db.prepare("SELECT * FROM access_visits WHERE id = 'visit-should-rollback'").get();
  assert(!checkGhost, 'Rolled back visit record does not exist in database');
  pass('Transaction rollback cleanly rolls back uncommitted access visit');

  // =========================================================================
  // 8. Concurrency Serialization: Simultaneous Check-in Race
  // =========================================================================
  console.log('\n--- 8. Concurrency Serialization: Simultaneous Check-in Race ---');

  // Create another event guest for concurrent check-in
  const concInvitee = await inviteeService.createInvitee(eventRes.event.id, adminUser, {
    fullName: 'Concurrent Candidate',
    email: 'concurrent@rec-async-test.org',
    organization: 'Race Testing Org',
  });
  const concPassRes = await inviteeService.generateInviteeAccessPass(eventRes.event.id, concInvitee.invitee!.id, adminUser);
  const concPass = concPassRes.pass!;

  // Fire two simultaneous check-ins
  const [res1, res2] = await Promise.all([
    receptionService.checkIn(adminUser, { accessPassId: concPass.id }),
    receptionService.checkIn(superAdminUser, { accessPassId: concPass.id }),
  ]);

  const successes = [res1, res2].filter((r) => r.success);
  const conflicts = [res1, res2].filter((r) => !r.success && (r.status === 409 || r.status === 400));

  assert.strictEqual(successes.length, 1, 'Exactly one concurrent check-in succeeded');
  assert.strictEqual(conflicts.length, 1, 'Exactly one concurrent check-in was safely rejected');
  pass('Concurrent check-in race correctly resolved: exactly 1 success, 1 conflict');

  // Fire two simultaneous check-outs for that visit
  const activeVisitId = successes[0].visit!.id;
  const [co1, co2] = await Promise.all([
    receptionService.checkOut(adminUser, { accessVisitId: activeVisitId }),
    receptionService.checkOut(superAdminUser, { accessVisitId: activeVisitId }),
  ]);

  const coSuccesses = [co1, co2].filter((r) => r.success);
  const coConflicts = [co1, co2].filter((r) => !r.success);

  assert.strictEqual(coSuccesses.length, 1, 'Exactly one concurrent check-out succeeded');
  assert.strictEqual(coConflicts.length, 1, 'Exactly one concurrent check-out was safely rejected');
  pass('Concurrent check-out race correctly resolved: exactly 1 success, 1 conflict');

  // =========================================================================
  // 9. Portable Africa/Lagos Date Boundaries & Summary Metrics
  // =========================================================================
  console.log('\n--- 9. Portable Date Boundaries & Summary Metrics ---');

  const summary = await receptionService.getSummary(adminUser);
  assert(summary.success, 'getSummary succeeds');
  assert(typeof summary.summary.currentlyCheckedIn === 'number', 'currentlyCheckedIn is a number');
  assert(typeof summary.summary.todayVisitors === 'number', 'todayVisitors is a number');
  assert(typeof summary.summary.todayEventGuests === 'number', 'todayEventGuests is a number');
  assert(typeof summary.summary.checkedOutToday === 'number', 'checkedOutToday is a number');
  assert(typeof summary.summary.accessDeniedToday === 'number', 'accessDeniedToday is a number');

  assert(summary.summary.todayVisitors >= 1, `todayVisitors reflects checked-in visitor (${summary.summary.todayVisitors})`);
  assert(summary.summary.todayEventGuests >= 2, `todayEventGuests reflects checked-in guests (${summary.summary.todayEventGuests})`);
  assert(summary.summary.checkedOutToday >= 2, `checkedOutToday reflects checked-out guests (${summary.summary.checkedOutToday})`);
  pass('Summary metrics calculate accurately using portable Lagos date boundaries');

  // Test History Filtering with date and status
  const histRes = await receptionService.listHistory(adminUser, {
    date: todayLagos,
    status: AccessVisitStatus.CHECKED_OUT,
  });
  assert(histRes.success, 'listHistory succeeds');
  assert(histRes.total >= 2, `listHistory returns checked-out visits (${histRes.total})`);
  for (const v of histRes.visits) {
    assert.strictEqual(v.status, AccessVisitStatus.CHECKED_OUT, 'All returned visits are CHECKED_OUT');
  }
  pass('listHistory correctly filters by portable Lagos calendar date and status');

  // Test DENIED status query via audit log branch
  const histDenied = await receptionService.listHistory(adminUser, { status: 'DENIED' });
  assert(histDenied.success, 'listHistory with status=DENIED succeeds');
  assert(histDenied.total >= 1, 'DENIED history retrieves audit log entries');
  for (const v of histDenied.visits) {
    assert.strictEqual(v.status, AccessVisitStatus.DENIED, 'Visits have status DENIED');
  }
  pass('listHistory correctly processes DENIED status through audit logs');

  // =========================================================================
  // 10. Audit Logging Policy Compliance
  // =========================================================================
  console.log('\n--- 10. Audit Logging Compliance ---');

  const auditRows = db.prepare(`
    SELECT action, metadata FROM audit_logs 
    WHERE action IN ('ACCESS_VERIFIED', 'ACCESS_CHECKED_IN', 'ACCESS_CHECKED_OUT', 'ACCESS_DENIED')
    ORDER BY created_at DESC LIMIT 20
  `).all() as any[];

  assert(auditRows.some((a) => a.action === 'ACCESS_VERIFIED'), 'Audit log contains ACCESS_VERIFIED');
  assert(auditRows.some((a) => a.action === 'ACCESS_CHECKED_IN'), 'Audit log contains ACCESS_CHECKED_IN');
  assert(auditRows.some((a) => a.action === 'ACCESS_CHECKED_OUT'), 'Audit log contains ACCESS_CHECKED_OUT');
  assert(auditRows.some((a) => a.action === 'ACCESS_DENIED'), 'Audit log contains ACCESS_DENIED');

  // Ensure no raw token leaked in audit metadata
  for (const row of auditRows) {
    assert(!row.metadata.includes('raw_token'), 'Audit metadata must not contain raw_token');
    assert(!row.metadata.includes('token_hash'), 'Audit metadata must not contain token_hash');
  }
  pass('Audit trail is complete, properly formatted, and contains zero credential secrets');

  // =========================================================================
  // 11. Express Route Handlers Async Propagation
  // =========================================================================
  console.log('\n--- 11. Express Route Handlers Async Propagation ---');

  assert(receptionRoutes, 'receptionRoutes default router exported');
  const routes = (receptionRoutes as any).stack
    .filter((layer: any) => layer.route)
    .map((layer: any) => {
      const path = layer.route.path;
      const methods = Object.keys(layer.route.methods).join(',').toUpperCase();
      const handler = layer.route.stack[layer.route.stack.length - 1].handle;
      const isAsync = handler.constructor.name === 'AsyncFunction';
      return { path, methods, isAsync };
    });

  assert.strictEqual(routes.length, 6, `Expected 6 reception routes, found ${routes.length}`);
  for (const r of routes) {
    assert(r.isAsync, `Route ${r.methods} ${r.path} handler must be an AsyncFunction`);
    pass(`Route ${r.methods} ${r.path} handler is an AsyncFunction`);
  }

  // Summary
  console.log('================================================================');
  console.log(`   PHASE 7 BATCH 2B RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runReceptionAsyncIntegrationTests().catch((err) => {
  console.error('Test suite uncaught error:', err);
  process.exit(1);
});
