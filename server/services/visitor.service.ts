import { dbAdapter, type DbAdapter } from '../db/adapter.ts';
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

/**
 * Computes exact UTC start and end ISO bounds for a calendar date YYYY-MM-DD in Africa/Lagos (+01:00).
 * Lagos has no daylight saving time, so [startMs, startMs + 24h) is mathematically precise.
 */
function getLagosDateRange(dateStr: string): { startIso: string; endIso: string } {
  const startMs = new Date(`${dateStr}T00:00:00+01:00`).getTime();
  const endMs = startMs + 24 * 60 * 60 * 1000;
  return {
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
  };
}

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
   * Helper to map a raw database query row to a strongly-typed VisitorVisitRecord.
   * Handles casing variations between SQLite and PostgreSQL.
   */
  private mapVisitRecord(r: any, nowIso: string): VisitorVisitRecord {
    const accessPassId = r.accessPassId ?? r.access_pass_id ?? null;
    let passRecord: AccessPassRecord | null = null;
    if (accessPassId) {
      const passValidFrom = r.passValidFrom ?? r.pass_valid_from ?? '';
      const passValidUntil = r.passValidUntil ?? r.pass_valid_until ?? '';
      passRecord = {
        id: accessPassId,
        passType: PassType.VISITOR,
        eventId: null,
        hostStaffId: r.hostStaffId ?? r.host_staff_id,
        displayCode: r.passDisplayCode ?? r.pass_display_code ?? '',
        validFrom: passValidFrom,
        validUntil: passValidUntil,
        status: (r.passStatus ?? r.pass_status) || AccessPassStatus.ACTIVE,
        maxUses: r.passMaxUses ?? r.pass_max_uses ?? null,
        useCount: r.passUseCount ?? r.pass_use_count ?? 0,
        createdBy: r.hostStaffId ?? r.host_staff_id,
        createdAt: r.createdAt ?? r.created_at,
        updatedAt: r.updatedAt ?? r.updated_at,
        revokedAt: r.passRevokedAt ?? r.pass_revoked_at ?? null,
        revokeReason: r.passRevokeReason ?? r.pass_revoke_reason ?? null,
        formattedValidFrom: accessService.formatDateTime(passValidFrom),
        formattedValidUntil: accessService.formatDateTime(passValidUntil),
      };
    }

    const validFrom = r.validFrom ?? r.valid_from;
    const validUntil = r.validUntil ?? r.valid_until;
    let effectiveStatus = (r.status as VisitorVisitStatus) || VisitorVisitStatus.PENDING;
    if (effectiveStatus !== VisitorVisitStatus.CANCELLED && nowIso > validUntil) {
      effectiveStatus = VisitorVisitStatus.EXPIRED;
    }

    return {
      id: r.id,
      hostStaffId: r.hostStaffId ?? r.host_staff_id,
      visitorFullName: r.visitorFullName ?? r.visitor_full_name,
      visitorPhone: r.visitorPhone ?? r.visitor_phone ?? null,
      visitorEmail: r.visitorEmail ?? r.visitor_email ?? null,
      purpose: r.purpose ?? null,
      notes: r.notes ?? null,
      validFrom,
      validUntil,
      status: effectiveStatus,
      accessPassId,
      createdAt: r.createdAt ?? r.created_at,
      updatedAt: r.updatedAt ?? r.updated_at,
      cancelledAt: r.cancelledAt ?? r.cancelled_at ?? null,
      cancelledBy: r.cancelledBy ?? r.cancelled_by ?? null,
      hostStaffName: r.hostStaffName ?? r.host_staff_name ?? undefined,
      hostStaffDepartment: r.hostStaffDepartment ?? r.host_staff_department ?? undefined,
      hostStaffEmail: r.hostStaffEmail ?? r.host_staff_email ?? undefined,
      cancelledByName: r.cancelledByName ?? r.cancelled_by_name ?? undefined,
      accessPass: passRecord,
      formattedDate: formatDateInTimezone(validFrom),
      formattedTimeRange: `${formatTimeInTimezone(validFrom)} – ${formatTimeInTimezone(validUntil)}`,
    };
  }

  /**
   * Lists visitor invitations with search, status filtering, and metrics
   * STAFF results are strictly scoped to their own host_staff_id.
   * ADMIN and SUPER_ADMIN have organization-wide access.
   */
  public async listVisits(
    actor: SafeUser,
    options?: {
      search?: string;
      status?: string;
      hostStaffId?: string;
      date?: string;
      page?: number;
      limit?: number;
    }
  ): Promise<{
    success: boolean;
    visits: VisitorVisitRecord[];
    total: number;
    page: number;
    limit: number;
    summary: VisitorVisitsSummary;
    error?: string;
  }> {
    const isStaff = actor.role === UserRole.STAFF;

    // Server-enforced host boundary: STAFF can only ever see their own records
    const effectiveHostStaffId = isStaff ? actor.id : (options?.hostStaffId || undefined);

    const nowIso = new Date().toISOString();
    const todayStr = getTodayDateString(COMPANY_TIMEZONE);
    const { startIso: todayStartIso, endIso: todayEndIso } = getLagosDateRange(todayStr);

    // 1. Calculate Summary Metrics using portable range predicates
    let summarySql = `
      SELECT 
        COUNT(*) as "total",
        COUNT(CASE WHEN valid_from >= $1 AND valid_from < $2 THEN 1 END) as "today",
        COUNT(CASE WHEN valid_from > $3 AND status != 'CANCELLED' THEN 1 END) as "upcoming",
        COUNT(CASE WHEN status = 'ACCESS_ISSUED' THEN 1 END) as "accessIssued",
        COUNT(CASE WHEN status = 'PENDING' THEN 1 END) as "pending",
        COUNT(CASE WHEN status = 'CANCELLED' THEN 1 END) as "cancelled"
      FROM visitor_visits
      WHERE 1=1
    `;
    const summaryParams: (string | number)[] = [todayStartIso, todayEndIso, nowIso];

    if (effectiveHostStaffId) {
      summarySql += ' AND host_staff_id = $4';
      summaryParams.push(effectiveHostStaffId);
    }

    const summaryRow = await dbAdapter.queryOne<any>(summarySql, summaryParams);
    const summary: VisitorVisitsSummary = {
      total: Number(summaryRow?.total || 0),
      today: Number(summaryRow?.today || 0),
      upcoming: Number(summaryRow?.upcoming || 0),
      accessIssued: Number(summaryRow?.accessIssued ?? summaryRow?.accessissued ?? 0),
      pending: Number(summaryRow?.pending || 0),
      cancelled: Number(summaryRow?.cancelled || 0),
    };

    // 2. Build Filtered Query
    let countSql = 'SELECT COUNT(*) as count FROM visitor_visits vv LEFT JOIN users u ON vv.host_staff_id = u.id WHERE 1=1';
    let dataSql = `
      SELECT 
        vv.id,
        vv.host_staff_id as "hostStaffId",
        vv.visitor_full_name as "visitorFullName",
        vv.visitor_phone as "visitorPhone",
        vv.visitor_email as "visitorEmail",
        vv.purpose,
        vv.notes,
        vv.valid_from as "validFrom",
        vv.valid_until as "validUntil",
        vv.status,
        vv.access_pass_id as "accessPassId",
        vv.created_at as "createdAt",
        vv.updated_at as "updatedAt",
        vv.cancelled_at as "cancelledAt",
        vv.cancelled_by as "cancelledBy",
        (u.first_name || ' ' || u.last_name) as "hostStaffName",
        u.department as "hostStaffDepartment",
        u.email as "hostStaffEmail",
        (cu.first_name || ' ' || cu.last_name) as "cancelledByName",
        ap.display_code as "passDisplayCode",
        ap.status as "passStatus",
        ap.valid_from as "passValidFrom",
        ap.valid_until as "passValidUntil",
        ap.max_uses as "passMaxUses",
        ap.use_count as "passUseCount",
        ap.revoked_at as "passRevokedAt",
        ap.revoke_reason as "passRevokeReason"
      FROM visitor_visits vv
      LEFT JOIN users u ON vv.host_staff_id = u.id
      LEFT JOIN users cu ON vv.cancelled_by = cu.id
      LEFT JOIN access_passes ap ON vv.access_pass_id = ap.id
      WHERE 1=1
    `;

    const params: (string | number)[] = [];
    let pIdx = 1;

    // Host scoping
    if (effectiveHostStaffId) {
      const p = `$${pIdx++}`;
      countSql += ` AND vv.host_staff_id = ${p}`;
      dataSql += ` AND vv.host_staff_id = ${p}`;
      params.push(effectiveHostStaffId);
    }

    // Status filter
    if (options?.status && Object.values(VisitorVisitStatus).includes(options.status as VisitorVisitStatus)) {
      const p = `$${pIdx++}`;
      countSql += ` AND vv.status = ${p}`;
      dataSql += ` AND vv.status = ${p}`;
      params.push(options.status);
    }

    // Date filter (matches YYYY-MM-DD in Lagos timezone using portable UTC range)
    if (options?.date && isValidDateString(options.date)) {
      const { startIso, endIso } = getLagosDateRange(options.date);
      const p1 = `$${pIdx++}`;
      const p2 = `$${pIdx++}`;
      countSql += ` AND vv.valid_from >= ${p1} AND vv.valid_from < ${p2}`;
      dataSql += ` AND vv.valid_from >= ${p1} AND vv.valid_from < ${p2}`;
      params.push(startIso, endIso);
    }

    // Search filter (case-insensitive across SQLite and PostgreSQL)
    if (options?.search && options.search.trim()) {
      const term = `%${options.search.trim().toLowerCase()}%`;
      const p = `$${pIdx++}`;
      const searchClause = ` AND (
        LOWER(vv.visitor_full_name) LIKE ${p} OR 
        LOWER(vv.visitor_email) LIKE ${p} OR 
        LOWER(vv.purpose) LIKE ${p} OR 
        LOWER(u.first_name) LIKE ${p} OR 
        LOWER(u.last_name) LIKE ${p}
      )`;
      countSql += searchClause;
      dataSql += searchClause;
      params.push(term);
    }

    // Pagination
    const page = Math.max(1, options?.page || 1);
    const limit = Math.min(100, Math.max(1, options?.limit || 20));
    const offset = (page - 1) * limit;

    const countRow = await dbAdapter.queryOne<{ count: number }>(countSql, [...params]);
    const total = Number(countRow?.count || 0);

    const limitP = `$${pIdx++}`;
    const offsetP = `$${pIdx++}`;
    dataSql += ` ORDER BY vv.valid_from DESC LIMIT ${limitP} OFFSET ${offsetP}`;
    const dataParams = [...params, limit, offset];

    const rows = await dbAdapter.query<any>(dataSql, dataParams);
    const visits: VisitorVisitRecord[] = rows.map((r) => this.mapVisitRecord(r, nowIso));

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
  public async getVisitById(
    visitId: string,
    actor: SafeUser,
    txClient?: DbAdapter
  ): Promise<{ success: boolean; visit?: VisitorVisitRecord; error?: string; status?: number }> {
    const db = txClient || dbAdapter;

    const row = await db.queryOne<any>(
      `
      SELECT 
        vv.id,
        vv.host_staff_id as "hostStaffId",
        vv.visitor_full_name as "visitorFullName",
        vv.visitor_phone as "visitorPhone",
        vv.visitor_email as "visitorEmail",
        vv.purpose,
        vv.notes,
        vv.valid_from as "validFrom",
        vv.valid_until as "validUntil",
        vv.status,
        vv.access_pass_id as "accessPassId",
        vv.created_at as "createdAt",
        vv.updated_at as "updatedAt",
        vv.cancelled_at as "cancelledAt",
        vv.cancelled_by as "cancelledBy",
        (u.first_name || ' ' || u.last_name) as "hostStaffName",
        u.department as "hostStaffDepartment",
        u.email as "hostStaffEmail",
        (cu.first_name || ' ' || cu.last_name) as "cancelledByName",
        ap.display_code as "passDisplayCode",
        ap.status as "passStatus",
        ap.valid_from as "passValidFrom",
        ap.valid_until as "passValidUntil",
        ap.max_uses as "passMaxUses",
        ap.use_count as "passUseCount",
        ap.revoked_at as "passRevokedAt",
        ap.revoke_reason as "passRevokeReason"
      FROM visitor_visits vv
      LEFT JOIN users u ON vv.host_staff_id = u.id
      LEFT JOIN users cu ON vv.cancelled_by = cu.id
      LEFT JOIN access_passes ap ON vv.access_pass_id = ap.id
      WHERE vv.id = $1
    `,
      [visitId]
    );

    if (!row) {
      return { success: false, error: 'Visitor invitation not found.', status: 404 };
    }

    const hostStaffId = row.hostStaffId ?? row.host_staff_id;
    // Cross-user authorization check: STAFF can only access their own visits
    if (actor.role === UserRole.STAFF && hostStaffId !== actor.id) {
      return {
        success: false,
        error: 'Forbidden: You are not authorized to view this visitor invitation.',
        status: 403,
      };
    }

    const nowIso = new Date().toISOString();
    return {
      success: true,
      visit: this.mapVisitRecord(row, nowIso),
    };
  }

  /**
   * Creates a new visitor invitation
   */
  public async createVisit(
    actor: SafeUser,
    input: CreateVisitorVisitInput,
    targetHostStaffId?: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ success: boolean; visit?: VisitorVisitRecord; error?: string; status?: number }> {
    // 1. Determine host staff ID:
    // STAFF can ONLY create for themselves. Never trust client body for host_staff_id when role is STAFF!
    let hostStaffId = actor.id;
    if (actor.role === UserRole.ADMIN || actor.role === UserRole.SUPER_ADMIN) {
      if (targetHostStaffId && targetHostStaffId.trim()) {
        hostStaffId = targetHostStaffId.trim();
      }
    }

    // Verify host staff user exists and is active
    const host = await dbAdapter.queryOne<{ id: string; first_name: string; last_name: string; department: string; email: string; status: string }>(
      'SELECT id, first_name, last_name, department, email, status FROM users WHERE id = $1',
      [hostStaffId]
    );
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
      const duplicate = await dbAdapter.queryOne<{ id: string }>(
        `
        SELECT id FROM visitor_visits
        WHERE host_staff_id = $1 
          AND LOWER(visitor_email) = LOWER($2)
          AND valid_from = $3
          AND valid_until = $4
          AND status != 'CANCELLED'
      `,
        [hostStaffId, visitorEmail, windowResult.validFrom, windowResult.validUntil]
      );

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
      await dbAdapter.execute(
        `
        INSERT INTO visitor_visits (
          id, host_staff_id, visitor_full_name, visitor_phone, visitor_email,
          purpose, notes, valid_from, valid_until, status, access_pass_id,
          created_at, updated_at, cancelled_at, cancelled_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL, $11, $12, NULL, NULL)
      `,
        [
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
          nowIso,
        ]
      );

      // 5. Immutable audit logging
      await auditService.log({
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

      const result = await this.getVisitById(id, actor);
      return { success: true, visit: result.visit };
    } catch (err) {
      console.error('[VisitorService] createVisit error:', err);
      return { success: false, error: 'Database error creating visitor invitation.', status: 500 };
    }
  }

  /**
   * Updates an existing visitor invitation
   */
  public async updateVisit(
    visitId: string,
    actor: SafeUser,
    input: UpdateVisitorVisitInput,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ success: boolean; visit?: VisitorVisitRecord; error?: string; status?: number }> {
    const existing = await dbAdapter.queryOne<any>('SELECT * FROM visitor_visits WHERE id = $1', [visitId]);
    if (!existing) {
      return { success: false, error: 'Visitor invitation not found.', status: 404 };
    }

    const hostStaffId = existing.host_staff_id ?? existing.hostStaffId;
    // Cross-user authorization check: STAFF can only update their own visits
    if (actor.role === UserRole.STAFF && hostStaffId !== actor.id) {
      return {
        success: false,
        error: 'Forbidden: You cannot modify another staff member\'s visitor invitation.',
        status: 403,
      };
    }

    if (existing.status === VisitorVisitStatus.CANCELLED) {
      return { success: false, error: 'Cannot update a cancelled visitor invitation.', status: 400 };
    }

    const visitorFullName = input.visitorFullName !== undefined ? this.normalizeString(input.visitorFullName) : (existing.visitor_full_name ?? existing.visitorFullName);
    if (input.visitorFullName !== undefined && !visitorFullName) {
      return { success: false, error: 'Visitor full name cannot be empty.', status: 400 };
    }

    const visitorPhone = input.visitorPhone !== undefined ? this.normalizeString(input.visitorPhone) : (existing.visitor_phone ?? existing.visitorPhone);
    const visitorEmail = input.visitorEmail !== undefined ? this.normalizeEmail(input.visitorEmail) : (existing.visitor_email ?? existing.visitorEmail);
    const purpose = input.purpose !== undefined ? this.normalizeString(input.purpose) : existing.purpose;
    const notes = input.notes !== undefined ? this.normalizeString(input.notes) : existing.notes;

    if (visitorEmail && !this.isValidEmail(visitorEmail)) {
      return { success: false, error: 'Please provide a valid visitor email address.', status: 400 };
    }

    // Time window update if date or times provided
    let validFrom = existing.valid_from ?? existing.validFrom;
    let validUntil = existing.valid_until ?? existing.validUntil;

    if (input.visitDate || input.startTime || input.endTime) {
      const dateStr = input.visitDate || validFrom.split('T')[0];
      const startTimeStr = input.startTime || formatTimeInTimezone(validFrom);
      const endTimeStr = input.endTime || formatTimeInTimezone(validUntil);

      const windowResult = this.computeValidityWindow(dateStr, startTimeStr, endTimeStr);
      if (!windowResult.valid || !windowResult.validFrom || !windowResult.validUntil) {
        return { success: false, error: windowResult.error || 'Invalid updated time window.', status: 400 };
      }
      validFrom = windowResult.validFrom;
      validUntil = windowResult.validUntil;
    }

    const nowIso = new Date().toISOString();
    const accessPassId = existing.access_pass_id ?? existing.accessPassId;

    try {
      await dbAdapter.transaction(async (tx) => {
        await tx.execute(
          `
          UPDATE visitor_visits
          SET visitor_full_name = $1, visitor_phone = $2, visitor_email = $3,
              purpose = $4, notes = $5, valid_from = $6, valid_until = $7, updated_at = $8
          WHERE id = $9
        `,
          [visitorFullName, visitorPhone, visitorEmail, purpose, notes, validFrom, validUntil, nowIso, visitId]
        );

        // If active access pass already exists, sync its validity window atomically
        if (accessPassId) {
          await tx.execute(
            `
            UPDATE access_passes
            SET valid_from = $1, valid_until = $2, updated_at = $3
            WHERE id = $4
          `,
            [validFrom, validUntil, nowIso, accessPassId]
          );
        }
      });

      await auditService.log({
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

      const updated = await this.getVisitById(visitId, actor);
      return { success: true, visit: updated.visit };
    } catch (err) {
      console.error('[VisitorService] updateVisit error:', err);
      return { success: false, error: 'Database error updating visitor invitation.', status: 500 };
    }
  }

  /**
   * Generates a VISITOR access pass for this invitation using Phase 6C infrastructure
   * Strictly atomic: pass creation and visitor record linkage commit or roll back together.
   */
  public async generateVisitorAccessPass(
    visitId: string,
    actor: SafeUser,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{
    success: boolean;
    visit?: VisitorVisitRecord;
    pass?: AccessPassRecord;
    error?: string;
    status?: number;
  }> {
    const visit = await dbAdapter.queryOne<any>('SELECT * FROM visitor_visits WHERE id = $1', [visitId]);
    if (!visit) {
      return { success: false, error: 'Visitor invitation not found.', status: 404 };
    }

    const hostStaffId = visit.host_staff_id ?? visit.hostStaffId;
    // Cross-user authorization check: STAFF can only generate pass for their own visitor
    if (actor.role === UserRole.STAFF && hostStaffId !== actor.id) {
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
    const validFrom = visit.valid_from ?? visit.validFrom;
    const validUntil = visit.valid_until ?? visit.validUntil;

    if (nowIso > validUntil) {
      return { success: false, error: 'Cannot issue an access pass for an expired visit window.', status: 400 };
    }

    try {
      const generatedPass = await dbAdapter.transaction(async (tx) => {
        // Generate individual VISITOR access pass via Phase 6C AccessService participating in this tx
        const passResult = await accessService.createVisitorAccessPass(
          actor,
          hostStaffId,
          {
            validFrom,
            validUntil,
            maxUses: 1, // Single-use visitor pass
          },
          ipAddress,
          userAgent,
          tx
        );

        if (!passResult.success || !passResult.pass) {
          throw new Error(passResult.error || 'Failed to generate visitor access pass.');
        }

        // Link access pass to visitor invitation on same tx
        await tx.execute(
          `
          UPDATE visitor_visits
          SET access_pass_id = $1, status = $2, updated_at = $3
          WHERE id = $4
        `,
          [passResult.pass.id, VisitorVisitStatus.ACCESS_ISSUED, nowIso, visitId]
        );

        return passResult.pass;
      });

      // Audit logging after transaction commits cleanly
      await auditService.log({
        actorId: actor.id,
        action: 'VISITOR_ACCESS_ISSUED',
        ipAddress,
        userAgent,
        metadata: {
          visitId,
          hostStaffId,
          visitorFullName: visit.visitor_full_name ?? visit.visitorFullName,
          passId: generatedPass.id,
          displayCode: generatedPass.displayCode,
          validFrom: generatedPass.validFrom,
          validUntil: generatedPass.validUntil,
        },
      });

      const updated = await this.getVisitById(visitId, actor);
      return {
        success: true,
        visit: updated.visit,
        pass: generatedPass,
      };
    } catch (err: any) {
      console.error('[VisitorService] generateVisitorAccessPass error:', err.message || err);
      return {
        success: false,
        error: err.message || 'Database error linking visitor access pass.',
        status: 500,
      };
    }
  }

  /**
   * Revokes a visitor's access pass while retaining the historical visit record.
   * Atomically reverts visit status to PENDING and marks pass REVOKED.
   */
  public async revokeVisitorAccess(
    visitId: string,
    actor: SafeUser,
    reason?: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ success: boolean; visit?: VisitorVisitRecord; error?: string; status?: number }> {
    const visit = await dbAdapter.queryOne<any>('SELECT * FROM visitor_visits WHERE id = $1', [visitId]);
    if (!visit) {
      return { success: false, error: 'Visitor invitation not found.', status: 404 };
    }

    const hostStaffId = visit.host_staff_id ?? visit.hostStaffId;
    // Cross-user authorization check: STAFF can only revoke their own visitors
    if (actor.role === UserRole.STAFF && hostStaffId !== actor.id) {
      return {
        success: false,
        error: 'Forbidden: You cannot revoke another staff member\'s visitor access.',
        status: 403,
      };
    }

    const accessPassId = visit.access_pass_id ?? visit.accessPassId;
    if (!accessPassId) {
      return { success: false, error: 'No active access pass found for this visitor invitation.', status: 400 };
    }

    const revokeReason = reason?.trim() || 'Visitor access revoked by host staff member';
    const nowIso = new Date().toISOString();

    try {
      await dbAdapter.transaction(async (tx) => {
        // Revoke the pass participating in tx
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

        // Revert status to PENDING while retaining historical visit and pass link
        await tx.execute(
          `
          UPDATE visitor_visits
          SET status = $1, updated_at = $2
          WHERE id = $3
        `,
          [VisitorVisitStatus.PENDING, nowIso, visitId]
        );
      });

      await auditService.log({
        actorId: actor.id,
        action: 'VISITOR_ACCESS_REVOKED',
        ipAddress,
        userAgent,
        metadata: {
          visitId,
          hostStaffId,
          visitorFullName: visit.visitor_full_name ?? visit.visitorFullName,
          accessPassId,
          reason: revokeReason,
        },
      });

      const updated = await this.getVisitById(visitId, actor);
      return { success: true, visit: updated.visit };
    } catch (err: any) {
      console.error('[VisitorService] revokeVisitorAccess error:', err.message || err);
      return {
        success: false,
        error: err.message || 'Database error updating visitor after revocation.',
        status: 500,
      };
    }
  }

  /**
   * Cancels a visitor invitation: revokes active pass, retains historical record, and logs audit
   */
  public async cancelVisit(
    visitId: string,
    actor: SafeUser,
    reason?: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ success: boolean; visit?: VisitorVisitRecord; error?: string; status?: number }> {
    const visit = await dbAdapter.queryOne<any>('SELECT * FROM visitor_visits WHERE id = $1', [visitId]);
    if (!visit) {
      return { success: false, error: 'Visitor invitation not found.', status: 404 };
    }

    const hostStaffId = visit.host_staff_id ?? visit.hostStaffId;
    // Cross-user authorization check: STAFF can only cancel their own visits
    if (actor.role === UserRole.STAFF && hostStaffId !== actor.id) {
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
    const accessPassId = visit.access_pass_id ?? visit.accessPassId;
    const nowIso = new Date().toISOString();

    try {
      await dbAdapter.transaction(async (tx) => {
        // If active access pass exists, automatically revoke it inside this transaction
        if (accessPassId) {
          const pass = await tx.queryOne<{ status: string }>('SELECT status FROM access_passes WHERE id = $1', [accessPassId]);
          if (pass && pass.status === AccessPassStatus.ACTIVE) {
            const revokeResult = await accessService.revokeAccessPass(
              accessPassId,
              actor,
              `Cancelled visit: ${cancelReason}`,
              ipAddress,
              userAgent,
              tx
            );
            if (!revokeResult.success) {
              throw new Error(revokeResult.error || 'Failed to revoke active access pass upon cancellation.');
            }
          }
        }

        await tx.execute(
          `
          UPDATE visitor_visits
          SET status = $1, cancelled_at = $2, cancelled_by = $3, updated_at = $4
          WHERE id = $5
        `,
          [VisitorVisitStatus.CANCELLED, nowIso, actor.id, nowIso, visitId]
        );
      });

      await auditService.log({
        actorId: actor.id,
        action: 'VISITOR_CANCELLED',
        ipAddress,
        userAgent,
        metadata: {
          visitId,
          hostStaffId,
          visitorFullName: visit.visitor_full_name ?? visit.visitorFullName,
          reason: cancelReason,
          previousStatus: visit.status,
          accessPassId,
        },
      });

      const updated = await this.getVisitById(visitId, actor);
      return { success: true, visit: updated.visit };
    } catch (err: any) {
      console.error('[VisitorService] cancelVisit error:', err.message || err);
      return {
        success: false,
        error: err.message || 'Database error cancelling visitor invitation.',
        status: 500,
      };
    }
  }
}

export const visitorService = new VisitorService();
