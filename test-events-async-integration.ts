import assert from 'node:assert';
import http from 'node:http';
import express from 'express';
import cookieParser from 'cookie-parser';
import authRoutes from './server/routes/auth.routes.ts';
import eventRoutes from './server/routes/event.routes.ts';
import { eventService } from './server/services/event.service.ts';
import { EventStatus, UserRole } from './src/types/index.ts';

// Track unhandled promise rejections to verify requirement 3
let unhandledRejectionsCount = 0;
const unhandledRejectionsList: unknown[] = [];
process.on('unhandledRejection', (reason) => {
  unhandledRejectionsCount++;
  unhandledRejectionsList.push(reason);
  console.error('[TEST FATAL] Unhandled Promise Rejection detected:', reason);
});

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

async function runAsyncIntegrationTests() {
  console.log('================================================================');
  console.log('   EVENTS MODULE ASYNC INTEGRATION & RELIABILITY TEST SUITE     ');
  console.log('================================================================');

  let passed = 0;
  function pass(msg: string) {
    passed++;
    console.log(`  ✅ [PASS ${passed}] ${msg}`);
  }

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRoutes);
  app.use('/api/events', eventRoutes);

  const server = app.listen(0);
  const address = server.address() as { port: number };
  const port = address.port;

  try {
    // 1. Setup Auth Tokens
    console.log('\n--- 1. Authenticating Roles ---');
    const superAdminCookie = await loginUser(port, 'admin@example.com', 'AdminSecurePassword123!');
    const adminCookie = await loginUser(port, 'manager@example.com', 'ManagerSecure123!');
    const staffCookie = await loginUser(port, 'john.doe@example.com', 'StaffSecure123!');
    pass('All 3 user roles authenticated and session cookies issued');

    // 2. Successful Operations & Async/Await Propagation
    console.log('\n--- 2. Async/Await Propagation & Lifecycle Flow ---');

    // 2.1 Create Event
    const createRes = await httpRequest({
      port,
      path: '/api/events',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        title: 'Async Verification Summit',
        location: 'Hall A',
        description: 'Verification of async handlers',
        startAt: '2026-11-01T10:00:00Z',
        endAt: '2026-11-01T18:00:00Z',
      }),
    });
    assert.strictEqual(createRes.status, 201);
    const created = JSON.parse(createRes.body);
    assert.strictEqual(created.success, true);
    assert.strictEqual(created.data.status, EventStatus.DRAFT);
    assert.strictEqual(typeof created.data.id, 'string');
    const testEventId = created.data.id;
    pass('createEvent successfully awaited and returns 201 with valid EventRecord');

    // 2.2 Get Event By ID
    const getRes = await httpRequest({
      port,
      path: `/api/events/${testEventId}`,
      method: 'GET',
      headers: { Cookie: adminCookie },
    });
    assert.strictEqual(getRes.status, 200);
    const getJson = JSON.parse(getRes.body);
    assert.strictEqual(getJson.success, true);
    assert.strictEqual(getJson.data.id, testEventId);
    assert.strictEqual(getJson.data.title, 'Async Verification Summit');
    pass('getEventById successfully awaited and returns 200 with creator details');

    // 2.3 Update Event
    const updateRes = await httpRequest({
      port,
      path: `/api/events/${testEventId}`,
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        title: 'Async Verification Summit (Updated)',
      }),
    });
    assert.strictEqual(updateRes.status, 200);
    const updateJson = JSON.parse(updateRes.body);
    assert.strictEqual(updateJson.success, true);
    assert.strictEqual(updateJson.data.title, 'Async Verification Summit (Updated)');
    pass('updateEvent successfully awaited and returns 200 with updated fields');

    // 2.4 List Events
    const listRes = await httpRequest({
      port,
      path: '/api/events?limit=10',
      method: 'GET',
      headers: { Cookie: adminCookie },
    });
    assert.strictEqual(listRes.status, 200);
    const listJson = JSON.parse(listRes.body);
    assert.strictEqual(listJson.success, true);
    assert.ok(Array.isArray(listJson.data.events));
    assert.ok(typeof listJson.data.total === 'number');
    pass('listEvents successfully awaited and returns 200 with paginated events array');

    // 2.5 Submit Event: DRAFT -> PENDING_APPROVAL
    const submitRes = await httpRequest({
      port,
      path: `/api/events/${testEventId}/submit`,
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
    assert.strictEqual(submitRes.status, 200);
    const submitJson = JSON.parse(submitRes.body);
    assert.strictEqual(submitJson.success, true);
    assert.strictEqual(submitJson.data.status, EventStatus.PENDING_APPROVAL);
    pass('submitEvent successfully awaited and transitions status to PENDING_APPROVAL');

    // 2.6 Withdraw Event: PENDING_APPROVAL -> DRAFT
    const withdrawRes = await httpRequest({
      port,
      path: `/api/events/${testEventId}/withdraw`,
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
    assert.strictEqual(withdrawRes.status, 200);
    const withdrawJson = JSON.parse(withdrawRes.body);
    assert.strictEqual(withdrawJson.success, true);
    assert.strictEqual(withdrawJson.data.status, EventStatus.DRAFT);
    pass('withdrawEvent successfully awaited and transitions status back to DRAFT');

    // Re-submit for approval
    await httpRequest({
      port,
      path: `/api/events/${testEventId}/submit`,
      method: 'POST',
      headers: { Cookie: adminCookie },
    });

    // 2.7 Approve Event: PENDING_APPROVAL -> APPROVED
    const approveRes = await httpRequest({
      port,
      path: `/api/events/${testEventId}/approve`,
      method: 'POST',
      headers: { Cookie: superAdminCookie },
    });
    assert.strictEqual(approveRes.status, 200);
    const approveJson = JSON.parse(approveRes.body);
    assert.strictEqual(approveJson.success, true);
    assert.strictEqual(approveJson.data.status, EventStatus.APPROVED);
    assert.ok(approveJson.data.approvedBy);
    pass('approveEvent successfully awaited and transitions status to APPROVED with approver metadata');

    // 2.8 Cancel Event: APPROVED -> CANCELLED
    const cancelRes = await httpRequest({
      port,
      path: `/api/events/${testEventId}/cancel`,
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
    assert.strictEqual(cancelRes.status, 200);
    const cancelJson = JSON.parse(cancelRes.body);
    assert.strictEqual(cancelJson.success, true);
    assert.strictEqual(cancelJson.data.status, EventStatus.CANCELLED);
    pass('cancelEvent successfully awaited and transitions status to CANCELLED');

    // 2.9 Reject Workflow (create second event)
    const create2Res = await httpRequest({
      port,
      path: '/api/events',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        title: 'Event To Be Rejected',
        location: 'Hall B',
        startAt: '2026-11-05T09:00:00Z',
        endAt: '2026-11-05T12:00:00Z',
      }),
    });
    const event2Id = JSON.parse(create2Res.body).data.id;
    await httpRequest({
      port,
      path: `/api/events/${event2Id}/submit`,
      method: 'POST',
      headers: { Cookie: adminCookie },
    });

    const rejectRes = await httpRequest({
      port,
      path: `/api/events/${event2Id}/reject`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: superAdminCookie },
      body: JSON.stringify({ reason: 'Rejected due to venue conflict.' }),
    });
    assert.strictEqual(rejectRes.status, 200);
    const rejectJson = JSON.parse(rejectRes.body);
    assert.strictEqual(rejectJson.success, true);
    assert.strictEqual(rejectJson.data.status, EventStatus.REJECTED);
    assert.strictEqual(rejectJson.data.rejectionReason, 'Rejected due to venue conflict.');
    pass('rejectEvent successfully awaited and records mandatory rejection reason');

    // 3. Authorization & Role Boundaries
    console.log('\n--- 3. Authorization & Role Enforcement ---');

    // 3.1 Anonymous access rejected
    const anonRes = await httpRequest({ port, path: '/api/events', method: 'GET' });
    assert.strictEqual(anonRes.status, 401);
    pass('Unauthenticated request rejected with 401 UNAUTHORIZED');

    // 3.2 Staff cannot create events
    const staffCreateRes = await httpRequest({
      port,
      path: '/api/events',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: staffCookie },
      body: JSON.stringify({
        title: 'Staff Event',
        location: 'Lounge',
        startAt: '2026-11-10T10:00:00Z',
        endAt: '2026-11-10T12:00:00Z',
      }),
    });
    assert.strictEqual(staffCreateRes.status, 403);
    pass('Staff role prohibited from creating events (403 FORBIDDEN)');

    // 3.3 Admin cannot approve events (Super Admin strictly enforced)
    const adminApproveRes = await httpRequest({
      port,
      path: `/api/events/${event2Id}/approve`,
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
    assert.strictEqual(adminApproveRes.status, 403);
    pass('Admin role prohibited from approving events (403 FORBIDDEN - Super Admin only)');

    // 3.4 Admin cannot reject events
    const adminRejectRes = await httpRequest({
      port,
      path: `/api/events/${event2Id}/reject`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ reason: 'Attempted admin rejection' }),
    });
    assert.strictEqual(adminRejectRes.status, 403);
    pass('Admin role prohibited from rejecting events (403 FORBIDDEN - Super Admin only)');

    // 4. Service Failure Handling & Unhandled Rejection Prevention
    console.log('\n--- 4. Asynchronous Service Failure & Error Propagation ---');

    // Test each route when the underlying eventService method throws/rejects asynchronously.
    // Verify that the route catches the rejection, sends 500 INTERNAL_ERROR, and does not cause an unhandled promise rejection.

    // 4.1 createEvent async rejection
    const origCreate = eventService.createEvent;
    eventService.createEvent = async () => {
      throw new Error('Simulated database connection failure during createEvent');
    };
    try {
      const failRes = await httpRequest({
        port,
        path: '/api/events',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({
          title: 'Database Fault Event',
          location: 'Anywhere',
          startAt: '2026-11-01T10:00:00Z',
          endAt: '2026-11-01T18:00:00Z',
        }),
      });
      assert.strictEqual(failRes.status, 500);
      const failJson = JSON.parse(failRes.body);
      assert.strictEqual(failJson.success, false);
      assert.strictEqual(failJson.code, 'INTERNAL_ERROR');
      pass('createEvent async failure caught -> returns 500 INTERNAL_ERROR without crashing');
    } finally {
      eventService.createEvent = origCreate;
    }

    // 4.2 listEvents async rejection
    const origList = eventService.listEvents;
    eventService.listEvents = async () => {
      throw new Error('Simulated database query failure during listEvents');
    };
    try {
      const failRes = await httpRequest({
        port,
        path: '/api/events',
        method: 'GET',
        headers: { Cookie: adminCookie },
      });
      assert.strictEqual(failRes.status, 500);
      const failJson = JSON.parse(failRes.body);
      assert.strictEqual(failJson.success, false);
      assert.strictEqual(failJson.code, 'INTERNAL_ERROR');
      pass('listEvents async failure caught -> returns 500 INTERNAL_ERROR without crashing');
    } finally {
      eventService.listEvents = origList;
    }

    // 4.3 getEventById async rejection
    const origGet = eventService.getEventById;
    eventService.getEventById = async () => {
      throw new Error('Simulated database query failure during getEventById');
    };
    try {
      const failRes = await httpRequest({
        port,
        path: `/api/events/${testEventId}`,
        method: 'GET',
        headers: { Cookie: adminCookie },
      });
      assert.strictEqual(failRes.status, 500);
      const failJson = JSON.parse(failRes.body);
      assert.strictEqual(failJson.success, false);
      assert.strictEqual(failJson.code, 'INTERNAL_ERROR');
      pass('getEventById async failure caught -> returns 500 INTERNAL_ERROR without crashing');
    } finally {
      eventService.getEventById = origGet;
    }

    // 4.4 updateEvent async rejection
    const origUpdate = eventService.updateEvent;
    eventService.updateEvent = async () => {
      throw new Error('Simulated database write failure during updateEvent');
    };
    try {
      const failRes = await httpRequest({
        port,
        path: `/api/events/${testEventId}`,
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ title: 'New Title' }),
      });
      assert.strictEqual(failRes.status, 500);
      const failJson = JSON.parse(failRes.body);
      assert.strictEqual(failJson.success, false);
      assert.strictEqual(failJson.code, 'INTERNAL_ERROR');
      pass('updateEvent async failure caught -> returns 500 INTERNAL_ERROR without crashing');
    } finally {
      eventService.updateEvent = origUpdate;
    }

    // 4.5 submitEvent async rejection
    const origSubmit = eventService.submitEvent;
    eventService.submitEvent = async () => {
      throw new Error('Simulated failure during submitEvent');
    };
    try {
      const failRes = await httpRequest({
        port,
        path: `/api/events/${testEventId}/submit`,
        method: 'POST',
        headers: { Cookie: adminCookie },
      });
      assert.strictEqual(failRes.status, 500);
      const failJson = JSON.parse(failRes.body);
      assert.strictEqual(failJson.success, false);
      assert.strictEqual(failJson.code, 'INTERNAL_ERROR');
      pass('submitEvent async failure caught -> returns 500 INTERNAL_ERROR without crashing');
    } finally {
      eventService.submitEvent = origSubmit;
    }

    // 4.6 withdrawEvent async rejection
    const origWithdraw = eventService.withdrawEvent;
    eventService.withdrawEvent = async () => {
      throw new Error('Simulated failure during withdrawEvent');
    };
    try {
      const failRes = await httpRequest({
        port,
        path: `/api/events/${testEventId}/withdraw`,
        method: 'POST',
        headers: { Cookie: adminCookie },
      });
      assert.strictEqual(failRes.status, 500);
      const failJson = JSON.parse(failRes.body);
      assert.strictEqual(failJson.success, false);
      assert.strictEqual(failJson.code, 'INTERNAL_ERROR');
      pass('withdrawEvent async failure caught -> returns 500 INTERNAL_ERROR without crashing');
    } finally {
      eventService.withdrawEvent = origWithdraw;
    }

    // 4.7 approveEvent async rejection
    const origApprove = eventService.approveEvent;
    eventService.approveEvent = async () => {
      throw new Error('Simulated failure during approveEvent');
    };
    try {
      const failRes = await httpRequest({
        port,
        path: `/api/events/${testEventId}/approve`,
        method: 'POST',
        headers: { Cookie: superAdminCookie },
      });
      assert.strictEqual(failRes.status, 500);
      const failJson = JSON.parse(failRes.body);
      assert.strictEqual(failJson.success, false);
      assert.strictEqual(failJson.code, 'INTERNAL_ERROR');
      pass('approveEvent async failure caught -> returns 500 INTERNAL_ERROR without crashing');
    } finally {
      eventService.approveEvent = origApprove;
    }

    // 4.8 rejectEvent async rejection
    const origReject = eventService.rejectEvent;
    eventService.rejectEvent = async () => {
      throw new Error('Simulated failure during rejectEvent');
    };
    try {
      const failRes = await httpRequest({
        port,
        path: `/api/events/${testEventId}/reject`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: superAdminCookie },
        body: JSON.stringify({ reason: 'Simulated rejection reason' }),
      });
      assert.strictEqual(failRes.status, 500);
      const failJson = JSON.parse(failRes.body);
      assert.strictEqual(failJson.success, false);
      assert.strictEqual(failJson.code, 'INTERNAL_ERROR');
      pass('rejectEvent async failure caught -> returns 500 INTERNAL_ERROR without crashing');
    } finally {
      eventService.rejectEvent = origReject;
    }

    // 4.9 cancelEvent async rejection
    const origCancel = eventService.cancelEvent;
    eventService.cancelEvent = async () => {
      throw new Error('Simulated failure during cancelEvent');
    };
    try {
      const failRes = await httpRequest({
        port,
        path: `/api/events/${testEventId}/cancel`,
        method: 'POST',
        headers: { Cookie: adminCookie },
      });
      assert.strictEqual(failRes.status, 500);
      const failJson = JSON.parse(failRes.body);
      assert.strictEqual(failJson.success, false);
      assert.strictEqual(failJson.code, 'INTERNAL_ERROR');
      pass('cancelEvent async failure caught -> returns 500 INTERNAL_ERROR without crashing');
    } finally {
      eventService.cancelEvent = origCancel;
    }

    // 5. Verification of Zero Unhandled Rejections
    console.log('\n--- 5. Unhandled Promise Rejection Audit ---');
    // Allow any pending event-loop microtasks to settle
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.strictEqual(
      unhandledRejectionsCount,
      0,
      `Expected 0 unhandled promise rejections, but found ${unhandledRejectionsCount}: ${JSON.stringify(unhandledRejectionsList)}`
    );
    pass('Zero unhandled promise rejections verified across all async error and success paths');

  } finally {
    server.close();
    if ('closeAllConnections' in server && typeof (server as any).closeAllConnections === 'function') {
      (server as any).closeAllConnections();
    }
  }

  console.log('\n================================================================');
  console.log(`   ALL ${passed} FOCUSED ASYNC INTEGRATION TESTS PASSED!`);
  console.log('================================================================');
  process.exit(0);
}

runAsyncIntegrationTests().catch((err) => {
  console.error('[TEST SUITE FAILED]:', err);
  process.exit(1);
});
