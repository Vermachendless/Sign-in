import { dbAdapter, type DbAdapter } from '../db/adapter.ts';
import { generateId } from '../utils/crypto.ts';
import { auditService } from './audit.service.ts';
import { accessService } from './access.service.ts';
import {
  EventInviteeRecord,
  InviteeStatus,
  CreateInviteeInput,
  UpdateInviteeInput,
  EventInviteesSummary,
  SafeUser,
  UserRole,
  EventStatus,
  AccessPassRecord,
  AccessPassStatus,
} from '../../src/types/index.ts';

export class InviteeService {
  /**
   * Helper to normalize strings (trim and convert empty strings to null)
   */
  private normalizeString(val?: string | null): string | null {
    if (!val) return null;
    const trimmed = val.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  /**
   * Helper to validate and normalize email
   */
  private normalizeEmail(val?: string | null): string | null {
    const str = this.normalizeString(val);
    if (!str) return null;
    return str.toLowerCase();
  }

  /**
   * Validates email format if provided
   */
  public isValidEmail(email: string): boolean {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  }

  /**
   * Maps a raw database row from event_invitees (with optional joined access_pass/user fields)
   * to a clean, strongly-typed EventInviteeRecord.
   */
  private mapInviteeRecord(r: any): EventInviteeRecord {
    const accessPassId = r.accessPassId ?? r.access_pass_id ?? null;
    let passRecord: AccessPassRecord | null = null;
    if (accessPassId) {
      const validFrom = r.passValidFrom ?? r.pass_valid_from ?? '';
      const validUntil = r.passValidUntil ?? r.pass_valid_until ?? '';
      passRecord = {
        id: accessPassId,
        passType: 'EVENT' as any,
        eventId: r.eventId ?? r.event_id,
        displayCode: r.passDisplayCode ?? r.pass_display_code ?? '',
        validFrom,
        validUntil,
        status: (r.passStatus ?? r.pass_status) || AccessPassStatus.ACTIVE,
        maxUses: r.passMaxUses ?? r.pass_max_uses ?? null,
        useCount: r.passUseCount ?? r.pass_use_count ?? 0,
        createdBy: r.invitedBy ?? r.invited_by,
        createdAt: r.createdAt ?? r.created_at,
        updatedAt: r.updatedAt ?? r.updated_at,
        revokedAt: r.passRevokedAt ?? r.pass_revoked_at ?? null,
        revokeReason: r.passRevokeReason ?? r.pass_revoke_reason ?? null,
        formattedValidFrom: accessService.formatDateTime(validFrom),
        formattedValidUntil: accessService.formatDateTime(validUntil),
      };
    }

    return {
      id: r.id,
      eventId: r.eventId ?? r.event_id,
      fullName: r.fullName ?? r.full_name,
      phone: r.phone ?? null,
      email: r.email ?? null,
      organization: r.organization ?? null,
      notes: r.notes ?? null,
      status: (r.status as InviteeStatus) || InviteeStatus.INVITED,
      accessPassId,
      invitedBy: r.invitedBy ?? r.invited_by,
      createdAt: r.createdAt ?? r.created_at,
      updatedAt: r.updatedAt ?? r.updated_at,
      invitedByName: r.invitedByName ?? r.invited_by_name ?? undefined,
      accessPass: passRecord,
    };
  }

  /**
   * Lists invitees for an event with search, status filtering, and summary metrics
   */
  public async listInvitees(
    eventId: string,
    actor: SafeUser,
    options?: {
      search?: string;
      status?: string;
      page?: number;
      limit?: number;
    }
  ): Promise<{
    success: boolean;
    invitees: EventInviteeRecord[];
    total: number;
    page: number;
    limit: number;
    summary: EventInviteesSummary;
    error?: string;
  }> {
    // 1. RBAC Check: STAFF cannot manage invitees
    if (actor.role === UserRole.STAFF) {
      return {
        success: false,
        invitees: [],
        total: 0,
        page: 1,
        limit: 20,
        summary: { total: 0, accessIssued: 0, cancelled: 0, invited: 0 },
        error: 'Forbidden: Staff members are not authorized to view or manage invitees.',
      };
    }

    // 2. Verify event exists
    const event = await dbAdapter.queryOne<{ id: string; title: string }>(
      'SELECT id, title FROM events WHERE id = $1',
      [eventId]
    );
    if (!event) {
      return {
        success: false,
        invitees: [],
        total: 0,
        page: 1,
        limit: 20,
        summary: { total: 0, accessIssued: 0, cancelled: 0, invited: 0 },
        error: 'Event not found.',
      };
    }

    // 3. Compute summary counts for this event
    const summaryRow = await dbAdapter.queryOne<{
      total?: number;
      accessIssued?: number;
      accessissued?: number;
      cancelled?: number;
      invited?: number;
    }>(
      `
      SELECT 
        COUNT(*) as "total",
        COUNT(CASE WHEN status = 'ACCESS_ISSUED' THEN 1 END) as "accessIssued",
        COUNT(CASE WHEN status = 'CANCELLED' THEN 1 END) as "cancelled",
        COUNT(CASE WHEN status = 'INVITED' THEN 1 END) as "invited"
      FROM event_invitees
      WHERE event_id = $1
    `,
      [eventId]
    );

    const summary: EventInviteesSummary = {
      total: Number(summaryRow?.total || 0),
      accessIssued: Number(summaryRow?.accessIssued ?? summaryRow?.accessissued ?? 0),
      cancelled: Number(summaryRow?.cancelled || 0),
      invited: Number(summaryRow?.invited || 0),
    };

    // 4. Construct filtered query
    let whereClause = 'ei.event_id = $1';
    const params: (string | number)[] = [eventId];
    let pIdx = 2;

    // Status filter
    if (options?.status && Object.values(InviteeStatus).includes(options.status as InviteeStatus)) {
      whereClause += ` AND ei.status = $${pIdx++}`;
      params.push(options.status);
    }

    // Search filter (name, email, organization)
    if (options?.search && options.search.trim()) {
      const term = `%${options.search.trim()}%`;
      whereClause += ` AND (ei.full_name LIKE $${pIdx++} OR ei.email LIKE $${pIdx++} OR ei.organization LIKE $${pIdx++})`;
      params.push(term, term, term);
    }

    // Pagination
    const page = Math.max(1, options?.page || 1);
    const limit = Math.min(100, Math.max(1, options?.limit || 20));
    const offset = (page - 1) * limit;

    const countSql = `SELECT COUNT(*) as count FROM event_invitees ei WHERE ${whereClause}`;
    const countRow = await dbAdapter.queryOne<{ count: number }>(countSql, [...params]);
    const total = Number(countRow?.count || 0);

    const dataParams: (string | number)[] = [...params, limit, offset];
    const limitPlaceholder = `$${pIdx++}`;
    const offsetPlaceholder = `$${pIdx++}`;

    const dataSql = `
      SELECT 
        ei.id,
        ei.event_id as "eventId",
        ei.full_name as "fullName",
        ei.phone,
        ei.email,
        ei.organization,
        ei.notes,
        ei.status,
        ei.access_pass_id as "accessPassId",
        ei.invited_by as "invitedBy",
        ei.created_at as "createdAt",
        ei.updated_at as "updatedAt",
        (u.first_name || ' ' || u.last_name) as "invitedByName",
        ap.display_code as "passDisplayCode",
        ap.status as "passStatus",
        ap.valid_from as "passValidFrom",
        ap.valid_until as "passValidUntil",
        ap.max_uses as "passMaxUses",
        ap.use_count as "passUseCount",
        ap.revoked_at as "passRevokedAt",
        ap.revoke_reason as "passRevokeReason"
      FROM event_invitees ei
      LEFT JOIN users u ON ei.invited_by = u.id
      LEFT JOIN access_passes ap ON ei.access_pass_id = ap.id
      WHERE ${whereClause}
      ORDER BY ei.created_at DESC
      LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}
    `;

    const rows = await dbAdapter.query<any>(dataSql, dataParams);
    const invitees: EventInviteeRecord[] = rows.map((r) => this.mapInviteeRecord(r));

    return {
      success: true,
      invitees,
      total,
      page,
      limit,
      summary,
    };
  }

  /**
   * Retrieves single invitee by ID ensuring cross-event protection
   */
  public async getInviteeById(
    eventId: string,
    inviteeId: string,
    actor: SafeUser,
    txClient?: DbAdapter
  ): Promise<{ success: boolean; invitee?: EventInviteeRecord; error?: string; status?: number }> {
    if (actor.role === UserRole.STAFF) {
      return { success: false, error: 'Forbidden: Staff members cannot access invitees.', status: 403 };
    }

    const db = txClient || dbAdapter;

    // Cross-event query: verify event_id matches
    const row = await db.queryOne<any>(
      `
      SELECT 
        ei.id,
        ei.event_id as "eventId",
        ei.full_name as "fullName",
        ei.phone,
        ei.email,
        ei.organization,
        ei.notes,
        ei.status,
        ei.access_pass_id as "accessPassId",
        ei.invited_by as "invitedBy",
        ei.created_at as "createdAt",
        ei.updated_at as "updatedAt",
        (u.first_name || ' ' || u.last_name) as "invitedByName",
        ap.display_code as "passDisplayCode",
        ap.status as "passStatus",
        ap.valid_from as "passValidFrom",
        ap.valid_until as "passValidUntil",
        ap.max_uses as "passMaxUses",
        ap.use_count as "passUseCount",
        ap.revoked_at as "passRevokedAt",
        ap.revoke_reason as "passRevokeReason"
      FROM event_invitees ei
      LEFT JOIN users u ON ei.invited_by = u.id
      LEFT JOIN access_passes ap ON ei.access_pass_id = ap.id
      WHERE ei.id = $1 AND ei.event_id = $2
    `,
      [inviteeId, eventId]
    );

    if (!row) {
      // Check if invitee exists on another event to detect cross-event attempt
      const other = await dbAdapter.queryOne<{ event_id: string }>(
        'SELECT event_id FROM event_invitees WHERE id = $1',
        [inviteeId]
      );
      if (other) {
        return {
          success: false,
          error: 'Cross-event access violation: Invitee does not belong to specified event.',
          status: 403,
        };
      }
      return { success: false, error: 'Invitee not found.', status: 404 };
    }

    return {
      success: true,
      invitee: this.mapInviteeRecord(row),
    };
  }

  /**
   * Adds an invitee to an APPROVED event
   */
  public async createInvitee(
    eventId: string,
    actor: SafeUser,
    input: CreateInviteeInput,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ success: boolean; invitee?: EventInviteeRecord; error?: string; status?: number }> {
    // 1. RBAC check
    if (actor.role === UserRole.STAFF) {
      return { success: false, error: 'Forbidden: Staff members cannot add invitees.', status: 403 };
    }

    // 2. Event check: MUST exist and be APPROVED
    const event = await dbAdapter.queryOne<{ id: string; title: string; status: string }>(
      'SELECT id, title, status FROM events WHERE id = $1',
      [eventId]
    );

    if (!event) {
      return { success: false, error: 'Event not found.', status: 404 };
    }

    if (event.status !== EventStatus.APPROVED) {
      return {
        success: false,
        error: `Invitees may only be added to APPROVED events. Current event status is "${event.status}".`,
        status: 400,
      };
    }

    // 3. Input validation & normalization
    const fullName = this.normalizeString(input.fullName);
    if (!fullName) {
      return { success: false, error: 'Full name is required.', status: 400 };
    }

    const phone = this.normalizeString(input.phone);
    const email = this.normalizeEmail(input.email);
    const organization = this.normalizeString(input.organization);
    const notes = this.normalizeString(input.notes);

    if (email && !this.isValidEmail(email)) {
      return { success: false, error: 'Please provide a valid email address.', status: 400 };
    }

    // 4. Duplicate email detection for non-cancelled invitees in this event
    if (email) {
      const duplicate = await dbAdapter.queryOne<{ id: string }>(
        `
        SELECT id FROM event_invitees 
        WHERE event_id = $1 AND LOWER(email) = LOWER($2) AND status != 'CANCELLED'
      `,
        [eventId, email]
      );

      if (duplicate) {
        return {
          success: false,
          error: `An invitee with email "${email}" has already been added to this event.`,
          status: 409,
        };
      }
    }

    // 5. Insert new invitee
    const id = generateId();
    const nowIso = new Date().toISOString();

    try {
      await dbAdapter.execute(
        `
        INSERT INTO event_invitees (
          id, event_id, full_name, phone, email, organization, notes,
          status, access_pass_id, invited_by, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `,
        [
          id,
          eventId,
          fullName,
          phone,
          email,
          organization,
          notes,
          InviteeStatus.INVITED,
          null,
          actor.id,
          nowIso,
          nowIso,
        ]
      );

      // 6. Audit logging (Zero raw credentials/secrets)
      await auditService.log({
        actorId: actor.id,
        action: 'EVENT_INVITEE_CREATED',
        ipAddress,
        userAgent,
        metadata: {
          eventId,
          eventTitle: event.title,
          inviteeId: id,
          fullName,
          email,
          organization,
        },
      });

      const result = await this.getInviteeById(eventId, id, actor);
      return { success: true, invitee: result.invitee };
    } catch (err) {
      console.error('[InviteeService] createInvitee error:', err);
      return { success: false, error: 'Database error creating invitee.', status: 500 };
    }
  }

  /**
   * Updates an existing invitee
   */
  public async updateInvitee(
    eventId: string,
    inviteeId: string,
    actor: SafeUser,
    input: UpdateInviteeInput,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ success: boolean; invitee?: EventInviteeRecord; error?: string; status?: number }> {
    if (actor.role === UserRole.STAFF) {
      return { success: false, error: 'Forbidden: Staff members cannot update invitees.', status: 403 };
    }

    // Verify invitee belongs to event
    const existing = await dbAdapter.queryOne<any>(
      'SELECT * FROM event_invitees WHERE id = $1 AND event_id = $2',
      [inviteeId, eventId]
    );
    if (!existing) {
      const other = await dbAdapter.queryOne<{ event_id: string }>(
        'SELECT event_id FROM event_invitees WHERE id = $1',
        [inviteeId]
      );
      if (other) {
        return { success: false, error: 'Cross-event access violation.', status: 403 };
      }
      return { success: false, error: 'Invitee not found.', status: 404 };
    }

    if (existing.status === InviteeStatus.CANCELLED) {
      return { success: false, error: 'Cannot update a cancelled invitee.', status: 400 };
    }

    const fullName = input.fullName !== undefined ? this.normalizeString(input.fullName) : existing.full_name;
    if (input.fullName !== undefined && !fullName) {
      return { success: false, error: 'Full name cannot be empty.', status: 400 };
    }

    const phone = input.phone !== undefined ? this.normalizeString(input.phone) : existing.phone;
    const email = input.email !== undefined ? this.normalizeEmail(input.email) : existing.email;
    const organization =
      input.organization !== undefined ? this.normalizeString(input.organization) : existing.organization;
    const notes = input.notes !== undefined ? this.normalizeString(input.notes) : existing.notes;

    if (email && !this.isValidEmail(email)) {
      return { success: false, error: 'Please provide a valid email address.', status: 400 };
    }

    // Duplicate email check
    if (email) {
      const duplicate = await dbAdapter.queryOne<{ id: string }>(
        `
        SELECT id FROM event_invitees 
        WHERE event_id = $1 AND LOWER(email) = LOWER($2) AND id != $3 AND status != 'CANCELLED'
      `,
        [eventId, email, inviteeId]
      );

      if (duplicate) {
        return {
          success: false,
          error: `An invitee with email "${email}" already exists for this event.`,
          status: 409,
        };
      }
    }

    const nowIso = new Date().toISOString();

    try {
      await dbAdapter.execute(
        `
        UPDATE event_invitees 
        SET full_name = $1, phone = $2, email = $3, organization = $4, notes = $5, updated_at = $6
        WHERE id = $7 AND event_id = $8
      `,
        [fullName, phone, email, organization, notes, nowIso, inviteeId, eventId]
      );

      await auditService.log({
        actorId: actor.id,
        action: 'EVENT_INVITEE_UPDATED',
        ipAddress,
        userAgent,
        metadata: {
          eventId,
          inviteeId,
          fullName,
          email,
          organization,
        },
      });

      const updated = await this.getInviteeById(eventId, inviteeId, actor);
      return { success: true, invitee: updated.invitee };
    } catch (err) {
      console.error('[InviteeService] updateInvitee error:', err);
      return { success: false, error: 'Database error updating invitee.', status: 500 };
    }
  }

  /**
   * Generates individual access pass for an invitee using AccessService
   * Strictly enforces event validity window (event.start_at -> event.end_at) and single use
   */
  public async generateInviteeAccessPass(
    eventId: string,
    inviteeId: string,
    actor: SafeUser,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{
    success: boolean;
    invitee?: EventInviteeRecord;
    pass?: AccessPassRecord;
    error?: string;
    status?: number;
  }> {
    if (actor.role === UserRole.STAFF) {
      return { success: false, error: 'Forbidden: Staff cannot issue access passes.', status: 403 };
    }

    try {
      return await dbAdapter.transaction(async (tx) => {
        // 1. Verify Event
        const event = await tx.queryOne<{
          id: string;
          title: string;
          location: string;
          start_at: string;
          end_at: string;
          status: string;
        }>('SELECT id, title, location, start_at, end_at, status FROM events WHERE id = $1', [eventId]);

        if (!event) {
          return { success: false, error: 'Event not found.', status: 404 };
        }

        if (event.status !== EventStatus.APPROVED) {
          return {
            success: false,
            error: `Cannot issue access pass: Event must be APPROVED. Current status is "${event.status}".`,
            status: 400,
          };
        }

        // 2. Verify Invitee and cross-event boundary
        const invitee = await tx.queryOne<any>(
          'SELECT * FROM event_invitees WHERE id = $1 AND event_id = $2',
          [inviteeId, eventId]
        );
        if (!invitee) {
          const other = await tx.queryOne<{ event_id: string }>(
            'SELECT event_id FROM event_invitees WHERE id = $1',
            [inviteeId]
          );
          if (other) {
            return { success: false, error: 'Cross-event access violation.', status: 403 };
          }
          return { success: false, error: 'Invitee not found.', status: 404 };
        }

        if (invitee.status === InviteeStatus.CANCELLED) {
          return { success: false, error: 'Cannot issue an access pass for a cancelled invitee.', status: 400 };
        }

        // 3. Generate individual EVENT access pass via AccessService participating in tx
        // Strictly adheres to event.start_at -> event.end_at and maxUses = 1
        const passResult = await accessService.createEventAccessPass(
          actor,
          event.id,
          {
            validFrom: event.start_at,
            validUntil: event.end_at,
            maxUses: 1, // Single-use individual invitee pass
          },
          ipAddress,
          userAgent,
          tx
        );

        if (!passResult.success || !passResult.pass) {
          throw new Error(passResult.error || 'Failed to generate access pass.');
        }

        const nowIso = new Date().toISOString();

        // 4. Update invitee record to link pass and set status to ACCESS_ISSUED on tx
        await tx.execute(
          `
          UPDATE event_invitees 
          SET access_pass_id = $1, status = $2, updated_at = $3
          WHERE id = $4 AND event_id = $5
        `,
          [passResult.pass.id, InviteeStatus.ACCESS_ISSUED, nowIso, inviteeId, eventId]
        );

        // 5. Audit log (Non-transactional, compliant with AuditLogResult contract; zero raw secrets)
        await auditService.log({
          actorId: actor.id,
          action: 'EVENT_INVITEE_ACCESS_ISSUED',
          ipAddress,
          userAgent,
          metadata: {
            eventId,
            eventTitle: event.title,
            inviteeId,
            inviteeName: invitee.full_name,
            passId: passResult.pass.id,
            displayCode: passResult.pass.displayCode,
            validFrom: passResult.pass.validFrom,
            validUntil: passResult.pass.validUntil,
          },
        });

        const updatedInvitee = await this.getInviteeById(eventId, inviteeId, actor, tx);
        return {
          success: true,
          invitee: updatedInvitee.invitee,
          pass: passResult.pass,
        };
      });
    } catch (err: any) {
      console.error('[InviteeService] generateInviteeAccessPass error:', err.message || err);
      return { success: false, error: err.message || 'Database error linking access pass.', status: 500 };
    }
  }

  /**
   * Revokes an invitee's access pass while retaining the historical invitee record
   * Both access_passes update and event_invitees status update participate in a shared transaction
   */
  public async revokeInviteeAccess(
    eventId: string,
    inviteeId: string,
    actor: SafeUser,
    reason?: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ success: boolean; invitee?: EventInviteeRecord; error?: string; status?: number }> {
    if (actor.role === UserRole.STAFF) {
      return { success: false, error: 'Forbidden: Staff cannot revoke access.', status: 403 };
    }

    try {
      return await dbAdapter.transaction(async (tx) => {
        // Cross-event verification on tx
        const invitee = await tx.queryOne<any>(
          'SELECT * FROM event_invitees WHERE id = $1 AND event_id = $2',
          [inviteeId, eventId]
        );
        if (!invitee) {
          const other = await tx.queryOne<{ event_id: string }>(
            'SELECT event_id FROM event_invitees WHERE id = $1',
            [inviteeId]
          );
          if (other) {
            return { success: false, error: 'Cross-event access violation.', status: 403 };
          }
          return { success: false, error: 'Invitee not found.', status: 404 };
        }

        const accessPassId = invitee.access_pass_id || invitee.accessPassId;
        if (!accessPassId) {
          return { success: false, error: 'Invitee does not have an active access pass.', status: 400 };
        }

        const revokeReason = reason?.trim() || 'Invitee access revoked by administrator';

        // Revoke the pass using AccessService revocation participating in tx
        const revokeResult = await accessService.revokeAccessPass(
          accessPassId,
          actor,
          revokeReason,
          ipAddress,
          userAgent,
          tx
        );

        if (!revokeResult.success) {
          throw new Error(revokeResult.error || 'Failed to revoke access pass.');
        }

        const nowIso = new Date().toISOString();

        // Revert status to INVITED while retaining invitee record on tx
        await tx.execute(
          `
          UPDATE event_invitees
          SET status = $1, updated_at = $2
          WHERE id = $3 AND event_id = $4
        `,
          [InviteeStatus.INVITED, nowIso, inviteeId, eventId]
        );

        await auditService.log({
          actorId: actor.id,
          action: 'EVENT_INVITEE_ACCESS_REVOKED',
          ipAddress,
          userAgent,
          metadata: {
            eventId,
            inviteeId,
            inviteeName: invitee.full_name,
            accessPassId,
            reason: revokeReason,
          },
        });

        const updated = await this.getInviteeById(eventId, inviteeId, actor, tx);
        return { success: true, invitee: updated.invitee };
      });
    } catch (err: any) {
      console.error('[InviteeService] revokeInviteeAccess error:', err.message || err);
      return { success: false, error: err.message || 'Database error updating invitee after revocation.', status: 500 };
    }
  }

  /**
   * Cancels an invitee: changes status to CANCELLED, revokes any active pass, retains record, and audits
   * Both pass revocation and invitee status update participate in a shared transaction
   */
  public async cancelInvitee(
    eventId: string,
    inviteeId: string,
    actor: SafeUser,
    reason?: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ success: boolean; invitee?: EventInviteeRecord; error?: string; status?: number }> {
    if (actor.role === UserRole.STAFF) {
      return { success: false, error: 'Forbidden: Staff cannot cancel invitees.', status: 403 };
    }

    try {
      return await dbAdapter.transaction(async (tx) => {
        // Cross-event verification on tx
        const invitee = await tx.queryOne<any>(
          'SELECT * FROM event_invitees WHERE id = $1 AND event_id = $2',
          [inviteeId, eventId]
        );
        if (!invitee) {
          const other = await tx.queryOne<{ event_id: string }>(
            'SELECT event_id FROM event_invitees WHERE id = $1',
            [inviteeId]
          );
          if (other) {
            return { success: false, error: 'Cross-event access violation.', status: 403 };
          }
          return { success: false, error: 'Invitee not found.', status: 404 };
        }

        if (invitee.status === InviteeStatus.CANCELLED) {
          return { success: false, error: 'Invitee is already cancelled.', status: 400 };
        }

        const cancelReason = reason?.trim() || 'Invitee cancelled by administrator';

        const accessPassId = invitee.access_pass_id || invitee.accessPassId;
        // If there is an associated pass that is ACTIVE, revoke it on tx
        if (accessPassId) {
          const pass = await tx.queryOne<{ status: string }>(
            'SELECT status FROM access_passes WHERE id = $1',
            [accessPassId]
          );
          if (pass && pass.status === AccessPassStatus.ACTIVE) {
            const revokeRes = await accessService.revokeAccessPass(
              accessPassId,
              actor,
              `Cancelled invitee: ${cancelReason}`,
              ipAddress,
              userAgent,
              tx
            );
            if (!revokeRes.success) {
              throw new Error(revokeRes.error || 'Failed to revoke active pass during cancellation.');
            }
          }
        }

        const nowIso = new Date().toISOString();

        await tx.execute(
          `
          UPDATE event_invitees
          SET status = $1, updated_at = $2
          WHERE id = $3 AND event_id = $4
        `,
          [InviteeStatus.CANCELLED, nowIso, inviteeId, eventId]
        );

        await auditService.log({
          actorId: actor.id,
          action: 'EVENT_INVITEE_CANCELLED',
          ipAddress,
          userAgent,
          metadata: {
            eventId,
            inviteeId,
            inviteeName: invitee.full_name,
            previousStatus: invitee.status,
            accessPassId,
            reason: cancelReason,
          },
        });

        const updated = await this.getInviteeById(eventId, inviteeId, actor, tx);
        return { success: true, invitee: updated.invitee };
      });
    } catch (err: any) {
      console.error('[InviteeService] cancelInvitee error:', err.message || err);
      return { success: false, error: err.message || 'Database error cancelling invitee.', status: 500 };
    }
  }
}

export const inviteeService = new InviteeService();
