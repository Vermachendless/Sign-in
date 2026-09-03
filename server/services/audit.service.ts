import { getDatabase } from '../db/index.ts';
import { generateId } from '../utils/crypto.ts';

export interface AuditLogInput {
  actorId?: string | null;
  action: string;
  targetUserId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | string | null;
}

class AuditService {
  /**
   * Records an immutable audit log entry in the database
   */
  public log(input: AuditLogInput): void {
    try {
      const db = getDatabase();
      const id = generateId();
      const now = new Date().toISOString();

      let metadataStr: string | null = null;
      if (input.metadata) {
        if (typeof input.metadata === 'string') {
          metadataStr = input.metadata;
        } else {
          // Deep clone and sanitize to ensure passwords, secrets, or tokens are never logged
          const cleanMetadata = { ...input.metadata };
          delete cleanMetadata.password;
          delete cleanMetadata.passwordHash;
          delete cleanMetadata.token;
          delete cleanMetadata.sessionToken;
          metadataStr = JSON.stringify(cleanMetadata);
        }
      }

      db.prepare(`
        INSERT INTO audit_logs (id, actor_id, action, target_user_id, ip_address, user_agent, metadata, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.actorId || null,
        input.action,
        input.targetUserId || null,
        input.ipAddress || null,
        input.userAgent || null,
        metadataStr,
        now
      );
    } catch (error) {
      console.error('[AuditService] Failed to write audit log:', error);
    }
  }
}

export const auditService = new AuditService();
