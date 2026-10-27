/**
 * FEEDS FEATURE — PHASE 2B: API ENDPOINTS & ROUTES INTEGRATION TEST SUITE
 *
 * Verifies:
 * 1. Unauthenticated requests blocked across all 7 endpoints with 401.
 * 2. Role access: STAFF, ADMIN, and SUPER_ADMIN can all view and interact with the feed.
 * 3. Inactive/suspended user rejection on mutations.
 * 4. Validation boundaries for post content (empty, >3000 chars, valid plain text).
 * 5. Author anti-spoofing: caller-supplied author IDs or roles are ignored; req.user.id is used.
 * 6. Validation boundaries for comment content (empty, >1000 chars, non-existent post).
 * 7. Post and comment deletion RBAC: non-author STAFF blocked (403), author & ADMIN/SUPER_ADMIN allowed (200).
 * 8. Reaction mechanics: valid/invalid enum, toggle off, type change, stats response.
 * 9. Pagination controls: limit bounds (1-50), cursor validation, malformed cursor rejection.
 * 10. Non-existent resource handling (404 for missing post/comment).
 */

import assert from 'node:assert';
import http from 'node:http';
import express, { Express } from 'express';
import cookieParser from 'cookie-parser';
import { getDatabase } from './server/db/index.ts';
import { dbAdapter } from './server/db/adapter.ts';
import feedRoutes from './server/routes/feed.routes.ts';
import { generateId, generateSecureToken, hashToken } from './server/utils/crypto.ts';

console.log('================================================================');
console.log('--- STARTING FEEDS PHASE 2B: API ENDPOINTS & ROUTES TESTS ---');
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

interface TestUser {
  id: string;
  email: string;
  token: string;
  role: string;
  status: string;
}

async function createTestUser(
  prefix: string,
  role: string = 'STAFF',
  status: string = 'ACTIVE'
): Promise<TestUser> {
  const id = `usr_f2b_${prefix}_${generateId().slice(0, 8)}`;
  const email = `${prefix}_${Date.now()}@feedtest.local`;
  const rawToken = generateSecureToken();
  const tokenHash = hashToken(rawToken);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await dbAdapter.execute(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, status, department, created_at, updated_at)
     VALUES ($1, $2, 'hash_pwd', $3, 'Tester', $4, $5, 'Engineering', $6, $7)`,
    [id, email, prefix, role, status, now, now]
  );

  const sessionId = 'ses_f2b_' + generateId().slice(0, 10);
  await dbAdapter.execute(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [sessionId, id, tokenHash, expiresAt, now]
  );

  return { id, email, token: rawToken, role, status };
}

async function main() {
  getDatabase(); // Ensure SQLite connection and tables initialized

  // Create lightweight Express app mounting the feed routes
  const app: Express = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use('/api/feed', feedRoutes);

  // Global fallback error handler
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: err?.message || 'Error' });
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));

  // Create test actors
  const staffAlice = await createTestUser('alice', 'STAFF', 'ACTIVE');
  const staffBob = await createTestUser('bob', 'STAFF', 'ACTIVE');
  const adminCharlie = await createTestUser('charlie', 'ADMIN', 'ACTIVE');
  const superAdminDiane = await createTestUser('diane', 'SUPER_ADMIN', 'ACTIVE');
  const suspendedEve = await createTestUser('eve', 'STAFF', 'SUSPENDED');

  const authHeader = (user: TestUser) => ({
    Authorization: `Bearer ${user.token}`,
  });

  // 1. Unauthenticated requests
  await runTest('1. Unauthenticated requests to all feed endpoints return 401', async () => {
    const endpoints = [
      { method: 'GET', path: '/api/feed/posts' },
      { method: 'POST', path: '/api/feed/posts', body: { content: 'test' } },
      { method: 'DELETE', path: '/api/feed/posts/some_id' },
      { method: 'GET', path: '/api/feed/posts/some_id/comments' },
      { method: 'POST', path: '/api/feed/posts/some_id/comments', body: { content: 'test' } },
      { method: 'DELETE', path: '/api/feed/comments/some_id' },
      { method: 'POST', path: '/api/feed/posts/some_id/reactions', body: { reactionType: 'LIKE' } },
    ];

    for (const ep of endpoints) {
      const res = await httpRequest(server, {
        method: ep.method,
        path: ep.path,
        body: ep.body,
      });
      assert.strictEqual(
        res.statusCode,
        401,
        `Expected 401 for ${ep.method} ${ep.path}, got ${res.statusCode}`
      );
      assert.strictEqual(res.body?.success, false);
      assert.strictEqual(res.body?.code, 'UNAUTHORIZED');
    }
  });

  // 2. Suspended user mutations blocked
  await runTest('2. Suspended users are rejected from feed mutations with 401 or 403', async () => {
    const resPost = await httpRequest(server, {
      method: 'POST',
      path: '/api/feed/posts',
      headers: authHeader(suspendedEve),
      body: { content: 'Suspended post attempt' },
    });
    // Session validation flags ACCOUNT_SUSPENDED with 401 or route returns 403
    assert(
      resPost.statusCode === 401 || resPost.statusCode === 403,
      `Expected 401/403, got ${resPost.statusCode}`
    );
    assert.strictEqual(resPost.body?.success, false);
  });

  // 3. Post creation & validation boundaries
  let createdPostId = '';
  await runTest('3.1. Reject empty or whitespace-only post content with 400', async () => {
    const res1 = await httpRequest(server, {
      method: 'POST',
      path: '/api/feed/posts',
      headers: authHeader(staffAlice),
      body: { content: '' },
    });
    assert.strictEqual(res1.statusCode, 400);
    assert.strictEqual(res1.body?.code, 'VALIDATION_ERROR');

    const res2 = await httpRequest(server, {
      method: 'POST',
      path: '/api/feed/posts',
      headers: authHeader(staffAlice),
      body: { content: '    \n\t   ' },
    });
    assert.strictEqual(res2.statusCode, 400);
    assert.strictEqual(res2.body?.code, 'VALIDATION_ERROR');
  });

  await runTest('3.2. Reject post content exceeding 3,000 characters with 400', async () => {
    const res = await httpRequest(server, {
      method: 'POST',
      path: '/api/feed/posts',
      headers: authHeader(staffAlice),
      body: { content: 'X'.repeat(3001) },
    });
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body?.code, 'VALIDATION_ERROR');
  });

  await runTest('3.3. Reject non-string post content with 400', async () => {
    const res = await httpRequest(server, {
      method: 'POST',
      path: '/api/feed/posts',
      headers: authHeader(staffAlice),
      body: { content: 12345 },
    });
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body?.code, 'VALIDATION_ERROR');
  });

  await runTest('3.4. Create valid post and verify anti-spoofing', async () => {
    // Attempt to spoof authorId as Bob, role as SUPER_ADMIN
    const res = await httpRequest(server, {
      method: 'POST',
      path: '/api/feed/posts',
      headers: authHeader(staffAlice),
      body: {
        content: 'Welcome to the quarterly engineering kickoff!',
        authorId: staffBob.id,
        role: 'SUPER_ADMIN',
        status: 'SUSPENDED',
      },
    });

    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(res.body?.success, true);
    const post = res.body?.data?.post;
    assert(post?.id);
    // Anti-spoofing: author must be Alice, NOT Bob!
    assert.strictEqual(post.author.id, staffAlice.id);
    assert.strictEqual(post.author.role, 'STAFF');
    assert.strictEqual(post.content, 'Welcome to the quarterly engineering kickoff!');
    createdPostId = post.id;
  });

  // 4. Role access: STAFF, ADMIN, SUPER_ADMIN
  await runTest('4. STAFF, ADMIN, and SUPER_ADMIN can all view posts and publish', async () => {
    // STAFF Bob publishes
    const resBob = await httpRequest(server, {
      method: 'POST',
      path: '/api/feed/posts',
      headers: authHeader(staffBob),
      body: { content: 'Design team sync at 2 PM' },
    });
    assert.strictEqual(resBob.statusCode, 201);

    // ADMIN Charlie publishes
    const resAdmin = await httpRequest(server, {
      method: 'POST',
      path: '/api/feed/posts',
      headers: authHeader(adminCharlie),
      body: { content: 'Company all-hands next Thursday' },
    });
    assert.strictEqual(resAdmin.statusCode, 201);

    // SUPER_ADMIN Diane views feed
    const resDiane = await httpRequest(server, {
      method: 'GET',
      path: '/api/feed/posts',
      headers: authHeader(superAdminDiane),
    });
    assert.strictEqual(resDiane.statusCode, 200);
    assert.strictEqual(resDiane.body?.success, true);
    assert(Array.isArray(resDiane.body?.data?.posts));
  });

  // 5. Comments endpoints & boundaries
  let createdCommentId = '';
  await runTest('5.1. Reject comment on non-existent post with 404', async () => {
    const res = await httpRequest(server, {
      method: 'POST',
      path: '/api/feed/posts/non_existent_post_id/comments',
      headers: authHeader(staffBob),
      body: { content: 'Nice kickoff!' },
    });
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.body?.code, 'NOT_FOUND');
  });

  await runTest('5.2. Reject empty or oversized comments with 400', async () => {
    const resEmpty = await httpRequest(server, {
      method: 'POST',
      path: `/api/feed/posts/${createdPostId}/comments`,
      headers: authHeader(staffBob),
      body: { content: '    ' },
    });
    assert.strictEqual(resEmpty.statusCode, 400);

    const resLong = await httpRequest(server, {
      method: 'POST',
      path: `/api/feed/posts/${createdPostId}/comments`,
      headers: authHeader(staffBob),
      body: { content: 'C'.repeat(1001) },
    });
    assert.strictEqual(resLong.statusCode, 400);
  });

  await runTest('5.3. Create valid comment and verify anti-spoofing', async () => {
    const res = await httpRequest(server, {
      method: 'POST',
      path: `/api/feed/posts/${createdPostId}/comments`,
      headers: authHeader(staffBob),
      body: {
        content: 'Excited for this! Looking forward to the roadmap.',
        authorId: staffAlice.id, // spoof attempt
      },
    });

    assert.strictEqual(res.statusCode, 201);
    const comment = res.body?.data?.comment;
    assert.strictEqual(comment.author.id, staffBob.id); // verified anti-spoofing
    assert.strictEqual(comment.content, 'Excited for this! Looking forward to the roadmap.');
    createdCommentId = comment.id;
  });

  await runTest('5.4. List comments returns chronological list with author details', async () => {
    const res = await httpRequest(server, {
      method: 'GET',
      path: `/api/feed/posts/${createdPostId}/comments`,
      headers: authHeader(staffAlice),
    });

    assert.strictEqual(res.statusCode, 200);
    const comments = res.body?.data?.comments;
    assert(Array.isArray(comments));
    assert.strictEqual(comments.length, 1);
    assert.strictEqual(comments[0].id, createdCommentId);
    assert.strictEqual(comments[0].author.firstName, 'bob');
  });

  // 6. Reactions endpoints & toggle mechanics
  await runTest('6.1. Reject invalid reaction types with 400', async () => {
    const res = await httpRequest(server, {
      method: 'POST',
      path: `/api/feed/posts/${createdPostId}/reactions`,
      headers: authHeader(staffAlice),
      body: { reactionType: 'THUMBS_UP' },
    });
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body?.code, 'VALIDATION_ERROR');
  });

  await runTest('6.2. Reaction toggle lifecycle via API: ADDED -> REMOVED -> ADDED -> UPDATED', async () => {
    // 1. ADDED
    const res1 = await httpRequest(server, {
      method: 'POST',
      path: `/api/feed/posts/${createdPostId}/reactions`,
      headers: authHeader(staffAlice),
      body: { reactionType: 'LIKE' },
    });
    assert.strictEqual(res1.statusCode, 200);
    assert.strictEqual(res1.body?.data?.action, 'ADDED');
    assert.strictEqual(res1.body?.data?.reactionType, 'LIKE');
    assert.strictEqual(res1.body?.data?.totalReactions, 1);
    assert.strictEqual(res1.body?.data?.reactions?.LIKE, 1);

    // 2. REMOVED (same type again)
    const res2 = await httpRequest(server, {
      method: 'POST',
      path: `/api/feed/posts/${createdPostId}/reactions`,
      headers: authHeader(staffAlice),
      body: { reactionType: 'LIKE' },
    });
    assert.strictEqual(res2.statusCode, 200);
    assert.strictEqual(res2.body?.data?.action, 'REMOVED');
    assert.strictEqual(res2.body?.data?.reactionType, null);
    assert.strictEqual(res2.body?.data?.totalReactions, 0);

    // 3. ADDED ('SUPPORT')
    const res3 = await httpRequest(server, {
      method: 'POST',
      path: `/api/feed/posts/${createdPostId}/reactions`,
      headers: authHeader(staffAlice),
      body: { reactionType: 'SUPPORT' },
    });
    assert.strictEqual(res3.statusCode, 200);
    assert.strictEqual(res3.body?.data?.action, 'ADDED');
    assert.strictEqual(res3.body?.data?.reactionType, 'SUPPORT');

    // 4. UPDATED ('SUPPORT' -> 'CELEBRATE')
    const res4 = await httpRequest(server, {
      method: 'POST',
      path: `/api/feed/posts/${createdPostId}/reactions`,
      headers: authHeader(staffAlice),
      body: { reactionType: 'CELEBRATE' },
    });
    assert.strictEqual(res4.statusCode, 200);
    assert.strictEqual(res4.body?.data?.action, 'UPDATED');
    assert.strictEqual(res4.body?.data?.reactionType, 'CELEBRATE');
    assert.strictEqual(res4.body?.data?.totalReactions, 1);
    assert.strictEqual(res4.body?.data?.reactions?.CELEBRATE, 1);
  });

  // 7. Pagination and query parameter validation
  await runTest('7.1. Validate pagination limit boundaries (reject 0, 51, invalid string)', async () => {
    const resZero = await httpRequest(server, {
      method: 'GET',
      path: '/api/feed/posts?limit=0',
      headers: authHeader(staffAlice),
    });
    assert.strictEqual(resZero.statusCode, 400);

    const res51 = await httpRequest(server, {
      method: 'GET',
      path: '/api/feed/posts?limit=51',
      headers: authHeader(staffAlice),
    });
    assert.strictEqual(res51.statusCode, 400);

    const resInvalid = await httpRequest(server, {
      method: 'GET',
      path: '/api/feed/posts?limit=abc',
      headers: authHeader(staffAlice),
    });
    assert.strictEqual(resInvalid.statusCode, 400);
  });

  await runTest('7.2. Reject malformed cursor with 400 VALIDATION_ERROR', async () => {
    const res = await httpRequest(server, {
      method: 'GET',
      path: '/api/feed/posts?cursor=not_a_valid_cursor_string',
      headers: authHeader(staffAlice),
    });
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body?.code, 'VALIDATION_ERROR');
    assert.strictEqual(res.body?.message, 'Invalid pagination cursor.');
  });

  await runTest('7.3. Valid pagination returns cursor and hasMore correctly', async () => {
    const res = await httpRequest(server, {
      method: 'GET',
      path: '/api/feed/posts?limit=2',
      headers: authHeader(staffAlice),
    });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body?.data?.posts?.length, 2);
    assert(res.body?.data?.hasMore === true || res.body?.data?.hasMore === false);
    if (res.body?.data?.hasMore) {
      assert(res.body?.data?.nextCursor, 'nextCursor must be provided when hasMore is true');
    }
  });

  // 8. Deletion RBAC permissions for posts and comments
  await runTest('8.1. Post deletion: Non-author STAFF is forbidden (403)', async () => {
    // Bob tries to delete Alice's post
    const res = await httpRequest(server, {
      method: 'DELETE',
      path: `/api/feed/posts/${createdPostId}`,
      headers: authHeader(staffBob),
    });
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body?.code, 'FORBIDDEN');
  });

  await runTest('8.2. Comment deletion: Non-author STAFF is forbidden (403)', async () => {
    // Alice tries to delete Bob's comment
    const res = await httpRequest(server, {
      method: 'DELETE',
      path: `/api/feed/comments/${createdCommentId}`,
      headers: authHeader(staffAlice),
    });
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body?.code, 'FORBIDDEN');
  });

  await runTest('8.3. Comment deletion: Author can delete own comment (200)', async () => {
    const res = await httpRequest(server, {
      method: 'DELETE',
      path: `/api/feed/comments/${createdCommentId}`,
      headers: authHeader(staffBob),
    });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body?.success, true);
  });

  await runTest('8.4. Post deletion: ADMIN can delete another user post (200)', async () => {
    const res = await httpRequest(server, {
      method: 'DELETE',
      path: `/api/feed/posts/${createdPostId}`,
      headers: authHeader(adminCharlie),
    });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body?.success, true);
  });

  await runTest('8.5. Deleting already-deleted post returns 404 NOT_FOUND', async () => {
    const res = await httpRequest(server, {
      method: 'DELETE',
      path: `/api/feed/posts/${createdPostId}`,
      headers: authHeader(adminCharlie),
    });
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.body?.code, 'NOT_FOUND');
  });

  server.close();

  console.log('================================================================');
  console.log(`PHASE 2B RESULTS: ${passed} passed, ${failed} failed.`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal test failure:', err);
  process.exit(1);
});
