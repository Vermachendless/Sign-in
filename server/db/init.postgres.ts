import type { Pool, PoolClient } from 'pg';
import { verifyPostgresConnection, getPostgresPool } from './postgres.ts';
import { initializePostgresSchema } from './schema.postgres.ts';
import { seedPostgresDatabase, PostgresSeedResult } from './seed.postgres.ts';
import { refreshOfficeIpsCache } from '../services/network.service.ts';

export interface PostgresStartupResult {
  connected: boolean;
  version?: string;
  seedResult: PostgresSeedResult;
  officeIps: string[];
}

/**
 * Sequential PostgreSQL production startup initialization:
 * 1. verifyPostgresConnection()
 * 2. initializePostgresSchema(client)
 * 3. seedPostgresDatabase(client)
 * 4. refreshOfficeIpsCache()
 *
 * Awaits each step sequentially. If any step fails, throws an error so that
 * the server halts startup and refuses to begin listening (fail-closed).
 */
export async function initializePostgresStartup(overrideClient?: Pool | PoolClient): Promise<PostgresStartupResult> {
  // Step 1: Verify PostgreSQL connectivity
  const connection = await verifyPostgresConnection();
  if (!connection.connected) {
    throw new Error(
      `[Startup FATAL] Failed to connect to PostgreSQL database: ${connection.error || 'Connection verification failed'}`
    );
  }
  console.log('[Database] PostgreSQL connection verified successfully.');

  // Step 2: Initialize PostgreSQL schema (idempotent DDL)
  const client = overrideClient || getPostgresPool();
  await initializePostgresSchema(client);
  console.log('[Database] PostgreSQL schema initialized successfully.');

  // Step 3: Seed PostgreSQL database (idempotent: Super Admin + base settings, 0 test data)
  const seedResult = await seedPostgresDatabase(client);
  console.log(`[Database] PostgreSQL database seeded: ${seedResult.message}`);

  // Step 4: Refresh approved office IPs in-memory cache from database
  const officeIps = await refreshOfficeIpsCache({ throwOnError: true });
  console.log(`[Database] Office IP cache refreshed successfully (${officeIps.length} approved IP(s) loaded).`);

  return {
    connected: true,
    version: connection.version,
    seedResult,
    officeIps,
  };
}
