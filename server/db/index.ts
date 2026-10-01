import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { DB_SCHEMA_SQL } from './schema.ts';

let dbInstance: DatabaseSync | null = null;

export function getDatabase(): DatabaseSync {
  if (dbInstance) {
    return dbInstance;
  }

  const dbDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const dbPath = process.env.DATABASE_PATH || path.join(dbDir, 'attendance.db');
  dbInstance = new DatabaseSync(dbPath);

  // Enable foreign keys and Write-Ahead Logging (WAL) for concurrency & durability
  dbInstance.exec('PRAGMA foreign_keys = ON;');
  dbInstance.exec('PRAGMA journal_mode = WAL;');
  dbInstance.exec('PRAGMA synchronous = NORMAL;');

  // Run schema migration
  dbInstance.exec(DB_SCHEMA_SQL);

  // Ensure visitor_visits table allows CHECKED_IN and CHECKED_OUT statuses
  try {
    const tableInfo = dbInstance.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='visitor_visits'").get() as { sql: string } | undefined;
    if (tableInfo && !tableInfo.sql.includes('CHECKED_IN')) {
      dbInstance.exec('PRAGMA foreign_keys = OFF;');
      dbInstance.exec(`
        CREATE TABLE visitor_visits_migrated (
          id TEXT PRIMARY KEY,
          host_staff_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          visitor_full_name TEXT NOT NULL,
          visitor_phone TEXT,
          visitor_email TEXT COLLATE NOCASE,
          purpose TEXT,
          notes TEXT,
          valid_from TEXT NOT NULL,
          valid_until TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('PENDING', 'ACCESS_ISSUED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'EXPIRED')) DEFAULT 'PENDING',
          access_pass_id TEXT REFERENCES access_passes(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          cancelled_at TEXT,
          cancelled_by TEXT REFERENCES users(id)
        );
        INSERT INTO visitor_visits_migrated SELECT * FROM visitor_visits;
        DROP TABLE visitor_visits;
        ALTER TABLE visitor_visits_migrated RENAME TO visitor_visits;
        CREATE INDEX IF NOT EXISTS idx_visitor_visits_host_staff_id ON visitor_visits(host_staff_id);
        CREATE INDEX IF NOT EXISTS idx_visitor_visits_status ON visitor_visits(status);
        CREATE INDEX IF NOT EXISTS idx_visitor_visits_access_pass_id ON visitor_visits(access_pass_id);
        CREATE INDEX IF NOT EXISTS idx_visitor_visits_valid_from ON visitor_visits(valid_from);
        CREATE INDEX IF NOT EXISTS idx_visitor_visits_valid_until ON visitor_visits(valid_until);
        CREATE INDEX IF NOT EXISTS idx_visitor_visits_visitor_email ON visitor_visits(visitor_email);
      `);
      dbInstance.exec('PRAGMA foreign_keys = ON;');
    }
  } catch (migErr) {
    console.warn('Migration warning for visitor_visits:', migErr);
  }

  return dbInstance;
}

export function closeDatabase(): void {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch (err) {
      console.error('Error closing database:', err);
    }
    dbInstance = null;
  }
}
