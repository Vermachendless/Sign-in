import assert from 'node:assert';
import http from 'node:http';
import express from 'express';
import cookieParser from 'cookie-parser';
import authRoutes from './server/routes/auth.routes.ts';
import eventRoutes from './server/routes/event.routes.ts';
import { getDatabase } from './server/db/index.ts';
import { eventService } from './server/services/event.service.ts';
import { auditService } from './server/services/audit.service.ts';
import { EventStatus, UserRole } from './src/types/index.ts';

function httpRequest(options: {
  port: number;
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: options.port,
        path: options.path,
        method: options.method || 'GET',
        headers: options.headers || {},
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body: data,
          });
        });
      }
    );

    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

function extractCookie(headers: http.IncomingHttpHeaders): string {
  const setCookie = headers['set-cookie'];
  if (!setCookie || setCookie.length === 0) return '';
  return setCookie[0].split(';')[0];
}

async function loginUser(port: number, email: string, pass: string): Promise<string> {
  const res = await httpRequest({
    port,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pass }),
  });
  assert.strictEqual(res.status, 200, `Login failed for ${email}`);
  return extractCookie(res.headers);
}

async function runPhase6bTests() {
  console.log('================================================================');
  console.log('   PHASE 6B — EVENT MANAGEMENT & SUPER ADMIN APPROVAL TESTS     ');
  console.log('================================================================');

  let passed = 0;
  function pass(msg: string) {
    passed++;
    console.log(`✅ [PASS] ${msg}`);
  }

  // Section 1: Database Schema & Migration Verification
  console.log('\n--- 1. Database Schema & Models Verification ---');
  const db = getDatabase();

  const tableCheck = db.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name='events'
  `).get() as { name: string } | undefined;
  assert.ok(tableCheck && tableCheck.name === 'events', 'events table exists in SQLite database');
  pass('Events database table exists with correct schema');

  // Verify status enum values
  assert.strictEqual(EventStatus.DRAFT, 'DRAFT');
  assert.strictEqual(EventStatus.PENDING_APPROVAL, 'PENDING_APPROVAL');
  assert.strictEqual(EventStatus.APPROVED, 'APPROVED');
  assert.strictEqual(EventStatus.REJECTED, 'REJECTED');
  assert.strictEqual(EventStatus.CANCELLED, 'CANCELLED');
  assert.strictEqual(EventStatus.COMPLETED, 'COMPLETED');
  pass('EventStatus contains DRAFT, PENDING_APPROVAL, APPROVED, REJECTED, CANCELLED, COMPLETED');

  // Section 2: Data Validation & Date/Time Handling
  console.log('\n--- 2. Event Date/Time & Input Validation Tests ---');

  // Date validation unit tests
  const validDates = eventService.validateEventDates('2026-10-15T09:00:00Z', '2026-10-15T17:00:00Z');
  assert.strictEqual(validDates.valid, true);
  pass('Valid dates accepted (endAt > startAt)');

  const equalDates = eventService.validateEventDates('2026-10-15T09:00:00Z', '2026-10-15T09:00:00Z');
  assert.strictEqual(equalDates.valid, false);
  assert.ok(equalDates.error?.includes('must be after'), 'Equal start and end dates rejected');
  pass('Equal start and end times rejected');

  const reversedDates = eventService.validateEventDates('2026-10-15T17:00:00Z', '2026-10-15T09:00:00Z');
  assert.strictEqual(reversedDates.valid, false);
  pass('End date prior to start date rejected');

  const malformedDates = eventService.validateEventDates('invalid-date-string', '2026-10-15T17:00:00Z');
  assert.strictEqual(malformedDates.valid, false);
  pass('Malformed date string rejected');

  const missingDates = eventService.validateEventDates('', '');
  assert.strictEqual(missingDates.valid, false);
  pass('Missing dates rejected');

  // Section 3: Live Express Server API & RBAC Tests
  console.log('\n--- 3. Live HTTP API & Role-Based Access Control Tests ---');

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRoutes);
  app.use('/api/events', eventRoutes);

  const server = app.listen(0);
  const address = server.address() as { port: number };
  const port = address.port;

  try {
    // Authenticate roles
    const superAdminCookie = await loginUser(port, 'admin@example.com', 'AdminSecurePassword123!');
    const adminCookie = await loginUser(port, 'manager@example.com', 'ManagerSecure123!');
    const staffCookie = await loginUser(port, 'john.doe@example.com', 'StaffSecure123!');

    // 3.1 Event Creation Tests
    console.log('\n--- 3.1 Creation RBAC ---');

    // Admin creates event -> 201 Created
    const createAdminRes = await httpRequest({
      port,
      path: '/api/events',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
      },
      body: JSON.stringify({
        title: 'Q4 Strategy Summit',
        location: 'Lagos Headquarters, 5th Floor',
        description: 'Quarterly strategic alignment session.',
        startAt: '2026-11-10T09:00:00Z',
        endAt: '2026-11-10T17:00:00Z',
      }),
    });
    assert.strictEqual(createAdminRes.status, 201);
    const createdAdminJson = JSON.parse(createAdminRes.body);
    assert.strictEqual(createdAdminJson.success, true);
    assert.strictEqual(createdAdminJson.data.status, EventStatus.DRAFT);
    const adminEventId = createdAdminJson.data.id;
    pass('Admin can create event in DRAFT status (201 Created)');

    // Staff tries to create event -> 403 Forbidden
    const createStaffRes = await httpRequest({
      port,
      path: '/api/events',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: staffCookie,
      },
      body: JSON.stringify({
        title: 'Unauthorized Staff Party',
        location: 'Breakroom',
        startAt: '2026-11-10T09:00:00Z',
        endAt: '2026-11-10T17:00:00Z',
      }),
    });
    assert.strictEqual(createStaffRes.status, 403);
    pass('Staff cannot create event (403 Forbidden)');

    // Super Admin creates event -> 201 Created
    const createSuperRes = await httpRequest({
      port,
      path: '/api/events',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: superAdminCookie,
      },
      body: JSON.stringify({
        title: 'Executive Board Meeting',
        location: 'Executive Suite A',
        startAt: '2026-11-12T10:00:00Z',
        endAt: '2026-11-12T14:00:00Z',
      }),
    });
    assert.strictEqual(createSuperRes.status, 201);
    pass('Super Admin can create event (201 Created)');

    // Data validation: Missing title -> 400 Validation Error
    const createMissingTitleRes = await httpRequest({
      port,
      path: '/api/events',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
      },
      body: JSON.stringify({
        title: '',
        location: 'Main Hall',
        startAt: '2026-11-10T09:00:00Z',
        endAt: '2026-11-10T17:00:00Z',
      }),
    });
    assert.strictEqual(createMissingTitleRes.status, 400);
    pass('Missing title rejected (400 Validation Error)');

    // Data validation: Missing location -> 400 Validation Error
    const createMissingLocRes = await httpRequest({
      port,
      path: '/api/events',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
      },
      body: JSON.stringify({
        title: 'Valid Title',
        location: '',
        startAt: '2026-11-10T09:00:00Z',
        endAt: '2026-11-10T17:00:00Z',
      }),
    });
    assert.strictEqual(createMissingLocRes.status, 400);
    pass('Missing location rejected (400 Validation Error)');

    // 3.2 Submission Tests: DRAFT -> PENDING_APPROVAL
    console.log('\n--- 3.2 Submission Workflow ---');

    // Staff tries to submit -> 403 Forbidden
    const submitStaffRes = await httpRequest({
      port,
      path: `/api/events/${adminEventId}/submit`,
      method: 'POST',
      headers: { Cookie: staffCookie },
    });
    assert.strictEqual(submitStaffRes.status, 403);
    pass('Staff cannot submit event (403 Forbidden)');

    // Admin submits draft event -> 200 OK, transitions to PENDING_APPROVAL
    const submitAdminRes = await httpRequest({
      port,
      path: `/api/events/${adminEventId}/submit`,
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
    assert.strictEqual(submitAdminRes.status, 200);
    const submitAdminJson = JSON.parse(submitAdminRes.body);
    assert.strictEqual(submitAdminJson.data.status, EventStatus.PENDING_APPROVAL);
    pass('Admin submits draft event -> transitions to PENDING_APPROVAL (200 OK)');

    // Cannot submit already submitted event -> 400
    const reSubmitRes = await httpRequest({
      port,
      path: `/api/events/${adminEventId}/submit`,
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
    assert.strictEqual(reSubmitRes.status, 400);
    pass('Cannot submit already pending event (400 Bad Request)');

    // Editing while PENDING_APPROVAL is blocked without withdrawing
    const patchPendingRes = await httpRequest({
      port,
      path: `/api/events/${adminEventId}`,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
      },
      body: JSON.stringify({ title: 'Altered Title Without Approval' }),
    });
    assert.strictEqual(patchPendingRes.status, 400);
    pass('Direct edits to PENDING_APPROVAL events blocked (400 Bad Request)');

    // Withdraw event back to draft
    const withdrawRes = await httpRequest({
      port,
      path: `/api/events/${adminEventId}/withdraw`,
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
    assert.strictEqual(withdrawRes.status, 200);
    const withdrawJson = JSON.parse(withdrawRes.body);
    assert.strictEqual(withdrawJson.data.status, EventStatus.DRAFT);
    pass('Creator can withdraw event back to DRAFT (200 OK)');

    // Edit while DRAFT works
    const patchDraftRes = await httpRequest({
      port,
      path: `/api/events/${adminEventId}`,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
      },
      body: JSON.stringify({ title: 'Q4 Strategic Summit (Updated Title)' }),
    });
    assert.strictEqual(patchDraftRes.status, 200);
    pass('Creator can edit draft event (200 OK)');

    // Resubmit for approval
    await httpRequest({
      port,
      path: `/api/events/${adminEventId}/submit`,
      method: 'POST',
      headers: { Cookie: adminCookie },
    });

    // 3.3 Super Admin Approval Tests
    console.log('\n--- 3.3 Approval RBAC & Workflow ---');

    // Admin tries to approve -> 403 Forbidden (Strict Super Admin boundary!)
    const adminApproveRes = await httpRequest({
      port,
      path: `/api/events/${adminEventId}/approve`,
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
    assert.strictEqual(adminApproveRes.status, 403);
    pass('Admin CANNOT approve event (403 Forbidden - Super Admin boundary enforced)');

    // Staff tries to approve -> 403 Forbidden
    const staffApproveRes = await httpRequest({
      port,
      path: `/api/events/${adminEventId}/approve`,
      method: 'POST',
      headers: { Cookie: staffCookie },
    });
    assert.strictEqual(staffApproveRes.status, 403);
    pass('Staff cannot approve event (403 Forbidden)');

    // Anonymous tries to approve -> 401 Unauthorized
    const anonApproveRes = await httpRequest({
      port,
      path: `/api/events/${adminEventId}/approve`,
      method: 'POST',
    });
    assert.strictEqual(anonApproveRes.status, 401);
    pass('Anonymous request cannot approve event (401 Unauthorized)');

    // Super Admin approves event -> 200 OK
    const superApproveRes = await httpRequest({
      port,
      path: `/api/events/${adminEventId}/approve`,
      method: 'POST',
      headers: { Cookie: superAdminCookie },
    });
    assert.strictEqual(superApproveRes.status, 200);
    const superApproveJson = JSON.parse(superApproveRes.body);
    assert.strictEqual(superApproveJson.data.status, EventStatus.APPROVED);
    assert.ok(superApproveJson.data.approvedBy, 'approvedBy is recorded');
    assert.ok(superApproveJson.data.approvedAt, 'approvedAt is recorded');
    pass('Super Admin approves event -> status becomes APPROVED (200 OK)');

    // Cannot submit already approved event
    const submitApprovedRes = await httpRequest({
      port,
      path: `/api/events/${adminEventId}/submit`,
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
    assert.strictEqual(submitApprovedRes.status, 400);
    pass('Cannot submit already approved event (400 Bad Request)');

    // Admin cannot edit approved event
    const editApprovedByAdminRes = await httpRequest({
      port,
      path: `/api/events/${adminEventId}`,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
      },
      body: JSON.stringify({ title: 'Malicious modification of approved event' }),
    });
    assert.strictEqual(editApprovedByAdminRes.status, 400);
    pass('Admin CANNOT modify approved event (400 Bad Request)');

    // 3.4 Super Admin Rejection Tests
    console.log('\n--- 3.4 Rejection RBAC & Workflow ---');

    // Create a new event to test rejection
    const createEvent2Res = await httpRequest({
      port,
      path: '/api/events',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
      },
      body: JSON.stringify({
        title: 'Unbudgeted Offsite Workshop',
        location: 'External Resort',
        startAt: '2026-11-20T10:00:00Z',
        endAt: '2026-11-20T18:00:00Z',
      }),
    });
    const event2Id = JSON.parse(createEvent2Res.body).data.id;
    // Submit event 2
    await httpRequest({
      port,
      path: `/api/events/${event2Id}/submit`,
      method: 'POST',
      headers: { Cookie: adminCookie },
    });

    // Admin tries to reject -> 403 Forbidden
    const adminRejectRes = await httpRequest({
      port,
      path: `/api/events/${event2Id}/reject`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
      },
      body: JSON.stringify({ reason: 'Admin rejection attempt' }),
    });
    assert.strictEqual(adminRejectRes.status, 403);
    pass('Admin cannot reject event (403 Forbidden)');

    // Rejection without reason -> 400 Bad Request
    const superRejectNoReason = await httpRequest({
      port,
      path: `/api/events/${event2Id}/reject`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: superAdminCookie,
      },
      body: JSON.stringify({ reason: '' }),
    });
    assert.strictEqual(superRejectNoReason.status, 400);
    pass('Rejection requires mandatory reason (400 Bad Request)');

    // Super Admin rejects with reason -> 200 OK
    const rejectionReasonText = 'Venue is not an authorized corporate facility. Please reschedule to internal auditorium.';
    const superRejectRes = await httpRequest({
      port,
      path: `/api/events/${event2Id}/reject`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: superAdminCookie,
      },
      body: JSON.stringify({ reason: rejectionReasonText }),
    });
    assert.strictEqual(superRejectRes.status, 200);
    const superRejectJson = JSON.parse(superRejectRes.body);
    assert.strictEqual(superRejectJson.data.status, EventStatus.REJECTED);
    assert.strictEqual(superRejectJson.data.rejectionReason, rejectionReasonText);
    pass('Super Admin rejects event with recorded reason (200 OK)');

    // Invalid transition: REJECTED -> APPROVED directly should fail
    const approveRejectedRes = await httpRequest({
      port,
      path: `/api/events/${event2Id}/approve`,
      method: 'POST',
      headers: { Cookie: superAdminCookie },
    });
    assert.strictEqual(approveRejectedRes.status, 400);
    pass('Invalid transition REJECTED -> APPROVED blocked (400 Bad Request)');

    // 3.5 Cancellation Workflow
    console.log('\n--- 3.5 Cancellation Tests ---');

    // Create event 3 to cancel
    const createEvent3Res = await httpRequest({
      port,
      path: '/api/events',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
      },
      body: JSON.stringify({
        title: 'Cancelled Dept Lunch',
        location: 'Cafeteria',
        startAt: '2026-11-25T12:00:00Z',
        endAt: '2026-11-25T13:30:00Z',
      }),
    });
    const event3Id = JSON.parse(createEvent3Res.body).data.id;

    // Staff cannot cancel
    const staffCancelRes = await httpRequest({
      port,
      path: `/api/events/${event3Id}/cancel`,
      method: 'POST',
      headers: { Cookie: staffCookie },
    });
    assert.strictEqual(staffCancelRes.status, 403);
    pass('Staff cannot cancel events (403 Forbidden)');

    // Admin cancels their event -> 200 OK
    const adminCancelRes = await httpRequest({
      port,
      path: `/api/events/${event3Id}/cancel`,
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
    assert.strictEqual(adminCancelRes.status, 200);
    const cancelJson = JSON.parse(adminCancelRes.body);
    assert.strictEqual(cancelJson.data.status, EventStatus.CANCELLED);
    pass('Authorized creator can cancel event (200 OK)');

    // Cancelled event cannot be approved
    const approveCancelledRes = await httpRequest({
      port,
      path: `/api/events/${event3Id}/approve`,
      method: 'POST',
      headers: { Cookie: superAdminCookie },
    });
    assert.strictEqual(approveCancelledRes.status, 400);
    pass('Invalid transition CANCELLED -> APPROVED blocked (400 Bad Request)');

    // 3.6 Role-Based Event Visibility
    console.log('\n--- 3.6 Event Visibility by Role ---');

    // Staff listing events should only see APPROVED events
    const staffListRes = await httpRequest({
      port,
      path: '/api/events',
      headers: { Cookie: staffCookie },
    });
    assert.strictEqual(staffListRes.status, 200);
    const staffListJson = JSON.parse(staffListRes.body);
    staffListJson.data.events.forEach((ev: any) => {
      assert.strictEqual(ev.status, EventStatus.APPROVED, 'Staff must only see APPROVED events');
    });
    pass('Staff visibility strictly restricted to APPROVED events');

    // Super Admin sees all events
    const superListRes = await httpRequest({
      port,
      path: '/api/events',
      headers: { Cookie: superAdminCookie },
    });
    assert.strictEqual(superListRes.status, 200);
    const superListJson = JSON.parse(superListRes.body);
    assert.ok(superListJson.data.total >= 3, 'Super Admin sees all events across all statuses');
    pass('Super Admin has full visibility across all event statuses');

    // 3.7 Audit Log Verification
    console.log('\n--- 3.7 Audit Log Verification ---');

    const auditActions = ['EVENT_CREATED', 'EVENT_SUBMITTED_FOR_APPROVAL', 'EVENT_APPROVED', 'EVENT_REJECTED', 'EVENT_CANCELLED'];
    for (const act of auditActions) {
      const logs = auditService.listLogs({ action: act });
      assert.ok(logs.total >= 1, `Audit log for ${act} was successfully recorded`);
      pass(`Audit log created for action: ${act}`);
    }
  } finally {
    server.close();
    if ('closeAllConnections' in server && typeof (server as any).closeAllConnections === 'function') {
      (server as any).closeAllConnections();
    }
  }

  console.log('\n================================================================');
  console.log(`   PHASE 6B TEST RESULTS: ${passed} PASSED, 0 FAILED`);
  console.log('================================================================');
  process.exit(0);
}

runPhase6bTests().catch((err) => {
  console.error('Phase 6B tests failed:', err);
  process.exit(1);
});
