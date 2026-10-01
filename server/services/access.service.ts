import crypto from 'node:crypto';
import { getDatabase } from '../db/index.ts';
import { generateId } from '../utils/crypto.ts';
import { auditService } from './audit.service.ts';
import {
  AccessPassRecord,
  AccessPassStatus,
  PassType,
  VerificationResult,
  SafeUser,
  UserRole,
  EventStatus,
} from '../../src/types/index.ts';
import { COMPANY_TIMEZONE, formatDateInTimezone, formatTimeInTimezone } from '../utils/time.ts';

// Unambiguous alphanumeric alphabet (excludes easily confused 0, O, 1, I)
const UNAMBIGUOUS_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/**
 * Sliding-window rate limiter for access pass verification attempts
 * Limits verification attempts per IP to prevent brute-force code guessing
 */
class VerificationRateLimiter {
  private attempts = new Map<string, { count: number; resetAt: number }>();
  private readonly maxAttempts = 25; // 25 attempts per minute
  private readonly windowMs = 60 * 1000; // 1 minute

  public checkLimit(ip: string): boolean {
    const now = Date.now();
    const entry = this.attempts.get(ip);

    if (!entry || now > entry.resetAt) {
      this.attempts.set(ip, { count: 1, resetAt: now + this.windowMs });
      return true; // within limit
    }

    if (entry.count >= this.maxAttempts) {
      return false; // rate limited
    }

    entry.count += 1;
    return true;
  }

  public reset(ip: string): void {
    this.attempts.delete(ip);
  }

  public clearAll(): void {
    this.attempts.clear();
  }
}

export class AccessService {
  private rateLimiter = new VerificationRateLimiter();

  /**
   * Generates a cryptographically secure random token and its SHA-256 hash
   */
  public generateAccessToken(): { rawToken: string; tokenHash: string } {
    const rawToken = crypto.randomBytes(32).toString('hex'); // 64 hex characters
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    return { rawToken, tokenHash };
  }

  /**
   * Hashes a raw token using SHA-256
   */
  public hashToken(rawToken: string): string {
    return crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
  }

  /**
   * Generates a random human-readable code in format EVT-XXXX-XXXX
   */
  public generateDisplayCode(prefix: 'EVT' | 'VIS' = 'EVT'): string {
    const randomChars = (length: number): string => {
      const bytes = crypto.randomBytes(length);
      let result = '';
      for (let i = 0; i < length; i++) {
        result += UNAMBIGUOUS_CHARS[bytes[i] % UNAMBIGUOUS_CHARS.length];
      }
      return result;
    };

    return `${prefix}-${randomChars(4)}-${randomChars(4)}`;
  }

  /**
   * Formats ISO date in company timezone (Africa/Lagos)
   */
  public formatDateTime(isoString?: string | null): string {
    if (!isoString) return '--';
    try {
      const datePart = formatDateInTimezone(isoString, COMPANY_TIMEZONE);
      const timePart = formatTimeInTimezone(isoString, COMPANY_TIMEZONE);
      return `${datePart}, ${timePart}`;
    } catch {
      return isoString;
    }
  }

  /**
   * Helper to normalize access codes (e.g. " evt-7k4p-92mx " -> "EVT-7K4P-92MX")
   */
  public normalizeCode(code: string): string {
    return code.trim().toUpperCase();
  }

  /**
   * Creates an EVENT access pass for an approved event
   */
  public createEventAccessPass(
    actor: SafeUser,
    eventId: string,
    options?: {
      maxUses?: number | null;
      validFrom?: string;
      validUntil?: string;
    },
    ipAddress?: string,
    userAgent?: string
  ): { success: boolean; pass?: AccessPassRecord; error?: string } {
    if (actor.role === UserRole.STAFF) {
      return { success: false, error: 'Staff members are not authorized to generate access passes.' };
    }

    const db = getDatabase();

    // 1. Verify associated event
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId) as
      | {
          id: string;
          title: string;
          location: string;
          start_at: string;
          end_at: string;
          status: string;
        }
      | undefined;

    if (!event) {
      return { success: false, error: 'Event not found.' };
    }

    // Only APPROVED events are eligible for access pass generation
    if (event.status !== EventStatus.APPROVED) {
      return {
        success: false,
        error: `Cannot generate access pass for event with status "${event.status}". Event must be APPROVED by Super Admin first.`,
      };
    }

    // 2. Validate validity window
    const nowIso = new Date().toISOString();
    const validFrom = options?.validFrom ? new Date(options.validFrom).toISOString() : event.start_at;
    const validUntil = options?.validUntil ? new Date(options.validUntil).toISOString() : event.end_at;

    if (isNaN(new Date(validFrom).getTime()) || isNaN(new Date(validUntil).getTime())) {
      return { success: false, error: 'Invalid start or end validity timestamps.' };
    }

    if (new Date(validUntil).getTime() <= new Date(validFrom).getTime()) {
      return { success: false, error: 'Access pass valid_until must be strictly after valid_from.' };
    }

    // 3. Validate max uses
    let maxUses: number | null = 1; // default single-use pass
    if (options?.maxUses !== undefined) {
      if (options.maxUses === null) {
        maxUses = null; // unlimited
      } else {
        const parsed = parseInt(String(options.maxUses), 10);
        if (isNaN(parsed) || parsed < 1) {
          return { success: false, error: 'Max uses must be a positive integer or null (unlimited).' };
        }
        maxUses = parsed;
      }
    }

    // 4. Generate cryptographically random token and display code
    const { rawToken, tokenHash } = this.generateAccessToken();

    // Ensure display code uniqueness
    let displayCode = this.generateDisplayCode('EVT');
    let attempts = 0;
    while (attempts < 5) {
      const existing = db.prepare('SELECT id FROM access_passes WHERE display_code = ?').get(displayCode);
      if (!existing) break;
      displayCode = this.generateDisplayCode('EVT');
      attempts++;
    }

    const passId = generateId();
    const createdAt = nowIso;

    try {
      db.prepare(`
        INSERT INTO access_passes (
          id, pass_type, event_id, host_staff_id, token_hash, display_code,
          valid_from, valid_until, status, max_uses, use_count,
          created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
      `).run(
        passId,
        PassType.EVENT,
        eventId,
        null,
        tokenHash,
        displayCode,
        validFrom,
        validUntil,
        AccessPassStatus.ACTIVE,
        maxUses,
        actor.id,
        createdAt,
        createdAt
      );

      // Audit log pass creation (Raw token is NEVER logged)
      auditService.log({
        actorId: actor.id,
        action: 'ACCESS_PASS_CREATED',
        ipAddress,
        userAgent,
        metadata: {
          passId,
          passType: PassType.EVENT,
          eventId,
          eventTitle: event.title,
          displayCode,
          maxUses,
          validFrom,
          validUntil,
        },
      });

      const passRecord: AccessPassRecord = {
        id: passId,
        passType: PassType.EVENT,
        eventId,
        hostStaffId: null,
        displayCode,
        validFrom,
        validUntil,
        status: AccessPassStatus.ACTIVE,
        maxUses,
        useCount: 0,
        createdBy: actor.id,
        createdAt,
        updatedAt: createdAt,
        rawToken, // Returned only on generation to the authorized creator
        eventTitle: event.title,
        eventLocation: event.location,
        creatorName: `${actor.firstName} ${actor.lastName}`,
        formattedValidFrom: this.formatDateTime(validFrom),
        formattedValidUntil: this.formatDateTime(validUntil),
      };

      return { success: true, pass: passRecord };
    } catch (err) {
      console.error('[AccessService] createEventAccessPass error:', err);
      return { success: false, error: 'Database error creating access pass.' };
    }
  }

  /**
   * Creates a VISITOR access pass for an authorized staff member's visitor
   */
  public createVisitorAccessPass(
    actor: SafeUser,
    hostStaffId: string,
    options: {
      validFrom: string;
      validUntil: string;
      maxUses?: number | null;
    },
    ipAddress?: string,
    userAgent?: string
  ): { success: boolean; pass?: AccessPassRecord; error?: string } {
    const db = getDatabase();

    // 1. Verify host staff member exists and is active
    const host = db.prepare('SELECT id, first_name, last_name, department, status FROM users WHERE id = ?').get(hostStaffId) as any;
    if (!host) {
      return { success: false, error: 'Host staff member not found.' };
    }
    if (host.status !== 'ACTIVE') {
      return { success: false, error: 'Host staff member is not currently active.' };
    }

    // 2. Validate validity window
    const nowIso = new Date().toISOString();
    const validFrom = new Date(options.validFrom).toISOString();
    const validUntil = new Date(options.validUntil).toISOString();

    if (isNaN(new Date(validFrom).getTime()) || isNaN(new Date(validUntil).getTime())) {
      return { success: false, error: 'Invalid start or end validity timestamps.' };
    }

    if (new Date(validUntil).getTime() <= new Date(validFrom).getTime()) {
      return { success: false, error: 'Visitor pass valid_until must be strictly after valid_from.' };
    }

    // 3. Validate max uses (default 1 for single-use visitor pass)
    let maxUses: number | null = 1;
    if (options.maxUses !== undefined) {
      if (options.maxUses === null) {
        maxUses = null;
      } else {
        const parsed = parseInt(String(options.maxUses), 10);
        if (isNaN(parsed) || parsed < 1) {
          return { success: false, error: 'Max uses must be a positive integer or null (unlimited).' };
        }
        maxUses = parsed;
      }
    }

    // 4. Generate cryptographically random token and display code (VIS-XXXX-XXXX)
    const { rawToken, tokenHash } = this.generateAccessToken();

    let displayCode = this.generateDisplayCode('VIS');
    let attempts = 0;
    while (attempts < 5) {
      const existing = db.prepare('SELECT id FROM access_passes WHERE display_code = ?').get(displayCode);
      if (!existing) break;
      displayCode = this.generateDisplayCode('VIS');
      attempts++;
    }

    const passId = generateId();
    const createdAt = nowIso;

    try {
      db.prepare(`
        INSERT INTO access_passes (
          id, pass_type, event_id, host_staff_id, token_hash, display_code,
          valid_from, valid_until, status, max_uses, use_count,
          created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
      `).run(
        passId,
        PassType.VISITOR,
        null,
        hostStaffId,
        tokenHash,
        displayCode,
        validFrom,
        validUntil,
        AccessPassStatus.ACTIVE,
        maxUses,
        actor.id,
        createdAt,
        createdAt
      );

      auditService.log({
        actorId: actor.id,
        action: 'ACCESS_PASS_CREATED',
        ipAddress,
        userAgent,
        metadata: {
          passId,
          passType: PassType.VISITOR,
          hostStaffId,
          hostStaffName: `${host.first_name} ${host.last_name}`,
          displayCode,
          maxUses,
          validFrom,
          validUntil,
        },
      });

      const passRecord: AccessPassRecord = {
        id: passId,
        passType: PassType.VISITOR,
        eventId: null,
        hostStaffId,
        displayCode,
        validFrom,
        validUntil,
        status: AccessPassStatus.ACTIVE,
        maxUses,
        useCount: 0,
        createdBy: actor.id,
        createdAt,
        updatedAt: createdAt,
        rawToken,
        hostStaffName: `${host.first_name} ${host.last_name}`,
        creatorName: `${actor.firstName} ${actor.lastName}`,
        formattedValidFrom: this.formatDateTime(validFrom),
        formattedValidUntil: this.formatDateTime(validUntil),
      };

      return { success: true, pass: passRecord };
    } catch (err) {
      console.error('[AccessService] createVisitorAccessPass error:', err);
      return { success: false, error: 'Database error creating visitor access pass.' };
    }
  }

  /**
   * Retrieves an access pass by ID
   */
  public getPassById(passId: string): AccessPassRecord | null {
    const db = getDatabase();

    const row = db.prepare(`
      SELECT 
        ap.id,
        ap.pass_type as passType,
        ap.event_id as eventId,
        ap.host_staff_id as hostStaffId,
        ap.display_code as displayCode,
        ap.valid_from as validFrom,
        ap.valid_until as validUntil,
        ap.status,
        ap.max_uses as maxUses,
        ap.use_count as useCount,
        ap.created_by as createdBy,
        ap.created_at as createdAt,
        ap.updated_at as updatedAt,
        ap.revoked_at as revokedAt,
        ap.revoked_by as revokedBy,
        ap.revoke_reason as revokeReason,
        e.title as eventTitle,
        e.location as eventLocation,
        (u.first_name || ' ' || u.last_name) as creatorName,
        (ru.first_name || ' ' || ru.last_name) as revokerName
      FROM access_passes ap
      LEFT JOIN events e ON ap.event_id = e.id
      LEFT JOIN users u ON ap.created_by = u.id
      LEFT JOIN users ru ON ap.revoked_by = ru.id
      WHERE ap.id = ?
    `).get(passId) as unknown as AccessPassRecord | undefined;

    if (!row) return null;

    // Dynamically evaluate EXPIRED status if beyond validUntil
    let effectiveStatus = row.status;
    const now = new Date().toISOString();
    if (effectiveStatus === AccessPassStatus.ACTIVE) {
      if (now > row.validUntil) {
        effectiveStatus = AccessPassStatus.EXPIRED;
      } else if (row.maxUses !== null && row.maxUses !== undefined && row.useCount >= row.maxUses) {
        effectiveStatus = AccessPassStatus.EXHAUSTED;
      }
    }

    return {
      ...row,
      status: effectiveStatus,
      formattedValidFrom: this.formatDateTime(row.validFrom),
      formattedValidUntil: this.formatDateTime(row.validUntil),
    };
  }

  /**
   * Lists access passes for an event
   */
  public listEventAccessPasses(
    eventId: string,
    actor: SafeUser
  ): { passes: AccessPassRecord[]; total: number } {
    if (actor.role === UserRole.STAFF) {
      return { passes: [], total: 0 };
    }

    const db = getDatabase();
    const rows = db.prepare(`
      SELECT 
        ap.id,
        ap.pass_type as passType,
        ap.event_id as eventId,
        ap.host_staff_id as hostStaffId,
        ap.display_code as displayCode,
        ap.valid_from as validFrom,
        ap.valid_until as validUntil,
        ap.status,
        ap.max_uses as maxUses,
        ap.use_count as useCount,
        ap.created_by as createdBy,
        ap.created_at as createdAt,
        ap.updated_at as updatedAt,
        ap.revoked_at as revokedAt,
        ap.revoked_by as revokedBy,
        ap.revoke_reason as revokeReason,
        e.title as eventTitle,
        e.location as eventLocation,
        (u.first_name || ' ' || u.last_name) as creatorName,
        (ru.first_name || ' ' || ru.last_name) as revokerName
      FROM access_passes ap
      LEFT JOIN events e ON ap.event_id = e.id
      LEFT JOIN users u ON ap.created_by = u.id
      LEFT JOIN users ru ON ap.revoked_by = ru.id
      WHERE ap.event_id = ?
      ORDER BY ap.created_at DESC
    `).all(eventId) as unknown as AccessPassRecord[];

    const now = new Date().toISOString();
    const formatted = rows.map((row) => {
      let effectiveStatus = row.status;
      if (effectiveStatus === AccessPassStatus.ACTIVE) {
        if (now > row.validUntil) {
          effectiveStatus = AccessPassStatus.EXPIRED;
        } else if (row.maxUses !== null && row.maxUses !== undefined && row.useCount >= row.maxUses) {
          effectiveStatus = AccessPassStatus.EXHAUSTED;
        }
      }
      return {
        ...row,
        status: effectiveStatus,
        formattedValidFrom: this.formatDateTime(row.validFrom),
        formattedValidUntil: this.formatDateTime(row.validUntil),
      };
    });

    return { passes: formatted, total: formatted.length };
  }

  /**
   * Revokes an access pass with mandatory reason
   */
  public revokeAccessPass(
    passId: string,
    actor: SafeUser,
    reason: string,
    ipAddress?: string,
    userAgent?: string
  ): { success: boolean; pass?: AccessPassRecord; error?: string } {
    const trimmedReason = reason?.trim();
    if (!trimmedReason || trimmedReason.length < 3) {
      return { success: false, error: 'A revocation reason is required (minimum 3 characters).' };
    }

    const db = getDatabase();
    const pass = db.prepare('SELECT * FROM access_passes WHERE id = ?').get(passId) as
      | {
          id: string;
          status: string;
          display_code: string;
          pass_type: string;
          host_staff_id: string | null;
          created_by: string;
        }
      | undefined;

    if (!pass) {
      return { success: false, error: 'Access pass not found.' };
    }

    // Role check: ADMIN and SUPER_ADMIN can revoke any pass.
    // STAFF can only revoke their own VISITOR access passes.
    if (actor.role === UserRole.STAFF) {
      if (pass.pass_type !== PassType.VISITOR || pass.host_staff_id !== actor.id) {
        return { success: false, error: 'Staff members are not authorized to revoke this access pass.' };
      }
    }

    if (pass.status === AccessPassStatus.REVOKED) {
      return { success: false, error: 'This access pass has already been revoked.' };
    }

    const now = new Date().toISOString();
    try {
      db.prepare(`
        UPDATE access_passes
        SET status = ?, revoked_at = ?, revoked_by = ?, revoke_reason = ?, updated_at = ?
        WHERE id = ?
      `).run(AccessPassStatus.REVOKED, now, actor.id, trimmedReason, now, passId);

      auditService.log({
        actorId: actor.id,
        action: 'ACCESS_PASS_REVOKED',
        ipAddress,
        userAgent,
        metadata: {
          passId,
          displayCode: pass.display_code,
          passType: pass.pass_type,
          revocationReason: trimmedReason,
        },
      });

      const updated = this.getPassById(passId);
      return { success: true, pass: updated || undefined };
    } catch (err) {
      console.error('[AccessService] revokeAccessPass error:', err);
      return { success: false, error: 'Database error revoking access pass.' };
    }
  }

  /**
   * Authoritative server-side access pass verification
   * Normalizes input, checks rate limiting, enforces validity window, event state, and atomic use counting
   */
  public verifyAccessPass(input: {
    code?: string;
    token?: string;
    consumeUse?: boolean;
    ipAddress?: string;
    userAgent?: string;
    actor?: SafeUser | null;
  }): VerificationResult {
    const clientIp = input.ipAddress || 'unknown';

    // 1. Rate limiting check per IP
    if (!this.rateLimiter.checkLimit(clientIp)) {
      auditService.log({
        actorId: input.actor?.id || null,
        action: 'ACCESS_PASS_VERIFICATION_FAILED',
        ipAddress: clientIp,
        userAgent: input.userAgent,
        metadata: {
          reason: 'RATE_LIMITED',
        },
      });

      return {
        valid: false,
        code: 'RATE_LIMITED',
        message: 'Too many verification attempts. Please wait before retrying.',
      };
    }

    // 2. Normalize input identifier
    let tokenHashToQuery: string | null = null;
    let displayCodeToQuery: string | null = null;

    if (input.token && typeof input.token === 'string' && input.token.trim()) {
      tokenHashToQuery = this.hashToken(input.token);
    } else if (input.code && typeof input.code === 'string' && input.code.trim()) {
      displayCodeToQuery = this.normalizeCode(input.code);
    } else {
      return {
        valid: false,
        code: 'VALIDATION_ERROR',
        message: 'Valid access code or QR token is required for verification.',
      };
    }

    const db = getDatabase();

    // 3. Find corresponding pass
    let passRow:
      | {
          id: string;
          pass_type: PassType;
          event_id: string | null;
          host_staff_id: string | null;
          display_code: string;
          valid_from: string;
          valid_until: string;
          status: AccessPassStatus;
          max_uses: number | null;
          use_count: number;
        }
      | undefined;

    if (tokenHashToQuery) {
      passRow = db.prepare(`
        SELECT id, pass_type, event_id, host_staff_id, display_code,
               valid_from, valid_until, status, max_uses, use_count
        FROM access_passes
        WHERE token_hash = ?
      `).get(tokenHashToQuery) as typeof passRow;
    } else if (displayCodeToQuery) {
      passRow = db.prepare(`
        SELECT id, pass_type, event_id, host_staff_id, display_code,
               valid_from, valid_until, status, max_uses, use_count
        FROM access_passes
        WHERE display_code = ? COLLATE NOCASE
      `).get(displayCodeToQuery) as typeof passRow;
    }

    if (!passRow) {
      auditService.log({
        actorId: input.actor?.id || null,
        action: 'ACCESS_PASS_VERIFICATION_FAILED',
        ipAddress: clientIp,
        userAgent: input.userAgent,
        metadata: {
          reason: 'ACCESS_NOT_FOUND',
        },
      });

      return {
        valid: false,
        code: 'ACCESS_NOT_FOUND',
        message: 'Access pass not found or invalid.',
      };
    }

    // 4. Check revocation
    if (passRow.status === AccessPassStatus.REVOKED) {
      auditService.log({
        actorId: input.actor?.id || null,
        action: 'ACCESS_PASS_VERIFICATION_FAILED',
        ipAddress: clientIp,
        userAgent: input.userAgent,
        metadata: {
          passId: passRow.id,
          displayCode: passRow.display_code,
          reason: 'ACCESS_REVOKED',
        },
      });

      return {
        valid: false,
        code: 'ACCESS_REVOKED',
        message: 'This access pass has been revoked by an administrator.',
      };
    }

    // 5. Check server authoritative validity window
    const now = new Date().toISOString();

    if (now < passRow.valid_from) {
      auditService.log({
        actorId: input.actor?.id || null,
        action: 'ACCESS_PASS_VERIFICATION_FAILED',
        ipAddress: clientIp,
        userAgent: input.userAgent,
        metadata: {
          passId: passRow.id,
          displayCode: passRow.display_code,
          reason: 'ACCESS_NOT_YET_VALID',
        },
      });

      return {
        valid: false,
        code: 'ACCESS_NOT_YET_VALID',
        message: `This access pass is not yet valid. Access starts at ${this.formatDateTime(passRow.valid_from)}.`,
      };
    }

    if (now > passRow.valid_until) {
      auditService.log({
        actorId: input.actor?.id || null,
        action: 'ACCESS_PASS_VERIFICATION_FAILED',
        ipAddress: clientIp,
        userAgent: input.userAgent,
        metadata: {
          passId: passRow.id,
          displayCode: passRow.display_code,
          reason: 'ACCESS_EXPIRED',
        },
      });

      return {
        valid: false,
        code: 'ACCESS_EXPIRED',
        message: `This access pass expired on ${this.formatDateTime(passRow.valid_until)}.`,
      };
    }

    // 6. Check use limits
    if (passRow.max_uses !== null && passRow.use_count >= passRow.max_uses) {
      auditService.log({
        actorId: input.actor?.id || null,
        action: 'ACCESS_PASS_VERIFICATION_FAILED',
        ipAddress: clientIp,
        userAgent: input.userAgent,
        metadata: {
          passId: passRow.id,
          displayCode: passRow.display_code,
          reason: 'ACCESS_EXHAUSTED',
        },
      });

      return {
        valid: false,
        code: 'ACCESS_EXHAUSTED',
        message: 'This access pass has exhausted its allowed number of uses.',
      };
    }

    // 7. Verify associated event when pass_type === 'EVENT'
    let eventData: {
      id: string;
      title: string;
      location: string;
      startAt: string;
      endAt: string;
    } | null = null;

    if (passRow.pass_type === PassType.EVENT) {
      if (!passRow.event_id) {
        return {
          valid: false,
          code: 'EVENT_NOT_FOUND',
          message: 'Associated event record is missing.',
        };
      }

      const event = db.prepare('SELECT id, title, location, start_at, end_at, status FROM events WHERE id = ?').get(passRow.event_id) as
        | {
            id: string;
            title: string;
            location: string;
            start_at: string;
            end_at: string;
            status: string;
          }
        | undefined;

      if (!event) {
        auditService.log({
          actorId: input.actor?.id || null,
          action: 'ACCESS_PASS_VERIFICATION_FAILED',
          ipAddress: clientIp,
          userAgent: input.userAgent,
          metadata: {
            passId: passRow.id,
            reason: 'EVENT_NOT_FOUND',
          },
        });

        return {
          valid: false,
          code: 'EVENT_NOT_FOUND',
          message: 'The associated event could not be found.',
        };
      }

      if (event.status === EventStatus.CANCELLED) {
        auditService.log({
          actorId: input.actor?.id || null,
          action: 'ACCESS_PASS_VERIFICATION_FAILED',
          ipAddress: clientIp,
          userAgent: input.userAgent,
          metadata: {
            passId: passRow.id,
            eventId: event.id,
            reason: 'EVENT_CANCELLED',
          },
        });

        return {
          valid: false,
          code: 'EVENT_CANCELLED',
          message: 'The associated event has been cancelled.',
        };
      }

      if (event.status === EventStatus.COMPLETED) {
        auditService.log({
          actorId: input.actor?.id || null,
          action: 'ACCESS_PASS_VERIFICATION_FAILED',
          ipAddress: clientIp,
          userAgent: input.userAgent,
          metadata: {
            passId: passRow.id,
            eventId: event.id,
            reason: 'EVENT_COMPLETED',
          },
        });

        return {
          valid: false,
          code: 'EVENT_COMPLETED',
          message: 'The associated event has already concluded.',
        };
      }

      if (event.status !== EventStatus.APPROVED) {
        auditService.log({
          actorId: input.actor?.id || null,
          action: 'ACCESS_PASS_VERIFICATION_FAILED',
          ipAddress: clientIp,
          userAgent: input.userAgent,
          metadata: {
            passId: passRow.id,
            eventId: event.id,
            reason: 'EVENT_NOT_APPROVED',
          },
        });

        return {
          valid: false,
          code: 'EVENT_NOT_APPROVED',
          message: 'The associated event is not approved for access.',
        };
      }

      eventData = {
        id: event.id,
        title: event.title,
        location: event.location,
        startAt: event.start_at,
        endAt: event.end_at,
      };
    }

    let visitorData: {
      id: string;
      visitorName: string;
      hostStaffName: string;
      hostStaffDepartment?: string | null;
      visitDate: string;
      visitTime: string;
      purpose?: string | null;
      status: string;
    } | null = null;

    if (passRow.pass_type === PassType.VISITOR) {
      const visit = db.prepare(`
        SELECT vv.id, vv.visitor_full_name, vv.purpose, vv.status, vv.valid_from, vv.valid_until,
               u.first_name as host_first_name, u.last_name as host_last_name, u.department as host_department
        FROM visitor_visits vv
        LEFT JOIN users u ON vv.host_staff_id = u.id
        WHERE vv.access_pass_id = ?
      `).get(passRow.id) as any;

      if (visit) {
        if (visit.status === 'CANCELLED') {
          auditService.log({
            actorId: input.actor?.id || null,
            action: 'ACCESS_PASS_VERIFICATION_FAILED',
            ipAddress: clientIp,
            userAgent: input.userAgent,
            metadata: {
              passId: passRow.id,
              visitId: visit.id,
              reason: 'VISIT_CANCELLED',
            },
          });

          return {
            valid: false,
            code: 'VISIT_CANCELLED',
            message: 'The associated visitor invitation has been cancelled.',
          };
        }

        visitorData = {
          id: visit.id,
          visitorName: visit.visitor_full_name,
          hostStaffName: `${visit.host_first_name || ''} ${visit.host_last_name || ''}`.trim() || 'Staff Member',
          hostStaffDepartment: visit.host_department || null,
          visitDate: formatDateInTimezone(visit.valid_from),
          visitTime: `${formatTimeInTimezone(visit.valid_from)} - ${formatTimeInTimezone(visit.valid_until)}`,
          purpose: visit.purpose || null,
          status: visit.status,
        };
      }
    }

    // 8. Atomic use consumption if requested
    let finalUseCount = passRow.use_count;
    if (input.consumeUse) {
      const updateResult = db.prepare(`
        UPDATE access_passes
        SET use_count = use_count + 1,
            status = CASE WHEN max_uses IS NOT NULL AND use_count + 1 >= max_uses THEN 'EXHAUSTED' ELSE status END,
            updated_at = ?
        WHERE id = ?
          AND (max_uses IS NULL OR use_count < max_uses)
          AND status = 'ACTIVE'
          AND valid_from <= ?
          AND valid_until >= ?
      `).run(now, passRow.id, now, now);

      if (updateResult.changes === 0) {
        // Concurrency safeguard: another request consumed the last use
        auditService.log({
          actorId: input.actor?.id || null,
          action: 'ACCESS_PASS_VERIFICATION_FAILED',
          ipAddress: clientIp,
          userAgent: input.userAgent,
          metadata: {
            passId: passRow.id,
            reason: 'ACCESS_EXHAUSTED',
          },
        });

        return {
          valid: false,
          code: 'ACCESS_EXHAUSTED',
          message: 'This access pass has exhausted its allowed number of uses.',
        };
      }

      finalUseCount += 1;
    }

    // 9. Audit log successful verification
    auditService.log({
      actorId: input.actor?.id || null,
      action: 'ACCESS_PASS_VERIFICATION_SUCCESS',
      ipAddress: clientIp,
      userAgent: input.userAgent,
      metadata: {
        passId: passRow.id,
        passType: passRow.pass_type,
        displayCode: passRow.display_code,
        eventId: passRow.event_id,
        consumed: !!input.consumeUse,
        newUseCount: finalUseCount,
      },
    });

    const remainingUses = passRow.max_uses !== null ? Math.max(0, passRow.max_uses - finalUseCount) : null;

    // Check if pass is linked to an invitee
    let inviteeData: { id: string; fullName: string; organization?: string | null } | null = null;
    const inviteeRow = db.prepare('SELECT id, full_name, organization FROM event_invitees WHERE access_pass_id = ?').get(passRow.id) as
      | { id: string; full_name: string; organization: string | null }
      | undefined;
    if (inviteeRow) {
      inviteeData = {
        id: inviteeRow.id,
        fullName: inviteeRow.full_name,
        organization: inviteeRow.organization,
      };
    }

    // 10. Return clean verification result
    return {
      valid: true,
      passType: passRow.pass_type,
      displayCode: passRow.display_code,
      event: eventData,
      invitee: inviteeData,
      visitor: visitorData,
      validFrom: passRow.valid_from,
      validUntil: passRow.valid_until,
      maxUses: passRow.max_uses,
      useCount: finalUseCount,
      remainingUses,
    };
  }

  /**
   * Resets rate limiter (useful for test suites)
   */
  public resetRateLimiter(): void {
    this.rateLimiter.clearAll();
  }
}

export const accessService = new AccessService();
