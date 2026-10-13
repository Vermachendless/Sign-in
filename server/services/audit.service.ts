import { dbAdapter } from '../db/adapter.ts';
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

export interface AuditLogOptions {
  /**
   * If true, throws AuditLoggingError on database failure.
   * If false or omitted (default), returns { success: false, error } and suppresses unhandled rejection.
   */
  throwOnError?: boolean;
}

export interface AuditLogResult {
  success: boolean;
  auditId?: string;
  error?: Error;
}

export interface AuditFailureDiagnostics {
  timestamp: string;
  action: string;
  actorId: string | null;
  targetUserId: string | null;
  ipAddress: string | null;
  errorMessage: string;
  errorName: string;
}

/**
 * Custom error thrown when throwOnError option is explicitly set to true.
 */
export class AuditLoggingError extends Error {
  public readonly diagnostics: AuditFailureDiagnostics;
  public readonly originalError: unknown;

  constructor(message: string, diagnostics: AuditFailureDiagnostics, originalError: unknown) {
    super(message);
    this.name = 'AuditLoggingError';
    this.diagnostics = diagnostics;
    this.originalError = originalError;
    Object.setPrototypeOf(this, AuditLoggingError.prototype);
  }
}

export type AuditFailureListener = (failure: AuditFailureDiagnostics) => void;

/**
 * IMPORTANT NOTE ON DURABILITY & TRANSACTIONALITY:
 * In-memory failure tracking and diagnostics are diagnostic only and ephemeral.
 * They are NOT durable across process restarts or multi-instance deployments.
 * Audit log database writes are executed independently and do NOT provide
 * ACID transaction coupling or rollback guarantees with callers' business operations.
 */
class AuditService {
  private readonly MAX_DIAGNOSTICS = 50;
  private readonly failureLog: AuditFailureDiagnostics[] = [];
  private totalFailures = 0;
  private readonly listeners: Set<AuditFailureListener> = new Set();

  /**
   * Records an immutable audit log entry in the database.
   * Returns AuditLogResult indicating whether the database write succeeded.
   * Default behavior avoids throwing to protect fire-and-forget callers from unhandled rejections.
   */
  public async log(
    input: AuditLogInput,
    options?: AuditLogOptions
  ): Promise<AuditLogResult> {
    const id = generateId();
    const now = new Date().toISOString();

    let metadataStr: string | null = null;
    try {
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

      await dbAdapter.execute(
        `
        INSERT INTO audit_logs (id, actor_id, action, target_user_id, ip_address, user_agent, metadata, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          id,
          input.actorId || null,
          input.action,
          input.targetUserId || null,
          input.ipAddress || null,
          input.userAgent || null,
          metadataStr,
          now,
        ]
      );

      return {
        success: true,
        auditId: id,
      };
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));

      const diagnostics: AuditFailureDiagnostics = {
        timestamp: now,
        action: input.action,
        actorId: input.actorId || null,
        targetUserId: input.targetUserId || null,
        ipAddress: input.ipAddress || null,
        errorMessage: error.message,
        errorName: error.name,
      };

      this.recordFailure(diagnostics);

      console.error(
        `[AuditService] Failed to write audit log for action "${input.action}":`,
        error.message
      );

      if (options?.throwOnError) {
        throw new AuditLoggingError(
          `Audit log failed for action "${input.action}": ${error.message}`,
          diagnostics,
          err
        );
      }

      return {
        success: false,
        error,
      };
    }
  }

  private recordFailure(diagnostics: AuditFailureDiagnostics): void {
    this.totalFailures++;
    this.failureLog.push(diagnostics);
    if (this.failureLog.length > this.MAX_DIAGNOSTICS) {
      this.failureLog.shift();
    }

    // Safely notify listeners without allowing listener errors to propagate or crash caller
    for (const listener of this.listeners) {
      try {
        listener(diagnostics);
      } catch (listenerErr) {
        console.error('[AuditService] Error in audit failure listener callback:', listenerErr);
      }
    }
  }

  /**
   * Retrieves the most recent failure diagnostic record, if any.
   */
  public getLastFailure(): AuditFailureDiagnostics | null {
    return this.failureLog.length > 0 ? this.failureLog[this.failureLog.length - 1] : null;
  }

  /**
   * Retrieves a copy of the recent failure diagnostics buffer.
   */
  public getFailures(): AuditFailureDiagnostics[] {
    return [...this.failureLog];
  }

  /**
   * Retrieves the cumulative count of audit write failures since process start.
   */
  public getFailureCount(): number {
    return this.totalFailures;
  }

  /**
   * Clears the diagnostics buffer and resets failure counter.
   */
  public clearFailureDiagnostics(): void {
    this.failureLog.length = 0;
    this.totalFailures = 0;
  }

  /**
   * Registers a subscriber callback for audit log failures.
   * Returns an unsubscribe function.
   */
  public onFailure(listener: AuditFailureListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Retrieves paginated audit logs with actor and target user details
   */
  public async listLogs(options?: {
    page?: number;
    limit?: number;
    action?: string;
    search?: string;
  }): Promise<{ logs: AuditLogRecord[]; total: number; page: number; limit: number; totalPages: number }> {
    const page = Math.max(1, options?.page || 1);
    const limit = Math.min(100, Math.max(1, options?.limit || 20));
    const offset = (page - 1) * limit;

    let whereClause = '1=1';
    const params: (string | number | null)[] = [];
    let pIdx = 1;

    if (options?.action && options.action.trim()) {
      whereClause += ` AND al.action = $${pIdx++}`;
      params.push(options.action.trim());
    }

    if (options?.search && options.search.trim()) {
      const term = `%${options.search.trim()}%`;
      whereClause += ` AND (al.action LIKE $${pIdx} OR al.ip_address LIKE $${pIdx + 1} OR u.first_name LIKE $${pIdx + 2} OR u.last_name LIKE $${pIdx + 3} OR u.email LIKE $${pIdx + 4})`;
      pIdx += 5;
      params.push(term, term, term, term, term);
    }

    const countRow = await dbAdapter.queryOne<{ count: number }>(
      `
      SELECT COUNT(*) as count
      FROM audit_logs al
      LEFT JOIN users u ON al.actor_id = u.id
      WHERE ${whereClause}
      `,
      [...params]
    );

    const total = countRow ? Number(countRow.count) : 0;
    const totalPages = Math.ceil(total / limit) || 1;

    const queryParams = [...params, limit, offset];
    const limitPlaceholder = `$${pIdx++}`;
    const offsetPlaceholder = `$${pIdx++}`;

    const rows = await dbAdapter.query<AuditLogRecord>(
      `
      SELECT 
        al.id,
        al.actor_id as "actorId",
        al.action,
        al.target_user_id as "targetUserId",
        al.ip_address as "ipAddress",
        al.user_agent as "userAgent",
        al.metadata,
        al.created_at as "createdAt",
        (u.first_name || ' ' || u.last_name) as "actorName",
        u.email as "actorEmail",
        u.role as "actorRole",
        (tu.first_name || ' ' || tu.last_name) as "targetUserName",
        tu.email as "targetEmail"
      FROM audit_logs al
      LEFT JOIN users u ON al.actor_id = u.id
      LEFT JOIN users tu ON al.target_user_id = tu.id
      WHERE ${whereClause}
      ORDER BY al.created_at DESC
      LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}
      `,
      queryParams
    );

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

