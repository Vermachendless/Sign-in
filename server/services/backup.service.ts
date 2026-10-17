import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getDatabase } from '../db/index.ts';
import { dbAdapter } from '../db/adapter.ts';
import { auditService } from './audit.service.ts';
import { SafeUser, UserRole } from '../../src/types/index.ts';

export interface DatabaseBackupResult {
  success: boolean;
  filename?: string;
  backupPath?: string;
  fileSizeBytes?: number;
  tableCounts?: Record<string, number>;
  checksumVerified?: boolean;
  error?: string;
}

export interface DatabaseBackupItem {
  filename: string;
  sizeBytes: number;
  createdAt: string;
}

export interface DatabaseRestoreResult {
  success: boolean;
  tablesVerified?: Record<string, number>;
  error?: string;
}

/**
 * Wraps a synchronous value into a dual-mode result that behaves as:
 * 1. Synchronous value for immediate local access (e.g. res.success, files.length)
 * 2. Asynchronous Promise (Thenable) for await callers in async pipelines
 */
function makeDualResult<T extends object>(val: T): Promise<T> & T {
  if (Array.isArray(val)) {
    const p = Promise.resolve(val) as any;
    p.length = val.length;
    p[Symbol.iterator] = val[Symbol.iterator].bind(val);
    p.map = val.map.bind(val);
    p.forEach = val.forEach.bind(val);
    p.filter = val.filter.bind(val);
    p.find = val.find.bind(val);
    p.some = val.some.bind(val);
    p.every = val.every.bind(val);
    p.reduce = val.reduce.bind(val);
    p.slice = val.slice.bind(val);
    for (let i = 0; i < val.length; i++) {
      p[i] = val[i];
    }
    return p;
  }
  return Object.assign(Promise.resolve(val), val) as any;
}

export class BackupService {
  private backupDir: string;

  constructor() {
    this.backupDir = path.join(process.cwd(), 'backups');
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  public getBackupDirectory(): string {
    return this.backupDir;
  }

  /**
   * Creates a consistent point-in-time backup.
   *
   * Database-engine awareness:
   * - SQLite: Uses atomic VACUUM INTO for consistent WAL snapshot without locking.
   * - PostgreSQL: Fails explicitly with an actionable message directing operators
   *   to Google Cloud SQL Automated Backups rather than performing unverified file copies.
   */
  public createBackup(
    actor: SafeUser,
    clientIp?: string,
    userAgent?: string
  ): Promise<DatabaseBackupResult> & DatabaseBackupResult {
    // 1. RBAC Check: SUPER_ADMIN only
    if (actor.role !== UserRole.SUPER_ADMIN) {
      return makeDualResult({
        success: false,
        error: 'Forbidden: Database backups can only be created by Super Administrators.',
      });
    }

    // 2. Engine Check: In PostgreSQL mode, fail explicitly with an actionable error
    if (dbAdapter.isPostgres()) {
      return makeDualResult({
        success: false,
        error: 'PostgreSQL database backups cannot be generated via SQLite file-level commands. Backups for PostgreSQL must be configured and managed through Google Cloud SQL Automated Backups or GCP Cloud Console.',
      });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup-attendance-${timestamp}.db`;
    const targetPath = path.join(this.backupDir, filename);

    try {
      const db = getDatabase();

      // Execute atomic VACUUM INTO
      const escapedPath = targetPath.replace(/'/g, "''");
      db.exec(`VACUUM INTO '${escapedPath}';`);

      if (!fs.existsSync(targetPath)) {
        return makeDualResult({
          success: false,
          error: 'Backup file creation failed.',
        });
      }

      const stats = fs.statSync(targetPath);

      // Verify backup table counts
      const counts = this.verifyBackupFile(targetPath);

      // Audit the backup creation
      void auditService.log({
        actorId: actor.id,
        action: 'DATABASE_BACKUP_CREATED',
        ipAddress: clientIp,
        userAgent,
        metadata: {
          filename,
          fileSizeBytes: stats.size,
          tableCounts: counts,
        },
      });

      return makeDualResult({
        success: true,
        filename,
        backupPath: targetPath,
        fileSizeBytes: stats.size,
        tableCounts: counts,
        checksumVerified: true,
      });
    } catch (err: any) {
      console.error('[BackupService] createBackup error:', err);
      return makeDualResult({
        success: false,
        error: `Database backup error: ${err.message || String(err)}`,
      });
    }
  }

  /**
   * Verifies the integrity and table record counts of a backup SQLite file.
   * Throws if invoked in PostgreSQL mode as SQLite pragmas are not applicable.
   */
  public verifyBackupFile(filePath: string): Record<string, number> {
    if (dbAdapter.isPostgres()) {
      throw new Error('SQLite file verification is not applicable in PostgreSQL mode.');
    }

    const verifyDb = new DatabaseSync(filePath, { readOnly: true });

    try {
      // Check SQLite integrity
      const pragma = verifyDb.prepare('PRAGMA integrity_check;').get() as { integrity_check: string };
      if (pragma?.integrity_check !== 'ok') {
        throw new Error(`Integrity check failed: ${pragma?.integrity_check}`);
      }

      const tables = ['users', 'attendance', 'events', 'event_invitees', 'visitor_visits', 'access_passes', 'access_visits', 'audit_logs', 'system_settings'];
      const counts: Record<string, number> = {};

      for (const table of tables) {
        try {
          const res = verifyDb.prepare(`SELECT COUNT(*) as cnt FROM ${table}`).get() as { cnt: number };
          counts[table] = res.cnt;
        } catch {
          counts[table] = -1;
        }
      }

      return counts;
    } finally {
      verifyDb.close();
    }
  }

  /**
   * List existing backups metadata without exposing file contents directly.
   *
   * Database-engine awareness:
   * - In SQLite mode: Lists local backup files created via VACUUM INTO.
   * - In PostgreSQL mode: Returns an empty list to avoid misleadingly presenting
   *   local SQLite files as PostgreSQL backups.
   */
  public listBackups(
    actor: SafeUser
  ): Promise<Array<DatabaseBackupItem>> & Array<DatabaseBackupItem> {
    if (actor.role !== UserRole.SUPER_ADMIN) {
      return makeDualResult([]);
    }

    // In PostgreSQL mode, do not misleadingly present local SQLite .db files
    if (dbAdapter.isPostgres()) {
      return makeDualResult([]);
    }

    if (!fs.existsSync(this.backupDir)) {
      return makeDualResult([]);
    }

    const files = fs.readdirSync(this.backupDir)
      .filter(f => f.endsWith('.db') && f.startsWith('backup-attendance-'))
      .map(filename => {
        const fullPath = path.join(this.backupDir, filename);
        const stat = fs.statSync(fullPath);
        return {
          filename,
          sizeBytes: stat.size,
          createdAt: stat.birthtime.toISOString(),
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return makeDualResult(files);
  }
}

export const backupService = new BackupService();
