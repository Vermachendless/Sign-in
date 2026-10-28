/**
 * PHASE 2A: ANNOUNCEMENT SCHEMA, CONSTRAINTS & TYPES TEST SUITE
 *
 * Verifies:
 * 1. Default values on creating standard posts (is_announcement = 0, priority = 'NORMAL', pinned_at = NULL).
 * 2. Setting announcement values (is_announcement = 1, priority = 'IMPORTANT' | 'URGENT', pinned_at = ISO string).
 * 3. Database CHECK constraint rejection when invalid priorities are supplied (e.g. 'CRITICAL', 'LOW', 'BOGUS').
 * 4. Synchronization of SQLite schema, PostgreSQL TS schema, and PostgreSQL raw SQL schema.
 * 5. Idempotent column addition for pre-existing SQLite databases without data loss.
 * 6. TypeScript type exports and structural integrity.
 */

import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { DB_SCHEMA_SQL } from './server/db/schema.ts';
import { POSTGRES_SCHEMA_SQL as POSTGRES_TS_SQL } from './server/db/schema.postgres.ts';
import { getDatabase, closeDatabase } from './server/db/index.ts';
import {
  AnnouncementPriority,
  FeedPost,
  FeedPostItem,
  FeedPostRecord,
} from './src/types/index.ts';

console.log('================================================================');
console.log('--- STARTING PHASE 2A: ANNOUNCEMENT SCHEMA & TYPES TEST SUITE ---');
console.log('================================================================');

let passed = 0;
let failed = 0;

function runTest(name: string, fn: () => void | Promise<void>) {
  try {
    const res = fn();
    if (res instanceof Promise) {
      return res
        .then(() => {
          console.log(`  ✓ ${name}`);
          passed++;
        })
        .catch((err) => {
          console.error(`  ✗ ${name}:`, err.message);
          failed++;
        });
    } else {
      console.log(`  ✓ ${name}`);
      passed++;
    }
  } catch (err: any) {
    console.error(`  ✗ ${name}:`, err.message);
    failed++;
  }
}

async function main() {
  // Test Group 1: Schema DDL & Artifact Synchronization
  runTest('1.1. SQLite schema DDL includes announcement columns and CHECK constraint', () => {
    assert(
      DB_SCHEMA_SQL.includes('is_announcement BOOLEAN NOT NULL DEFAULT 0'),
      'SQLite schema must define is_announcement with DEFAULT 0'
    );
    assert(
      DB_SCHEMA_SQL.includes("CHECK(priority IN ('NORMAL', 'IMPORTANT', 'URGENT'))"),
      'SQLite schema must enforce priority CHECK constraint'
    );
    assert(
      DB_SCHEMA_SQL.includes("priority TEXT NOT NULL CHECK(priority IN ('NORMAL', 'IMPORTANT', 'URGENT')) DEFAULT 'NORMAL'"),
      "SQLite schema must define priority default 'NORMAL'"
    );
    assert(
      DB_SCHEMA_SQL.includes('pinned_at TEXT'),
      'SQLite schema must define nullable pinned_at'
    );
  });

  runTest('1.2. PostgreSQL TS schema includes announcement columns and CHECK constraint', () => {
    assert(
      POSTGRES_TS_SQL.includes('is_announcement BOOLEAN NOT NULL DEFAULT FALSE'),
      'PostgreSQL TS schema must define is_announcement with DEFAULT FALSE'
    );
    assert(
      POSTGRES_TS_SQL.includes("CHECK (priority IN ('NORMAL', 'IMPORTANT', 'URGENT'))"),
      'PostgreSQL TS schema must enforce priority CHECK constraint'
    );
    assert(
      POSTGRES_TS_SQL.includes("priority VARCHAR(20) NOT NULL CHECK (priority IN ('NORMAL', 'IMPORTANT', 'URGENT')) DEFAULT 'NORMAL'"),
      "PostgreSQL TS schema must define priority default 'NORMAL'"
    );
    assert(
      POSTGRES_TS_SQL.includes('pinned_at TIMESTAMPTZ'),
      'PostgreSQL TS schema must define nullable pinned_at TIMESTAMPTZ'
    );
  });

  runTest('1.3. PostgreSQL raw SQL file (schema.postgres.sql) contains tables 14, 15, 16 synchronized with TS schema', () => {
    const rawSqlPath = path.join(process.cwd(), 'server', 'db', 'schema.postgres.sql');
    assert(fs.existsSync(rawSqlPath), 'schema.postgres.sql must exist');
    const rawSql = fs.readFileSync(rawSqlPath, 'utf8');

    assert(rawSql.includes('CREATE TABLE IF NOT EXISTS feed_posts'), 'schema.postgres.sql must include feed_posts');
    assert(rawSql.includes('CREATE TABLE IF NOT EXISTS feed_comments'), 'schema.postgres.sql must include feed_comments');
    assert(rawSql.includes('CREATE TABLE IF NOT EXISTS feed_reactions'), 'schema.postgres.sql must include feed_reactions');

    assert(
      rawSql.includes('is_announcement BOOLEAN NOT NULL DEFAULT FALSE'),
      'schema.postgres.sql must contain is_announcement'
    );
    assert(
      rawSql.includes("CHECK (priority IN ('NORMAL', 'IMPORTANT', 'URGENT'))"),
      'schema.postgres.sql must contain priority CHECK constraint'
    );
    assert(
      rawSql.includes('pinned_at TIMESTAMPTZ'),
      'schema.postgres.sql must contain pinned_at'
    );
  });

  // Test Group 2: SQLite Table Instantiation & Defaults
  runTest('2.1. Brand new database creates feed_posts with correct default values for standard posts', () => {
    const memDb = new DatabaseSync(':memory:');
    memDb.exec('PRAGMA foreign_keys = OFF;');
    memDb.exec(DB_SCHEMA_SQL);

    // Insert user and standard post
    memDb.exec(`
      INSERT INTO users (id, email, password_hash, first_name, last_name, role, status, created_at, updated_at)
      VALUES ('u1', 'u1@test.com', 'h', 'Test', 'User', 'STAFF', 'ACTIVE', '2026-01-01', '2026-01-01');
    `);

    memDb.exec(`
      INSERT INTO feed_posts (id, author_id, content, created_at, updated_at)
      VALUES ('p_std_1', 'u1', 'Standard post without explicit announcement fields', '2026-01-01T10:00:00.000Z', '2026-01-01T10:00:00.000Z');
    `);

    const row = memDb.prepare('SELECT id, is_announcement, priority, pinned_at FROM feed_posts WHERE id = ?').get('p_std_1') as any;
    assert.strictEqual(row.id, 'p_std_1');
    assert.strictEqual(row.is_announcement, 0, 'Standard post is_announcement must default to 0');
    assert.strictEqual(row.priority, 'NORMAL', "Standard post priority must default to 'NORMAL'");
    assert.strictEqual(row.pinned_at, null, 'Standard post pinned_at must default to NULL');
    memDb.close();
  });

  runTest('2.2. Setting announcement values persists successfully', () => {
    const memDb = new DatabaseSync(':memory:');
    memDb.exec('PRAGMA foreign_keys = OFF;');
    memDb.exec(DB_SCHEMA_SQL);

    const now = new Date().toISOString();
    memDb.exec(`
      INSERT INTO feed_posts (id, author_id, content, is_announcement, priority, pinned_at, created_at, updated_at)
      VALUES ('p_ann_urgent', 'u1', 'Urgent maintenance shutdown', 1, 'URGENT', '${now}', '${now}', '${now}');
    `);

    const rowUrgent = memDb.prepare('SELECT * FROM feed_posts WHERE id = ?').get('p_ann_urgent') as any;
    assert.strictEqual(rowUrgent.is_announcement, 1);
    assert.strictEqual(rowUrgent.priority, 'URGENT');
    assert.strictEqual(rowUrgent.pinned_at, now);

    memDb.exec(`
      INSERT INTO feed_posts (id, author_id, content, is_announcement, priority, pinned_at, created_at, updated_at)
      VALUES ('p_ann_important', 'u1', 'Important quarterly townhall', 1, 'IMPORTANT', NULL, '${now}', '${now}');
    `);

    const rowImp = memDb.prepare('SELECT * FROM feed_posts WHERE id = ?').get('p_ann_important') as any;
    assert.strictEqual(rowImp.is_announcement, 1);
    assert.strictEqual(rowImp.priority, 'IMPORTANT');
    assert.strictEqual(rowImp.pinned_at, null);
    memDb.close();
  });

  runTest('2.3. SQLite CHECK constraint rejects invalid priorities', () => {
    const memDb = new DatabaseSync(':memory:');
    memDb.exec('PRAGMA foreign_keys = OFF;');
    memDb.exec(DB_SCHEMA_SQL);

    const invalidPriorities = ['CRITICAL', 'LOW', 'urgent', 'HIGH', 'BOGUS', ''];
    for (const badPriority of invalidPriorities) {
      assert.throws(
        () => {
          memDb.exec(`
            INSERT INTO feed_posts (id, author_id, content, priority, created_at, updated_at)
            VALUES ('p_bad_${badPriority}', 'u1', 'Test bad priority', '${badPriority}', '2026-01-01', '2026-01-01');
          `);
        },
        /CHECK constraint failed/i,
        `Priority '${badPriority}' must violate database CHECK constraint`
      );
    }
    memDb.close();
  });

  // Test Group 3: Backward-Compatible SQLite Schema Evolution
  runTest('3.1. Pre-existing database without announcement columns migrates idempotently without data loss', () => {
    const tmpDbPath = `/tmp/test-announcement-migration-${Date.now()}.db`;
    try {
      // Step A: Create old legacy database where feed_posts only had 5 original columns
      const legacyDb = new DatabaseSync(tmpDbPath);
      legacyDb.exec(`
        CREATE TABLE feed_posts (
          id TEXT PRIMARY KEY,
          author_id TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO feed_posts VALUES ('p_legacy_1', 'u_old', 'Existing staff post before migration', '2026-01-01', '2026-01-01');
      `);
      legacyDb.close();

      // Step B: Initialize using getDatabase with this existing file
      process.env.DATABASE_PATH = tmpDbPath;
      closeDatabase();
      const appDb = getDatabase();

      // Verify legacy row is preserved intact
      const legacyRow = appDb.prepare('SELECT * FROM feed_posts WHERE id = ?').get('p_legacy_1') as any;
      assert.ok(legacyRow, 'Legacy post must be preserved');
      assert.strictEqual(legacyRow.content, 'Existing staff post before migration');
      assert.strictEqual(legacyRow.is_announcement, 0, 'Legacy post is_announcement migrated with default 0');
      assert.strictEqual(legacyRow.priority, 'NORMAL', "Legacy post priority migrated with default 'NORMAL'");
      assert.strictEqual(legacyRow.pinned_at, null, 'Legacy post pinned_at migrated with null');

      // Verify CHECK constraint is enforced on newly added column
      assert.throws(
        () => {
          appDb.exec(`
            INSERT INTO feed_posts (id, author_id, content, priority, created_at, updated_at)
            VALUES ('p_fail', 'u1', 'Testing', 'INVALID_PRIORITY', '2026-01-01', '2026-01-01');
          `);
        },
        /CHECK constraint failed/i,
        'CHECK constraint must be active after migration'
      );

      // Verify second initialization is idempotent (no errors)
      closeDatabase();
      const reloadedDb = getDatabase();
      const columns = reloadedDb.prepare('PRAGMA table_info(feed_posts)').all() as { name: string }[];
      const names = columns.map((c) => c.name);
      assert(names.includes('is_announcement'));
      assert(names.includes('priority'));
      assert(names.includes('pinned_at'));

      closeDatabase();
    } finally {
      if (fs.existsSync(tmpDbPath)) {
        fs.unlinkSync(tmpDbPath);
      }
      delete process.env.DATABASE_PATH;
    }
  });

  // Test Group 4: TypeScript Types Integrity
  runTest('4.1. TypeScript types support both standard posts and announcements', () => {
    const standardPost: FeedPost = {
      id: 'p1',
      content: 'Standard post',
      isAnnouncement: false,
      priority: 'NORMAL',
      pinnedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      author: {
        id: 'u1',
        email: 'user@example.com',
        firstName: 'John',
        lastName: 'Doe',
        role: 'STAFF' as any,
      },
      stats: {
        commentsCount: 0,
        reactionsCount: 0,
        reactions: { LIKE: 0, CELEBRATE: 0, SUPPORT: 0, INSIGHTFUL: 0 },
      },
      currentUserReaction: null,
    };

    const announcementPost: FeedPost = {
      id: 'p2',
      content: 'Urgent office alert',
      isAnnouncement: true,
      priority: 'URGENT',
      pinnedAt: '2026-01-01T12:00:00.000Z',
      createdAt: '2026-01-01T12:00:00.000Z',
      updatedAt: '2026-01-01T12:00:00.000Z',
      author: {
        id: 'adm1',
        email: 'admin@example.com',
        firstName: 'Admin',
        lastName: 'Officer',
        role: 'ADMIN' as any,
      },
      stats: {
        commentsCount: 5,
        reactionsCount: 10,
        reactions: { LIKE: 4, CELEBRATE: 2, SUPPORT: 3, INSIGHTFUL: 1 },
      },
      currentUserReaction: 'SUPPORT',
    };

    assert.strictEqual(standardPost.isAnnouncement, false);
    assert.strictEqual(announcementPost.priority, 'URGENT');
  });

  console.log('================================================================');
  console.log(`PHASE 2A ANNOUNCEMENT TESTS: ${passed} passed, ${failed} failed.`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal test execution error:', err);
  process.exit(1);
});
