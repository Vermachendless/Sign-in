import { getDatabase } from '../db/index.ts';
import { generateId } from '../utils/crypto.ts';
import { auditService } from './audit.service.ts';
import { accessService } from './access.service.ts';
import {
  VisitorVisitRecord,
  VisitorVisitStatus,
  CreateVisitorVisitInput,
  UpdateVisitorVisitInput,
  VisitorVisitsSummary,
  SafeUser,
  UserRole,
  AccessPassRecord,
  AccessPassStatus,
  PassType,
} from '../../src/types/index.ts';
import {
  COMPANY_TIMEZONE,
  getTodayDateString,
  formatDateInTimezone,
  formatTimeInTimezone,
  isValidDateString,
} from '../utils/time.ts';

export class VisitorService {
  /**
   * Helper to normalize strings (trim and convert empty strings to null)
   */
  private normalizeString(val?: string | null): string | null {
    if (!val) return null;
    const trimmed = val.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  /**
   * Helper to normalize email
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
   * Validates HH:mm time format
   */
  public isValidTimeString(timeStr?: string | null): boolean {
    if (!timeStr || typeof timeStr !== 'string') return false;
    return /^([01]\d|2[0-3]):([0-5]\d)$/.test(timeStr.trim());
  }

  /**
   * Computes ISO UTC timestamps from visitDate (YYYY-MM-DD) and times (HH:mm) in Africa/Lagos (+01:00)
   */
  public computeValidityWindow(
    visitDate: string,
    startTime: string,
    endTime: string
  ): { valid: boolean; validFrom?: string; validUntil?: string; error?: string } {
    if (!isValidDateString(visitDate)) {
      return { valid: false, error: 'Invalid visit date. Must be YYYY-MM-DD format.' };
    }
    if (!this.isValidTimeString(startTime) || !this.isValidTimeString(endTime)) {
      return { valid: false, error: 'Start and end times must be valid 24-hour time format (HH:mm).' };
    }

    try {
      // Africa/Lagos is UTC+1 (WAT) year-round
      const startIso = new Date(`${visitDate}T${startTime.trim()}:00+01:00`).toISOString();
      const endIso = new Date(`${visitDate}T${endTime.trim()}:00+01:00`).toISOString();

      const startMs = new Date(startIso).getTime();
      const endMs = new Date(endIso).getTime();

      if (isNaN(startMs) || isNaN(endMs)) {
        return { valid: false, error: 'Invalid calendar date or time values.' };
      }

      if (endMs <= startMs) {
        return { valid: false, error: 'Visit start time must be strictly before end time.' };
      }

      // Maximum duration safeguard: visit cannot exceed 24 hours
      const durationHours = (endMs - startMs) / (3600 * 1000);
      if (durationHours > 24) {
        return { valid: false, error: 'Visit duration cannot exceed 24 hours.' };
      }

      return { valid: true, validFrom: startIso, validUntil: endIso };
    } catch {
      return { valid: false, error: 'Failed to compute visit time window.' };
    }
  }

  /**
   * Lists visitor invitations with search, status filtering, and metrics
   * STAFF results are strictly scoped to their own host_staff_id.
   * ADMIN and SUPER_ADMIN have organization-wide access.
   */
  public listVisits(
    actor: SafeUser,
    options?: {
      search?: string;
      status?: string;
      hostStaffId?: string;
      date?: string;
      page?: number;
      limit?: number;
    }
  ): {
    success: boolean;
    visits: VisitorVisitRecord[];
    total: number;
    page: number;
    limit: number;
    summary: VisitorVisitsSummary;
    error?: string;
  } {
    const db = getDatabase();
    const isStaff = actor.role === UserRole.STAFF;

    // Server-enforced host boundary: STAFF can only ever see their own records
    const effectiveHostStaffId = isStaff ? actor.id : (options?.hostStaffId || undefined);

    const nowIso = new Date().toISOString();
    const todayStr = getTodayDateString(COMPANY_TIMEZONE);

    // 1. Calculate Summary Metrics
    let summarySql = `
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN DATE(valid_from, '+1 hour') = ? THEN 1 END) as today,
        COUNT(CASE WHEN valid_from > ? AND status != 'CANCELLED' THEN 1 END) as upcoming,
        COUNT(CASE WHEN status = 'ACCESS_ISSUED' THEN 1 END) as accessIssued,
        COUNT(CASE WHEN status = 'PENDING' THEN 1 END) as pending,
        COUNT(CASE WHEN status = 'CANCELLED' THEN 1 END) as cancelled
      FROM visitor_visits
      WHERE 1=1
    `;
    const summaryParams: (string | number)[] = [todayStr, nowIso];

    if (effectiveHostStaffId) {
      summarySql += ' AND host_staff_id = ?';
      summaryParams.push(effectiveHostStaffId);
    }

    const summaryRow = db.prepare(summarySql).get(...summaryParams) as any;
    const summary: VisitorVisitsSummary = {
      total: Number(summaryRow?.total || 0),
      today: Number(summaryRow?.today || 0),
      upcoming: Number(summaryRow?.upcoming || 0),
      accessIssued: Number(summaryRow?.accessIssued || 0),
      pending: Number(summaryRow?.pending || 0),
      cancelled: Number(summaryRow?.cancelled || 0),
    };

    // 2. Build Query
    let countSql = 'SELECT COUNT(*) as count FROM visitor_visits vv LEFT JOIN users u ON vv.host_staff_id = u.id WHERE 1=1';
    let dataSql = `
      SELECT 
        vv.id,
        vv.host_staff_id as hostStaffId,
        vv.visitor_full_name as visitorFullName,
        vv.visitor_phone as visitorPhone,
        vv.visitor_email as visitorEmail,
        vv.purpose,
        vv.notes,
        vv.valid_from as validFrom,
        vv.valid_until as validUntil,
        vv.status,
        vv.access_pass_id as accessPassId,
        vv.created_at as createdAt,
        vv.updated_at as updatedAt,
        vv.cancelled_at as cancelledAt,
        vv.cancelled_by as cancelledBy,
        (u.first_name || ' ' || u.last_name) as hostStaffName,
        u.department as hostStaffDepartment,
        u.email as hostStaffEmail,
        (cu.first_name || ' ' || cu.last_name) as cancelledByName,
        ap.display_code as passDisplayCode,
        ap.status as passStatus,
        ap.valid_from as passValidFrom,
        ap.valid_until as passValidUntil,
        ap.max_uses as passMaxUses,
        ap.use_count as passUseCount,
        ap.revoked_at as passRevokedAt,
        ap.revoke_reason as passRevokeReason
      FROM visitor_visits vv
      LEFT JOIN users u ON vv.host_staff_id = u.id
      LEFT JOIN users cu ON vv.cancelled_by = cu.id
      LEFT JOIN access_passes ap ON vv.access_pass_id = ap.id
      WHERE 1=1
    `;

    const params: (string | number)[] = [];

    // Host scoping
    if (effectiveHostStaffId) {
      countSql += ' AND vv.host_staff_id = ?';
      dataSql += ' AND vv.host_staff_id = ?';
      params.push(effectiveHostStaffId);
    }

    // Status filter
    if (options?.status && Object.values(VisitorVisitStatus).includes(options.status as VisitorVisitStatus)) {
      countSql += ' AND vv.status = ?';
      dataSql += ' AND vv.status = ?';
      params.push(options.status);
    }

    // Date filter (matches YYYY-MM-DD in Lagos timezone)
    if (options?.date && isValidDateString(options.date)) {
      countSql += " AND DATE(vv.valid_from, '+1 hour') = ?";
      dataSql += " AND DATE(vv.valid_from, '+1 hour') = ?";
      params.push(options.date);
    }

    // Search filter
    if (options?.search && options.search.trim()) {
      const term = `%${options.search.trim()}%`;
      const searchClause = ` AND (
        vv.visitor_full_name LIKE ? OR 
        vv.visitor_email LIKE ? OR 
        vv.purpose LIKE ? OR 
        u.first_name LIKE ? OR 
        u.last_name LIKE ?
      )`;
      countSql += searchClause;
      dataSql += searchClause;
      params.push(term, term, term, term, term);
    }

    // Pagination
    const page = Math.max(1, options?.page || 1);
    const limit = Math.min(100, Math.max(1, options?.limit || 20));
    const offset = (page - 1) * limit;

    const countRow = db.prepare(countSql).get(...params) as { count: number };
    const total = Number(countRow?.count || 0);

    dataSql += ' ORDER BY vv.valid_from DESC LIMIT ? OFFSET ?';
    const dataParams = [...params, limit, offset];

    const rows = db.prepare(dataSql).all(...dataParams) as any[];

    const visits: VisitorVisitRecord[] = rows.map((r) => {
      let passRecord: AccessPassRecord | null = null;
      if (r.accessPassId) {
        passRecord = {
          id: r.accessPassId,
          passType: PassType.VISITOR,
          eventId: null,
          hostStaffId: r.hostStaffId,
          displayCode: r.passDisplayCode || '',
          validFrom: r.passValidFrom || '',
          validUntil: r.passValidUntil || '',
          status: r.passStatus || AccessPassStatus.ACTIVE,
          maxUses: r.passMaxUses,
          useCount: r.passUseCount || 0,
          createdBy: r.hostStaffId,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          revokedAt: r.passRevokedAt,
          revokeReason: r.passRevokeReason,
          formattedValidFrom: accessService.formatDateTime(r.passValidFrom),
          formattedValidUntil: accessService.formatDateTime(r.passValidUntil),
        };
      }

      // Check dynamic expiration
      let effectiveStatus = r.status as VisitorVisitStatus;
      if (effectiveStatus !== VisitorVisitStatus.CANCELLED && nowIso > r.validUntil) {
        effectiveStatus = VisitorVisitStatus.EXPIRED;
      }

      return {
        id: r.id,
        hostStaffId: r.hostStaffId,
        visitorFullName: r.visitorFullName,
        visitorPhone: r.visitorPhone,
        visitorEmail: r.visitorEmail,
        purpose: r.purpose,
        notes: r.notes,
        validFrom: r.validFrom,
        validUntil: r.validUntil,
        status: effectiveStatus,
        accessPassId: r.accessPassId,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        cancelledAt: r.cancelledAt,
        cancelledBy: r.cancelledBy,
        hostStaffName: r.hostStaffName,
        hostStaffDepartment: r.hostStaffDepartment,
        hostStaffEmail: r.hostStaffEmail,
        cancelledByName: r.cancelledByName,
        accessPass: passRecord,
        formattedDate: formatDateInTimezone(r.validFrom),
        formattedTimeRange: `${formatTimeInTimezone(r.validFrom)} – ${formatTimeInTimezone(r.validUntil)}`,
      };
    });

    return {
      success: true,
      visits,
      total,
      page,
      limit,
      summary,
    };
  }

  /**
   * Retrieves single visit by ID with strict cross-user authorization enforcement
   */
  public getVisitById(
    visitId: string,
    actor: SafeUser
  ): { success: boolean; visit?: VisitorVisitRecord; error?: string; status?: number } {
    const db = getDatabase();

    const row = db.prepare(`
      SELECT 
        vv.id,
        vv.host_staff_id as hostStaffId,
        vv.visitor_full_name as visitorFullName,
        vv.visitor_phone as visitorPhone,
        vv.visitor_email as visitorEmail,
        vv.purpose,
        vv.notes,
        vv.valid_from as validFrom,
        vv.valid_until as validUntil,
        vv.status,
        vv.access_pass_id as accessPassId,
        vv.created_at as createdAt,
        vv.updated_at as updatedAt,
        vv.cancelled_at as cancelledAt,
        vv.cancelled_by as cancelledBy,
        (u.first_name || ' ' || u.last_name) as hostStaffName,
        u.department as hostStaffDepartment,
        u.email as hostStaffEmail,
        (cu.first_name || ' ' || cu.last_name) as cancelledByName,
        ap.display_code as passDisplayCode,
        ap.status as passStatus,
        ap.valid_from as passValidFrom,
        ap.valid_until as passValidUntil,
        ap.max_uses as passMaxUses,
        ap.use_count as passUseCount,
        ap.revoked_at as passRevokedAt,
        ap.revoke_reason as passRevokeReason
      FROM visitor_visits vv
      LEFT JOIN users u ON vv.host_staff_id = u.id
      LEFT JOIN users cu ON vv.cancelled_by = cu.id
      LEFT JOIN access_passes ap ON vv.access_pass_id = ap.id
      WHERE vv.id = ?
    `).get(visitId) as any;

    if (!row) {
      return { success: false, error: 'Visitor invitation not found.', status: 404 };
    }

    // Cross-user authorization check: STAFF can only access their own visits
    if (actor.role === UserRole.STAFF && row.hostStaffId !== actor.id) {
      return {
        success: false,
        error: 'Forbidden: You are not authorized to view this visitor invitation.',
        status: 403,
      };
    }

    let passRecord: AccessPassRecord | null = null;
    if (row.accessPassId) {
      passRecord = {
        id: row.accessPassId,
        passType: PassType.VISITOR,
        eventId: null,
        hostStaffId: row.hostStaffId,
        displayCode: row.passDisplayCode || '',
        validFrom: row.passValidFrom || '',
        validUntil: row.passValidUntil || '',
        status: row.passStatus || AccessPassStatus.ACTIVE,
        maxUses: row.passMaxUses,
        useCount: row.passUseCount || 0,
        createdBy: row.hostStaffId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        revokedAt: row.passRevokedAt,
        revokeReason: row.passRevokeReason,
        formattedValidFrom: accessService.formatDateTime(row.passValidFrom),
        formattedValidUntil: accessService.formatDateTime(row.passValidUntil),
      };
    }

    const nowIso = new Date().toISOString();
    let effectiveStatus = row.status as VisitorVisitStatus;
    if (effectiveStatus !== VisitorVisitStatus.CANCELLED && nowIso > row.validUntil) {
      effectiveStatus = VisitorVisitStatus.EXPIRED;
    }

    return {
      success: true,
      visit: {
        id: row.id,
        hostStaffId: row.hostStaffId,
        visitorFullName: row.visitorFullName,
        visitorPhone: row.visitorPhone,
        visitorEmail: row.visitorEmail,
        purpose: row.purpose,
        notes: row.notes,
        validFrom: row.validFrom,
        validUntil: row.validUntil,
        status: effectiveStatus,
        accessPassId: row.accessPassId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        cancelledAt: row.cancelledAt,
        cancelledBy: row.cancelledBy,
        hostStaffName: row.hostStaffName,
        hostStaffDepartment: row.hostStaffDepartment,
        hostStaffEmail: row.hostStaffEmail,
        cancelledByName: row.cancelledByName,
        accessPass: passRecord,
        formattedDate: formatDateInTimezone(row.validFrom),
        formattedTimeRange: `${formatTimeInTimezone(row.validFrom)} – ${formatTimeInTimezone(row.validUntil)}`,
      },
    };
  }

  /**
   * Creates a new visitor invitation
   */
  public createVisit(
    actor: SafeUser,
    input: CreateVisitorVisitInput,
    targetHostStaffId?: string,
    ipAddress?: string,
    userAgent?: string
  ): { success: boolean; visit?: VisitorVisitRecord; error?: string; status?: number } {
    const db = getDatabase();

    // 1. Determine host staff ID:
    // STAFF can ONLY create for themselves. Never trust client body for host_staff_id when role is STAFF!
    let hostStaffId = actor.id;
    if (actor.role === UserRole.ADMIN || actor.role === UserRole.SUPER_ADMIN) {
      if (targetHostStaffId && targetHostStaffId.trim()) {
        hostStaffId = targetHostStaffId.trim();
      }
    }

    // Verify host staff user exists and is active
    const host = db.prepare('SELECT id, first_name, last_name, department, email, status FROM users WHERE id = ?').get(hostStaffId) as any;
    if (!host) {
      return { success: false, error: 'Host staff member not found.', status: 404 };
    }
    if (host.status !== 'ACTIVE') {
      return { success: false, error: 'Host staff member is not currently active.', status: 400 };
    }

    // 2. Validate and normalize inputs
    const visitorFullName = this.normalizeString(input.visitorFullName);
    if (!visitorFullName) {
      return { success: false, error: 'Visitor full name is required.', status: 400 };
    }

    const visitorPhone = this.normalizeString(input.visitorPhone);
    const visitorEmail = this.normalizeEmail(input.visitorEmail);
    const purpose = this.normalizeString(input.purpose);
    const notes = this.normalizeString(input.notes);

    if (visitorEmail && !this.isValidEmail(visitorEmail)) {
      return { success: false, error: 'Please provide a valid visitor email address.', status: 400 };
    }

    // 3. Validate visit date, start time, and end time
    const windowResult = this.computeValidityWindow(input.visitDate, input.startTime, input.endTime);
    if (!windowResult.valid || !windowResult.validFrom || !windowResult.validUntil) {
      return { success: false, error: windowResult.error || 'Invalid visit time window.', status: 400 };
    }

    // Advisory duplicate check: avoid exact overlapping active invitations for same host and visitor email
    if (visitorEmail) {
      const duplicate = db.prepare(`
        SELECT id FROM visitor_visits
        WHERE host_staff_id = ? 
          AND LOWER(visitor_email) = LOWER(?)
          AND valid_from = ?
          AND valid_until = ?
          AND status != 'CANCELLED'
      `).get(hostStaffId, visitorEmail, windowResult.validFrom, windowResult.validUntil);

      if (duplicate) {
        return {
          success: false,
          error: `An active visit invitation for ${visitorEmail} during this exact time slot already exists.`,
          status: 409,
        };
      }
    }

    // 4. Insert new visitor visit record in PENDING status
    const id = generateId();
    const nowIso = new Date().toISOString();

    try {
      db.prepare(`
        INSERT INTO visitor_visits (
          id, host_staff_id, visitor_full_name, visitor_phone, visitor_email,
          purpose, notes, valid_from, valid_until, status, access_pass_id,
          created_at, updated_at, cancelled_at, cancelled_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, NULL)
      `).run(
        id,
        hostStaffId,
        visitorFullName,
        visitorPhone,
        visitorEmail,
        purpose,
        notes,
        windowResult.validFrom,
        windowResult.validUntil,
        VisitorVisitStatus.PENDING,
        nowIso,
        nowIso
      );

      // 5. Immutable audit logging
      auditService.log({
        actorId: actor.id,
        action: 'VISITOR_CREATED',
        ipAddress,
        userAgent,
        metadata: {
          visitId: id,
          hostStaffId,
          hostStaffName: `${host.first_name} ${host.last_name}`,
          visitorFullName,
          visitorEmail,
          purpose,
          validFrom: windowResult.validFrom,
          validUntil: windowResult.validUntil,
        },
      });

      const result = this.getVisitById(id, actor);
      return { success: true, visit: result.visit };
    } catch (err) {
      console.error('[VisitorService] createVisit error:', err);
      return { success: false, error: 'Database error creating visitor invitation.', status: 500 };
    }
  }

  /**
   * Updates an existing visitor invitation
   */
  public updateVisit(
    visitId: string,
    actor: SafeUser,
    input: UpdateVisitorVisitInput,
    ipAddress?: string,
    userAgent?: string
  ): { success: boolean; visit?: VisitorVisitRecord; error?: string; status?: number } {
    const db = getDatabase();

    const existing = db.prepare('SELECT * FROM visitor_visits WHERE id = ?').get(visitId) as any;
    if (!existing) {
      return { success: false, error: 'Visitor invitation not found.', status: 404 };
    }

    // Cross-user authorization check: STAFF can only update their own visits
    if (actor.role === UserRole.STAFF && existing.host_staff_id !== actor.id) {
      return {
        success: false,
        error: 'Forbidden: You cannot modify another staff member\'s visitor invitation.',
        status: 403,
      };
    }

    if (existing.status === VisitorVisitStatus.CANCELLED) {
      return { success: false, error: 'Cannot update a cancelled visitor invitation.', status: 400 };
    }

    const visitorFullName = input.visitorFullName !== undefined ? this.normalizeString(input.visitorFullName) : existing.visitor_full_name;
    if (input.visitorFullName !== undefined && !visitorFullName) {
      return { success: false, error: 'Visitor full name cannot be empty.', status: 400 };
    }

    const visitorPhone = input.visitorPhone !== undefined ? this.normalizeString(input.visitorPhone) : existing.visitor_phone;
    const visitorEmail = input.visitorEmail !== undefined ? this.normalizeEmail(input.visitorEmail) : existing.visitor_email;
    const purpose = input.purpose !== undefined ? this.normalizeString(input.purpose) : existing.purpose;
    const notes = input.notes !== undefined ? this.normalizeString(input.notes) : existing.notes;

    if (visitorEmail && !this.isValidEmail(visitorEmail)) {
      return { success: false, error: 'Please provide a valid visitor email address.', status: 400 };
    }

    // Time window update if date or times provided
    let validFrom = existing.valid_from;
    let validUntil = existing.valid_until;

    if (input.visitDate || input.startTime || input.endTime) {
      // If updating time, default missing fields from existing timestamps
      const existingDate = formatDateInTimezone(existing.valid_from).split(',')[0]; // or parse YYYY-MM-DD
      const dateStr = input.visitDate || existing.valid_from.split('T')[0];
      const startTimeStr = input.startTime || formatTimeInTimezone(existing.valid_from);
      const endTimeStr = input.endTime || formatTimeInTimezone(existing.valid_until);

      const windowResult = this.computeValidityWindow(dateStr, startTimeStr, endTimeStr);
      if (!windowResult.valid || !windowResult.validFrom || !windowResult.validUntil) {
        return { success: false, error: windowResult.error || 'Invalid updated time window.', status: 400 };
      }
      validFrom = windowResult.validFrom;
      validUntil = windowResult.validUntil;
    }

    const nowIso = new Date().toISOString();

    try {
      db.prepare(`
        UPDATE visitor_visits
        SET visitor_full_name = ?, visitor_phone = ?, visitor_email = ?,
            purpose = ?, notes = ?, valid_from = ?, valid_until = ?, updated_at = ?
        WHERE id = ?
      `).run(visitorFullName, visitorPhone, visitorEmail, purpose, notes, validFrom, validUntil, nowIso, visitId);

      // If active access pass already exists, sync its validity window
      if (existing.access_pass_id) {
        db.prepare(`
          UPDATE access_passes
          SET valid_from = ?, valid_until = ?, updated_at = ?
          WHERE id = ?
        `).run(validFrom, validUntil, nowIso, existing.access_pass_id);
      }

      auditService.log({
        actorId: actor.id,
        action: 'VISITOR_UPDATED',
        ipAddress,
        userAgent,
        metadata: {
          visitId,
          visitorFullName,
          validFrom,
          validUntil,
          purpose,
        },
      });

      const updated = this.getVisitById(visitId, actor);
      return { success: true, visit: updated.visit };
    } catch (err) {
      console.error('[VisitorService] updateVisit error:', err);
      return { success: false, error: 'Database error updating visitor invitation.', status: 500 };
    }
  }

  /**
   * Generates a VISITOR access pass for this invitation using Phase 6C infrastructure
   */
  public generateVisitorAccessPass(
    visitId: string,
    actor: SafeUser,
    ipAddress?: string,
    userAgent?: string
  ): {
    success: boolean;
    visit?: VisitorVisitRecord;
    pass?: AccessPassRecord;
    error?: string;
    status?: number;
  } {
    const db = getDatabase();

    const visit = db.prepare('SELECT * FROM visitor_visits WHERE id = ?').get(visitId) as any;
    if (!visit) {
      return { success: false, error: 'Visitor invitation not found.', status: 404 };
    }

    // Cross-user authorization check: STAFF can only generate pass for their own visitor
    if (actor.role === UserRole.STAFF && visit.host_staff_id !== actor.id) {
      return {
        success: false,
        error: 'Forbidden: You cannot generate an access pass for another staff member\'s visitor.',
        status: 403,
      };
    }

    if (visit.status === VisitorVisitStatus.CANCELLED) {
      return { success: false, error: 'Cannot issue an access pass for a cancelled visitor invitation.', status: 400 };
    }

    const nowIso = new Date().toISOString();
    if (nowIso > visit.valid_until) {
      return { success: false, error: 'Cannot issue an access pass for an expired visit window.', status: 400 };
    }

    // Generate individual VISITOR access pass via Phase 6C AccessService
    const passResult = accessService.createVisitorAccessPass(
      actor,
      visit.host_staff_id,
      {
        validFrom: visit.valid_from,
        validUntil: visit.valid_until,
        maxUses: 1, // Single-use visitor pass
      },
      ipAddress,
      userAgent
    );

    if (!passResult.success || !passResult.pass) {
      return {
        success: false,
        error: passResult.error || 'Failed to generate visitor access pass.',
        status: 400,
      };
    }

    try {
      db.prepare(`
        UPDATE visitor_visits
        SET access_pass_id = ?, status = ?, updated_at = ?
        WHERE id = ?
      `).run(passResult.pass.id, VisitorVisitStatus.ACCESS_ISSUED, nowIso, visitId);

      auditService.log({
        actorId: actor.id,
        action: 'VISITOR_ACCESS_ISSUED',
        ipAddress,
        userAgent,
        metadata: {
          visitId,
          hostStaffId: visit.host_staff_id,
          visitorFullName: visit.visitor_full_name,
          passId: passResult.pass.id,
          displayCode: passResult.pass.displayCode,
          validFrom: passResult.pass.validFrom,
          validUntil: passResult.pass.validUntil,
        },
      });

      const updated = this.getVisitById(visitId, actor);
      return {
        success: true,
        visit: updated.visit,
        pass: passResult.pass,
      };
    } catch (err) {
      console.error('[VisitorService] generateVisitorAccessPass error:', err);
      return { success: false, error: 'Database error linking visitor access pass.', status: 500 };
    }
  }

  /**
   * Revokes a visitor's access pass while retaining the historical visit record
   */
  public revokeVisitorAccess(
    visitId: string,
    actor: SafeUser,
    reason?: string,
    ipAddress?: string,
    userAgent?: string
  ): { success: boolean; visit?: VisitorVisitRecord; error?: string; status?: number } {
    const db = getDatabase();

    const visit = db.prepare('SELECT * FROM visitor_visits WHERE id = ?').get(visitId) as any;
    if (!visit) {
      return { success: false, error: 'Visitor invitation not found.', status: 404 };
    }

    // Cross-user authorization check: STAFF can only revoke their own visitors
    if (actor.role === UserRole.STAFF && visit.host_staff_id !== actor.id) {
      return {
        success: false,
        error: 'Forbidden: You cannot revoke another staff member\'s visitor access.',
        status: 403,
      };
    }

    if (!visit.access_pass_id) {
      return { success: false, error: 'No active access pass found for this visitor invitation.', status: 400 };
    }

    const revokeReason = reason?.trim() || 'Visitor access revoked by host staff member';

    // Revoke the pass using Phase 6C revocation mechanism
    const revokeResult = accessService.revokeAccessPass(
      visit.access_pass_id,
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
      // Revert status to PENDING while retaining historical visit and pass link
      db.prepare(`
        UPDATE visitor_visits
        SET status = ?, updated_at = ?
        WHERE id = ?
      `).run(VisitorVisitStatus.PENDING, nowIso, visitId);

      auditService.log({
        actorId: actor.id,
        action: 'VISITOR_ACCESS_REVOKED',
        ipAddress,
        userAgent,
        metadata: {
          visitId,
          hostStaffId: visit.host_staff_id,
          visitorFullName: visit.visitor_full_name,
          accessPassId: visit.access_pass_id,
          reason: revokeReason,
        },
      });

      const updated = this.getVisitById(visitId, actor);
      return { success: true, visit: updated.visit };
    } catch (err) {
      console.error('[VisitorService] revokeVisitorAccess error:', err);
      return { success: false, error: 'Database error updating visitor after revocation.', status: 500 };
    }
  }

  /**
   * Cancels a visitor invitation: revokes active pass, retains historical record, and logs audit
   */
  public cancelVisit(
    visitId: string,
    actor: SafeUser,
    reason?: string,
    ipAddress?: string,
    userAgent?: string
  ): { success: boolean; visit?: VisitorVisitRecord; error?: string; status?: number } {
    const db = getDatabase();

    const visit = db.prepare('SELECT * FROM visitor_visits WHERE id = ?').get(visitId) as any;
    if (!visit) {
      return { success: false, error: 'Visitor invitation not found.', status: 404 };
    }

    // Cross-user authorization check: STAFF can only cancel their own visits
    if (actor.role === UserRole.STAFF && visit.host_staff_id !== actor.id) {
      return {
        success: false,
        error: 'Forbidden: You cannot cancel another staff member\'s visitor invitation.',
        status: 403,
      };
    }

    if (visit.status === VisitorVisitStatus.CANCELLED) {
      return { success: false, error: 'Visitor invitation is already cancelled.', status: 400 };
    }

    const cancelReason = reason?.trim() || 'Visit cancelled by host staff member';

    // If active access pass exists, automatically revoke it
    if (visit.access_pass_id) {
      const pass = db.prepare('SELECT status FROM access_passes WHERE id = ?').get(visit.access_pass_id) as any;
      if (pass && pass.status === AccessPassStatus.ACTIVE) {
        accessService.revokeAccessPass(
          visit.access_pass_id,
          actor,
          `Cancelled visit: ${cancelReason}`,
          ipAddress,
          userAgent
        );
      }
    }

    const nowIso = new Date().toISOString();

    try {
      db.prepare(`
        UPDATE visitor_visits
        SET status = ?, cancelled_at = ?, cancelled_by = ?, updated_at = ?
        WHERE id = ?
      `).run(VisitorVisitStatus.CANCELLED, nowIso, actor.id, nowIso, visitId);

      auditService.log({
        actorId: actor.id,
        action: 'VISITOR_CANCELLED',
        ipAddress,
        userAgent,
        metadata: {
          visitId,
          hostStaffId: visit.host_staff_id,
          visitorFullName: visit.visitor_full_name,
          reason: cancelReason,
          previousStatus: visit.status,
          accessPassId: visit.access_pass_id,
        },
      });

      const updated = this.getVisitById(visitId, actor);
      return { success: true, visit: updated.visit };
    } catch (err) {
      console.error('[VisitorService] cancelVisit error:', err);
      return { success: false, error: 'Database error cancelling visitor invitation.', status: 500 };
    }
  }
}

export const visitorService = new VisitorService();
