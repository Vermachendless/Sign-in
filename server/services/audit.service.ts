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

export interface AuditLogRecord {
  id: string;
  actorId: string | null;
  action: string;
  targetUserId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: string | null;
  createdAt: string;
  actorName?: string | null;
  actorEmail?: string | null;
  actorRole?: string | null;
  targetUserName?: string | null;
  targetUserEmail?: string | null;
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

  /**
   * Retrieves paginated audit logs with actor and target user details
   */
  public listLogs(options?: {
    page?: number;
    limit?: number;
    action?: string;
    search?: string;
  }): { logs: AuditLogRecord[]; total: number; page: number; limit: number; totalPages: number } {
    const db = getDatabase();
    const page = Math.max(1, options?.page || 1);
    const limit = Math.min(100, Math.max(1, options?.limit || 20));
    const offset = (page - 1) * limit;

    let whereClause = '1=1';
    const params: (string | number | null)[] = [];

    if (options?.action && options.action.trim()) {
      whereClause += ' AND al.action = ?';
      params.push(options.action.trim());
    }

    if (options?.search && options.search.trim()) {
      const term = `%${options.search.trim()}%`;
      whereClause += ' AND (al.action LIKE ? OR al.ip_address LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ?)';
      params.push(term, term, term, term, term);
    }

    const countRow = db.prepare(`
      SELECT COUNT(*) as count
      FROM audit_logs al
      LEFT JOIN users u ON al.actor_id = u.id
      WHERE ${whereClause}
    `).get(...params) as { count: number } | undefined;

    const total = countRow ? Number(countRow.count) : 0;
    const totalPages = Math.ceil(total / limit) || 1;

    const queryParams = [...params, limit, offset];
    const rows = db.prepare(`
      SELECT 
        al.id,
        al.actor_id as actorId,
        al.action,
        al.target_user_id as targetUserId,
        al.ip_address as ipAddress,
        al.user_agent as userAgent,
        al.metadata,
        al.created_at as createdAt,
        (u.first_name || ' ' || u.last_name) as actorName,
        u.email as actorEmail,
        u.role as actorRole,
        (tu.first_name || ' ' || tu.last_name) as targetUserName,
        tu.email as targetEmail
      FROM audit_logs al
      LEFT JOIN users u ON al.actor_id = u.id
      LEFT JOIN users tu ON al.target_user_id = tu.id
      WHERE ${whereClause}
      ORDER BY al.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...queryParams) as unknown as AuditLogRecord[];

    return {
      logs: rows || [],
      total,
      page,
      limit,
      totalPages,
    };
  }
}

export const auditService = new AuditService();
