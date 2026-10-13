import pg from 'pg';
import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

const { Pool: PgPool, types } = pg;

// Configure PostgreSQL type parsers to prevent timezone/date drift:
// OID 1184 = TIMESTAMPTZ -> Return ISO string verbatim
// OID 1114 = TIMESTAMP -> Return ISO string verbatim
// OID 1082 = DATE -> Return YYYY-MM-DD string verbatim
types.setTypeParser(1184, (val: string) => val);
types.setTypeParser(1114, (val: string) => val);
types.setTypeParser(1082, (val: string) => val);

let poolInstance: Pool | null = null;

export interface PostgresPoolConfig {
  connectionString: string;
  max: number;
  min: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  ssl?: { rejectUnauthorized: boolean } | boolean;
}

/**
 * Returns whether the application is running in production mode.
 */
export function isProductionEnvironment(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Resolves PostgreSQL pool configuration with strict production security.
 */
export function resolvePostgresConfig(): PostgresPoolConfig {
  const isProd = isProductionEnvironment();
  const dbUrl = process.env.DATABASE_URL?.trim();

  // Strict Fail-Closed Production Gate:
  // If NODE_ENV === "production", DATABASE_URL is mandatory.
  if (isProd) {
    if (!dbUrl) {
      console.error(
        '[FATAL PRODUCTION DATABASE ERROR] NODE_ENV is set to "production" but DATABASE_URL is missing or empty. ' +
        'The application refuses to start. Falling back to SQLite or in-memory storage in production is strictly prohibited.'
      );
      throw new Error(
        'DATABASE_URL is required in production. SQLite fallback is strictly prohibited in production mode.'
      );
    }

    // Explicitly verify DATABASE_PATH is NOT used in production
    if (process.env.DATABASE_PATH) {
      console.warn(
        '[PostgreSQL Config NOTICE] DATABASE_PATH environment variable is ignored in production mode. Cloud Run uses DATABASE_URL.'
      );
    }
  }

  const connectionString = dbUrl || '';
  const max = parseInt(process.env.DB_POOL_MAX || '10', 10);
  const min = parseInt(process.env.DB_POOL_MIN || '2', 10);
  const idleTimeoutMillis = parseInt(process.env.DB_IDLE_TIMEOUT_MS || '30000', 10);
  const connectionTimeoutMillis = parseInt(process.env.DB_CONNECT_TIMEOUT_MS || '5000', 10);

  // SSL handling: Enable SSL for Cloud Run / Cloud SQL production connections
  let ssl: { rejectUnauthorized: boolean } | boolean | undefined;
  if (isProd || connectionString.includes('sslmode=require')) {
    const rejectUnauthorized = process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true';
    ssl = { rejectUnauthorized };
  }

  return {
    connectionString,
    max,
    min,
    idleTimeoutMillis,
    connectionTimeoutMillis,
    ...(ssl !== undefined ? { ssl } : {}),
  };
}

/**
 * Retrieves the singleton PostgreSQL connection pool.
 * In production, fails closed immediately if DATABASE_URL is missing.
 */
export function getPostgresPool(): Pool {
  if (poolInstance) {
    return poolInstance;
  }

  const config = resolvePostgresConfig();

  if (!config.connectionString) {
    throw new Error(
      'Cannot initialize PostgreSQL pool: DATABASE_URL is not configured.'
    );
  }

  poolInstance = new PgPool(config);

  // Error listener for idle clients in pool
  poolInstance.on('error', (err: Error) => {
    console.error('[PostgreSQL Pool Unexpected Client Error]:', err.message);
  });

  return poolInstance;
}

/**
 * For testing purposes: allows overriding or resetting the pool instance.
 */
export function setPostgresPoolForTesting(pool: Pool | null): void {
  poolInstance = pool;
}

/**
 * Executes a callback within a managed database transaction.
 * Automatically acquires client, executes BEGIN, commits on success,
 * rolls back on any error, and releases client back to the pool.
 */
export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const pool = getPostgresPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('[PostgreSQL withTransaction] Rollback failed:', rollbackErr);
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Executes a parameterized query using the pool.
 */
export async function queryPostgres<R extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<R>> {
  const pool = getPostgresPool();
  return pool.query<R>(text, params);
}

/**
 * Health check to verify PostgreSQL connectivity.
 * Fails closed on connection error; NEVER falls back to SQLite.
 */
export async function verifyPostgresConnection(): Promise<{
  connected: boolean;
  version?: string;
  error?: string;
}> {
  try {
    const pool = getPostgresPool();
    const res = await pool.query('SELECT version();');
    return {
      connected: true,
      version: res.rows[0]?.version,
    };
  } catch (err: any) {
    const errorMessage = err?.message || String(err);
    console.error('[PostgreSQL Health Check Error]:', errorMessage);
    return {
      connected: false,
      error: errorMessage,
    };
  }
}

/**
 * Gracefully shuts down the PostgreSQL pool and terminates idle connections.
 */
export async function closePostgresPool(): Promise<void> {
  if (poolInstance) {
    try {
      await poolInstance.end();
      console.log('[PostgreSQL] Connection pool gracefully drained and closed.');
    } catch (err) {
      console.error('[PostgreSQL] Error closing connection pool:', err);
    }
    poolInstance = null;
  }
}
