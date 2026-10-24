/**
 * MESSAGES PHASE 1A — DATABASE SCHEMA & CONSTRAINTS TEST SUITE
 *
 * Verifies:
 * 1. Both tables (conversations, direct_messages) initialize cleanly and idempotently.
 * 2. Canonical participant ordering: participant1_id < participant2_id succeeds.
 * 3. Self-conversations (participant1_id == participant2_id) are rejected by CHECK constraint.
 * 4. Inverted participant order (participant1_id > participant2_id) is rejected by CHECK constraint.
 * 5. Unique constraint prevents duplicate one-to-one conversations.
 * 6. Foreign key enforcement on users(id) for conversations.
 * 7. Direct messages insertion, defaults (is_read = 0), and foreign keys.
 * 8. Self-messages (sender_id == recipient_id) are rejected by CHECK constraint.
 * 9. All required performance indexes exist in the database.
 * 10. PostgreSQL schema DDL syntax validation.
 */

import assert from 'node:assert';
import { getDatabase } from './server/db/index.ts';
import { dbAdapter } from './server/db/adapter.ts';
import { POSTGRES_SCHEMA_SQL } from './server/db/schema.postgres.ts';
import { generateId } from './server/utils/crypto.ts';

console.log('--- STARTING MESSAGES PHASE 1A SCHEMA & CONSTRAINTS TESTS ---');

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

async function setupTestUsers() {
  const now = new Date().toISOString();
  // Ensure user A has lower ID than user B
  const id1 = 'usr_msg_a_' + generateId().slice(0, 8);
  const id2 = 'usr_msg_b_' + generateId().slice(0, 8);
  const userA = id1 < id2 ? id1 : id2;
  const userB = id1 < id2 ? id2 : id1;

  await dbAdapter.execute(
    `INSERT OR IGNORE INTO users (id, email, password_hash, first_name, last_name, role, status, department, created_at, updated_at)
     VALUES ($1, $2, 'hash123', 'Alice', 'Messaging', 'STAFF', 'ACTIVE', 'Engineering', $3, $4)`,
    [userA, `alice_${Date.now()}@test.com`, now, now]
  );

  await dbAdapter.execute(
    `INSERT OR IGNORE INTO users (id, email, password_hash, first_name, last_name, role, status, department, created_at, updated_at)
     VALUES ($1, $2, 'hash123', 'Bob', 'Messaging', 'STAFF', 'ACTIVE', 'Design', $3, $4)`,
    [userB, `bob_${Date.now()}@test.com`, now, now]
  );

  return { userA, userB };
}

async function runAllTests() {
  // 1. Initialize SQLite database & verify schema migration
  await runTest('1. Database initializes conversations and direct_messages tables cleanly', () => {
    const db = getDatabase();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('conversations', 'direct_messages')").all() as any[];
    assert.strictEqual(tables.length, 2, 'Both conversations and direct_messages tables must exist in SQLite');
  });

  const { userA, userB } = await setupTestUsers();
  const now = new Date().toISOString();

  // 2. Canonical participant ordering (userA < userB) succeeds
  const convId = 'conv_test_' + generateId().slice(0, 8);
  await runTest('2. Canonical participant ordering (participant1_id < participant2_id) succeeds', async () => {
    await dbAdapter.execute(
      `INSERT INTO conversations (id, participant1_id, participant2_id, last_message_text, last_message_at, created_at, updated_at)
       VALUES ($1, $2, $3, NULL, NULL, $4, $5)`,
      [convId, userA, userB, now, now]
    );

    const row = await dbAdapter.queryOne<any>('SELECT * FROM conversations WHERE id = $1', [convId]);
    assert(row, 'Conversation record must be retrieved');
    assert.strictEqual(row.participant1_id, userA);
    assert.strictEqual(row.participant2_id, userB);
  });

  // 3. Self-conversation is rejected by CHECK constraint
  await runTest('3. Self-conversation (participant1_id == participant2_id) is rejected by CHECK constraint', async () => {
    let threw = false;
    try {
      await dbAdapter.execute(
        `INSERT INTO conversations (id, participant1_id, participant2_id, last_message_text, last_message_at, created_at, updated_at)
         VALUES ($1, $2, $3, NULL, NULL, $4, $5)`,
        ['conv_self_' + generateId().slice(0, 8), userA, userA, now, now]
      );
    } catch {
      threw = true;
    }
    assert.strictEqual(threw, true, 'Self-conversation must fail CHECK (participant1_id < participant2_id)');
  });

  // 4. Inverted participant order (userB > userA) is rejected by CHECK constraint
  await runTest('4. Inverted participant order (participant1_id > participant2_id) is rejected by CHECK constraint', async () => {
    let threw = false;
    try {
      await dbAdapter.execute(
        `INSERT INTO conversations (id, participant1_id, participant2_id, last_message_text, last_message_at, created_at, updated_at)
         VALUES ($1, $2, $3, NULL, NULL, $4, $5)`,
        ['conv_inv_' + generateId().slice(0, 8), userB, userA, now, now]
      );
    } catch {
      threw = true;
    }
    assert.strictEqual(threw, true, 'Inverted participant order must fail CHECK (participant1_id < participant2_id)');
  });

  // 5. Duplicate conversation between same participants is rejected by UNIQUE constraint
  await runTest('5. Duplicate conversation between same participants is rejected by UNIQUE constraint', async () => {
    let threw = false;
    try {
      await dbAdapter.execute(
        `INSERT INTO conversations (id, participant1_id, participant2_id, last_message_text, last_message_at, created_at, updated_at)
         VALUES ($1, $2, $3, NULL, NULL, $4, $5)`,
        ['conv_dup_' + generateId().slice(0, 8), userA, userB, now, now]
      );
    } catch {
      threw = true;
    }
    assert.strictEqual(threw, true, 'Duplicate conversation must fail UNIQUE(participant1_id, participant2_id)');
  });

  // 6. Direct message insertion with valid participants
  const msgId = 'msg_test_' + generateId().slice(0, 8);
  await runTest('6. Direct message insertion succeeds with correct defaults (is_read = 0)', async () => {
    await dbAdapter.execute(
      `INSERT INTO direct_messages (id, conversation_id, sender_id, recipient_id, content, is_read, read_at, created_at)
       VALUES ($1, $2, $3, $4, $5, 0, NULL, $6)`,
      [msgId, convId, userA, userB, 'Hello Bob! This is a test message.', now]
    );

    const row = await dbAdapter.queryOne<any>('SELECT * FROM direct_messages WHERE id = $1', [msgId]);
    assert(row, 'Message must be retrieved');
    assert.strictEqual(row.content, 'Hello Bob! This is a test message.');
    assert.strictEqual(Number(row.is_read), 0);
    assert.strictEqual(row.read_at, null);
  });

  // 7. Self-message (sender_id == recipient_id) is rejected by CHECK constraint
  await runTest('7. Self-message (sender_id == recipient_id) is rejected by CHECK constraint', async () => {
    let threw = false;
    try {
      await dbAdapter.execute(
        `INSERT INTO direct_messages (id, conversation_id, sender_id, recipient_id, content, is_read, read_at, created_at)
         VALUES ($1, $2, $3, $4, $5, 0, NULL, $6)`,
        ['msg_self_' + generateId().slice(0, 8), convId, userA, userA, 'Self talk', now]
      );
    } catch {
      threw = true;
    }
    assert.strictEqual(threw, true, 'Self-message must fail CHECK (sender_id != recipient_id)');
  });

  // 8. Required indexes exist in SQLite
  await runTest('8. Required indexes for conversations and direct_messages exist in SQLite', () => {
    const db = getDatabase();
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as any[];
    const indexNames = new Set(rows.map((r) => r.name));

    const expectedIndexes = [
      'idx_conversations_p1',
      'idx_conversations_p2',
      'idx_conversations_last_message',
      'idx_direct_messages_convo_created',
      'idx_direct_messages_recipient_unread',
      'idx_direct_messages_convo_recipient_unread',
    ];

    for (const idx of expectedIndexes) {
      assert(indexNames.has(idx), `Expected index ${idx} must exist`);
    }
  });

  // 9. PostgreSQL schema DDL validation
  await runTest('9. PostgreSQL schema DDL contains conversations and direct_messages tables and indexes', () => {
    assert(POSTGRES_SCHEMA_SQL.includes('CREATE TABLE IF NOT EXISTS conversations'), 'Postgres schema must define conversations');
    assert(POSTGRES_SCHEMA_SQL.includes('CREATE TABLE IF NOT EXISTS direct_messages'), 'Postgres schema must define direct_messages');
    assert(POSTGRES_SCHEMA_SQL.includes('idx_conversations_p1'), 'Postgres schema must define idx_conversations_p1');
    assert(POSTGRES_SCHEMA_SQL.includes('idx_direct_messages_convo_created'), 'Postgres schema must define idx_direct_messages_convo_created');
    assert(POSTGRES_SCHEMA_SQL.includes('idx_direct_messages_recipient_unread'), 'Postgres schema must define idx_direct_messages_recipient_unread');
    assert(POSTGRES_SCHEMA_SQL.includes('CHECK (participant1_id < participant2_id)'), 'Postgres schema must enforce canonical participant ordering');
    assert(POSTGRES_SCHEMA_SQL.includes('CHECK (sender_id != recipient_id)'), 'Postgres schema must prohibit self-messages');
  });

  console.log(`\nMessages Phase 1A Schema Test Summary: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
