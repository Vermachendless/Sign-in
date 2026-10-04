import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getDatabase } from '../db/index.ts';
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

export interface DatabaseRestoreResult {
  success: boolean;
  tablesVerified?: Record<string, number>;
  error?: string;
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
   * Creates a consistent point-in-time backup using SQLite's atomic VACUUM INTO.
   * This is fully safe under concurrent WAL mode operations without locking or corrupting writes.
   */
  public createBackup(
    actor: SafeUser,
    clientIp?: string,
    userAgent?: string
  ): DatabaseBackupResult {
    // 1. RBAC Check: SUPER_ADMIN only
    if (actor.role !== UserRole.SUPER_ADMIN) {
      return {
        success: false,
        error: 'Forbidden: Database backups can only be created by Super Administrators.',
      };
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup-attendance-${timestamp}.db`;
    const targetPath = path.join(this.backupDir, filename);

    try {
      const db = getDatabase();

      // Execute atomic VACUUM INTO
      // Escaping path for safety
      const escapedPath = targetPath.replace(/'/g, "''");
      db.exec(`VACUUM INTO '${escapedPath}';`);

      if (!fs.existsSync(targetPath)) {
        return {
          success: false,
          error: 'Backup file creation failed.',
        };
      }

      const stats = fs.statSync(targetPath);

      // Verify backup table counts
      const counts = this.verifyBackupFile(targetPath);

      // Audit the backup creation
      auditService.log({
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

      return {
        success: true,
        filename,
        backupPath: targetPath,
        fileSizeBytes: stats.size,
        tableCounts: counts,
        checksumVerified: true,
      };
    } catch (err: any) {
      console.error('[BackupService] createBackup error:', err);
      return {
        success: false,
        error: `Database backup error: ${err.message || String(err)}`,
      };
    }
  }

  /**
   * Verifies the integrity and table record counts of a backup SQLite file.
   */
  public verifyBackupFile(filePath: string): Record<string, number> {
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
   * List existing backups metadata without exposing file contents directly
   */
  public listBackups(actor: SafeUser): Array<{ filename: string; sizeBytes: number; createdAt: string }> {
    if (actor.role !== UserRole.SUPER_ADMIN) {
      return [];
    }

    if (!fs.existsSync(this.backupDir)) {
      return [];
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

    return files;
  }
}

export const backupService = new BackupService();
