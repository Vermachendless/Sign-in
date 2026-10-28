/**
 * PHASE 2A.1: ANNOUNCEMENT SCHEMA MIGRATION HARDENING TEST SUITE
 *
 * Verifies:
 * 1. Migration from legacy schema lacking all three columns adds all 3 announcement columns.
 * 2. Preservation of existing post records and their content when migrated.
 * 3. Correct default values for existing records (is_announcement = 0, priority = 'NORMAL', pinned_at = NULL).
 * 4. Idempotent re-run on an already-migrated database (fast no-op, no schema errors or duplicates).
 * 5. Rollback on mid-migration failure: partial column additions are rolled back cleanly.
 * 6. Explicit failure propagation on migration error halting database initialization (no swallowing errors).
 */

import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { getDatabase, closeDatabase } from './server/db/index.ts';

console.log('================================================================');
console.log('--- STARTING PHASE 2A.1: MIGRATION HARDENING TEST SUITE ---');
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
  // Test 1, 2, 3: Legacy migration, record preservation, and default values
  runTest('1. Legacy schema lacking all 3 columns receives is_announcement, priority, and pinned_at', () => {
    const tmpDbPath = `/tmp/test-phase2a1-legacy-${Date.now()}.db`;
    try {
      const legacyDb = new DatabaseSync(tmpDbPath);
      legacyDb.exec(`
        CREATE TABLE feed_posts (
          id TEXT PRIMARY KEY,
          author_id TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO feed_posts VALUES ('post_1', 'user_a', 'First historical post', '2026-01-01T10:00:00.000Z', '2026-01-01T10:00:00.000Z');
        INSERT INTO feed_posts VALUES ('post_2', 'user_b', 'Second historical post with symbols & accents: ñ, é, 💡', '2026-01-02T11:00:00.000Z', '2026-01-02T11:00:00.000Z');
      `);
      legacyDb.close();

      process.env.DATABASE_PATH = tmpDbPath;
      closeDatabase();
      const appDb = getDatabase();

      const columns = appDb.prepare('PRAGMA table_info(feed_posts)').all() as { name: string; type: string; dflt_value: any }[];
      const colNames = columns.map((c) => c.name);

      assert(colNames.includes('is_announcement'), 'feed_posts must have is_announcement column');
      assert(colNames.includes('priority'), 'feed_posts must have priority column');
      assert(colNames.includes('pinned_at'), 'feed_posts must have pinned_at column');

      closeDatabase();
    } finally {
      if (fs.existsSync(tmpDbPath)) {
        fs.unlinkSync(tmpDbPath);
      }
      delete process.env.DATABASE_PATH;
    }
  });

  runTest('2. Preservation of existing post records and their content', () => {
    const tmpDbPath = `/tmp/test-phase2a1-records-${Date.now()}.db`;
    try {
      const legacyDb = new DatabaseSync(tmpDbPath);
      legacyDb.exec(`
        CREATE TABLE feed_posts (
          id TEXT PRIMARY KEY,
          author_id TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO feed_posts VALUES ('p_alpha', 'u_1', 'Original Content Alpha', '2026-01-01T08:00:00Z', '2026-01-01T08:00:00Z');
        INSERT INTO feed_posts VALUES ('p_beta', 'u_2', 'Original Content Beta', '2026-01-01T09:00:00Z', '2026-01-01T09:00:00Z');
      `);
      legacyDb.close();

      process.env.DATABASE_PATH = tmpDbPath;
      closeDatabase();
      const appDb = getDatabase();

      const rowAlpha = appDb.prepare('SELECT * FROM feed_posts WHERE id = ?').get('p_alpha') as any;
      const rowBeta = appDb.prepare('SELECT * FROM feed_posts WHERE id = ?').get('p_beta') as any;

      assert.ok(rowAlpha, 'Post Alpha must exist');
      assert.strictEqual(rowAlpha.author_id, 'u_1');
      assert.strictEqual(rowAlpha.content, 'Original Content Alpha');
      assert.strictEqual(rowAlpha.created_at, '2026-01-01T08:00:00Z');

      assert.ok(rowBeta, 'Post Beta must exist');
      assert.strictEqual(rowBeta.author_id, 'u_2');
      assert.strictEqual(rowBeta.content, 'Original Content Beta');
      assert.strictEqual(rowBeta.created_at, '2026-01-01T09:00:00Z');

      closeDatabase();
    } finally {
      if (fs.existsSync(tmpDbPath)) {
        fs.unlinkSync(tmpDbPath);
      }
      delete process.env.DATABASE_PATH;
    }
  });

  runTest('3. Correct default values for existing records (is_announcement = 0, priority = "NORMAL", pinned_at = NULL)', () => {
    const tmpDbPath = `/tmp/test-phase2a1-defaults-${Date.now()}.db`;
    try {
      const legacyDb = new DatabaseSync(tmpDbPath);
      legacyDb.exec(`
        CREATE TABLE feed_posts (
          id TEXT PRIMARY KEY,
          author_id TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO feed_posts VALUES ('p_default_check', 'u_1', 'Post to check defaults', '2026-01-01', '2026-01-01');
      `);
      legacyDb.close();

      process.env.DATABASE_PATH = tmpDbPath;
      closeDatabase();
      const appDb = getDatabase();

      const row = appDb.prepare('SELECT * FROM feed_posts WHERE id = ?').get('p_default_check') as any;
      assert.strictEqual(row.is_announcement, 0, 'Legacy record is_announcement must default to 0');
      assert.strictEqual(row.priority, 'NORMAL', 'Legacy record priority must default to NORMAL');
      assert.strictEqual(row.pinned_at, null, 'Legacy record pinned_at must default to NULL');

      closeDatabase();
    } finally {
      if (fs.existsSync(tmpDbPath)) {
        fs.unlinkSync(tmpDbPath);
      }
      delete process.env.DATABASE_PATH;
    }
  });

  runTest('4. Idempotency: re-running database initialization on migrated database is a safe no-op', () => {
    const tmpDbPath = `/tmp/test-phase2a1-idempotent-${Date.now()}.db`;
    try {
      const legacyDb = new DatabaseSync(tmpDbPath);
      legacyDb.exec(`
        CREATE TABLE feed_posts (
          id TEXT PRIMARY KEY,
          author_id TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO feed_posts VALUES ('p_idem', 'u_1', 'Idempotency test post', '2026-01-01', '2026-01-01');
      `);
      legacyDb.close();

      process.env.DATABASE_PATH = tmpDbPath;
      closeDatabase();

      // First run: executes migration
      const firstInit = getDatabase();
      assert.ok(firstInit, 'First initialization succeeds');
      closeDatabase();

      // Second run: tables already contain columns, must succeed idempotently without error
      const secondInit = getDatabase();
      const colsSecond = secondInit.prepare('PRAGMA table_info(feed_posts)').all() as { name: string }[];
      const names = colsSecond.map((c) => c.name);
      assert(names.includes('is_announcement'));
      assert(names.includes('priority'));
      assert(names.includes('pinned_at'));

      const postCount = secondInit.prepare('SELECT COUNT(*) as cnt FROM feed_posts').get() as { cnt: number };
      assert.strictEqual(postCount.cnt, 1, 'Record count remains exactly 1');
      closeDatabase();

      // Third run: immediate reload without closing should return cached healthy instance
      const thirdInit = getDatabase();
      assert.strictEqual(thirdInit, getDatabase(), 'Returns cached healthy instance');
      closeDatabase();
    } finally {
      if (fs.existsSync(tmpDbPath)) {
        fs.unlinkSync(tmpDbPath);
      }
      delete process.env.DATABASE_PATH;
    }
  });

  runTest('5. Rollback on mid-migration failure: partial column additions are rolled back cleanly', () => {
    const tmpDbPath = `/tmp/test-phase2a1-rollback-${Date.now()}.db`;
    try {
      // Step A: Create legacy feed_posts without announcement columns
      const legacyDb = new DatabaseSync(tmpDbPath);
      legacyDb.exec(`
        CREATE TABLE feed_posts (
          id TEXT PRIMARY KEY,
          author_id TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO feed_posts VALUES ('p_rollback', 'u_1', 'Post before failed migration', '2026-01-01', '2026-01-01');
      `);
      legacyDb.close();

      // Step B: Simulate mid-migration failure during the second column addition (priority)
      const origExec = DatabaseSync.prototype.exec;
      let intercepted = false;
      DatabaseSync.prototype.exec = function (sql: any) {
        if (typeof sql === 'string' && sql.includes('ADD COLUMN priority')) {
          intercepted = true;
          throw new Error('Simulated disk failure during priority column migration');
        }
        return origExec.apply(this, arguments as any);
      };

      process.env.DATABASE_PATH = tmpDbPath;
      closeDatabase();

      let caughtError: Error | null = null;
      try {
        getDatabase();
      } catch (err: any) {
        caughtError = err;
      } finally {
        DatabaseSync.prototype.exec = origExec;
      }

      assert.strictEqual(intercepted, true, 'Interception must have triggered');
      assert.ok(caughtError, 'getDatabase() must throw on migration failure');
      assert(
        caughtError.message.includes('[FATAL] Failed to migrate feed_posts announcement columns'),
        `Error must be explicit fatal: ${caughtError.message}`
      );

      // Step C: Open the database directly to inspect schema after failure
      // Notice: is_announcement was executed prior to the simulated failure.
      // Thanks to the transaction and rollback, is_announcement must NOT be present on disk!
      const verifyDb = new DatabaseSync(tmpDbPath);
      const cols = verifyDb.prepare('PRAGMA table_info(feed_posts)').all() as { name: string }[];
      const colNames = cols.map((c) => c.name);

      assert(
        !colNames.includes('is_announcement'),
        'is_announcement must be rolled back and NOT remain on disk after mid-migration failure'
      );
      assert(!colNames.includes('priority'), 'priority must not be present');
      assert(!colNames.includes('pinned_at'), 'pinned_at must not be present');

      // Pre-existing post must remain completely intact
      const preservedRow = verifyDb.prepare('SELECT * FROM feed_posts WHERE id = ?').get('p_rollback') as any;
      assert.ok(preservedRow, 'Legacy post row must be intact');
      assert.strictEqual(preservedRow.content, 'Post before failed migration');
      verifyDb.close();

      // Step D: After transient failure is resolved, getDatabase() completes migration cleanly
      closeDatabase();
      const recoveredDb = getDatabase();
      const recoveredCols = recoveredDb.prepare('PRAGMA table_info(feed_posts)').all() as { name: string }[];
      const recNames = recoveredCols.map((c) => c.name);
      assert(recNames.includes('is_announcement'), 'Recovered DB has is_announcement');
      assert(recNames.includes('priority'), 'Recovered DB has priority');
      assert(recNames.includes('pinned_at'), 'Recovered DB has pinned_at');
      closeDatabase();
    } finally {
      if (fs.existsSync(tmpDbPath)) {
        fs.unlinkSync(tmpDbPath);
      }
      delete process.env.DATABASE_PATH;
    }
  });

  runTest('6. Explicit failure propagation on migration error halting database initialization', () => {
    const tmpDbPath = `/tmp/test-phase2a1-halt-${Date.now()}.db`;
    try {
      const legacyDb = new DatabaseSync(tmpDbPath);
      legacyDb.exec(`
        CREATE TABLE feed_posts (
          id TEXT PRIMARY KEY,
          author_id TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      legacyDb.close();

      const origExec = DatabaseSync.prototype.exec;
      DatabaseSync.prototype.exec = function (sql: any) {
        if (typeof sql === 'string' && sql.includes('ADD COLUMN is_announcement')) {
          throw new Error('Immediate table lock timeout');
        }
        return origExec.apply(this, arguments as any);
      };

      process.env.DATABASE_PATH = tmpDbPath;
      closeDatabase();

      assert.throws(
        () => {
          getDatabase();
        },
        (err: any) => {
          return (
            err instanceof Error &&
            err.message.includes('[FATAL] Failed to migrate feed_posts announcement columns') &&
            err.message.includes('Immediate table lock timeout')
          );
        },
        'getDatabase() must throw a fatal Error propagating original root cause and halt initialization'
      );

      DatabaseSync.prototype.exec = origExec;
      closeDatabase();
    } finally {
      if (fs.existsSync(tmpDbPath)) {
        fs.unlinkSync(tmpDbPath);
      }
      delete process.env.DATABASE_PATH;
    }
  });
}

main().then(() => {
  console.log('================================================================');
  console.log(`PHASE 2A.1 MIGRATION HARDENING TESTS: ${passed} passed, ${failed} failed.`);
  console.log('================================================================');
  if (failed > 0) {
    process.exit(1);
  }
});
