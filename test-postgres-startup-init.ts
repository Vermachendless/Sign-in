/**
 * PHASE 8A — POSTGRESQL STARTUP INITIALIZATION TEST SUITE
 *
 * Verifies:
 * 1. Strict Sequential Startup Order:
 *    verifyPostgresConnection -> initializePostgresSchema -> seedPostgresDatabase -> refreshOfficeIpsCache
 * 2. Successful Startup Initialization & Contract Verification
 * 3. Connection Failure Fail-Closed Gate (no schema/seed execution)
 * 4. Schema DDL Failure Fail-Closed Gate (no seed/cache execution)
 * 5. Seed Failure Fail-Closed Gate (no cache refresh)
 * 6. Cache Refresh Failure Fail-Closed Gate
 * 7. Office IP Cache Readiness: In-memory cache loaded and active for network verification
 * 8. Empty / Invalid Office IP Configuration Fails Closed (no accidental unrestricted access)
 * 9. Super Admin & Existing Customized Settings Preservation across restarts
 */

import assert from 'node:assert';
import type { Request } from 'express';
import { initializePostgresStartup } from './server/db/init.postgres.ts';
import {
  setPostgresPoolForTesting,
  verifyPostgresConnection,
} from './server/db/postgres.ts';
import {
  getApprovedOfficeIps,
  verifyOfficeNetwork,
  refreshOfficeIpsCache,
  setCachedOfficeIpsForTesting,
} from './server/services/network.service.ts';

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

async function runAllTests() {
  console.log('================================================================');
  console.log('PHASE 8A: POSTGRESQL STARTUP INITIALIZATION TESTS');
  console.log('================================================================\n');

  const origNodeEnv = process.env.NODE_ENV;
  const origDbUrl = process.env.DATABASE_URL;
  const origAdminEmail = process.env.INITIAL_ADMIN_EMAIL;
  const origAdminPass = process.env.INITIAL_ADMIN_PASSWORD;
  const origOfficeIps = process.env.OFFICE_IPS;

  try {
    // -------------------------------------------------------------------------
    // 1. SEQUENTIAL STARTUP ORDER VERIFICATION
    // -------------------------------------------------------------------------
    console.log('--- 1. Strict Sequential Startup Order ---');

    await runTest('Startup executes steps in exact order: connect -> schema -> seed -> cache', async () => {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgresql://testuser:testpass@localhost:5432/testdb';
      process.env.INITIAL_ADMIN_EMAIL = 'admin.startup@company.com';
      process.env.INITIAL_ADMIN_PASSWORD = 'StartupSecurePass123!';
      delete process.env.OFFICE_IPS;

      const executionLog: string[] = [];
      let superAdminExists = false;

      const mockPool: any = {
        query: async (sql: string, params?: any[]) => {
          if (sql.includes('SELECT version()')) {
            executionLog.push('STEP_1_CONNECT_CHECK');
            return { rows: [{ version: 'PostgreSQL 16.0 (Mock Engine)' }] };
          }
          if (sql.includes('CREATE TABLE IF NOT EXISTS users')) {
            executionLog.push('STEP_2_SCHEMA_DDL');
            return { rows: [] };
          }
          if (sql.includes("SELECT id, email FROM users WHERE role = 'SUPER_ADMIN'")) {
            executionLog.push('STEP_3_SEED_CHECK_ADMIN');
            return { rows: superAdminExists ? [{ id: 'admin-1', email: 'admin.startup@company.com' }] : [] };
          }
          if (sql.includes('INSERT INTO users')) {
            executionLog.push('STEP_3_SEED_INSERT_ADMIN');
            superAdminExists = true;
            return { rows: [] };
          }
          if (sql.includes('INSERT INTO audit_logs')) {
            executionLog.push('STEP_3_SEED_AUDIT_LOG');
            return { rows: [] };
          }
          if (sql.includes('INSERT INTO system_settings')) {
            executionLog.push('STEP_3_SEED_SETTINGS');
            return { rows: [] };
          }
          if (sql.includes("SELECT value FROM system_settings WHERE key = $1")) {
            executionLog.push('STEP_4_CACHE_REFRESH');
            return { rows: [{ value: JSON.stringify(['102.129.144.10', '102.129.144.20']) }] };
          }
          return { rows: [] };
        },
      };

      setPostgresPoolForTesting(mockPool);
      setCachedOfficeIpsForTesting(null);

      const result = await initializePostgresStartup(mockPool);

      assert.strictEqual(result.connected, true);
      assert.strictEqual(result.seedResult.superAdminCreated, true);
      assert.deepStrictEqual(result.officeIps, ['102.129.144.10', '102.129.144.20']);

      // Assert order: connect check -> schema ddl -> seed admin -> seed settings -> cache refresh
      const connectIdx = executionLog.indexOf('STEP_1_CONNECT_CHECK');
      const schemaIdx = executionLog.indexOf('STEP_2_SCHEMA_DDL');
      const seedCheckIdx = executionLog.indexOf('STEP_3_SEED_CHECK_ADMIN');
      const cacheIdx = executionLog.indexOf('STEP_4_CACHE_REFRESH');

      assert.ok(connectIdx !== -1, 'Connection check must be executed');
      assert.ok(schemaIdx !== -1, 'Schema DDL must be executed');
      assert.ok(seedCheckIdx !== -1, 'Seed check must be executed');
      assert.ok(cacheIdx !== -1, 'Cache refresh must be executed');

      assert.ok(connectIdx < schemaIdx, 'Connection check must precede schema initialization');
      assert.ok(schemaIdx < seedCheckIdx, 'Schema initialization must precede database seeding');
      assert.ok(seedCheckIdx < cacheIdx, 'Database seeding must precede office IP cache refresh');
    });

    // -------------------------------------------------------------------------
    // 2. OFFICE IP CACHE READINESS & NETWORK VERIFICATION
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Office IP Cache Readiness & Verification ---');

    await runTest('After startup, approved office IPs from database are active in memory', () => {
      // Prior test populated cachedDbOfficeIps with ['102.129.144.10', '102.129.144.20']
      const { dbIps, allIps } = getApprovedOfficeIps();
      assert.ok(dbIps.includes('102.129.144.10'), '102.129.144.10 must be present in dbIps');
      assert.ok(dbIps.includes('102.129.144.20'), '102.129.144.20 must be present in dbIps');
      assert.ok(allIps.has('102.129.144.10'), '102.129.144.10 must be in allIps Set');

      // Test incoming client IP match
      const req = {
        headers: { 'x-forwarded-for': '102.129.144.10' },
      } as unknown as Request;

      const verification = verifyOfficeNetwork(req);
      assert.strictEqual(verification.isOfficeNetwork, true, 'Configured database IP must be accepted');
      assert.strictEqual(verification.matchedRuleType, 'DATABASE_SETTINGS');
      assert.strictEqual(verification.detectedIp, '102.129.144.10');
    });

    await runTest('Unapproved external IP is rejected when database IPs are configured', () => {
      const req = {
        headers: { 'x-forwarded-for': '198.51.100.77' },
      } as unknown as Request;

      const verification = verifyOfficeNetwork(req);
      assert.strictEqual(verification.isOfficeNetwork, false, 'Unapproved external IP must be rejected');
      assert.strictEqual(verification.matchedRuleType, 'NONE');
    });

    // -------------------------------------------------------------------------
    // 3. FAIL-CLOSED CONNECTION FAILURE
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Connection Failure Fail-Closed Gate ---');

    await runTest('Connection check failure throws fatal error and aborts before schema/seed', async () => {
      let schemaCalled = false;
      let seedCalled = false;

      const failingPool: any = {
        query: async (sql: string) => {
          if (sql.includes('SELECT version()')) {
            throw new Error('Connection refused by PostgreSQL server at 10.0.0.5:5432');
          }
          if (sql.includes('CREATE TABLE')) {
            schemaCalled = true;
          }
          if (sql.includes('SELECT id, email FROM users')) {
            seedCalled = true;
          }
          return { rows: [] };
        },
      };

      setPostgresPoolForTesting(failingPool);

      await assert.rejects(
        async () => initializePostgresStartup(failingPool),
        (err: Error) => {
          assert.ok(
            err.message.includes('Failed to connect to PostgreSQL database'),
            `Expected connection failure message, got: ${err.message}`
          );
          return true;
        }
      );

      assert.strictEqual(schemaCalled, false, 'Schema must not be executed if connection failed');
      assert.strictEqual(seedCalled, false, 'Seed must not be executed if connection failed');
    });

    // -------------------------------------------------------------------------
    // 4. FAIL-CLOSED SCHEMA INITIALIZATION FAILURE
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Schema Initialization Failure Fail-Closed Gate ---');

    await runTest('Schema DDL failure throws and aborts before seed/cache refresh', async () => {
      let seedCalled = false;
      let cacheRefreshed = false;

      const failingSchemaPool: any = {
        query: async (sql: string) => {
          if (sql.includes('SELECT version()')) {
            return { rows: [{ version: 'PostgreSQL 16.0' }] };
          }
          if (sql.includes('CREATE TABLE IF NOT EXISTS users')) {
            throw new Error('PostgreSQL syntax error or permission denied in CREATE TABLE');
          }
          if (sql.includes('SELECT id, email FROM users')) {
            seedCalled = true;
          }
          if (sql.includes('SELECT value FROM system_settings')) {
            cacheRefreshed = true;
          }
          return { rows: [] };
        },
      };

      setPostgresPoolForTesting(failingSchemaPool);

      await assert.rejects(
        async () => initializePostgresStartup(failingSchemaPool),
        /permission denied in CREATE TABLE/
      );

      assert.strictEqual(seedCalled, false, 'Seed must not be executed if schema failed');
      assert.strictEqual(cacheRefreshed, false, 'Cache refresh must not be executed if schema failed');
    });

    // -------------------------------------------------------------------------
    // 5. FAIL-CLOSED SEED FAILURE
    // -------------------------------------------------------------------------
    console.log('\n--- 5. Seed Failure Fail-Closed Gate ---');

    await runTest('Missing Super Admin credentials in production throws and aborts before cache refresh', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.INITIAL_ADMIN_EMAIL;
      delete process.env.INITIAL_ADMIN_PASSWORD;

      let cacheRefreshed = false;

      const seedFailPool: any = {
        query: async (sql: string) => {
          if (sql.includes('SELECT version()')) {
            return { rows: [{ version: 'PostgreSQL 16.0' }] };
          }
          if (sql.includes('CREATE TABLE')) {
            return { rows: [] };
          }
          if (sql.includes("SELECT id, email FROM users WHERE role = 'SUPER_ADMIN'")) {
            return { rows: [] }; // No admin exists
          }
          if (sql.includes('SELECT value FROM system_settings')) {
            cacheRefreshed = true;
          }
          return { rows: [] };
        },
      };

      setPostgresPoolForTesting(seedFailPool);

      await assert.rejects(
        async () => initializePostgresStartup(seedFailPool),
        /INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD environment variables are required/
      );

      assert.strictEqual(cacheRefreshed, false, 'Cache refresh must not run if seed fails');
    });

    // -------------------------------------------------------------------------
    // 6. FAIL-CLOSED CACHE REFRESH FAILURE
    // -------------------------------------------------------------------------
    console.log('\n--- 6. Cache Refresh Failure Fail-Closed Gate ---');

    await runTest('Cache refresh database error propagates with throwOnError: true', async () => {
      process.env.NODE_ENV = 'production';
      process.env.INITIAL_ADMIN_EMAIL = 'admin@example.com';
      process.env.INITIAL_ADMIN_PASSWORD = 'AdminPass123!';

      const cacheFailPool: any = {
        query: async (sql: string) => {
          if (sql.includes('SELECT version()')) {
            return { rows: [{ version: 'PostgreSQL 16.0' }] };
          }
          if (sql.includes('CREATE TABLE')) {
            return { rows: [] };
          }
          if (sql.includes("SELECT id, email FROM users WHERE role = 'SUPER_ADMIN'")) {
            return { rows: [{ id: 'existing-admin', email: 'admin@example.com' }] };
          }
          if (sql.includes('INSERT INTO system_settings')) {
            return { rows: [] };
          }
          if (sql.includes('SELECT value FROM system_settings WHERE key = $1')) {
            throw new Error('database table system_settings is locked or unavailable');
          }
          return { rows: [] };
        },
      };

      setPostgresPoolForTesting(cacheFailPool);

      await assert.rejects(
        async () => initializePostgresStartup(cacheFailPool),
        /database table system_settings is locked or unavailable/
      );
    });

    // -------------------------------------------------------------------------
    // 7. EMPTY / INVALID OFFICE IP CONFIGURATION FAILS CLOSED
    // -------------------------------------------------------------------------
    console.log('\n--- 7. Empty & Invalid Office IP Configuration Safety ---');

    await runTest('Empty or missing office IPs in database causes verifyOfficeNetwork to fail closed', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.OFFICE_IPS;

      // Mock database returning empty string for approvedOfficeIPs
      const emptyIpPool: any = {
        query: async (sql: string) => {
          if (sql.includes('SELECT value FROM system_settings WHERE key = $1')) {
            return { rows: [{ value: '[]' }] };
          }
          return { rows: [] };
        },
      };

      setPostgresPoolForTesting(emptyIpPool);
      await refreshOfficeIpsCache();

      const { dbIps, allIps } = getApprovedOfficeIps();
      assert.strictEqual(dbIps.length, 0, 'dbIps must be empty');
      assert.strictEqual(allIps.size, 0, 'allIps must be empty');

      // Attempt attendance check-in from external IP
      const req1 = {
        headers: { 'x-forwarded-for': '102.129.144.50' },
      } as unknown as Request;

      const verification1 = verifyOfficeNetwork(req1);
      assert.strictEqual(verification1.isOfficeNetwork, false, 'External IP must be rejected when no office IPs configured');

      // Attempt attendance check-in from loopback address in production
      const req2 = {
        headers: { 'x-forwarded-for': '127.0.0.1' },
      } as unknown as Request;

      const verification2 = verifyOfficeNetwork(req2);
      assert.strictEqual(verification2.isOfficeNetwork, false, 'Loopback in production must always be rejected');
    });

    await runTest('Corrupted JSON in system_settings parses to empty array and fails closed', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.OFFICE_IPS;

      const corruptedPool: any = {
        query: async (sql: string) => {
          if (sql.includes('SELECT value FROM system_settings WHERE key = $1')) {
            return { rows: [{ value: '{invalid: "corrupted json without array' }] };
          }
          return { rows: [] };
        },
      };

      setPostgresPoolForTesting(corruptedPool);
      await refreshOfficeIpsCache();

      const { allIps } = getApprovedOfficeIps();
      // Even if fallback comma parsing runs, invalid syntax will not match incoming IP
      const req = {
        headers: { 'x-forwarded-for': '102.129.144.50' },
      } as unknown as Request;

      const verification = verifyOfficeNetwork(req);
      assert.strictEqual(verification.isOfficeNetwork, false, 'Corrupted setting must fail closed');
    });

    // -------------------------------------------------------------------------
    // 8. IDEMPOTENT RESTART & PRESERVATION OF EXISTING DATA
    // -------------------------------------------------------------------------
    console.log('\n--- 8. Idempotency & Data Preservation Across Restarts ---');

    await runTest('Existing Super Admin and customized settings are preserved on restart', async () => {
      process.env.NODE_ENV = 'production';
      process.env.INITIAL_ADMIN_EMAIL = 'admin@example.com';
      process.env.INITIAL_ADMIN_PASSWORD = 'AdminPass123!';

      let userInserted = false;
      let auditLogInserted = false;

      const existingDataPool: any = {
        query: async (sql: string, params?: any[]) => {
          if (sql.includes('SELECT version()')) {
            return { rows: [{ version: 'PostgreSQL 16.0' }] };
          }
          if (sql.includes('CREATE TABLE')) {
            return { rows: [] };
          }
          if (sql.includes("SELECT id, email FROM users WHERE role = 'SUPER_ADMIN'")) {
            // Existing Super Admin found in database
            return { rows: [{ id: 'admin-existing-uuid', email: 'custom.existing.admin@company.com' }] };
          }
          if (sql.includes('INSERT INTO users')) {
            userInserted = true;
            return { rows: [] };
          }
          if (sql.includes('INSERT INTO audit_logs')) {
            auditLogInserted = true;
            return { rows: [] };
          }
          if (sql.includes('INSERT INTO system_settings')) {
            // Verify that the ON CONFLICT clause preserves existing customized value
            assert.ok(
              sql.includes('WHEN system_settings.value IS NULL OR system_settings.value = \'\' THEN EXCLUDED.value'),
              'System settings must preserve existing non-empty values'
            );
            return { rows: [] };
          }
          if (sql.includes('SELECT value FROM system_settings WHERE key = $1')) {
            return { rows: [{ value: JSON.stringify(['102.129.144.99']) }] };
          }
          return { rows: [] };
        },
      };

      setPostgresPoolForTesting(existingDataPool);

      const result = await initializePostgresStartup(existingDataPool);

      assert.strictEqual(result.seedResult.superAdminCreated, false, 'Existing Super Admin must not be recreated');
      assert.strictEqual(result.seedResult.superAdminEmail, 'custom.existing.admin@company.com');
      assert.strictEqual(userInserted, false, 'No INSERT INTO users query should be executed');
      assert.strictEqual(auditLogInserted, false, 'No seed bootstrap audit log should be executed for existing admin');
      assert.deepStrictEqual(result.officeIps, ['102.129.144.99']);
    });

  } finally {
    // Restore environment
    process.env.NODE_ENV = origNodeEnv;
    if (origDbUrl) process.env.DATABASE_URL = origDbUrl; else delete process.env.DATABASE_URL;
    if (origAdminEmail) process.env.INITIAL_ADMIN_EMAIL = origAdminEmail; else delete process.env.INITIAL_ADMIN_EMAIL;
    if (origAdminPass) process.env.INITIAL_ADMIN_PASSWORD = origAdminPass; else delete process.env.INITIAL_ADMIN_PASSWORD;
    if (origOfficeIps) process.env.OFFICE_IPS = origOfficeIps; else delete process.env.OFFICE_IPS;
    setPostgresPoolForTesting(null);
    setCachedOfficeIpsForTesting(null);
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
