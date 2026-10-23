/**
 * PHASE 3A STEP 2 — NOTIFICATION SERVICE & AUTHENTICATED API TEST SUITE
 *
 * Verifies:
 * 1. Notification Creation & Input Validation (userId, type, title, message, metadata serialization)
 * 2. Unauthenticated Request Blocking (all 4 endpoints return 401 Unauthorized)
 * 3. User Ownership & Data Isolation (User B cannot list, count, or mark User A's notifications)
 * 4. IDOR Protection (Marking another user's notification returns 404 NOT_FOUND, no existence leakage)
 * 5. Bounded Pagination & Timestamp Ordering (newest first, limit bounds, totalPages, hasMore)
 * 6. Read Timestamp Behavior (is_read set, read_at populated and preserved across re-reads)
 * 7. Mark-All-Read Isolation (only affects the authenticated user's unread items)
 * 8. Route Collision Prevention (unread-count and mark-all-read not matched as IDs)
 */

import assert from 'node:assert';
import http from 'node:http';
import express from 'express';
import cookieParser from 'cookie-parser';
import { dbAdapter } from './server/db/adapter.ts';
import { notificationService } from './server/services/notification.service.ts';
import notificationRoutes from './server/routes/notification.routes.ts';
import { generateId, generateSecureToken, hashToken } from './server/utils/crypto.ts';
import { NotificationType } from './src/types/index.ts';

let testsPassed = 0;
let testsFailed = 0;

async function runTest(name: string, fn: () => void | Promise<void>) {
  try {
    const res = fn();
    if (res instanceof Promise) {
      await res;
    }
    console.log(`  ✓ ${name}`);
    testsPassed++;
  } catch (err: any) {
    console.error(`  ✗ ${name}:`, err.message);
    testsFailed++;
  }
}

// Helper to make HTTP requests against test server
function httpRequest(
  server: http.Server,
  options: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: any;
  }
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: any }> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === 'string') {
      return reject(new Error('Server address not available'));
    }

    const payload = options.body ? JSON.stringify(options.body) : undefined;
    const reqHeaders: Record<string, string> = {
      Accept: 'application/json',
      ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(payload)) } : {}),
      ...(options.headers || {}),
    };

    const req = http.request(
      {
        host: '127.0.0.1',
        port: addr.port,
        method: options.method,
        path: options.path,
        headers: reqHeaders,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          let parsed: any;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          resolve({
            statusCode: res.statusCode || 500,
            headers: res.headers,
            body: parsed,
          });
        });
      }
    );

    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function runAllTests() {
  console.log('================================================================');
  console.log('PHASE 3A STEP 2: NOTIFICATION SERVICE & API TEST SUITE');
  console.log('================================================================\n');

  // Set up Express test application with cookie-parser and notification routes
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/notifications', notificationRoutes);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const testUserAId = 'test_user_a_' + Date.now();
  const testUserBId = 'test_user_b_' + Date.now();
  const tokenA = generateSecureToken();
  const tokenB = generateSecureToken();
  const createdNotificationIds: string[] = [];

  try {
    // -------------------------------------------------------------------------
    // Setup Test Users and Sessions in SQLite database
    // -------------------------------------------------------------------------
    const nowIso = new Date().toISOString();
    const futureIso = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

    await dbAdapter.execute(
      `
      INSERT INTO users (id, email, password_hash, first_name, last_name, role, status, created_at, updated_at)
      VALUES ($1, $2, 'dummy_hash', 'UserA', 'Test', 'STAFF', 'ACTIVE', $3, $3),
             ($4, $5, 'dummy_hash', 'UserB', 'Test', 'STAFF', 'ACTIVE', $3, $3)
      `,
      [testUserAId, `usera.${Date.now()}@test.com`, nowIso, testUserBId, `userb.${Date.now()}@test.com`]
    );

    await dbAdapter.execute(
      `
      INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
      VALUES ($1, $2, $3, $4, $5),
             ($6, $7, $8, $4, $5)
      `,
      [generateId(), testUserAId, hashToken(tokenA), futureIso, nowIso, generateId(), testUserBId, hashToken(tokenB)]
    );

    const headersA = { Authorization: `Bearer ${tokenA}` };
    const headersB = { Authorization: `Bearer ${tokenB}` };

    console.log('--- 1. Notification Creation Service & Validation ---');

    await runTest('createNotification rejects missing userId', async () => {
      await assert.rejects(
        () => notificationService.createNotification({ userId: '', type: 'ALERT', title: 'T', message: 'M' }),
        /recipient userId is required/
      );
    });

    await runTest('createNotification rejects missing type', async () => {
      await assert.rejects(
        () => notificationService.createNotification({ userId: testUserAId, type: '', title: 'T', message: 'M' }),
        /type is required/
      );
    });

    await runTest('createNotification rejects missing title', async () => {
      await assert.rejects(
        () => notificationService.createNotification({ userId: testUserAId, type: 'ALERT', title: '', message: 'M' }),
        /title is required/
      );
    });

    await runTest('createNotification rejects title exceeding 255 chars', async () => {
      await assert.rejects(
        () => notificationService.createNotification({ userId: testUserAId, type: 'ALERT', title: 'a'.repeat(256), message: 'M' }),
        /cannot exceed 255 characters/
      );
    });

    await runTest('createNotification rejects missing message', async () => {
      await assert.rejects(
        () => notificationService.createNotification({ userId: testUserAId, type: 'ALERT', title: 'T', message: '' }),
        /message is required/
      );
    });

    let notif1Id = '';
    await runTest('createNotification creates unread notification with serialized metadata', async () => {
      const created = await notificationService.createNotification({
        userId: testUserAId,
        type: NotificationType.VISITOR_CHECKED_IN,
        title: 'Visitor Arrived',
        message: 'Jane Doe has checked in at reception.',
        metadata: { visitorName: 'Jane Doe', visitId: 'visit_123' },
      });

      assert(created.id);
      assert.strictEqual(created.userId, testUserAId);
      assert.strictEqual(created.type, NotificationType.VISITOR_CHECKED_IN);
      assert.strictEqual(created.title, 'Visitor Arrived');
      assert.strictEqual(created.message, 'Jane Doe has checked in at reception.');
      assert.deepStrictEqual(created.metadata, { visitorName: 'Jane Doe', visitId: 'visit_123' });
      assert.strictEqual(created.isRead, false);
      assert.strictEqual(created.readAt, null);
      assert(created.createdAt);

      notif1Id = created.id;
      createdNotificationIds.push(notif1Id);
    });

    console.log('\n--- 2. Unauthenticated Request Blocking ---');

    await runTest('GET /api/notifications returns 401 without auth', async () => {
      const res = await httpRequest(server, { method: 'GET', path: '/api/notifications' });
      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.code, 'UNAUTHORIZED');
    });

    await runTest('GET /api/notifications/unread-count returns 401 without auth', async () => {
      const res = await httpRequest(server, { method: 'GET', path: '/api/notifications/unread-count' });
      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.code, 'UNAUTHORIZED');
    });

    await runTest('PATCH /api/notifications/:id/read returns 401 without auth', async () => {
      const res = await httpRequest(server, { method: 'PATCH', path: `/api/notifications/${notif1Id}/read` });
      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.code, 'UNAUTHORIZED');
    });

    await runTest('PATCH /api/notifications/mark-all-read returns 401 without auth', async () => {
      const res = await httpRequest(server, { method: 'PATCH', path: '/api/notifications/mark-all-read' });
      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.code, 'UNAUTHORIZED');
    });

    console.log('\n--- 3. User Ownership & Data Isolation ---');

    await runTest('User A retrieves their notification; User B receives zero of User A notifications', async () => {
      // User A list
      const resA = await httpRequest(server, { method: 'GET', path: '/api/notifications', headers: headersA });
      assert.strictEqual(resA.statusCode, 200);
      assert.strictEqual(resA.body.success, true);
      assert.strictEqual(resA.body.data.total, 1);
      assert.strictEqual(resA.body.data.notifications[0].id, notif1Id);

      // User B list
      const resB = await httpRequest(server, { method: 'GET', path: '/api/notifications', headers: headersB });
      assert.strictEqual(resB.statusCode, 200);
      assert.strictEqual(resB.body.success, true);
      assert.strictEqual(resB.body.data.total, 0);
      assert.strictEqual(resB.body.data.notifications.length, 0);
    });

    await runTest('User A unread count is 1; User B unread count is 0', async () => {
      const resA = await httpRequest(server, { method: 'GET', path: '/api/notifications/unread-count', headers: headersA });
      assert.strictEqual(resA.statusCode, 200);
      assert.strictEqual(resA.body.data.unreadCount, 1);

      const resB = await httpRequest(server, { method: 'GET', path: '/api/notifications/unread-count', headers: headersB });
      assert.strictEqual(resB.statusCode, 200);
      assert.strictEqual(resB.body.data.unreadCount, 0);
    });

    await runTest('User B cannot mark User A notification as read (returns 404 NOT_FOUND, no ID leakage)', async () => {
      const res = await httpRequest(server, {
        method: 'PATCH',
        path: `/api/notifications/${notif1Id}/read`,
        headers: headersB,
      });

      assert.strictEqual(res.statusCode, 404);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.code, 'NOT_FOUND');
    });

    console.log('\n--- 4. Read Status & Timestamp Preservation ---');

    let firstReadAt = '';
    await runTest('User A marks notification as read (isRead=true, readAt populated)', async () => {
      const res = await httpRequest(server, {
        method: 'PATCH',
        path: `/api/notifications/${notif1Id}/read`,
        headers: headersA,
      });

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.notification.isRead, true);
      assert(res.body.data.notification.readAt);

      firstReadAt = res.body.data.notification.readAt;

      // Verify unread count decreased to 0
      const countRes = await httpRequest(server, { method: 'GET', path: '/api/notifications/unread-count', headers: headersA });
      assert.strictEqual(countRes.body.data.unreadCount, 0);
    });

    await runTest('Re-marking notification as read does NOT overwrite original readAt timestamp', async () => {
      // Wait 10ms to ensure time changes if recalculated
      await new Promise((r) => setTimeout(r, 15));

      const res = await httpRequest(server, {
        method: 'PATCH',
        path: `/api/notifications/${notif1Id}/read`,
        headers: headersA,
      });

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.data.notification.readAt, firstReadAt);
    });

    console.log('\n--- 5. Bounded Pagination & Ordering ---');

    await runTest('Pagination bounds, ordering (newest first), and limits', async () => {
      // Create 3 additional notifications for User A with distinct timestamps
      await new Promise((r) => setTimeout(r, 10));
      const n2 = await notificationService.createNotification({
        userId: testUserAId,
        type: NotificationType.EVENT_APPROVED,
        title: 'Event Approved',
        message: 'Your Q4 All-Hands event was approved.',
      });
      createdNotificationIds.push(n2.id);

      await new Promise((r) => setTimeout(r, 10));
      const n3 = await notificationService.createNotification({
        userId: testUserAId,
        type: NotificationType.SYSTEM,
        title: 'System Notice',
        message: 'Scheduled maintenance this weekend.',
      });
      createdNotificationIds.push(n3.id);

      // Page 1 with limit=2 (User A has 3 total notifications)
      const page1 = await httpRequest(server, {
        method: 'GET',
        path: '/api/notifications?page=1&limit=2',
        headers: headersA,
      });

      assert.strictEqual(page1.statusCode, 200);
      assert.strictEqual(page1.body.data.total, 3);
      assert.strictEqual(page1.body.data.notifications.length, 2);
      assert.strictEqual(page1.body.data.page, 1);
      assert.strictEqual(page1.body.data.limit, 2);
      assert.strictEqual(page1.body.data.totalPages, 2);
      assert.strictEqual(page1.body.data.hasMore, true);
      // Newest first check: n3 was created after n2
      assert.strictEqual(page1.body.data.notifications[0].id, n3.id);
      assert.strictEqual(page1.body.data.notifications[1].id, n2.id);

      // Page 2 with limit=2
      const page2 = await httpRequest(server, {
        method: 'GET',
        path: '/api/notifications?page=2&limit=2',
        headers: headersA,
      });

      assert.strictEqual(page2.statusCode, 200);
      assert.strictEqual(page2.body.data.notifications.length, 1);
      assert.strictEqual(page2.body.data.hasMore, false);
      assert.strictEqual(page2.body.data.notifications[0].id, notif1Id);

      // Unread only filter
      const unreadOnlyRes = await httpRequest(server, {
        method: 'GET',
        path: '/api/notifications?unreadOnly=true',
        headers: headersA,
      });

      assert.strictEqual(unreadOnlyRes.statusCode, 200);
      assert.strictEqual(unreadOnlyRes.body.data.total, 2); // n2 and n3 are unread; notif1Id was read
      assert.strictEqual(unreadOnlyRes.body.data.notifications.length, 2);
    });

    console.log('\n--- 6. Mark All Read Isolation ---');

    await runTest('PATCH /api/notifications/mark-all-read marks only authenticated user items as read', async () => {
      // Create an unread notification for User B
      const notifB = await notificationService.createNotification({
        userId: testUserBId,
        type: NotificationType.VISITOR_CHECKED_IN,
        title: 'Visitor Arrived B',
        message: 'Guest for User B arrived.',
      });
      createdNotificationIds.push(notifB.id);

      // Verify User A unread count = 2 (n2, n3), User B unread count = 1 (notifB)
      const countA1 = await httpRequest(server, { method: 'GET', path: '/api/notifications/unread-count', headers: headersA });
      assert.strictEqual(countA1.body.data.unreadCount, 2);
      const countB1 = await httpRequest(server, { method: 'GET', path: '/api/notifications/unread-count', headers: headersB });
      assert.strictEqual(countB1.body.data.unreadCount, 1);

      // User A marks all as read
      const markAllRes = await httpRequest(server, {
        method: 'PATCH',
        path: '/api/notifications/mark-all-read',
        headers: headersA,
      });

      assert.strictEqual(markAllRes.statusCode, 200);
      assert.strictEqual(markAllRes.body.data.updatedCount, 2);

      // User A unread count is now 0
      const countA2 = await httpRequest(server, { method: 'GET', path: '/api/notifications/unread-count', headers: headersA });
      assert.strictEqual(countA2.body.data.unreadCount, 0);

      // User B unread count is STILL 1 (unaffected)
      const countB2 = await httpRequest(server, { method: 'GET', path: '/api/notifications/unread-count', headers: headersB });
      assert.strictEqual(countB2.body.data.unreadCount, 1);
    });

    console.log('\n--- 7. Route Collision Prevention ---');

    await runTest('/unread-count is never captured by :id/read', async () => {
      const res = await httpRequest(server, { method: 'GET', path: '/api/notifications/unread-count', headers: headersA });
      assert.strictEqual(res.statusCode, 200);
      assert(res.body.data.unreadCount !== undefined);
    });

    await runTest('/mark-all-read is never captured by :id/read', async () => {
      const res = await httpRequest(server, { method: 'PATCH', path: '/api/notifications/mark-all-read', headers: headersA });
      assert.strictEqual(res.statusCode, 200);
      assert(res.body.data.updatedCount !== undefined);
    });
  } finally {
    // -------------------------------------------------------------------------
    // Cleanup created test records
    // -------------------------------------------------------------------------
    try {
      if (createdNotificationIds.length > 0) {
        for (const nid of createdNotificationIds) {
          await dbAdapter.execute('DELETE FROM notifications WHERE id = $1', [nid]);
        }
      }
      await dbAdapter.execute('DELETE FROM sessions WHERE user_id IN ($1, $2)', [testUserAId, testUserBId]);
      await dbAdapter.execute('DELETE FROM users WHERE id IN ($1, $2)', [testUserAId, testUserBId]);
    } catch (cleanupErr) {
      console.warn('Cleanup warning:', cleanupErr);
    }

    server.close();
  }

  console.log('\n================================================================');
  console.log(`TEST SUMMARY: ${testsPassed} passed, ${testsFailed} failed`);
  console.log('================================================================\n');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runAllTests();
