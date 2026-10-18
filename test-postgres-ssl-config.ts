/**
 * PHASE 8B STAGE 3 — POSTGRESQL CONNECTION-SPECIFIC SSL CONFIGURATION TEST SUITE
 *
 * Verifies:
 * 1. Unix-domain socket connections do NOT enable client-side TLS (Cloud SQL Auth Proxy compatibility).
 * 2. Percent-encoded and query-param Unix socket URI variants are reliably detected as sockets.
 * 3. Direct TCP connections in production enforce SSL with rejectUnauthorized: true by default.
 * 4. Production does NOT silently default to accepting unverified server certificates.
 * 5. Explicit DB_SSL_REJECT_UNAUTHORIZED='false' opt-out behaves according to documented semantics.
 * 6. Contradictory configurations (Unix socket + sslmode=require) fail safely with descriptive errors.
 * 7. Insecure configurations (TCP + sslmode=disable in production) fail safely.
 * 8. Non-production TCP behavior remains unchanged (unencrypted local dev without SSL).
 * 9. Pool settings (max, min, timeouts) are fully preserved.
 * 10. SQLite non-production configuration and database instantiation remain intact.
 */

import assert from 'node:assert';
import pg from 'pg';
import { parse as parseConnectionString } from 'pg-connection-string';
import { resolvePostgresConfig } from './server/db/postgres.ts';
import { getDatabaseEngine, getDatabase } from './server/db/index.ts';

const { Pool: PgPool } = pg;

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
  console.log('PHASE 8B STAGE 3: POSTGRESQL CONNECTION-SPECIFIC SSL TESTS');
  console.log('================================================================\n');

  const origNodeEnv = process.env.NODE_ENV;
  const origDbUrl = process.env.DATABASE_URL;
  const origDbSslReject = process.env.DB_SSL_REJECT_UNAUTHORIZED;
  const origPoolMax = process.env.DB_POOL_MAX;
  const origPoolMin = process.env.DB_POOL_MIN;

  try {
    // -------------------------------------------------------------------------
    // 1. UNIX-DOMAIN SOCKET CONNECTIONS (NO CLIENT-SIDE TLS)
    // -------------------------------------------------------------------------
    console.log('--- 1. Unix-Domain Socket Connections (Cloud SQL Auth Proxy) ---');

    await runTest('In production: Unix socket URI with ?host=/cloudsql/... leaves ssl undefined', () => {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgresql://dbuser:secretpass@/attendancedb?host=/cloudsql/my-project:europe-west2:my-instance';
      delete process.env.DB_SSL_REJECT_UNAUTHORIZED;

      const config = resolvePostgresConfig();
      assert.strictEqual(config.ssl, undefined, 'Client-side TLS must NOT be configured for Unix socket');
      assert.strictEqual(config.connectionString, process.env.DATABASE_URL);
    });

    await runTest('In production: Unix socket URI with percent-encoded path leaves ssl undefined', () => {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgresql://dbuser:secretpass@%2Fcloudsql%2Fmy-project%3Aeurope-west2%3Amy-instance/attendancedb';
      delete process.env.DB_SSL_REJECT_UNAUTHORIZED;

      const config = resolvePostgresConfig();
      assert.strictEqual(config.ssl, undefined, 'Client-side TLS must NOT be configured for percent-encoded Unix socket');
    });

    await runTest('In production: Standard system Unix socket (/var/run/postgresql) leaves ssl undefined', () => {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgresql://dbuser:secretpass@/attendancedb?host=/var/run/postgresql';

      const config = resolvePostgresConfig();
      assert.strictEqual(config.ssl, undefined, 'Standard Linux Unix socket must not use TLS');
    });

    await runTest('In production: Unix socket with sslmode=disable leaves ssl undefined', () => {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgresql://dbuser:secretpass@/attendancedb?host=/cloudsql/p:r:i&sslmode=disable';

      const config = resolvePostgresConfig();
      assert.strictEqual(config.ssl, undefined, 'Unix socket with sslmode=disable must have ssl: undefined');
    });

    await runTest('In production: Percent-encoded Unix socket with sslmode=disable leaves ssl undefined', () => {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgresql://dbuser:secretpass@%2Fcloudsql%2Fp%3Ar%3Ai/attendancedb?sslmode=disable';

      const config = resolvePostgresConfig();
      assert.strictEqual(config.ssl, undefined, 'Percent-encoded Unix socket with sslmode=disable must leave ssl undefined');
    });

    // -------------------------------------------------------------------------
    // 2. DIRECT TCP CONNECTIONS & PRODUCTION TLS ENFORCEMENT
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Direct TCP Connections & Production TLS Enforcement ---');

    await runTest('In production on TCP: SSL is enabled with rejectUnauthorized: true by default', () => {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgresql://dbuser:secretpass@10.0.0.5:5432/attendancedb';
      delete process.env.DB_SSL_REJECT_UNAUTHORIZED;

      const config = resolvePostgresConfig();
      assert.ok(config.ssl !== undefined, 'SSL must be configured on TCP in production');
      assert.deepStrictEqual(
        config.ssl,
        { rejectUnauthorized: true },
        'Production TCP must default to verified certificates (rejectUnauthorized: true)'
      );
    });

    await runTest('In production on TCP: Direct TCP with custom port preserves port and sets TLS with verified certs', () => {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgresql://dbuser:secretpass@10.0.0.5:6543/attendancedb';
      delete process.env.DB_SSL_REJECT_UNAUTHORIZED;

      const config = resolvePostgresConfig();
      // Verify TCP classification
      const parsed = parseConnectionString(config.connectionString);
      assert.strictEqual(parsed.host, '10.0.0.5', 'Host must be parsed as 10.0.0.5 without slash prefix');
      assert.strictEqual(parsed.port, '6543', 'Configured custom port 6543 must be preserved intact');
      assert.strictEqual(parsed.host?.startsWith('/'), false, 'Custom port connection must not be classified as Unix socket');

      // Verify TLS enforcement
      assert.ok(config.ssl !== undefined, 'TLS must be enabled for custom port TCP in production');
      assert.deepStrictEqual(
        config.ssl,
        { rejectUnauthorized: true },
        'Custom port TCP must default to verified certificates (rejectUnauthorized: true)'
      );
    });

    await runTest('In production on TCP: DB_SSL_REJECT_UNAUTHORIZED=true explicitly validates certificates', () => {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgresql://dbuser:secretpass@db.company.internal:5432/attendancedb';
      process.env.DB_SSL_REJECT_UNAUTHORIZED = 'true';

      const config = resolvePostgresConfig();
      assert.deepStrictEqual(config.ssl, { rejectUnauthorized: true });
    });

    await runTest('In production on TCP: DB_SSL_REJECT_UNAUTHORIZED=false explicitly opts out with warning', () => {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgresql://dbuser:secretpass@10.0.0.5:5432/attendancedb';
      process.env.DB_SSL_REJECT_UNAUTHORIZED = 'false';

      const config = resolvePostgresConfig();
      assert.deepStrictEqual(config.ssl, { rejectUnauthorized: false });
    });

    // -------------------------------------------------------------------------
    // 3. CONFIGURATION VALIDATION & CONTRADICTORY SETTINGS
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Configuration Validation & Contradictory Settings ---');

    await runTest('Contradictory config: Unix socket with sslmode=require throws fatal error', () => {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgresql://dbuser:secretpass@/attendancedb?host=/cloudsql/p:r:i&sslmode=require';

      assert.throws(
        () => resolvePostgresConfig(),
        /Contradictory database configuration.*Unix sockets do not support client-side TLS/
      );
    });

    await runTest('Contradictory config: Unix socket with sslmode=verify-ca throws fatal error', () => {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgresql://dbuser:secretpass@/attendancedb?host=/cloudsql/p:r:i&sslmode=verify-ca';

      assert.throws(
        () => resolvePostgresConfig(),
        /Contradictory database configuration.*Unix sockets do not support client-side TLS/
      );
    });

    await runTest('Contradictory config: Unix socket with sslmode=verify-full throws fatal error', () => {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgresql://dbuser:secretpass@/attendancedb?host=/cloudsql/p:r:i&sslmode=verify-full';

      assert.throws(
        () => resolvePostgresConfig(),
        /Contradictory database configuration.*Unix sockets do not support client-side TLS/
      );
    });

    await runTest('Contradictory config: Percent-encoded Unix socket with sslmode=verify-full throws fatal error', () => {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgresql://dbuser:secretpass@%2Fcloudsql%2Fp%3Ar%3Ai/attendancedb?sslmode=verify-full';

      assert.throws(
        () => resolvePostgresConfig(),
        /Contradictory database configuration.*Unix sockets do not support client-side TLS/
      );
    });

    await runTest('Insecure config: Direct TCP in production with sslmode=disable throws fatal error', () => {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgresql://dbuser:secretpass@10.0.0.5:5432/attendancedb?sslmode=disable';

      assert.throws(
        () => resolvePostgresConfig(),
        /Insecure database configuration.*sslmode=disable is prohibited in production mode for TCP/
      );
    });

    // -------------------------------------------------------------------------
    // 4. NON-PRODUCTION DEVELOPMENT ENVIRONMENT PRESERVATION
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Non-Production Development Environment Preservation ---');

    await runTest('In development on TCP without sslmode: SSL is undefined (unencrypted local dev)', () => {
      process.env.NODE_ENV = 'development';
      process.env.DATABASE_URL = 'postgresql://devuser:devpass@localhost:5432/devdb';
      delete process.env.DB_SSL_REJECT_UNAUTHORIZED;

      const config = resolvePostgresConfig();
      assert.strictEqual(config.ssl, undefined, 'Local dev TCP should not force SSL by default');
    });

    await runTest('In development on TCP with sslmode=require: SSL is configured', () => {
      process.env.NODE_ENV = 'development';
      process.env.DATABASE_URL = 'postgresql://devuser:devpass@localhost:5432/devdb?sslmode=require';
      delete process.env.DB_SSL_REJECT_UNAUTHORIZED;

      const config = resolvePostgresConfig();
      assert.ok(config.ssl !== undefined);
      assert.deepStrictEqual(config.ssl, { rejectUnauthorized: false });
    });

    await runTest('In development without DATABASE_URL: getDatabaseEngine returns sqlite', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.DATABASE_URL;

      assert.strictEqual(getDatabaseEngine(), 'sqlite');
      const db = getDatabase();
      assert.ok(db, 'SQLite database must be available');
    });

    // -------------------------------------------------------------------------
    // 5. POOL CONFIGURATION INTEGRITY
    // -------------------------------------------------------------------------
    console.log('\n--- 5. Pool Configuration Integrity ---');

    await runTest('Pool max, min, and timeout defaults and overrides are strictly preserved', () => {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgresql://dbuser:secretpass@10.0.0.5:5432/attendancedb';
      delete process.env.DB_POOL_MAX;
      delete process.env.DB_POOL_MIN;

      // Verify defaults
      const defaultConfig = resolvePostgresConfig();
      assert.strictEqual(defaultConfig.max, 10, 'Default pool max must be 10');
      assert.strictEqual(defaultConfig.min, 2, 'Default pool min must be 2');
      assert.strictEqual(defaultConfig.connectionTimeoutMillis, 5000);
      assert.strictEqual(defaultConfig.idleTimeoutMillis, 30000);

      // Verify environment overrides
      process.env.DB_POOL_MAX = '20';
      process.env.DB_POOL_MIN = '4';
      const overriddenConfig = resolvePostgresConfig();
      assert.strictEqual(overriddenConfig.max, 20);
      assert.strictEqual(overriddenConfig.min, 4);
    });

    // -------------------------------------------------------------------------
    // 6. SSL PARAMETER PRECEDENCE AND PG.POOL OPTIONS INTEGRATION
    // -------------------------------------------------------------------------
    console.log('\n--- 6. SSL Parameter Precedence and pg.Pool Options Integration ---');

    await runTest('pg.Pool options: Unix socket configuration passed to new PgPool preserves ssl: undefined', () => {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgresql://dbuser:secretpass@/attendancedb?host=/cloudsql/my-project:europe-west2:my-instance';

      const config = resolvePostgresConfig();
      const pool = new PgPool(config);

      // Verify that pg.Pool stores ssl as undefined for Unix sockets
      assert.strictEqual(pool.options.ssl, undefined, 'Pool options.ssl must be undefined for Unix socket');
      assert.strictEqual(config.ssl, undefined);
    });

    await runTest('pg.Pool options: Direct TCP with production config passed to new PgPool enforces ssl: { rejectUnauthorized: true }', () => {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgresql://dbuser:secretpass@10.0.0.5:5432/attendancedb';
      delete process.env.DB_SSL_REJECT_UNAUTHORIZED;

      const config = resolvePostgresConfig();
      const pool = new PgPool(config);

      // Verify that pg.Pool receives and enforces explicit ssl configuration object
      assert.deepStrictEqual(
        pool.options.ssl,
        { rejectUnauthorized: true },
        'Pool options.ssl must match explicit production config ({ rejectUnauthorized: true })'
      );
    });

    await runTest('pg.Pool options: Explicit config.ssl overrides URL parameters and prevents weakening', () => {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgresql://dbuser:secretpass@10.0.0.5:5432/attendancedb?sslmode=require';
      delete process.env.DB_SSL_REJECT_UNAUTHORIZED;

      const config = resolvePostgresConfig();
      const pool = new PgPool(config);

      // In node-postgres, explicit pool.options.ssl object takes precedence over connectionString url params
      assert.deepStrictEqual(
        pool.options.ssl,
        { rejectUnauthorized: true },
        'Explicit config.ssl must take precedence in pool.options.ssl'
      );
    });

  } finally {
    process.env.NODE_ENV = origNodeEnv;
    if (origDbUrl) process.env.DATABASE_URL = origDbUrl; else delete process.env.DATABASE_URL;
    if (origDbSslReject) process.env.DB_SSL_REJECT_UNAUTHORIZED = origDbSslReject; else delete process.env.DB_SSL_REJECT_UNAUTHORIZED;
    if (origPoolMax) process.env.DB_POOL_MAX = origPoolMax; else delete process.env.DB_POOL_MAX;
    if (origPoolMin) process.env.DB_POOL_MIN = origPoolMin; else delete process.env.DB_POOL_MIN;
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
