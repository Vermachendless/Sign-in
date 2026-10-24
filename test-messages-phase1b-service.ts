/**
 * MESSAGES PHASE 1B — BACKEND SERVICE & AUTHENTICATED API TEST SUITE
 *
 * Verifies:
 * 1. Contact Discovery (messageService.listContacts & GET /api/messages/contacts)
 *    - Excludes authenticated caller
 *    - Filters out non-ACTIVE users (SUSPENDED, INACTIVE)
 *    - Case-insensitive search on first name, last name, email, department
 * 2. Conversation Creation & Canonical Ordering (POST /api/messages/conversations)
 *    - Rejects self-conversations (400)
 *    - Rejects non-existent or inactive recipient (400)
 *    - Canonical ordering: (UserA, UserB) and (UserB, UserA) yield identical conversation
 *    - Canonical ordering constraint: participant1_id < participant2_id
 *    - Idempotent retrieval (201 created first time, 200 on existing)
 * 3. Message Delivery & Anti-Spoofing (POST /api/messages/conversations/:id/messages)
 *    - Validates message content (rejects empty/whitespace, rejects > 2000 chars)
 *    - Anti-spoofing: sender is strictly derived from req.user.id
 *    - Recipient automatically resolved as other participant
 *    - Atomic conversation update: last_message_text and last_message_at updated
 *    - Non-participant access blocked (404 NOT_FOUND)
 * 4. Message History & Pagination (GET /api/messages/conversations/:id/messages)
 *    - Chronological order (oldest to newest)
 *    - Pagination bounds (page, limit, totalPages, hasMore)
 *    - Non-participant access blocked (404 NOT_FOUND)
 * 5. Conversation Listing & Summaries (GET /api/messages/conversations)
 *    - User isolation: lists only conversations the user participates in
 *    - Enriches with other participant profile
 *    - Accurate unread message count per conversation
 * 6. Read Receipts & Unread Counters (PATCH /api/messages/conversations/:id/read & GET /api/messages/unread-count)
 *    - Senders cannot mark their own sent messages as read
 *    - Recipient marking as read updates incoming messages only
 *    - Timestamp preservation: read_at is preserved on repeated marks
 *    - Global unread count reflects unread incoming messages accurately
 * 7. Authentication & Route Guarding
 *    - Unauthenticated requests blocked with 401
 *    - Route collision safety: /unread-count and /contacts never match /:id
 */

import assert from 'node:assert';
import http from 'node:http';
import express, { Express } from 'express';
import cookieParser from 'cookie-parser';
import { getDatabase } from './server/db/index.ts';
import { dbAdapter } from './server/db/adapter.ts';
import { messageService } from './server/services/message.service.ts';
import messageRoutes from './server/routes/message.routes.ts';
import { generateId, generateSecureToken, hashToken } from './server/utils/crypto.ts';

console.log('--- STARTING MESSAGES PHASE 1B SERVICE & API TEST SUITE ---');

let passed = 0;
let failed = 0;

async function runTest(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗ ${name}:`, err.message);
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

// User setup helper
interface TestUser {
  id: string;
  email: string;
  token: string;
  firstName: string;
  lastName: string;
  role: string;
  status: string;
  department: string;
}

async function createTestUser(
  prefix: string,
  firstName: string,
  lastName: string,
  department: string,
  status: string = 'ACTIVE',
  role: string = 'STAFF'
): Promise<TestUser> {
  const id = `usr_${prefix}_${generateId().slice(0, 8)}`;
  const email = `${prefix}_${Date.now()}@company.test`;
  const rawToken = generateSecureToken();
  const tokenHash = hashToken(rawToken);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await dbAdapter.execute(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, status, department, created_at, updated_at)
     VALUES ($1, $2, 'hash_test_123', $3, $4, $5, $6, $7, $8, $9)`,
    [id, email, firstName, lastName, role, status, department, now, now]
  );

  // Insert session
  const sessionId = 'ses_' + generateId().slice(0, 10);
  await dbAdapter.execute(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [sessionId, id, tokenHash, expiresAt, now]
  );

  return {
    id,
    email,
    token: rawToken,
    firstName,
    lastName,
    role,
    status,
    department,
  };
}

async function main() {
  // Ensure database is initialized
  getDatabase();

  // Setup test Express app
  const app: Express = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/messages', messageRoutes);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));

  try {
    // 1. Create Test Users
    const alice = await createTestUser('alice', 'Alice', 'Ada', 'Engineering', 'ACTIVE');
    const bob = await createTestUser('bob', 'Bob', 'Babbage', 'Design', 'ACTIVE');
    const charlie = await createTestUser('charlie', 'Charlie', 'Curie', 'Security', 'ACTIVE');
    const suspendedDave = await createTestUser('dave', 'Dave', 'DeMorgan', 'Marketing', 'SUSPENDED');

    // Headers with Bearer tokens
    const aliceAuth = { Authorization: `Bearer ${alice.token}` };
    const bobAuth = { Authorization: `Bearer ${bob.token}` };
    const charlieAuth = { Authorization: `Bearer ${charlie.token}` };
    const daveAuth = { Authorization: `Bearer ${suspendedDave.token}` };

    // TEST SECTION 1: CONTACT DISCOVERY
    await runTest('1.1. Contacts list excludes authenticated caller and suspended users', async () => {
      const res = await httpRequest(server, {
        method: 'GET',
        path: '/api/messages/contacts',
        headers: aliceAuth,
      });

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      const contacts = res.body.data.contacts;
      assert(Array.isArray(contacts), 'Contacts must be an array');

      // Must not contain Alice herself
      assert(!contacts.some((c: any) => c.id === alice.id), 'Caller must not be in contacts');
      // Must not contain suspended Dave
      assert(!contacts.some((c: any) => c.id === suspendedDave.id), 'Suspended user must not be in contacts');
      // Must contain Bob and Charlie
      assert(contacts.some((c: any) => c.id === bob.id), 'Bob must be in contacts');
      assert(contacts.some((c: any) => c.id === charlie.id), 'Charlie must be in contacts');
    });

    await runTest('1.2. Contacts search filters case-insensitively by name, email, or department', async () => {
      const res = await httpRequest(server, {
        method: 'GET',
        path: `/api/messages/contacts?search=babbage`,
        headers: aliceAuth,
      });

      assert.strictEqual(res.statusCode, 200);
      const contacts = res.body.data.contacts;
      assert(contacts.length >= 1, 'Should find at least 1 contact matching search');
      const bobContact = contacts.find((c: any) => c.id === bob.id);
      assert(bobContact, 'Bob must be in search results');
      assert.strictEqual(bobContact.lastName, 'Babbage');
    });

    // TEST SECTION 2: CONVERSATION CREATION & CANONICAL ORDERING
    let sharedConvId = '';

    await runTest('2.1. Self-conversations are rejected with 400', async () => {
      const res = await httpRequest(server, {
        method: 'POST',
        path: '/api/messages/conversations',
        headers: aliceAuth,
        body: { recipientId: alice.id },
      });

      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.code, 'VALIDATION_ERROR');
    });

    await runTest('2.2. Conversation with non-existent or suspended recipient is rejected with 400', async () => {
      const resNonExistent = await httpRequest(server, {
        method: 'POST',
        path: '/api/messages/conversations',
        headers: aliceAuth,
        body: { recipientId: 'usr_nonexistent_9999' },
      });
      assert.strictEqual(resNonExistent.statusCode, 400);

      const resSuspended = await httpRequest(server, {
        method: 'POST',
        path: '/api/messages/conversations',
        headers: aliceAuth,
        body: { recipientId: suspendedDave.id },
      });
      assert.strictEqual(resSuspended.statusCode, 400);
    });

    await runTest('2.3. Alice initiates conversation with Bob: returns 201 Created', async () => {
      const res = await httpRequest(server, {
        method: 'POST',
        path: '/api/messages/conversations',
        headers: aliceAuth,
        body: { recipientId: bob.id },
      });

      assert.strictEqual(res.statusCode, 201);
      assert.strictEqual(res.body.success, true);
      const conv = res.body.data.conversation;
      assert(conv.id, 'Conversation must have an ID');
      sharedConvId = conv.id;

      // Check canonical ordering: participant1_id < participant2_id
      const p1 = conv.participant1Id;
      const p2 = conv.participant2Id;
      assert(p1 < p2, `participant1_id (${p1}) must be < participant2_id (${p2})`);
      assert(
        (p1 === alice.id && p2 === bob.id) || (p1 === bob.id && p2 === alice.id),
        'Participants must be Alice and Bob'
      );
    });

    await runTest('2.4. Bob initiates conversation with Alice: returns existing conversation (200 OK, idempotent)', async () => {
      const res = await httpRequest(server, {
        method: 'POST',
        path: '/api/messages/conversations',
        headers: bobAuth,
        body: { recipientId: alice.id },
      });

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      const conv = res.body.data.conversation;
      assert.strictEqual(conv.id, sharedConvId, 'Must return the identical conversation ID regardless of caller order');
    });

    // TEST SECTION 3: MESSAGE SENDING & ANTI-SPOOFING
    let msg1Id = '';
    let msg2Id = '';

    await runTest('3.1. Rejects empty, whitespace, and oversized messages with 400', async () => {
      const resEmpty = await httpRequest(server, {
        method: 'POST',
        path: `/api/messages/conversations/${sharedConvId}/messages`,
        headers: aliceAuth,
        body: { content: '   ' },
      });
      assert.strictEqual(resEmpty.statusCode, 400);

      const resOversized = await httpRequest(server, {
        method: 'POST',
        path: `/api/messages/conversations/${sharedConvId}/messages`,
        headers: aliceAuth,
        body: { content: 'x'.repeat(2001) },
      });
      assert.strictEqual(resOversized.statusCode, 400);
    });

    await runTest('3.2. Alice sends message to Bob: sender spoofing immunity and conversation update', async () => {
      const res = await httpRequest(server, {
        method: 'POST',
        path: `/api/messages/conversations/${sharedConvId}/messages`,
        headers: aliceAuth,
        // Attempting to spoof sender_id or recipient_id in body
        body: { content: 'Hello Bob!', senderId: bob.id, recipientId: charlie.id },
      });

      assert.strictEqual(res.statusCode, 201);
      const msg = res.body.data.message;
      assert.strictEqual(msg.senderId, alice.id, 'Sender must strictly be Alice (derived from token)');
      assert.strictEqual(msg.recipientId, bob.id, 'Recipient must be automatically resolved to Bob');
      assert.strictEqual(msg.content, 'Hello Bob!');
      assert.strictEqual(msg.isRead, false);
      msg1Id = msg.id;

      // Verify conversation's last_message_text was updated
      const convCheck = await messageService.getConversationById(alice.id, sharedConvId);
      assert.strictEqual(convCheck?.lastMessageText, 'Hello Bob!');
      assert(convCheck?.lastMessageAt, 'lastMessageAt must be set');
    });

    await runTest('3.3. Non-participant Charlie cannot send message to Alice-Bob conversation (404 NOT_FOUND)', async () => {
      const res = await httpRequest(server, {
        method: 'POST',
        path: `/api/messages/conversations/${sharedConvId}/messages`,
        headers: charlieAuth,
        body: { content: 'Unauthorized intrusion!' },
      });

      assert.strictEqual(res.statusCode, 404, 'Must return 404 to avoid leaking conversation existence to non-participants');
    });

    await runTest('3.4. Alice sends second message to Bob', async () => {
      const res = await httpRequest(server, {
        method: 'POST',
        path: `/api/messages/conversations/${sharedConvId}/messages`,
        headers: aliceAuth,
        body: { content: 'Are you available to review the site plans?' },
      });

      assert.strictEqual(res.statusCode, 201);
      msg2Id = res.body.data.message.id;
    });

    // TEST SECTION 4: UNREAD COUNTS & CONVERSATION LISTING
    await runTest('4.1. Global unread count reflects 2 unread messages for Bob, 0 for Alice', async () => {
      const resBob = await httpRequest(server, {
        method: 'GET',
        path: '/api/messages/unread-count',
        headers: bobAuth,
      });
      assert.strictEqual(resBob.statusCode, 200);
      assert.strictEqual(resBob.body.data.unreadCount, 2, 'Bob must have 2 unread incoming messages');

      const resAlice = await httpRequest(server, {
        method: 'GET',
        path: '/api/messages/unread-count',
        headers: aliceAuth,
      });
      assert.strictEqual(resAlice.statusCode, 200);
      assert.strictEqual(resAlice.body.data.unreadCount, 0, 'Alice is sender; unread count must be 0');
    });

    await runTest('4.2. Conversations listing returns summary with other participant profile and unread count', async () => {
      // Bob's list
      const resBob = await httpRequest(server, {
        method: 'GET',
        path: '/api/messages/conversations',
        headers: bobAuth,
      });

      assert.strictEqual(resBob.statusCode, 200);
      assert.strictEqual(resBob.body.data.conversations.length, 1);
      const bobSummary = resBob.body.data.conversations[0];
      assert.strictEqual(bobSummary.id, sharedConvId);
      assert.strictEqual(bobSummary.otherParticipant.id, alice.id);
      assert.strictEqual(bobSummary.otherParticipant.firstName, 'Alice');
      assert.strictEqual(bobSummary.unreadCount, 2);
      assert.strictEqual(bobSummary.lastMessage?.content, 'Are you available to review the site plans?');

      // Charlie's list: must be empty
      const resCharlie = await httpRequest(server, {
        method: 'GET',
        path: '/api/messages/conversations',
        headers: charlieAuth,
      });
      assert.strictEqual(resCharlie.statusCode, 200);
      assert.strictEqual(resCharlie.body.data.conversations.length, 0);
    });

    // TEST SECTION 5: MESSAGE HISTORY & PAGINATION
    await runTest('5.1. Message history is chronological (oldest first) and paginated', async () => {
      const res = await httpRequest(server, {
        method: 'GET',
        path: `/api/messages/conversations/${sharedConvId}/messages?page=1&limit=10`,
        headers: aliceAuth,
      });

      assert.strictEqual(res.statusCode, 200);
      const { messages, total, totalPages, hasMore } = res.body.data;
      assert.strictEqual(total, 2);
      assert.strictEqual(totalPages, 1);
      assert.strictEqual(hasMore, false);
      assert.strictEqual(messages.length, 2);
      assert.strictEqual(messages[0].id, msg1Id);
      assert.strictEqual(messages[1].id, msg2Id);
      assert.strictEqual(messages[0].content, 'Hello Bob!');
      assert.strictEqual(messages[1].content, 'Are you available to review the site plans?');
    });

    await runTest('5.2. Non-participant Charlie cannot read message history (404 NOT_FOUND)', async () => {
      const res = await httpRequest(server, {
        method: 'GET',
        path: `/api/messages/conversations/${sharedConvId}/messages`,
        headers: charlieAuth,
      });
      assert.strictEqual(res.statusCode, 404);
    });

    // TEST SECTION 6: READ RECEIPTS & MARK-AS-READ
    await runTest('6.1. Sender Alice cannot mark messages as read (0 updated)', async () => {
      const res = await httpRequest(server, {
        method: 'PATCH',
        path: `/api/messages/conversations/${sharedConvId}/read`,
        headers: aliceAuth,
      });

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.data.markedCount, 0, 'Sender has no incoming unread messages to mark');
      assert.strictEqual(res.body.data.unreadCount, 0);
    });

    await runTest('6.2. Non-participant Charlie cannot mark conversation as read (404 NOT_FOUND)', async () => {
      const res = await httpRequest(server, {
        method: 'PATCH',
        path: `/api/messages/conversations/${sharedConvId}/read`,
        headers: charlieAuth,
      });
      assert.strictEqual(res.statusCode, 404);
    });

    await runTest('6.3. Recipient Bob marks conversation as read: updates messages, sets read_at, resets unread count', async () => {
      const res = await httpRequest(server, {
        method: 'PATCH',
        path: `/api/messages/conversations/${sharedConvId}/read`,
        headers: bobAuth,
      });

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.data.markedCount, 2, 'Must have marked 2 incoming messages');
      assert.strictEqual(res.body.data.unreadCount, 0, 'Refreshed total unread count must now be 0');

      // Verify individual message records
      const msgsRes = await httpRequest(server, {
        method: 'GET',
        path: `/api/messages/conversations/${sharedConvId}/messages`,
        headers: bobAuth,
      });
      const msgs = msgsRes.body.data.messages;
      assert.strictEqual(msgs[0].isRead, true);
      assert(msgs[0].readAt, 'readAt timestamp must be set');
      assert.strictEqual(msgs[1].isRead, true);
      assert(msgs[1].readAt, 'readAt timestamp must be set');

      // Verify idempotent second mark-as-read (markedCount = 0, readAt unchanged)
      const firstReadAt = msgs[0].readAt;
      const resSecond = await httpRequest(server, {
        method: 'PATCH',
        path: `/api/messages/conversations/${sharedConvId}/read`,
        headers: bobAuth,
      });
      assert.strictEqual(resSecond.statusCode, 200);
      assert.strictEqual(resSecond.body.data.markedCount, 0, 'No more unread messages to mark');

      const msgsCheck = await httpRequest(server, {
        method: 'GET',
        path: `/api/messages/conversations/${sharedConvId}/messages`,
        headers: bobAuth,
      });
      assert.strictEqual(msgsCheck.body.data.messages[0].readAt, firstReadAt, 'readAt timestamp must not be overwritten');
    });

    // TEST SECTION 7: AUTHENTICATION ENFORCEMENT & ROUTE COLLISION PREVENTION
    await runTest('7.1. Unauthenticated requests to all message endpoints return 401 Unauthorized', async () => {
      const endpoints = [
        { method: 'GET', path: '/api/messages/contacts' },
        { method: 'GET', path: '/api/messages/unread-count' },
        { method: 'GET', path: '/api/messages/conversations' },
        { method: 'POST', path: '/api/messages/conversations', body: { recipientId: bob.id } },
        { method: 'GET', path: `/api/messages/conversations/${sharedConvId}/messages` },
        { method: 'POST', path: `/api/messages/conversations/${sharedConvId}/messages`, body: { content: 'test' } },
        { method: 'PATCH', path: `/api/messages/conversations/${sharedConvId}/read` },
      ];

      for (const ep of endpoints) {
        const res = await httpRequest(server, {
          method: ep.method,
          path: ep.path,
          body: ep.body,
        });
        assert.strictEqual(res.statusCode, 401, `${ep.method} ${ep.path} must return 401 without auth`);
        assert.strictEqual(res.body.code, 'UNAUTHORIZED');
      }
    });

    await runTest('7.2. Route collision test: /unread-count and /contacts are not captured as :id', async () => {
      const resUnread = await httpRequest(server, {
        method: 'GET',
        path: '/api/messages/unread-count',
        headers: aliceAuth,
      });
      assert.strictEqual(resUnread.statusCode, 200);
      assert(resUnread.body.data.hasOwnProperty('unreadCount'), 'Must hit unread-count handler, not :id handler');

      const resContacts = await httpRequest(server, {
        method: 'GET',
        path: '/api/messages/contacts',
        headers: aliceAuth,
      });
      assert.strictEqual(resContacts.statusCode, 200);
      assert(resContacts.body.data.hasOwnProperty('contacts'), 'Must hit contacts handler, not :id handler');
    });
  } finally {
    server.close();
  }

  console.log('\n--- TEST RESULTS SUMMARY ---');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error during test run:', err);
  process.exit(1);
});
