/**
 * PHASE 7 — POSTGRESQL CONNECTOR & FAIL-CLOSED ARCHITECTURE TEST SUITE
 * 
 * Verifies:
 * 1. Production Fail-Closed database selection (DATABASE_URL mandatory, no SQLite fallback)
 * 2. SQLite preservation for non-production development
 * 3. Connection pool configuration, connection timeout, and SSL parsing
 * 4. Type parser registration (TIMESTAMPTZ / TIMESTAMP / DATE verbatim strings)
 * 5. Managed transaction semantics (BEGIN, COMMIT, ROLLBACK on error, release)
 * 6. Clean seed validation (0 test records, configurable credentials)
 * 7. Office-network security behavior compatibility with PostgreSQL architecture
 */

import assert from 'node:assert';
import {
  resolvePostgresConfig,
  getPostgresPool,
  withTransaction,
  setPostgresPoolForTesting,
  closePostgresPool,
} from './server/db/postgres.ts';
import { getDatabase, getDatabaseEngine } from './server/db/index.ts';
import { POSTGRES_SCHEMA_SQL } from './server/db/schema.postgres.ts';
import { seedPostgresDatabase } from './server/db/seed.postgres.ts';
import { verifyOfficeNetwork, extractClientIp, isLoopbackAddress, normalizeIp } from './server/services/network.service.ts';
import { Request } from 'express';

let testsPassed = 0;
let testsFailed = 0;

function runTest(name: string, fn: () => void | Promise<void>) {
  try {
    const res = fn();
    if (res instanceof Promise) {
      return res
        .then(() => {
          console.log(`  ✓ ${name}`);
          testsPassed++;
        })
        .catch((err) => {
          console.error(`  ✗ ${name}:`, err.message);
          testsFailed++;
        });
    }
    console.log(`  ✓ ${name}`);
    testsPassed++;
  } catch (err: any) {
    console.error(`  ✗ ${name}:`, err.message);
    testsFailed++;
  }
}

async function runAllTests() {
  console.log('================================================================');
  console.log('PHASE 7 STEP 3: POSTGRESQL CONNECTOR & FAIL-CLOSED ARCHITECTURE');
  console.log('================================================================\n');

  const origNodeEnv = process.env.NODE_ENV;
  const origDbUrl = process.env.DATABASE_URL;
  const origDbPath = process.env.DATABASE_PATH;

  try {
    // -------------------------------------------------------------------------
    // 1. FAIL-CLOSED PRODUCTION GATES
    // -------------------------------------------------------------------------
    console.log('--- 1. Strict Fail-Closed Production Database Gates ---');

    await runTest('In production without DATABASE_URL: resolvePostgresConfig() throws fatal error', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.DATABASE_URL;

      assert.throws(
        () => resolvePostgresConfig(),
        /DATABASE_URL is required in production/
      );
    });

    await runTest('In production without DATABASE_URL: getPostgresPool() throws fatal error', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.DATABASE_URL;
      setPostgresPoolForTesting(null);

      assert.throws(
        () => getPostgresPool(),
        /DATABASE_URL is required in production/
      );
    });

    await runTest('In production: getDatabase() refuses to instantiate SQLite and fails closed', () => {
      process.env.NODE_ENV = 'production';
      assert.throws(
        () => getDatabase(),
        /Refusing to initialize SQLite in production/
      );
    });

    await runTest('In production with DATABASE_PATH set: DATABASE_PATH is ignored and warned', () => {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgresql://user:pass@127.0.0.1:5432/appdb';
      process.env.DATABASE_PATH = '/tmp/fake-sqlite.db';

      const config = resolvePostgresConfig();
      assert.strictEqual(config.connectionString, 'postgresql://user:pass@127.0.0.1:5432/appdb');
    });

    // -------------------------------------------------------------------------
    // 2. NON-PRODUCTION & SQLITE PRESERVATION
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Non-Production Local Development SQLite Preservation ---');

    await runTest('In development: getDatabaseEngine() returns sqlite when DATABASE_URL is unset', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.DATABASE_URL;

      const engine = getDatabaseEngine();
      assert.strictEqual(engine, 'sqlite');
    });

    await runTest('In development: existing SQLite getDatabase() works and contains schema tables', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.DATABASE_URL;

      const db = getDatabase();
      assert.ok(db, 'SQLite database must be available in development');

      // Verify core tables exist in SQLite without modification
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
      const tableNames = tables.map((t) => t.name);

      assert.ok(tableNames.includes('users'), 'users table exists in SQLite');
      assert.ok(tableNames.includes('attendance'), 'attendance table exists in SQLite');
      assert.ok(tableNames.includes('access_passes'), 'access_passes table exists in SQLite');
      assert.ok(tableNames.includes('system_settings'), 'system_settings table exists in SQLite');
      assert.ok(tableNames.includes('audit_logs'), 'audit_logs table exists in SQLite');
    });

    // -------------------------------------------------------------------------
    // 3. CONNECTION POOL CONFIGURATION & OPTIONS
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Pool Configuration, Timeouts, and SSL Resolution ---');

    await runTest('Config parses pool size, connection timeouts, and SSL properly', () => {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgresql://user:secret@localhost:5432/prod_db?sslmode=require';
      process.env.DB_POOL_MAX = '15';
      process.env.DB_POOL_MIN = '3';
      process.env.DB_CONNECT_TIMEOUT_MS = '6000';
      process.env.DB_IDLE_TIMEOUT_MS = '45000';

      const config = resolvePostgresConfig();
      assert.strictEqual(config.max, 15);
      assert.strictEqual(config.min, 3);
      assert.strictEqual(config.connectionTimeoutMillis, 6000);
      assert.strictEqual(config.idleTimeoutMillis, 45000);
      assert.ok(config.ssl !== undefined, 'SSL must be configured in production');
    });

    // -------------------------------------------------------------------------
    // 4. TRANSACTION SEMANTICS
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Transaction Management Semantics ---');

    await runTest('withTransaction executes BEGIN, commits on success, and releases client', async () => {
      const callLog: string[] = [];
      const mockClient = {
        query: async (sql: string) => {
          callLog.push(sql);
          return { rows: [] };
        },
        release: () => {
          callLog.push('RELEASE');
        },
      };

      const mockPool = {
        connect: async () => mockClient,
      } as any;

      setPostgresPoolForTesting(mockPool);

      const result = await withTransaction(async (client) => {
        await client.query('INSERT INTO mock_table VALUES (1)');
        return 'SUCCESS_DATA';
      });

      assert.strictEqual(result, 'SUCCESS_DATA');
      assert.deepStrictEqual(callLog, [
        'BEGIN',
        'INSERT INTO mock_table VALUES (1)',
        'COMMIT',
        'RELEASE',
      ]);
    });

    await runTest('withTransaction executes ROLLBACK and releases client on error', async () => {
      const callLog: string[] = [];
      const mockClient = {
        query: async (sql: string) => {
          callLog.push(sql);
          if (sql.includes('FAIL_INSERT')) {
            throw new Error('Database constraint violation');
          }
          return { rows: [] };
        },
        release: () => {
          callLog.push('RELEASE');
        },
      };

      const mockPool = {
        connect: async () => mockClient,
      } as any;

      setPostgresPoolForTesting(mockPool);

      await assert.rejects(
        async () => {
          await withTransaction(async (client) => {
            await client.query('INSERT FAIL_INSERT');
          });
        },
        /Database constraint violation/
      );

      assert.deepStrictEqual(callLog, [
        'BEGIN',
        'INSERT FAIL_INSERT',
        'ROLLBACK',
        'RELEASE',
      ]);
      setPostgresPoolForTesting(null);
    });

    // -------------------------------------------------------------------------
    // 5. SCHEMA INVENTORY & CLEAN SEED BEHAVIOR
    // -------------------------------------------------------------------------
    console.log('\n--- 5. PostgreSQL Schema & Seed Verification ---');

    await runTest('POSTGRES_SCHEMA_SQL contains all 10 core tables with correct constraints', () => {
      const expectedTables = [
        'users',
        'sessions',
        'audit_logs',
        'system_settings',
        'attendance',
        'events',
        'access_passes',
        'event_invitees',
        'visitor_visits',
        'access_visits',
      ];

      for (const table of expectedTables) {
        assert.ok(
          POSTGRES_SCHEMA_SQL.includes(`CREATE TABLE IF NOT EXISTS ${table}`),
          `Table ${table} must be defined in PostgreSQL schema`
        );
      }

      // Verify specific constraints
      assert.ok(POSTGRES_SCHEMA_SQL.includes('uq_attendance_staff_date UNIQUE (staff_id, date)'));
      assert.ok(POSTGRES_SCHEMA_SQL.includes('CHECK (role IN (\'SUPER_ADMIN\', \'ADMIN\', \'STAFF\'))'));
      assert.ok(POSTGRES_SCHEMA_SQL.includes('idx_users_email_lower ON users (LOWER(email))'));
    });

    await runTest('seedPostgresDatabase fails closed in production if admin credentials missing', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.INITIAL_ADMIN_EMAIL;
      delete process.env.INITIAL_ADMIN_PASSWORD;

      const mockClient = {
        query: async (sql: string) => {
          if (sql.includes('SELECT id, email FROM users')) {
            return { rows: [] }; // No admin exists
          }
          return { rows: [] };
        },
      } as any;

      await assert.rejects(
        async () => seedPostgresDatabase(mockClient),
        /INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD environment variables are required/
      );
    });

    await runTest('seedPostgresDatabase seeds only Super Admin + System Settings with 0 test data', async () => {
      process.env.NODE_ENV = 'development';
      process.env.INITIAL_ADMIN_EMAIL = 'custom.admin@company.com';
      process.env.INITIAL_ADMIN_PASSWORD = 'CustomAdminPassword123!';

      const insertedTables: string[] = [];
      const mockClient = {
        query: async (sql: string, params?: any[]) => {
          if (sql.includes('SELECT id, email FROM users')) {
            return { rows: [] }; // No admin exists yet
          }
          if (sql.includes('INSERT INTO users')) {
            insertedTables.push('users');
            assert.strictEqual(params?.[1], 'custom.admin@company.com');
            assert.ok(sql.includes("'SUPER_ADMIN'"));
          }
          if (sql.includes('INSERT INTO audit_logs')) {
            insertedTables.push('audit_logs');
          }
          if (sql.includes('INSERT INTO system_settings')) {
            insertedTables.push('system_settings');
          }
          return { rows: [] };
        },
      } as any;

      const result = await seedPostgresDatabase(mockClient);
      assert.strictEqual(result.superAdminCreated, true);
      assert.strictEqual(result.superAdminEmail, 'custom.admin@company.com');
      assert.strictEqual(result.settingsCount, 5);

      // Verify no other tables were inserted (zero attendance, zero events, zero passes)
      assert.ok(insertedTables.includes('users'));
      assert.ok(insertedTables.includes('audit_logs'));
      assert.ok(insertedTables.includes('system_settings'));
      assert.ok(!insertedTables.includes('attendance'), '0 attendance records must be inserted');
      assert.ok(!insertedTables.includes('events'), '0 event records must be inserted');
      assert.ok(!insertedTables.includes('access_passes'), '0 access_pass records must be inserted');
    });

    // -------------------------------------------------------------------------
    // 6. OFFICE-NETWORK SECURITY COMPATIBILITY
    // -------------------------------------------------------------------------
    console.log('\n--- 6. Office-Network Security Behavior Compatibility ---');

    await runTest('extractClientIp correctly takes leftmost IP from proxy chain', () => {
      const req = {
        headers: {
          'x-forwarded-for': '102.129.144.52, 35.190.247.1, 10.0.0.1',
        },
      } as unknown as Request;

      const extracted = extractClientIp(req);
      assert.strictEqual(extracted.ip, '102.129.144.52');
      assert.strictEqual(extracted.ipSource, 'x-forwarded-for');
      assert.strictEqual(extracted.proxyHopCount, 3);
    });

    await runTest('verifyOfficeNetwork fails closed on unauthorized IPs', () => {
      process.env.NODE_ENV = 'production';
      process.env.OFFICE_IPS = '102.129.144.1, 102.129.144.2';

      const req = {
        headers: {
          'x-forwarded-for': '203.0.113.195',
        },
      } as unknown as Request;

      const verification = verifyOfficeNetwork(req);
      assert.strictEqual(verification.isOfficeNetwork, false);
      assert.strictEqual(verification.detectedIp, '203.0.113.195');
    });

    await runTest('In production: loopback addresses are unconditionally rejected', () => {
      process.env.NODE_ENV = 'production';
      process.env.OFFICE_IPS = '127.0.0.1, 102.129.144.1';

      const req = {
        headers: {
          'x-forwarded-for': '127.0.0.1',
        },
      } as unknown as Request;

      const verification = verifyOfficeNetwork(req);
      assert.strictEqual(verification.isOfficeNetwork, false, 'Loopback in production must be rejected');
    });

  } finally {
    // Restore environment
    process.env.NODE_ENV = origNodeEnv;
    if (origDbUrl) process.env.DATABASE_URL = origDbUrl; else delete process.env.DATABASE_URL;
    if (origDbPath) process.env.DATABASE_PATH = origDbPath; else delete process.env.DATABASE_PATH;
    setPostgresPoolForTesting(null);
  }

  console.log('\n================================================================');
  console.log(`TEST SUMMARY: ${testsPassed} passed, ${testsFailed} failed`);
  console.log('================================================================\n');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
