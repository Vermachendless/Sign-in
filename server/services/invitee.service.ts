import { getDatabase } from '../db/index.ts';
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
   * Lists invitees for an event with search, status filtering, and summary metrics
   */
  public listInvitees(
    eventId: string,
    actor: SafeUser,
    options?: {
      search?: string;
      status?: string;
      page?: number;
      limit?: number;
    }
  ): {
    success: boolean;
    invitees: EventInviteeRecord[];
    total: number;
    page: number;
    limit: number;
    summary: EventInviteesSummary;
    error?: string;
  } {
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

    const db = getDatabase();

    // 2. Verify event exists
    const event = db.prepare('SELECT id, title FROM events WHERE id = ?').get(eventId);
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
    const summaryRow = db.prepare(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'ACCESS_ISSUED' THEN 1 END) as accessIssued,
        COUNT(CASE WHEN status = 'CANCELLED' THEN 1 END) as cancelled,
        COUNT(CASE WHEN status = 'INVITED' THEN 1 END) as invited
      FROM event_invitees
      WHERE event_id = ?
    `).get(eventId) as { total: number; accessIssued: number; cancelled: number; invited: number };

    const summary: EventInviteesSummary = {
      total: Number(summaryRow?.total || 0),
      accessIssued: Number(summaryRow?.accessIssued || 0),
      cancelled: Number(summaryRow?.cancelled || 0),
      invited: Number(summaryRow?.invited || 0),
    };

    // 4. Construct filtered query
    let countSql = 'SELECT COUNT(*) as count FROM event_invitees ei WHERE ei.event_id = ?';
    let dataSql = `
      SELECT 
        ei.id,
        ei.event_id as eventId,
        ei.full_name as fullName,
        ei.phone,
        ei.email,
        ei.organization,
        ei.notes,
        ei.status,
        ei.access_pass_id as accessPassId,
        ei.invited_by as invitedBy,
        ei.created_at as createdAt,
        ei.updated_at as updatedAt,
        (u.first_name || ' ' || u.last_name) as invitedByName,
        ap.display_code as passDisplayCode,
        ap.status as passStatus,
        ap.valid_from as passValidFrom,
        ap.valid_until as passValidUntil,
        ap.max_uses as passMaxUses,
        ap.use_count as passUseCount,
        ap.revoked_at as passRevokedAt,
        ap.revoke_reason as passRevokeReason
      FROM event_invitees ei
      LEFT JOIN users u ON ei.invited_by = u.id
      LEFT JOIN access_passes ap ON ei.access_pass_id = ap.id
      WHERE ei.event_id = ?
    `;

    const params: (string | number)[] = [eventId];

    // Status filter
    if (options?.status && Object.values(InviteeStatus).includes(options.status as InviteeStatus)) {
      countSql += ' AND ei.status = ?';
      dataSql += ' AND ei.status = ?';
      params.push(options.status);
    }

    // Search filter (name, email, organization)
    if (options?.search && options.search.trim()) {
      const term = `%${options.search.trim()}%`;
      countSql += ' AND (ei.full_name LIKE ? OR ei.email LIKE ? OR ei.organization LIKE ?)';
      dataSql += ' AND (ei.full_name LIKE ? OR ei.email LIKE ? OR ei.organization LIKE ?)';
      params.push(term, term, term);
    }

    // Pagination
    const page = Math.max(1, options?.page || 1);
    const limit = Math.min(100, Math.max(1, options?.limit || 20));
    const offset = (page - 1) * limit;

    const countRow = db.prepare(countSql).get(...params) as { count: number };
    const total = Number(countRow?.count || 0);

    dataSql += ' ORDER BY ei.created_at DESC LIMIT ? OFFSET ?';
    const dataParams: (string | number)[] = [...params, limit, offset];

    const rows = db.prepare(dataSql).all(...dataParams) as any[];

    const invitees: EventInviteeRecord[] = rows.map((r) => {
      let passRecord: AccessPassRecord | null = null;
      if (r.accessPassId) {
        passRecord = {
          id: r.accessPassId,
          passType: 'EVENT' as any,
          eventId: r.eventId,
          displayCode: r.passDisplayCode || '',
          validFrom: r.passValidFrom || '',
          validUntil: r.passValidUntil || '',
          status: r.passStatus || AccessPassStatus.ACTIVE,
          maxUses: r.passMaxUses,
          useCount: r.passUseCount || 0,
          createdBy: r.invitedBy,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          revokedAt: r.passRevokedAt,
          revokeReason: r.passRevokeReason,
          formattedValidFrom: accessService.formatDateTime(r.passValidFrom),
          formattedValidUntil: accessService.formatDateTime(r.passValidUntil),
        };
      }

      return {
        id: r.id,
        eventId: r.eventId,
        fullName: r.fullName,
        phone: r.phone,
        email: r.email,
        organization: r.organization,
        notes: r.notes,
        status: r.status as InviteeStatus,
        accessPassId: r.accessPassId,
        invitedBy: r.invitedBy,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        invitedByName: r.invitedByName,
        accessPass: passRecord,
      };
    });

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
  public getInviteeById(
    eventId: string,
    inviteeId: string,
    actor: SafeUser
  ): { success: boolean; invitee?: EventInviteeRecord; error?: string; status?: number } {
    if (actor.role === UserRole.STAFF) {
      return { success: false, error: 'Forbidden: Staff members cannot access invitees.', status: 403 };
    }

    const db = getDatabase();

    // Cross-event query: verify event_id matches
    const row = db.prepare(`
      SELECT 
        ei.id,
        ei.event_id as eventId,
        ei.full_name as fullName,
        ei.phone,
        ei.email,
        ei.organization,
        ei.notes,
        ei.status,
        ei.access_pass_id as accessPassId,
        ei.invited_by as invitedBy,
        ei.created_at as createdAt,
        ei.updated_at as updatedAt,
        (u.first_name || ' ' || u.last_name) as invitedByName,
        ap.display_code as passDisplayCode,
        ap.status as passStatus,
        ap.valid_from as passValidFrom,
        ap.valid_until as passValidUntil,
        ap.max_uses as passMaxUses,
        ap.use_count as passUseCount,
        ap.revoked_at as passRevokedAt,
        ap.revoke_reason as passRevokeReason
      FROM event_invitees ei
      LEFT JOIN users u ON ei.invited_by = u.id
      LEFT JOIN access_passes ap ON ei.access_pass_id = ap.id
      WHERE ei.id = ? AND ei.event_id = ?
    `).get(inviteeId, eventId) as any;

    if (!row) {
      // Check if invitee exists on another event to detect cross-event attempt
      const other = db.prepare('SELECT event_id FROM event_invitees WHERE id = ?').get(inviteeId);
      if (other) {
        return { success: false, error: 'Cross-event access violation: Invitee does not belong to specified event.', status: 403 };
      }
      return { success: false, error: 'Invitee not found.', status: 404 };
    }

    let passRecord: AccessPassRecord | null = null;
    if (row.accessPassId) {
      passRecord = {
        id: row.accessPassId,
        passType: 'EVENT' as any,
        eventId: row.eventId,
        displayCode: row.passDisplayCode || '',
        validFrom: row.passValidFrom || '',
        validUntil: row.passValidUntil || '',
        status: row.passStatus || AccessPassStatus.ACTIVE,
        maxUses: row.passMaxUses,
        useCount: row.passUseCount || 0,
        createdBy: row.invitedBy,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        revokedAt: row.passRevokedAt,
        revokeReason: row.passRevokeReason,
        formattedValidFrom: accessService.formatDateTime(row.passValidFrom),
        formattedValidUntil: accessService.formatDateTime(row.passValidUntil),
      };
    }

    return {
      success: true,
      invitee: {
        id: row.id,
        eventId: row.eventId,
        fullName: row.fullName,
        phone: row.phone,
        email: row.email,
        organization: row.organization,
        notes: row.notes,
        status: row.status as InviteeStatus,
        accessPassId: row.accessPassId,
        invitedBy: row.invitedBy,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        invitedByName: row.invitedByName,
        accessPass: passRecord,
      },
    };
  }

  /**
   * Adds an invitee to an APPROVED event
   */
  public createInvitee(
    eventId: string,
    actor: SafeUser,
    input: CreateInviteeInput,
    ipAddress?: string,
    userAgent?: string
  ): { success: boolean; invitee?: EventInviteeRecord; error?: string; status?: number } {
    // 1. RBAC check
    if (actor.role === UserRole.STAFF) {
      return { success: false, error: 'Forbidden: Staff members cannot add invitees.', status: 403 };
    }

    const db = getDatabase();

    // 2. Event check: MUST exist and be APPROVED
    const event = db.prepare('SELECT id, title, status FROM events WHERE id = ?').get(eventId) as
      | { id: string; title: string; status: string }
      | undefined;

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
      const duplicate = db.prepare(`
        SELECT id FROM event_invitees 
        WHERE event_id = ? AND LOWER(email) = LOWER(?) AND status != 'CANCELLED'
      `).get(eventId, email);

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
      db.prepare(`
        INSERT INTO event_invitees (
          id, event_id, full_name, phone, email, organization, notes,
          status, access_pass_id, invited_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
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
        nowIso
      );

      // 6. Audit logging (Zero raw credentials/secrets)
      auditService.log({
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

      const result = this.getInviteeById(eventId, id, actor);
      return { success: true, invitee: result.invitee };
    } catch (err) {
      console.error('[InviteeService] createInvitee error:', err);
      return { success: false, error: 'Database error creating invitee.', status: 500 };
    }
  }

  /**
   * Updates an existing invitee
   */
  public updateInvitee(
    eventId: string,
    inviteeId: string,
    actor: SafeUser,
    input: UpdateInviteeInput,
    ipAddress?: string,
    userAgent?: string
  ): { success: boolean; invitee?: EventInviteeRecord; error?: string; status?: number } {
    if (actor.role === UserRole.STAFF) {
      return { success: false, error: 'Forbidden: Staff members cannot update invitees.', status: 403 };
    }

    const db = getDatabase();

    // Verify invitee belongs to event
    const existing = db.prepare('SELECT * FROM event_invitees WHERE id = ? AND event_id = ?').get(inviteeId, eventId) as any;
    if (!existing) {
      const other = db.prepare('SELECT event_id FROM event_invitees WHERE id = ?').get(inviteeId);
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
    const organization = input.organization !== undefined ? this.normalizeString(input.organization) : existing.organization;
    const notes = input.notes !== undefined ? this.normalizeString(input.notes) : existing.notes;

    if (email && !this.isValidEmail(email)) {
      return { success: false, error: 'Please provide a valid email address.', status: 400 };
    }

    // Duplicate email check
    if (email) {
      const duplicate = db.prepare(`
        SELECT id FROM event_invitees 
        WHERE event_id = ? AND LOWER(email) = LOWER(?) AND id != ? AND status != 'CANCELLED'
      `).get(eventId, email, inviteeId);

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
      db.prepare(`
        UPDATE event_invitees 
        SET full_name = ?, phone = ?, email = ?, organization = ?, notes = ?, updated_at = ?
        WHERE id = ? AND event_id = ?
      `).run(fullName, phone, email, organization, notes, nowIso, inviteeId, eventId);

      auditService.log({
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

      const updated = this.getInviteeById(eventId, inviteeId, actor);
      return { success: true, invitee: updated.invitee };
    } catch (err) {
      console.error('[InviteeService] updateInvitee error:', err);
      return { success: false, error: 'Database error updating invitee.', status: 500 };
    }
  }

  /**
   * Generates individual access pass for an invitee using Phase 6C infrastructure
   * Strictly enforces event validity window (event.start_at -> event.end_at) and single use
   */
  public generateInviteeAccessPass(
    eventId: string,
    inviteeId: string,
    actor: SafeUser,
    ipAddress?: string,
    userAgent?: string
  ): {
    success: boolean;
    invitee?: EventInviteeRecord;
    pass?: AccessPassRecord;
    error?: string;
    status?: number;
  } {
    if (actor.role === UserRole.STAFF) {
      return { success: false, error: 'Forbidden: Staff cannot issue access passes.', status: 403 };
    }

    const db = getDatabase();

    // 1. Verify Event
    const event = db.prepare('SELECT id, title, location, start_at, end_at, status FROM events WHERE id = ?').get(eventId) as
      | { id: string; title: string; location: string; start_at: string; end_at: string; status: string }
      | undefined;

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
    const invitee = db.prepare('SELECT * FROM event_invitees WHERE id = ? AND event_id = ?').get(inviteeId, eventId) as any;
    if (!invitee) {
      const other = db.prepare('SELECT event_id FROM event_invitees WHERE id = ?').get(inviteeId);
      if (other) {
        return { success: false, error: 'Cross-event access violation.', status: 403 };
      }
      return { success: false, error: 'Invitee not found.', status: 404 };
    }

    if (invitee.status === InviteeStatus.CANCELLED) {
      return { success: false, error: 'Cannot issue an access pass for a cancelled invitee.', status: 400 };
    }

    // 3. Generate individual EVENT access pass via Phase 6C AccessService
    // Strictly adheres to event.start_at -> event.end_at and maxUses = 1
    const passResult = accessService.createEventAccessPass(
      actor,
      event.id,
      {
        validFrom: event.start_at,
        validUntil: event.end_at,
        maxUses: 1, // Single-use individual invitee pass
      },
      ipAddress,
      userAgent
    );

    if (!passResult.success || !passResult.pass) {
      return {
        success: false,
        error: passResult.error || 'Failed to generate access pass.',
        status: 400,
      };
    }

    const nowIso = new Date().toISOString();

    // 4. Update invitee record to link pass and set status to ACCESS_ISSUED
    try {
      db.prepare(`
        UPDATE event_invitees 
        SET access_pass_id = ?, status = ?, updated_at = ?
        WHERE id = ? AND event_id = ?
      `).run(passResult.pass.id, InviteeStatus.ACCESS_ISSUED, nowIso, inviteeId, eventId);

      // 5. Audit log (No raw token in metadata)
      auditService.log({
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

      const updatedInvitee = this.getInviteeById(eventId, inviteeId, actor);
      return {
        success: true,
        invitee: updatedInvitee.invitee,
        pass: passResult.pass,
      };
    } catch (err) {
      console.error('[InviteeService] generateInviteeAccessPass error:', err);
      return { success: false, error: 'Database error linking access pass.', status: 500 };
    }
  }

  /**
   * Revokes an invitee's access pass while retaining the historical invitee record
   */
  public revokeInviteeAccess(
    eventId: string,
    inviteeId: string,
    actor: SafeUser,
    reason?: string,
    ipAddress?: string,
    userAgent?: string
  ): { success: boolean; invitee?: EventInviteeRecord; error?: string; status?: number } {
    if (actor.role === UserRole.STAFF) {
      return { success: false, error: 'Forbidden: Staff cannot revoke access.', status: 403 };
    }

    const db = getDatabase();

    // Cross-event verification
    const invitee = db.prepare('SELECT * FROM event_invitees WHERE id = ? AND event_id = ?').get(inviteeId, eventId) as any;
    if (!invitee) {
      const other = db.prepare('SELECT event_id FROM event_invitees WHERE id = ?').get(inviteeId);
      if (other) {
        return { success: false, error: 'Cross-event access violation.', status: 403 };
      }
      return { success: false, error: 'Invitee not found.', status: 404 };
    }

    if (!invitee.access_pass_id) {
      return { success: false, error: 'Invitee does not have an active access pass.', status: 400 };
    }

    const revokeReason = reason?.trim() || 'Invitee access revoked by administrator';

    // Revoke the pass using Phase 6C revocation
    const revokeResult = accessService.revokeAccessPass(
      invitee.access_pass_id,
      actor,
      revokeReason,
      ipAddress,
      userAgent
    );

    if (!revokeResult.success) {
      return { success: false, error: revokeResult.error || 'Failed to revoke access pass.', status: 400 };
    }

    const nowIso = new Date().toISOString();

    try {
      // Revert status to INVITED while retaining invitee record
      db.prepare(`
        UPDATE event_invitees
        SET status = ?, updated_at = ?
        WHERE id = ? AND event_id = ?
      `).run(InviteeStatus.INVITED, nowIso, inviteeId, eventId);

      auditService.log({
        actorId: actor.id,
        action: 'EVENT_INVITEE_ACCESS_REVOKED',
        ipAddress,
        userAgent,
        metadata: {
          eventId,
          inviteeId,
          inviteeName: invitee.full_name,
          accessPassId: invitee.access_pass_id,
          reason: revokeReason,
        },
      });

      const updated = this.getInviteeById(eventId, inviteeId, actor);
      return { success: true, invitee: updated.invitee };
    } catch (err) {
      console.error('[InviteeService] revokeInviteeAccess error:', err);
      return { success: false, error: 'Database error updating invitee after revocation.', status: 500 };
    }
  }

  /**
   * Cancels an invitee: changes status to CANCELLED, revokes any active pass, retains record, and audits
   */
  public cancelInvitee(
    eventId: string,
    inviteeId: string,
    actor: SafeUser,
    reason?: string,
    ipAddress?: string,
    userAgent?: string
  ): { success: boolean; invitee?: EventInviteeRecord; error?: string; status?: number } {
    if (actor.role === UserRole.STAFF) {
      return { success: false, error: 'Forbidden: Staff cannot cancel invitees.', status: 403 };
    }

    const db = getDatabase();

    // Cross-event verification
    const invitee = db.prepare('SELECT * FROM event_invitees WHERE id = ? AND event_id = ?').get(inviteeId, eventId) as any;
    if (!invitee) {
      const other = db.prepare('SELECT event_id FROM event_invitees WHERE id = ?').get(inviteeId);
      if (other) {
        return { success: false, error: 'Cross-event access violation.', status: 403 };
      }
      return { success: false, error: 'Invitee not found.', status: 404 };
    }

    if (invitee.status === InviteeStatus.CANCELLED) {
      return { success: false, error: 'Invitee is already cancelled.', status: 400 };
    }

    const cancelReason = reason?.trim() || 'Invitee cancelled by administrator';

    // If there is an associated pass that is ACTIVE, revoke it
    if (invitee.access_pass_id) {
      const pass = db.prepare('SELECT status FROM access_passes WHERE id = ?').get(invitee.access_pass_id) as any;
      if (pass && pass.status === AccessPassStatus.ACTIVE) {
        accessService.revokeAccessPass(
          invitee.access_pass_id,
          actor,
          `Cancelled invitee: ${cancelReason}`,
          ipAddress,
          userAgent
        );
      }
    }

    const nowIso = new Date().toISOString();

    try {
      db.prepare(`
        UPDATE event_invitees
        SET status = ?, updated_at = ?
        WHERE id = ? AND event_id = ?
      `).run(InviteeStatus.CANCELLED, nowIso, inviteeId, eventId);

      auditService.log({
        actorId: actor.id,
        action: 'EVENT_INVITEE_CANCELLED',
        ipAddress,
        userAgent,
        metadata: {
          eventId,
          inviteeId,
          inviteeName: invitee.full_name,
          previousStatus: invitee.status,
          accessPassId: invitee.access_pass_id,
          reason: cancelReason,
        },
      });

      const updated = this.getInviteeById(eventId, inviteeId, actor);
      return { success: true, invitee: updated.invitee };
    } catch (err) {
      console.error('[InviteeService] cancelInvitee error:', err);
      return { success: false, error: 'Database error cancelling invitee.', status: 500 };
    }
  }
}

export const inviteeService = new InviteeService();
