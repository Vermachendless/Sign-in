/**
 * PHASE 2B.2: OFFICIAL ANNOUNCEMENTS BACKEND TEST SUITE
 *
 * Verifies:
 * 1. Ordinary post creation by STAFF, ADMIN, and SUPER_ADMIN with default values.
 * 2. STAFF attempts to publish announcements, set elevated priority, or pin posts receive HTTP 403.
 * 3. ADMIN and SUPER_ADMIN announcement creation (NORMAL, IMPORTANT, URGENT).
 * 4. Validation boundaries: rejection of invalid priorities and non-boolean flags (400).
 * 5. Ordinary posts receive correct defaults (isAnnouncement: false, priority: 'NORMAL', pinnedAt: null).
 * 6. Announcement fields returned by createPost, listPosts, and getPostById.
 * 7. Pin/unpin authorization: STAFF rejected (403), pinning ordinary post rejected (400), ADMIN allowed (200).
 * 8. Two-tier feed ordering & pagination: pinned posts first, unpinned chronological, no duplication on page 2.
 * 9. Paged pinned posts: handling more pinned announcements than the requested limit.
 * 10. In-app notifications: IMPORTANT and URGENT trigger notifications for active colleagues, excluding author.
 * 11. No notifications for ordinary posts or NORMAL announcements.
 * 12. Suspended users excluded from receiving announcement notifications.
 */

import assert from 'node:assert';
import http from 'node:http';
import express, { Express } from 'express';
import cookieParser from 'cookie-parser';
import { getDatabase } from './server/db/index.ts';
import { dbAdapter } from './server/db/adapter.ts';
import feedRoutes from './server/routes/feed.routes.ts';
import { feedService } from './server/services/feed.service.ts';
import { notificationService } from './server/services/notification.service.ts';
import { generateId, generateSecureToken, hashToken } from './server/utils/crypto.ts';
import { UserRole, UserStatus, AnnouncementPriority } from './src/types/index.ts';

console.log('================================================================');
console.log('--- STARTING PHASE 2B.2: ANNOUNCEMENTS BACKEND TEST SUITE ---');
console.log('================================================================');

let passed = 0;
let failed = 0;

async function runTest(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗ ${name}:`, err.message);
    if (err.stack) {
      console.error(err.stack.split('\n').slice(1, 4).join('\n'));
    }
    failed++;
  }
}

// HTTP Helper for testing express routes
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

    const payload = options.body !== undefined ? JSON.stringify(options.body) : undefined;
    const reqHeaders: Record<string, string> = {
      Accept: 'application/json',
      ...options.headers,
    };

    if (payload !== undefined) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(payload).toString();
    }

    const req = http.request(
      {
        host: '127.0.0.1',
        port: addr.port,
        path: options.path,
        method: options.method,
        headers: reqHeaders,
      },
      (res) => {
        let rawData = '';
        res.on('data', (chunk) => {
          rawData += chunk;
        });
        res.on('end', () => {
          let parsed: any;
          try {
            parsed = rawData ? JSON.parse(rawData) : null;
          } catch {
            parsed = rawData;
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
    if (payload !== undefined) {
      req.write(payload);
    }
    req.end();
  });
}

async function main() {
  getDatabase(); // Initialize SQLite tables and migrations

  const app: Express = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/feed', feedRoutes);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));

  // Setup test users & sessions
  const now = new Date().toISOString();
  const future = new Date(Date.now() + 86400000).toISOString();

  async function createTestUserWithSession(
    role: UserRole,
    status: UserStatus = UserStatus.ACTIVE,
    prefix: string = 'user'
  ) {
    const userId = `u_p2b2_${prefix}_${generateId().slice(0, 8)}`;
    const email = `${userId}@test.com`;
    const token = generateSecureToken();
    const tokenHash = hashToken(token);

    await dbAdapter.execute(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, department, role, status, created_at, updated_at)
       VALUES ($1, $2, 'hash', 'Test', $3, 'Engineering', $4, $5, $6, $6)`,
      [userId, email, prefix, role, status, now]
    );

    await dbAdapter.execute(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [`s_${userId}`, userId, tokenHash, future, now]
    );

    return {
      userId,
      email,
      role,
      status,
      token,
      headers: {
        Authorization: `Bearer ${token}`,
        Cookie: `session_token=${token}`,
      },
    };
  }

  const staff1 = await createTestUserWithSession(UserRole.STAFF, UserStatus.ACTIVE, 'staff1');
  const staff2 = await createTestUserWithSession(UserRole.STAFF, UserStatus.ACTIVE, 'staff2');
  const staffSuspended = await createTestUserWithSession(UserRole.STAFF, UserStatus.SUSPENDED, 'staff_susp');
  const admin1 = await createTestUserWithSession(UserRole.ADMIN, UserStatus.ACTIVE, 'admin1');
  const superAdmin1 = await createTestUserWithSession(UserRole.SUPER_ADMIN, UserStatus.ACTIVE, 'superadmin1');

  // --- Group 1: Ordinary Post Creation & Defaults ---
  await runTest('1.1. Ordinary post by STAFF succeeds with default announcement fields', async () => {
    const res = await httpRequest(server, {
      method: 'POST',
      path: '/api/feed/posts',
      headers: staff1.headers,
      body: { content: 'Ordinary staff post from staff1' },
    });

    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(res.body.success, true);
    const post = res.body.data.post;
    assert.strictEqual(post.isAnnouncement, false, 'Default isAnnouncement must be false');
    assert.strictEqual(post.priority, 'NORMAL', "Default priority must be 'NORMAL'");
    assert.strictEqual(post.pinnedAt, null, 'Default pinnedAt must be null');
  });

  await runTest('1.2. Ordinary post by ADMIN succeeds with default announcement fields', async () => {
    const res = await httpRequest(server, {
      method: 'POST',
      path: '/api/feed/posts',
      headers: admin1.headers,
      body: { content: 'Standard post authored by admin' },
    });

    assert.strictEqual(res.statusCode, 201);
    const post = res.body.data.post;
    assert.strictEqual(post.isAnnouncement, false);
    assert.strictEqual(post.priority, 'NORMAL');
    assert.strictEqual(post.pinnedAt, null);
  });

  // --- Group 2: STAFF Privilege Escalation Prevention (403 FORBIDDEN) ---
  await runTest('2.1. STAFF attempting isAnnouncement: true receives 403 FORBIDDEN', async () => {
    const res = await httpRequest(server, {
      method: 'POST',
      path: '/api/feed/posts',
      headers: staff1.headers,
      body: { content: 'Staff trying to broadcast announcement', isAnnouncement: true },
    });

    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.code, 'FORBIDDEN');
    assert((res.body.message || res.body.error?.message || '').includes('Only administrators'));
  });

  await runTest('2.2. STAFF attempting priority: IMPORTANT receives 403 FORBIDDEN', async () => {
    const res = await httpRequest(server, {
      method: 'POST',
      path: '/api/feed/posts',
      headers: staff1.headers,
      body: { content: 'Staff trying to elevate priority', priority: 'IMPORTANT' },
    });

    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.code, 'FORBIDDEN');
  });

  await runTest('2.3. STAFF attempting isPinned: true receives 403 FORBIDDEN', async () => {
    const res = await httpRequest(server, {
      method: 'POST',
      path: '/api/feed/posts',
      headers: staff1.headers,
      body: { content: 'Staff trying to pin a post', isPinned: true },
    });

    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.code, 'FORBIDDEN');
  });

  // --- Group 3: Input Validation Boundaries (400 VALIDATION_ERROR) ---
  await runTest('3.1. Reject invalid priority value with 400', async () => {
    const res = await httpRequest(server, {
      method: 'POST',
      path: '/api/feed/posts',
      headers: admin1.headers,
      body: { content: 'Post with invalid priority', isAnnouncement: true, priority: 'CRITICAL' },
    });

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.code, 'VALIDATION_ERROR');
    assert((res.body.message || res.body.error?.message || '').includes("Must be one of: 'NORMAL', 'IMPORTANT', 'URGENT'"));
  });

  await runTest('3.2. Reject non-boolean isAnnouncement with 400', async () => {
    const res = await httpRequest(server, {
      method: 'POST',
      path: '/api/feed/posts',
      headers: admin1.headers,
      body: { content: 'Non boolean isAnnouncement', isAnnouncement: 'true' },
    });

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.code, 'VALIDATION_ERROR');
  });

  await runTest('3.3. Reject non-boolean isPinned with 400', async () => {
    const res = await httpRequest(server, {
      method: 'POST',
      path: '/api/feed/posts',
      headers: admin1.headers,
      body: { content: 'Non boolean isPinned', isPinned: 1 },
    });

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.code, 'VALIDATION_ERROR');
  });

  await runTest('3.4. Reject pinning non-announcement with 400', async () => {
    const res = await httpRequest(server, {
      method: 'POST',
      path: '/api/feed/posts',
      headers: admin1.headers,
      body: { content: 'Ordinary post cannot be pinned', isAnnouncement: false, isPinned: true },
    });

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.code, 'VALIDATION_ERROR');
    assert((res.body.message || res.body.error?.message || '').includes('Only official announcements can be pinned'));
  });

  await runTest('3.5. Reject elevated priority on non-announcement with 400', async () => {
    const res = await httpRequest(server, {
      method: 'POST',
      path: '/api/feed/posts',
      headers: admin1.headers,
      body: { content: 'Ordinary post cannot have urgent priority', isAnnouncement: false, priority: 'URGENT' },
    });

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.code, 'VALIDATION_ERROR');
    assert((res.body.message || res.body.error?.message || '').includes('Elevated priority is only permitted for official announcements'));
  });

  // --- Group 4: Official Announcement Creation by Admin & Super Admin ---
  let normalAnnouncementId = '';
  let importantAnnouncementId = '';
  let urgentPinnedAnnouncementId = '';

  await runTest('4.1. ADMIN creates NORMAL official announcement', async () => {
    const res = await httpRequest(server, {
      method: 'POST',
      path: '/api/feed/posts',
      headers: admin1.headers,
      body: {
        content: 'Official notice: Office cafeteria menu updated',
        isAnnouncement: true,
        priority: 'NORMAL',
      },
    });

    assert.strictEqual(res.statusCode, 201);
    const post = res.body.data.post;
    assert.strictEqual(post.isAnnouncement, true);
    assert.strictEqual(post.priority, 'NORMAL');
    assert.strictEqual(post.pinnedAt, null);
    normalAnnouncementId = post.id;
  });

  await runTest('4.2. ADMIN creates IMPORTANT official announcement', async () => {
    const res = await httpRequest(server, {
      method: 'POST',
      path: '/api/feed/posts',
      headers: admin1.headers,
      body: {
        content: 'Important notice: Quarterly all-hands meeting on Friday at 3 PM',
        isAnnouncement: true,
        priority: 'IMPORTANT',
      },
    });

    assert.strictEqual(res.statusCode, 201);
    const post = res.body.data.post;
    assert.strictEqual(post.isAnnouncement, true);
    assert.strictEqual(post.priority, 'IMPORTANT');
    assert.strictEqual(post.pinnedAt, null);
    importantAnnouncementId = post.id;
  });

  await runTest('4.3. SUPER_ADMIN creates URGENT pinned official announcement', async () => {
    const res = await httpRequest(server, {
      method: 'POST',
      path: '/api/feed/posts',
      headers: superAdmin1.headers,
      body: {
        content: 'URGENT: Building evacuation drill tomorrow at 10 AM',
        isAnnouncement: true,
        priority: 'URGENT',
        isPinned: true,
      },
    });

    assert.strictEqual(res.statusCode, 201);
    const post = res.body.data.post;
    assert.strictEqual(post.isAnnouncement, true);
    assert.strictEqual(post.priority, 'URGENT');
    assert(post.pinnedAt !== null, 'pinnedAt must be set for pinned announcement');
    urgentPinnedAnnouncementId = post.id;
  });

  // --- Group 5: Response Mapping & Single Post Retrieval ---
  await runTest('5.1. getPostById returns complete announcement fields', async () => {
    const post = await feedService.getPostById(urgentPinnedAnnouncementId, admin1.userId);
    assert(post !== null);
    assert.strictEqual(post.id, urgentPinnedAnnouncementId);
    assert.strictEqual(post.isAnnouncement, true);
    assert.strictEqual(post.priority, 'URGENT');
    assert(typeof post.pinnedAt === 'string');
  });

  // --- Group 6: Pin & Unpin Behavior via API ---
  await runTest('6.1. STAFF cannot pin or unpin posts (403)', async () => {
    const res = await httpRequest(server, {
      method: 'PATCH',
      path: `/api/feed/posts/${importantAnnouncementId}/pin`,
      headers: staff1.headers,
      body: { isPinned: true },
    });

    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body.code, 'FORBIDDEN');
  });

  await runTest('6.2. ADMIN cannot pin an ordinary non-announcement post (400)', async () => {
    // Create an ordinary post
    const stdPost = await feedService.createPost(admin1.userId, 'Ordinary post to test pin rejection');
    const res = await httpRequest(server, {
      method: 'PATCH',
      path: `/api/feed/posts/${stdPost.id}/pin`,
      headers: admin1.headers,
      body: { isPinned: true },
    });

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.code, 'VALIDATION_ERROR');
    assert((res.body.message || res.body.error?.message || '').includes('Only official announcements can be pinned'));
  });

  await runTest('6.3. ADMIN can pin an unpinned announcement (200)', async () => {
    const res = await httpRequest(server, {
      method: 'PATCH',
      path: `/api/feed/posts/${importantAnnouncementId}/pin`,
      headers: admin1.headers,
      body: { isPinned: true },
    });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    const post = res.body.data.post;
    assert.strictEqual(post.id, importantAnnouncementId);
    assert(post.pinnedAt !== null, 'pinnedAt must now be populated');
  });

  await runTest('6.4. ADMIN can unpin a pinned announcement (200)', async () => {
    const res = await httpRequest(server, {
      method: 'PATCH',
      path: `/api/feed/posts/${importantAnnouncementId}/pin`,
      headers: admin1.headers,
      body: { isPinned: false },
    });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    const post = res.body.data.post;
    assert.strictEqual(post.id, importantAnnouncementId);
    assert.strictEqual(post.pinnedAt, null, 'pinnedAt must now be null');
  });

  // --- Group 7: Two-Tier Feed Ordering & Pagination ---
  await runTest('7.1. Initial feed puts pinned announcements at the top', async () => {
    // Current state: urgentPinnedAnnouncementId is pinned; others are unpinned
    const res = await httpRequest(server, {
      method: 'GET',
      path: '/api/feed/posts?limit=10',
      headers: staff1.headers,
    });

    assert.strictEqual(res.statusCode, 200);
    const posts = res.body.data.posts;
    assert(posts.length > 0);
    // First post must be the pinned announcement
    assert.strictEqual(posts[0].id, urgentPinnedAnnouncementId);
    assert(posts[0].pinnedAt !== null);

    // Subsequent unpinned posts follow in chronological order
    const unpinned = posts.filter((p: any) => p.pinnedAt === null);
    for (let i = 1; i < unpinned.length; i++) {
      assert(
        new Date(unpinned[i - 1].createdAt).getTime() >= new Date(unpinned[i].createdAt).getTime(),
        'Unpinned posts must be ordered newest to oldest'
      );
    }
  });

  await runTest('7.2. Paged cursor navigation does not repeat pinned posts', async () => {
    // Request with limit 2
    const res1 = await httpRequest(server, {
      method: 'GET',
      path: '/api/feed/posts?limit=2',
      headers: staff1.headers,
    });

    assert.strictEqual(res1.statusCode, 200);
    assert.strictEqual(res1.body.data.posts.length, 2);
    assert.strictEqual(res1.body.data.posts[0].id, urgentPinnedAnnouncementId);
    const cursor = res1.body.data.nextCursor;
    assert(cursor !== null);

    // Page 2 using cursor
    const res2 = await httpRequest(server, {
      method: 'GET',
      path: `/api/feed/posts?limit=5&cursor=${encodeURIComponent(cursor)}`,
      headers: staff1.headers,
    });

    assert.strictEqual(res2.statusCode, 200);
    const page2Posts = res2.body.data.posts;
    // Page 2 MUST NOT contain the pinned announcement
    const hasPinnedInPage2 = page2Posts.some((p: any) => p.id === urgentPinnedAnnouncementId);
    assert.strictEqual(hasPinnedInPage2, false, 'Pinned post must not repeat on subsequent pages');
  });

  await runTest('7.3. Handle more pinned announcements than the requested limit', async () => {
    // Pin two more announcements: normalAnnouncementId and a new one
    await feedService.setPostPinned(normalAnnouncementId, true, {
      id: admin1.userId,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
    });

    const extraPinned = await feedService.createPost(admin1.userId, 'Extra pinned announcement', {
      isAnnouncement: true,
      priority: 'URGENT',
      isPinned: true,
    });

    // Now we have at least 3 pinned announcements (extraPinned, normalAnnouncementId, urgentPinnedAnnouncementId)
    // Request with limit=2 (less than count of pinned posts)
    const resPage1 = await httpRequest(server, {
      method: 'GET',
      path: '/api/feed/posts?limit=2',
      headers: staff1.headers,
    });

    assert.strictEqual(resPage1.statusCode, 200);
    assert.strictEqual(resPage1.body.data.posts.length, 2);
    assert(resPage1.body.data.hasMore === true);
    assert(resPage1.body.data.nextCursor !== null);
    // Both items on Page 1 must be pinned
    assert(resPage1.body.data.posts[0].pinnedAt !== null);
    assert(resPage1.body.data.posts[1].pinnedAt !== null);

    // Request Page 2 with limit=2
    const resPage2 = await httpRequest(server, {
      method: 'GET',
      path: `/api/feed/posts?limit=2&cursor=${encodeURIComponent(resPage1.body.data.nextCursor)}`,
      headers: staff1.headers,
    });

    assert.strictEqual(resPage2.statusCode, 200);
    assert(resPage2.body.data.posts.length > 0);
    // First item of page 2 should be the 3rd pinned announcement
    const p1Ids = new Set(resPage1.body.data.posts.map((p: any) => p.id));
    for (const p of resPage2.body.data.posts) {
      assert(!p1Ids.has(p.id), `Post ${p.id} from Page 1 must not appear on Page 2`);
    }

    // Clean up extra pinned
    await feedService.setPostPinned(normalAnnouncementId, false, {
      id: admin1.userId,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
    });
    await feedService.deletePost(extraPinned.id, {
      id: admin1.userId,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
    });
  });

  // --- Group 8: In-App Notifications Integration ---
  await runTest('8.1. IMPORTANT announcement notifies active colleagues but not author or suspended users', async () => {
    // Check initial unread counts
    const staff1InitialUnread = await notificationService.getUnreadCount(staff1.userId);
    const staff2InitialUnread = await notificationService.getUnreadCount(staff2.userId);
    const adminInitialUnread = await notificationService.getUnreadCount(admin1.userId);
    const suspInitialUnread = await notificationService.getUnreadCount(staffSuspended.userId);

    // Admin1 creates IMPORTANT announcement
    const res = await httpRequest(server, {
      method: 'POST',
      path: '/api/feed/posts',
      headers: admin1.headers,
      body: {
        content: 'Notification Test: Important health and safety inspection on Monday',
        isAnnouncement: true,
        priority: 'IMPORTANT',
      },
    });

    assert.strictEqual(res.statusCode, 201);
    const postId = res.body.data.post.id;

    // Verify notifications
    const staff1NewUnread = await notificationService.getUnreadCount(staff1.userId);
    const staff2NewUnread = await notificationService.getUnreadCount(staff2.userId);
    const adminNewUnread = await notificationService.getUnreadCount(admin1.userId);
    const suspNewUnread = await notificationService.getUnreadCount(staffSuspended.userId);

    assert.strictEqual(staff1NewUnread, staff1InitialUnread + 1, 'Active staff1 must receive notification');
    assert.strictEqual(staff2NewUnread, staff2InitialUnread + 1, 'Active staff2 must receive notification');
    assert.strictEqual(adminNewUnread, adminInitialUnread, 'Author (admin1) must NOT receive notification');
    assert.strictEqual(suspNewUnread, suspInitialUnread, 'Suspended staff must NOT receive notification');

    // Inspect notification record for staff1
    const staff1Notifs = await notificationService.listNotifications(staff1.userId, { limit: 1 });
    const latestNotif = staff1Notifs.notifications[0];
    assert.strictEqual(latestNotif.title, '[Important] Official Announcement');
    assert(latestNotif.message.includes('health and safety inspection'));
    assert.strictEqual(latestNotif.metadata?.postId, postId);
    assert.strictEqual(latestNotif.metadata?.priority, 'IMPORTANT');
    assert.strictEqual(latestNotif.metadata?.isAnnouncement, true);
  });

  await runTest('8.2. URGENT announcement notifies active colleagues with [URGENT] title', async () => {
    const staff1InitialUnread = await notificationService.getUnreadCount(staff1.userId);

    const res = await httpRequest(server, {
      method: 'POST',
      path: '/api/feed/posts',
      headers: admin1.headers,
      body: {
        content: 'Notification Test: Urgent power outage in server room',
        isAnnouncement: true,
        priority: 'URGENT',
      },
    });

    assert.strictEqual(res.statusCode, 201);
    const postId = res.body.data.post.id;

    const staff1NewUnread = await notificationService.getUnreadCount(staff1.userId);
    assert.strictEqual(staff1NewUnread, staff1InitialUnread + 1);

    const staff1Notifs = await notificationService.listNotifications(staff1.userId, { limit: 1 });
    const latestNotif = staff1Notifs.notifications[0];
    assert.strictEqual(latestNotif.title, '[URGENT] Official Announcement');
    assert(latestNotif.message.includes('power outage'));
    assert.strictEqual(latestNotif.metadata?.postId, postId);
    assert.strictEqual(latestNotif.metadata?.priority, 'URGENT');
  });

  await runTest('8.3. NORMAL priority announcement does NOT generate notifications', async () => {
    const staff1InitialUnread = await notificationService.getUnreadCount(staff1.userId);

    const res = await httpRequest(server, {
      method: 'POST',
      path: '/api/feed/posts',
      headers: admin1.headers,
      body: {
        content: 'Notification Test: Normal announcement should not notify staff',
        isAnnouncement: true,
        priority: 'NORMAL',
      },
    });

    assert.strictEqual(res.statusCode, 201);

    const staff1NewUnread = await notificationService.getUnreadCount(staff1.userId);
    assert.strictEqual(
      staff1NewUnread,
      staff1InitialUnread,
      'NORMAL announcement must not dispatch notifications'
    );
  });

  await runTest('8.4. Ordinary staff post does NOT generate notifications', async () => {
    const staff2InitialUnread = await notificationService.getUnreadCount(staff2.userId);

    const res = await httpRequest(server, {
      method: 'POST',
      path: '/api/feed/posts',
      headers: staff1.headers,
      body: {
        content: 'Ordinary post by staff1 should never trigger notifications',
      },
    });

    assert.strictEqual(res.statusCode, 201);

    const staff2NewUnread = await notificationService.getUnreadCount(staff2.userId);
    assert.strictEqual(
      staff2NewUnread,
      staff2InitialUnread,
      'Ordinary post must not dispatch notifications'
    );
  });

  server.close();

  console.log('================================================================');
  console.log(`PHASE 2B.2 RESULTS: ${passed} passed, ${failed} failed.`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
