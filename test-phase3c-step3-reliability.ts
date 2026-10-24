/**
 * PHASE 3C STEP 3 — CHECK-IN RELIABILITY & EVENT CONCURRENCY REGRESSION TEST SUITE
 *
 * Verifies:
 * 1. Normal check-in still succeeds and creates one visit.
 * 2. Bounded fallback retrieves visit record if primary query experiences transient error.
 * 3. A post-commit lookup failure returns the truthful contract (committed: true, visitId, status: 500)
 *    and does NOT execute the transaction a second time.
 * 4. Pass usage is NOT incremented twice during or after post-commit failure.
 * 5. Notification failure still does not undo a committed check-in.
 * 6. A retry against an already-active visit is rejected (409) and does not create duplicate visit or notification.
 * 7. Event decision concurrency: competing decisions cannot both succeed or dispatch duplicate/conflicting notifications.
 * 8. Competing simultaneous approvals cannot both succeed.
 */

import assert from 'node:assert';
import { dbAdapter } from './server/db/adapter.ts';
import { receptionService } from './server/services/reception.service.ts';
import { eventService } from './server/services/event.service.ts';
import { notificationService } from './server/services/notification.service.ts';
import { accessService } from './server/services/access.service.ts';
import { generateId } from './server/utils/crypto.ts';
import {
  SafeUser,
  UserRole,
  UserStatus,
  PassType,
  EventStatus,
} from './src/types/index.ts';

console.log('--- STARTING PHASE 3C STEP 3 RELIABILITY & CONCURRENCY TESTS ---');

let passed = 0;
let failed = 0;

async function runTest(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗ ${name}:`, err.message);
    failed++;
  }
}

// Test users
const superAdmin1: SafeUser = {
  id: 'usr_sa1_' + generateId().slice(0, 8),
  email: `sa1_${Date.now()}@example.com`,
  firstName: 'Super1',
  lastName: 'Admin',
  role: UserRole.SUPER_ADMIN,
  status: UserStatus.ACTIVE,
  department: 'Executive',
};

const superAdmin2: SafeUser = {
  id: 'usr_sa2_' + generateId().slice(0, 8),
  email: `sa2_${Date.now()}@example.com`,
  firstName: 'Super2',
  lastName: 'Admin',
  role: UserRole.SUPER_ADMIN,
  status: UserStatus.ACTIVE,
  department: 'Executive',
};

const hostStaff: SafeUser = {
  id: 'usr_host3c_' + generateId().slice(0, 8),
  email: `host3c_${Date.now()}@example.com`,
  firstName: 'HostStaff',
  lastName: 'Reliability',
  role: UserRole.STAFF,
  status: UserStatus.ACTIVE,
  department: 'Engineering',
};

const deskAdmin: SafeUser = {
  id: 'usr_desk3c_' + generateId().slice(0, 8),
  email: `desk3c_${Date.now()}@example.com`,
  firstName: 'Desk',
  lastName: 'Admin',
  role: UserRole.ADMIN,
  status: UserStatus.ACTIVE,
  department: 'Reception',
};

const eventCreator: SafeUser = {
  id: 'usr_creator3c_' + generateId().slice(0, 8),
  email: `creator3c_${Date.now()}@example.com`,
  firstName: 'Event',
  lastName: 'Creator',
  role: UserRole.ADMIN,
  status: UserStatus.ACTIVE,
  department: 'Marketing',
};

async function setup() {
  const now = new Date().toISOString();

  for (const u of [superAdmin1, superAdmin2, hostStaff, deskAdmin, eventCreator]) {
    await dbAdapter.execute(
      `INSERT OR IGNORE INTO users (id, email, password_hash, first_name, last_name, role, status, department, created_at, updated_at)
       VALUES ($1, $2, 'hash123', $3, $4, $5, $6, $7, $8, $9)`,
      [u.id, u.email, u.firstName, u.lastName, u.role, u.status, u.department, now, now]
    );
  }
}

async function createTestVisitorPass(visitorName: string, hostId: string, maxUses = 1) {
  const now = new Date();
  const validFrom = now.toISOString();
  const validUntil = new Date(now.getTime() + 86400000).toISOString();
  const token = 'tok_' + generateId();
  const tokenHash = accessService.hashToken(token);
  const displayCode = 'V-' + Math.floor(100000 + Math.random() * 900000).toString();
  const passId = generateId();
  const visitId = generateId();
  const nowIso = now.toISOString();

  await dbAdapter.execute(
    `INSERT INTO access_passes (
       id, pass_type, host_staff_id, token_hash, display_code, valid_from, valid_until, status, max_uses, use_count, created_by, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', $8, 0, $9, $10, $11)`,
    [passId, PassType.VISITOR, hostId, tokenHash, displayCode, validFrom, validUntil, maxUses, hostId, nowIso, nowIso]
  );

  await dbAdapter.execute(
    `INSERT INTO visitor_visits (
       id, host_staff_id, visitor_full_name, visitor_phone, visitor_email, purpose, valid_from, valid_until, status, access_pass_id, created_at, updated_at
     ) VALUES ($1, $2, $3, '08012345678', 'visitor@test.com', 'Reliability Review', $4, $5, 'ACCESS_ISSUED', $6, $7, $8)`,
    [visitId, hostId, visitorName, validFrom, validUntil, passId, nowIso, nowIso]
  );

  return { passId, visitId, displayCode, token };
}

async function createPendingEventFixture(title: string) {
  const tomorrow = new Date(Date.now() + 86400000).toISOString();
  const dayAfter = new Date(Date.now() + 90000000).toISOString();

  const createRes = await eventService.createEvent(eventCreator, {
    title,
    description: 'Concurrency Test Event',
    location: 'Conference Room 1',
    startAt: tomorrow,
    endAt: dayAfter,
  });

  assert.strictEqual(createRes.success, true, 'Event creation should succeed');
  const eventId = createRes.event!.id;

  const submitRes = await eventService.submitEvent(eventId, eventCreator);
  assert.strictEqual(submitRes.success, true, 'Event submission should succeed');

  return eventId;
}

async function runAllTests() {
  await setup();

  // Test 1: Normal check-in still succeeds and creates one visit
  await runTest('1. Normal check-in succeeds and creates exactly one visit', async () => {
    const { passId, displayCode } = await createTestVisitorPass('Normal Visitor 1', hostStaff.id);
    const result = await receptionService.checkIn(
      deskAdmin,
      { accessCode: displayCode },
      '127.0.0.1',
      'TestRunner'
    );

    assert.strictEqual(result.success, true, 'Check-in must succeed');
    assert(result.visit, 'Visit object must be returned');
    assert.strictEqual(result.visit?.accessPassId, passId);
    assert.strictEqual(result.visit?.status, 'CHECKED_IN');

    // Verify DB visit count
    const visits = await dbAdapter.query<any>(
      'SELECT id, status FROM access_visits WHERE access_pass_id = $1',
      [passId]
    );
    assert.strictEqual(visits.length, 1, 'Exactly one access_visit must exist');

    // Verify pass use_count is 1
    const passRow = await dbAdapter.queryOne<any>(
      'SELECT use_count, status FROM access_passes WHERE id = $1',
      [passId]
    );
    assert.strictEqual(passRow.use_count, 1, 'Pass use_count must be 1');
  });

  // Test 2: Bounded fallback recovers if primary getVisitRecordById throws transient error
  await runTest('2. Bounded fallback recovers visit record if initial lookup fails once', async () => {
    const { passId, displayCode } = await createTestVisitorPass('Fallback Recover Visitor', hostStaff.id);

    const originalGetVisit = receptionService.getVisitRecordById.bind(receptionService);
    let attempts = 0;

    // Simulate transient failure on first lookup call, then recovery on retry
    receptionService.getVisitRecordById = async function (id: string, tx?: any) {
      attempts++;
      if (attempts === 1) {
        throw new Error('Simulated transient replica query timeout');
      }
      return originalGetVisit(id, tx);
    };

    try {
      const result = await receptionService.checkIn(
        deskAdmin,
        { accessCode: displayCode },
        '127.0.0.1',
        'TestRunner'
      );

      assert.strictEqual(result.success, true, 'Check-in must succeed via bounded fallback');
      assert(result.visit, 'Visit must be retrieved on retry');
      assert.strictEqual(result.visit?.accessPassId, passId);
      assert.strictEqual(attempts, 2, 'Must have attempted primary lookup + 1 bounded retry');
    } finally {
      receptionService.getVisitRecordById = originalGetVisit;
    }
  });

  // Test 3: Post-commit lookup failure returns truthful contract and does not re-execute transaction
  await runTest('3. Post-commit lookup failure returns truthful contract without re-executing transaction', async () => {
    const { passId, displayCode } = await createTestVisitorPass('Post-Commit Failure Visitor', hostStaff.id);

    const originalGetVisit = receptionService.getVisitRecordById.bind(receptionService);

    // Simulate persistent query failure after transaction has committed
    receptionService.getVisitRecordById = async function () {
      throw new Error('Simulated database network partition during lookup');
    };

    let result: any;
    try {
      result = await receptionService.checkIn(
        deskAdmin,
        { accessCode: displayCode },
        '127.0.0.1',
        'TestRunner'
      );
    } finally {
      receptionService.getVisitRecordById = originalGetVisit;
    }

    assert.strictEqual(result.success, false, 'Result success must be false since record was not loaded');
    assert.strictEqual(result.committed, true, 'Result committed MUST be true');
    assert(result.visitId, 'Result must include the committed visitId');
    assert.strictEqual(result.status, 500, 'Result status must be 500');
    assert(
      result.error?.includes('Check-in was recorded'),
      'Error message must communicate that check-in was recorded'
    );
    assert(
      result.error?.includes('rather than retrying check-in'),
      'Error message must advise against blind retries'
    );

    // Verify DB state: visit was actually committed
    const visits = await dbAdapter.query<any>(
      'SELECT id, status FROM access_visits WHERE access_pass_id = $1',
      [passId]
    );
    assert.strictEqual(visits.length, 1, 'Transaction must have committed exactly one visit');
    assert.strictEqual(visits[0].id, result.visitId);
    assert.strictEqual(visits[0].status, 'CHECKED_IN');

    // Verify pass usage was incremented exactly once (not twice, not rolled back)
    const passRow = await dbAdapter.queryOne<any>(
      'SELECT use_count, status FROM access_passes WHERE id = $1',
      [passId]
    );
    assert.strictEqual(passRow.use_count, 1, 'Pass use_count must remain exactly 1');
  });

  // Test 4: Pass usage is not incremented twice on retry after committed check-in
  await runTest('4. Retrying check-in on already active pass fails with 409 and does not increment usage', async () => {
    const { passId, displayCode } = await createTestVisitorPass('No Double Increment Visitor', hostStaff.id, 5);

    // First check-in
    const res1 = await receptionService.checkIn(
      deskAdmin,
      { accessCode: displayCode },
      '127.0.0.1',
      'TestRunner'
    );
    assert.strictEqual(res1.success, true);

    const passBeforeRetry = await dbAdapter.queryOne<any>(
      'SELECT use_count FROM access_passes WHERE id = $1',
      [passId]
    );
    assert.strictEqual(passBeforeRetry.use_count, 1);

    // Attempt retry
    const res2 = await receptionService.checkIn(
      deskAdmin,
      { accessCode: displayCode },
      '127.0.0.1',
      'TestRunner'
    );
    assert.strictEqual(res2.success, false, 'Retry must fail');
    assert.strictEqual(res2.status, 409, 'Retry must return 409 Conflict');

    // Verify usage was not incremented
    const passAfterRetry = await dbAdapter.queryOne<any>(
      'SELECT use_count FROM access_passes WHERE id = $1',
      [passId]
    );
    assert.strictEqual(passAfterRetry.use_count, 1, 'Pass use_count must still be 1');

    // Verify visits table still has only 1 record
    const visits = await dbAdapter.query<any>(
      'SELECT id FROM access_visits WHERE access_pass_id = $1',
      [passId]
    );
    assert.strictEqual(visits.length, 1, 'Must still have only 1 visit');
  });

  // Test 5: Notification failure does not undo committed check-in
  await runTest('5. Notification failure does not fail or rollback committed check-in', async () => {
    const { passId, displayCode } = await createTestVisitorPass('Notif Fail Resilient Visitor', hostStaff.id);

    const originalCreateNotif = notificationService.createNotification.bind(notificationService);
    notificationService.createNotification = async function () {
      throw new Error('Simulated notification delivery crash');
    };

    try {
      const result = await receptionService.checkIn(
        deskAdmin,
        { accessCode: displayCode },
        '127.0.0.1',
        'TestRunner'
      );

      assert.strictEqual(result.success, true, 'Check-in must succeed despite notification failure');
      assert(result.visit, 'Visit object must be returned');
      assert.strictEqual(result.visit?.status, 'CHECKED_IN');
    } finally {
      notificationService.createNotification = originalCreateNotif;
    }
  });

  // Test 6: Retry against already-active visit does not create duplicate notification
  await runTest('6. Retry does not deliver duplicate notification to host', async () => {
    const { passId, displayCode } = await createTestVisitorPass('Deduplication Notif Visitor', hostStaff.id);

    // Count host notifications before
    const notifsBefore = await dbAdapter.queryOne<any>(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = $1',
      [hostStaff.id]
    );
    const countBefore = Number(notifsBefore.count);

    // Initial check-in
    await receptionService.checkIn(deskAdmin, { accessCode: displayCode });

    // Host should have 1 notification
    const notifsAfterFirst = await dbAdapter.queryOne<any>(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = $1',
      [hostStaff.id]
    );
    assert.strictEqual(Number(notifsAfterFirst.count), countBefore + 1, 'Host should receive 1 notification');

    // Attempt retry
    await receptionService.checkIn(deskAdmin, { accessCode: displayCode });

    // Notification count must remain unchanged
    const notifsAfterRetry = await dbAdapter.queryOne<any>(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = $1',
      [hostStaff.id]
    );
    assert.strictEqual(Number(notifsAfterRetry.count), countBefore + 1, 'Retry must not add duplicate notification');
  });

  // Test 7: Event decision concurrency: competing decisions cannot both succeed
  await runTest('7. Competing event decisions cannot both succeed or create conflicting notifications', async () => {
    const eventId = await createPendingEventFixture('Competing Decisions Event');

    // Count creator notifications before
    const notifsBefore = await dbAdapter.queryOne<any>(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = $1',
      [eventCreator.id]
    );
    const countBefore = Number(notifsBefore.count);

    // Launch competing approval and rejection simultaneously
    const [approvalResult, rejectionResult] = await Promise.all([
      eventService.approveEvent(eventId, superAdmin1),
      eventService.rejectEvent(eventId, superAdmin2, 'Rejected for testing race condition'),
    ]);

    // Exactly one of the two decisions must succeed
    const successCount = (approvalResult.success ? 1 : 0) + (rejectionResult.success ? 1 : 0);
    assert.strictEqual(successCount, 1, 'Exactly one competing decision must succeed');

    const failureCount = (!approvalResult.success ? 1 : 0) + (!rejectionResult.success ? 1 : 0);
    assert.strictEqual(failureCount, 1, 'Exactly one competing decision must fail');

    // Verify creator received exactly ONE notification (not both)
    const notifsAfter = await dbAdapter.queryOne<any>(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = $1',
      [eventCreator.id]
    );
    assert.strictEqual(Number(notifsAfter.count), countBefore + 1, 'Creator must receive exactly one notification');

    // Verify final event status in database matches the winning decision
    const finalEvent = await dbAdapter.queryOne<any>(
      'SELECT status FROM events WHERE id = $1',
      [eventId]
    );
    if (approvalResult.success) {
      assert.strictEqual(finalEvent.status, EventStatus.APPROVED);
      assert(rejectionResult.error?.includes('Event status was modified'), 'Lost race must report status modified');
    } else {
      assert.strictEqual(finalEvent.status, EventStatus.REJECTED);
      assert(approvalResult.error?.includes('Event status was modified'), 'Lost race must report status modified');
    }
  });

  // Test 8: Competing simultaneous approvals cannot both succeed
  await runTest('8. Competing simultaneous approvals cannot both succeed', async () => {
    const eventId = await createPendingEventFixture('Competing Approvals Event');

    const [res1, res2] = await Promise.all([
      eventService.approveEvent(eventId, superAdmin1),
      eventService.approveEvent(eventId, superAdmin2),
    ]);

    const successCount = (res1.success ? 1 : 0) + (res2.success ? 1 : 0);
    assert.strictEqual(successCount, 1, 'Exactly one approval must succeed');
    assert.strictEqual(res1.success ? res2.success : res1.success, false, 'The other approval must fail');
  });

  console.log(`\nPhase 3C Step 3 Test Summary: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
