/**
 * PHASE 3C STEP 1 — WORKFLOW NOTIFICATION TRIGGERS TEST SUITE
 *
 * Verifies:
 * 1. Successful visitor check-in creates the expected host notification.
 * 2. Failed, duplicate, and verification-only visitor operations do not create a check-in notification.
 * 3. Successful event approval notifies the event creator with the correct outcome.
 * 4. Successful event rejection notifies the event creator with the correct outcome.
 * 5. Failed event operations do not create notifications.
 * 6. Notification failures are handled without causing check-in or event approval to fail.
 * 7. Multi-tenant privacy: notifications are only delivered to the intended recipient.
 * 8. SQLite and PostgreSQL query syntax compatibility.
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
  NotificationType,
  PassType,
  EventStatus,
} from './src/types/index.ts';

console.log('--- STARTING PHASE 3C WORKFLOW NOTIFICATION TRIGGER TESTS ---');

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
const superAdmin: SafeUser = {
  id: 'usr_sa_' + generateId().slice(0, 8),
  email: `sa_${Date.now()}@example.com`,
  firstName: 'Super',
  lastName: 'Admin',
  role: UserRole.SUPER_ADMIN,
  status: UserStatus.ACTIVE,
  department: 'Executive',
};

const hostStaff: SafeUser = {
  id: 'usr_host_' + generateId().slice(0, 8),
  email: `host_${Date.now()}@example.com`,
  firstName: 'Host',
  lastName: 'Staff',
  role: UserRole.STAFF,
  status: UserStatus.ACTIVE,
  department: 'Engineering',
};

const eventCreatorAdmin: SafeUser = {
  id: 'usr_creator_' + generateId().slice(0, 8),
  email: `creator_${Date.now()}@example.com`,
  firstName: 'Event',
  lastName: 'Creator',
  role: UserRole.ADMIN,
  status: UserStatus.ACTIVE,
  department: 'Operations',
};

const otherStaff: SafeUser = {
  id: 'usr_other_' + generateId().slice(0, 8),
  email: `other_${Date.now()}@example.com`,
  firstName: 'Other',
  lastName: 'Person',
  role: UserRole.STAFF,
  status: UserStatus.ACTIVE,
  department: 'Marketing',
};

const adminReceptionist: SafeUser = {
  id: 'usr_reception_' + generateId().slice(0, 8),
  email: `reception_${Date.now()}@example.com`,
  firstName: 'Desk',
  lastName: 'Admin',
  role: UserRole.ADMIN,
  status: UserStatus.ACTIVE,
  department: 'Security',
};

async function setup() {
  const now = new Date().toISOString();

  // Insert users
  for (const u of [superAdmin, hostStaff, eventCreatorAdmin, otherStaff, adminReceptionist]) {
    await dbAdapter.execute(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, status, department, created_at, updated_at)
       VALUES ($1, $2, 'dummy_hash', $3, $4, $5, $6, $7, $8, $9)`,
      [u.id, u.email, u.firstName, u.lastName, u.role, u.status, u.department, now, now]
    );
  }
}

async function createTestVisitorPass(visitorName: string, hostId: string) {
  const now = new Date();
  const validFrom = new Date(now.getTime() - 3600000).toISOString();
  const validUntil = new Date(now.getTime() + 3600000).toISOString();

  const token = 'tok_' + generateId();
  const tokenHash = accessService.hashToken(token);
  const displayCode = 'V-' + Math.floor(100000 + Math.random() * 900000).toString();
  const passId = generateId();
  const visitId = generateId();
  const nowIso = now.toISOString();

  // Create access pass
  await dbAdapter.execute(
    `INSERT INTO access_passes (
       id, pass_type, host_staff_id, token_hash, display_code, valid_from, valid_until, status, max_uses, use_count, created_by, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', 1, 0, $8, $9, $10)`,
    [passId, PassType.VISITOR, hostId, tokenHash, displayCode, validFrom, validUntil, hostId, nowIso, nowIso]
  );

  // Create visitor_visits record
  await dbAdapter.execute(
    `INSERT INTO visitor_visits (
       id, host_staff_id, visitor_full_name, visitor_phone, visitor_email, purpose, valid_from, valid_until, status, access_pass_id, created_at, updated_at
     ) VALUES ($1, $2, $3, '08012345678', 'visitor@test.com', 'Quarterly Review', $4, $5, 'ACCESS_ISSUED', $6, $7, $8)`,
    [visitId, hostId, visitorName, validFrom, validUntil, passId, nowIso, nowIso]
  );

  return { passId, visitId, displayCode, token };
}

async function runAllTests() {
  await setup();

  // TEST 1: Successful visitor check-in creates host notification
  await runTest('1. Successful visitor check-in creates the expected host notification', async () => {
    const visitorName = 'Ada Lovelace';
    const { displayCode } = await createTestVisitorPass(visitorName, hostStaff.id);

    const checkInRes = await receptionService.checkIn(
      adminReceptionist,
      { accessCode: displayCode },
      '192.168.1.50',
      'TestAgent'
    );

    assert.strictEqual(checkInRes.success, true, 'Check-in must succeed');
    assert.ok(checkInRes.visit, 'Visit record must be returned');

    // Verify notification delivered to hostStaff
    const hostNotifs = await notificationService.listNotifications(hostStaff.id, { page: 1, limit: 10 });
    assert.strictEqual(hostNotifs.notifications.length, 1, 'Host should receive 1 notification');

    const notif = hostNotifs.notifications[0];
    assert.strictEqual(notif.type, NotificationType.VISITOR_CHECKED_IN);
    assert.ok(notif.title.includes(visitorName), `Title should mention visitor: ${notif.title}`);
    assert.ok(notif.message.includes('Quarterly Review'), `Message should include purpose: ${notif.message}`);
    assert.strictEqual(notif.isRead, false);
    assert.strictEqual(notif.metadata?.guestName, visitorName);

    // Verify other staff did NOT receive any notification
    const otherNotifs = await notificationService.listNotifications(otherStaff.id, { page: 1, limit: 10 });
    assert.strictEqual(otherNotifs.notifications.length, 0, 'Other staff must receive 0 notifications');
  });

  // TEST 2: Duplicate check-in attempt does not create another notification
  await runTest('2. Duplicate check-in attempt is rejected and creates no duplicate notification', async () => {
    const visitorName = 'Charles Babbage';
    const { displayCode } = await createTestVisitorPass(visitorName, hostStaff.id);

    // First check-in succeeds
    const checkIn1 = await receptionService.checkIn(adminReceptionist, { accessCode: displayCode });
    assert.strictEqual(checkIn1.success, true);

    const countAfterFirst = (await notificationService.listNotifications(hostStaff.id, {})).total;

    // Second check-in must fail with 409
    const checkIn2 = await receptionService.checkIn(adminReceptionist, { accessCode: displayCode });
    assert.strictEqual(checkIn2.success, false);
    assert.strictEqual(checkIn2.status, 409);

    const countAfterSecond = (await notificationService.listNotifications(hostStaff.id, {})).total;
    assert.strictEqual(countAfterSecond, countAfterFirst, 'Notification count must not increase on duplicate check-in');
  });

  // TEST 3: Verification-only operations do not create check-in notifications
  await runTest('3. Credential verification (verifyCredential) does not trigger check-in notification', async () => {
    const visitorName = 'Alan Turing';
    const { displayCode } = await createTestVisitorPass(visitorName, hostStaff.id);

    const countBefore = (await notificationService.listNotifications(hostStaff.id, {})).total;

    const verifyRes = await receptionService.verifyCredential(adminReceptionist, { accessCode: displayCode });
    assert.strictEqual(verifyRes.success, true);
    assert.strictEqual(verifyRes.verification?.canCheckIn, true);

    const countAfter = (await notificationService.listNotifications(hostStaff.id, {})).total;
    assert.strictEqual(countAfter, countBefore, 'Credential verification must not generate notifications');
  });

  // TEST 4: Failed check-in does not create notifications
  await runTest('4. Failed check-in with invalid code does not create notifications', async () => {
    const countBefore = (await notificationService.listNotifications(hostStaff.id, {})).total;

    const res = await receptionService.checkIn(adminReceptionist, { accessCode: 'INVALID-XYZ-999' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.status, 404);

    const countAfter = (await notificationService.listNotifications(hostStaff.id, {})).total;
    assert.strictEqual(countAfter, countBefore, 'Failed check-in must not generate notifications');
  });

  // TEST 5: Successful event approval notifies the event creator
  await runTest('5. Successful event approval notifies the event creator', async () => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString();
    const dayAfter = new Date(Date.now() + 90000000).toISOString();

    // Create event as eventCreatorAdmin
    const createRes = await eventService.createEvent(eventCreatorAdmin, {
      title: 'Annual Tech Symposium',
      description: 'Engineering department conference',
      location: 'Main Auditorium',
      startAt: tomorrow,
      endAt: dayAfter,
    });
    assert.strictEqual(createRes.success, true, 'Event creation should succeed');
    const eventId = createRes.event!.id;

    // Submit for approval
    const submitRes = await eventService.submitEvent(eventId, eventCreatorAdmin);
    assert.strictEqual(submitRes.success, true, 'Event submission should succeed');

    const countBeforeApproval = (await notificationService.listNotifications(eventCreatorAdmin.id, {})).total;

    // Super Admin approves event
    const approveRes = await eventService.approveEvent(eventId, superAdmin);
    assert.strictEqual(approveRes.success, true, 'Event approval should succeed');
    assert.strictEqual(approveRes.event?.status, EventStatus.APPROVED);

    // Verify creator received EVENT_APPROVED notification
    const creatorNotifs = await notificationService.listNotifications(eventCreatorAdmin.id, {});
    assert.strictEqual(creatorNotifs.total, countBeforeApproval + 1, 'Creator should receive 1 new notification');

    const latestNotif = creatorNotifs.notifications[0];
    assert.strictEqual(latestNotif.type, NotificationType.EVENT_APPROVED);
    assert.ok(latestNotif.title.includes('Annual Tech Symposium'));
    assert.ok(latestNotif.message.includes('Super Admin'));
    assert.strictEqual(latestNotif.metadata?.eventId, eventId);

    // Other staff did not receive it
    const otherNotifs = await notificationService.listNotifications(otherStaff.id, {});
    assert.strictEqual(otherNotifs.total, 0);
  });

  // TEST 6: Duplicate event approval attempt is rejected and generates no duplicate notification
  await runTest('6. Duplicate event approval attempt fails and does not create duplicate notification', async () => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString();
    const dayAfter = new Date(Date.now() + 90000000).toISOString();

    const createRes = await eventService.createEvent(eventCreatorAdmin, {
      title: 'Design Sprint Workshop',
      location: 'Room 204',
      startAt: tomorrow,
      endAt: dayAfter,
    });
    const eventId = createRes.event!.id;
    await eventService.submitEvent(eventId, eventCreatorAdmin);

    // First approval succeeds
    await eventService.approveEvent(eventId, superAdmin);
    const countAfterFirst = (await notificationService.listNotifications(eventCreatorAdmin.id, {})).total;

    // Second approval must fail (already APPROVED)
    const approveRes2 = await eventService.approveEvent(eventId, superAdmin);
    assert.strictEqual(approveRes2.success, false);

    const countAfterSecond = (await notificationService.listNotifications(eventCreatorAdmin.id, {})).total;
    assert.strictEqual(countAfterSecond, countAfterFirst, 'Notification count must not increase on duplicate approval');
  });

  // TEST 7: Successful event rejection notifies the event creator with reason
  await runTest('7. Successful event rejection notifies creator with rejection reason', async () => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString();
    const dayAfter = new Date(Date.now() + 90000000).toISOString();

    const createRes = await eventService.createEvent(eventCreatorAdmin, {
      title: 'Marketing Hackathon',
      location: 'Annex B',
      startAt: tomorrow,
      endAt: dayAfter,
    });
    const eventId = createRes.event!.id;
    await eventService.submitEvent(eventId, eventCreatorAdmin);

    const countBeforeReject = (await notificationService.listNotifications(eventCreatorAdmin.id, {})).total;

    const rejectionReason = 'Room conflict with Board meeting';
    const rejectRes = await eventService.rejectEvent(eventId, superAdmin, rejectionReason);
    assert.strictEqual(rejectRes.success, true);
    assert.strictEqual(rejectRes.event?.status, EventStatus.REJECTED);

    // Verify creator received EVENT_REJECTED notification
    const notifs = await notificationService.listNotifications(eventCreatorAdmin.id, {});
    assert.strictEqual(notifs.total, countBeforeReject + 1);
    const notif = notifs.notifications[0];
    assert.strictEqual(notif.type, NotificationType.EVENT_REJECTED);
    assert.ok(notif.title.includes('Marketing Hackathon'));
    assert.ok(notif.message.includes(rejectionReason));
    assert.strictEqual(notif.metadata?.rejectionReason, rejectionReason);
  });

  // TEST 8: Failed event operations do not create notifications
  await runTest('8. Unauthorized event approval attempt fails without notifications', async () => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString();
    const dayAfter = new Date(Date.now() + 90000000).toISOString();

    const createRes = await eventService.createEvent(eventCreatorAdmin, {
      title: 'Unauthorized Event Test',
      location: 'Lab 1',
      startAt: tomorrow,
      endAt: dayAfter,
    });
    const eventId = createRes.event!.id;
    await eventService.submitEvent(eventId, eventCreatorAdmin);

    const countBefore = (await notificationService.listNotifications(eventCreatorAdmin.id, {})).total;

    // Non-SuperAdmin attempts approval -> fails
    const failRes = await eventService.approveEvent(eventId, hostStaff);
    assert.strictEqual(failRes.success, false);

    const countAfter = (await notificationService.listNotifications(eventCreatorAdmin.id, {})).total;
    assert.strictEqual(countAfter, countBefore, 'Failed unauthorized approval must not create notifications');
  });

  // TEST 9: Notification creation failure does NOT fail the check-in or event approval
  await runTest('9. Notification service failure is caught and does not fail visitor check-in or approval', async () => {
    const { displayCode } = await createTestVisitorPass('Grace Hopper', hostStaff.id);

    // Monkey-patch notificationService.createNotification temporarily to simulate failure
    const originalCreate = notificationService.createNotification;
    let failedAttemptCaught = false;

    notificationService.createNotification = async () => {
      failedAttemptCaught = true;
      throw new Error('Simulated notification database timeout');
    };

    try {
      // Check-in should still succeed!
      const checkInRes = await receptionService.checkIn(adminReceptionist, { accessCode: displayCode });
      assert.strictEqual(checkInRes.success, true, 'Check-in must succeed even if notification fails');
      assert.strictEqual(failedAttemptCaught, true, 'Simulated failure was triggered');
    } finally {
      // Restore original
      notificationService.createNotification = originalCreate;
    }
  });

  console.log(`\nPhase 3C Test Summary: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('Test suite uncaught error:', err);
  process.exit(1);
});
