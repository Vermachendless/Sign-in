import { getDatabase } from '../db/index.ts';
import { generateId } from '../utils/crypto.ts';
import { auditService } from './audit.service.ts';
import { accessService } from './access.service.ts';
import {
  AccessVisitRecord,
  AccessVisitStatus,
  ReceptionVerificationResponse,
  ReceptionSummaryMetrics,
  SafeUser,
  UserRole,
  PassType,
  AccessPassStatus,
  EventStatus,
  InviteeStatus,
  VisitorVisitStatus,
} from '../../src/types/index.ts';
import {
  COMPANY_TIMEZONE,
  getTodayDateString,
  formatDateInTimezone,
  formatTimeInTimezone,
} from '../utils/time.ts';

export class ReceptionService {
  /**
   * Authoritative credential verification for reception desk
   * Verification is strictly separated from physical check-in.
   * Does NOT consume the pass and does NOT create a check-in visit.
   */
  public verifyCredential(
    actor: SafeUser,
    input: { accessCode?: string; token?: string },
    clientIp?: string,
    userAgent?: string
  ): {
    success: boolean;
    verification?: ReceptionVerificationResponse;
    error?: string;
    status?: number;
  } {
    // 1. RBAC: Only ADMIN and SUPER_ADMIN have reception access
    if (actor.role === UserRole.STAFF) {
      return {
        success: false,
        error: 'Forbidden: Reception verification is restricted to administrative staff.',
        status: 403,
      };
    }

    const code = input.accessCode?.trim();
    const token = input.token?.trim();

    if (!code && !token) {
      return {
        success: false,
        error: 'Please provide an access code or scan a QR credential.',
        status: 400,
      };
    }

    const db = getDatabase();

    // 2. Resolve the underlying access pass record first
    let passRow: any = null;
    if (token) {
      const tokenHash = accessService.hashToken(token);
      passRow = db.prepare('SELECT * FROM access_passes WHERE token_hash = ?').get(tokenHash);
    } else if (code) {
      const normalizedCode = accessService.normalizeCode(code);
      passRow = db.prepare('SELECT * FROM access_passes WHERE display_code = ? COLLATE NOCASE').get(normalizedCode);
    }

    if (!passRow) {
      auditService.log({
        actorId: actor.id,
        action: 'ACCESS_DENIED',
        ipAddress: clientIp,
        userAgent,
        metadata: {
          code: code || undefined,
          reason: 'PASS_NOT_FOUND',
          message: 'Invalid access code: Credential not found.',
        },
      });

      return {
        success: false,
        error: 'Invalid access code: Credential not found.',
        verification: {
          valid: false,
          code: 'PASS_NOT_FOUND',
          message: 'Invalid access code: Credential not found.',
          isCheckedIn: false,
          isCheckedOut: false,
          canCheckIn: false,
          canCheckOut: false,
          denialReason: 'Invalid access code: Credential not found.',
        },
        status: 404,
      };
    }

    // 3. Retrieve linked entity details (EVENT invitee or STAFF visitor)
    let guestName = 'Unknown Guest';
    let organization: string | null = null;
    let hostStaffName: string | null = null;
    let hostStaffDepartment: string | null = null;
    let eventTitle: string | null = null;
    let eventLocation: string | null = null;
    let visitDate: string | null = null;
    let formattedValidRange: string | null = null;
    let inviteeId: string | null = null;
    let visitorVisitId: string | null = null;
    let isInviteeCancelled = false;
    let isVisitorCancelled = false;

    if (passRow.pass_type === PassType.EVENT) {
      const invitee = db.prepare(`
        SELECT ei.id, ei.full_name, ei.organization, ei.status,
               e.title as event_title, e.location as event_location, e.start_at, e.end_at, e.status as event_status
        FROM event_invitees ei
        JOIN events e ON ei.event_id = e.id
        WHERE ei.access_pass_id = ?
      `).get(passRow.id) as any;

      if (invitee) {
        inviteeId = invitee.id;
        guestName = invitee.full_name;
        organization = invitee.organization || null;
        eventTitle = invitee.event_title;
        eventLocation = invitee.event_location;
        visitDate = formatDateInTimezone(invitee.start_at);
        formattedValidRange = `${formatTimeInTimezone(invitee.start_at)} – ${formatTimeInTimezone(invitee.end_at)}`;
        if (invitee.status === 'CANCELLED') {
          isInviteeCancelled = true;
        }
      }
    } else if (passRow.pass_type === PassType.VISITOR) {
      const visit = db.prepare(`
        SELECT vv.id, vv.visitor_full_name, vv.purpose, vv.status, vv.valid_from, vv.valid_until,
               u.first_name, u.last_name, u.department
        FROM visitor_visits vv
        JOIN users u ON vv.host_staff_id = u.id
        WHERE vv.access_pass_id = ?
      `).get(passRow.id) as any;

      if (visit) {
        visitorVisitId = visit.id;
        guestName = visit.visitor_full_name;
        hostStaffName = `${visit.first_name} ${visit.last_name}`.trim();
        hostStaffDepartment = visit.department || null;
        organization = visit.purpose || null;
        visitDate = formatDateInTimezone(visit.valid_from);
        formattedValidRange = `${formatTimeInTimezone(visit.valid_from)} – ${formatTimeInTimezone(visit.valid_until)}`;
        if (visit.status === 'CANCELLED') {
          isVisitorCancelled = true;
        }
      }
    }

    // 4. Check physical access visits status
    const latestVisit = db.prepare(`
      SELECT * FROM access_visits 
      WHERE access_pass_id = ?
      ORDER BY created_at DESC 
      LIMIT 1
    `).get(passRow.id) as any;

    const isCheckedIn = latestVisit?.status === 'CHECKED_IN';
    const isCheckedOut = latestVisit?.status === 'CHECKED_OUT';

    // 5. Handle already checked-in state
    if (isCheckedIn) {
      auditService.log({
        actorId: actor.id,
        action: 'ACCESS_VERIFIED',
        ipAddress: clientIp,
        userAgent,
        metadata: {
          passId: passRow.id,
          displayCode: passRow.display_code,
          passType: passRow.pass_type,
          guestName,
          isCheckedIn: true,
          isCheckedOut: false,
        },
      });

      return {
        success: true,
        verification: {
          valid: true,
          passId: passRow.id,
          passType: passRow.pass_type,
          displayCode: passRow.display_code,
          guestName,
          organization,
          hostStaffName,
          hostStaffDepartment,
          eventTitle,
          eventLocation,
          visitDate: visitDate || undefined,
          validFrom: passRow.valid_from,
          validUntil: passRow.valid_until,
          formattedValidRange: formattedValidRange || undefined,
          passStatus: passRow.status,
          isCheckedIn: true,
          isCheckedOut: false,
          canCheckIn: false,
          canCheckOut: true,
          activeVisitId: latestVisit.id,
          checkedInAt: latestVisit.checked_in_at,
          checkedOutAt: null,
        },
      };
    }

    // 6. Handle already checked-out state
    if (isCheckedOut) {
      auditService.log({
        actorId: actor.id,
        action: 'ACCESS_DENIED',
        ipAddress: clientIp,
        userAgent,
        metadata: {
          passId: passRow.id,
          displayCode: passRow.display_code,
          reason: 'ALREADY_CHECKED_OUT',
          message: 'Access already checked out',
        },
      });

      return {
        success: false,
        error: 'Access already checked out.',
        verification: {
          valid: false,
          code: 'ALREADY_CHECKED_OUT',
          message: 'Access already checked out',
          passId: passRow.id,
          passType: passRow.pass_type,
          displayCode: passRow.display_code,
          guestName,
          organization,
          hostStaffName,
          eventTitle,
          isCheckedIn: false,
          isCheckedOut: true,
          canCheckIn: false,
          canCheckOut: false,
          checkedInAt: latestVisit.checked_in_at,
          checkedOutAt: latestVisit.checked_out_at,
          denialReason: 'Access already checked out',
        },
        status: 400,
      };
    }

    // 7. Check cancellation states
    if (isInviteeCancelled) {
      auditService.log({
        actorId: actor.id,
        action: 'ACCESS_DENIED',
        ipAddress: clientIp,
        userAgent,
        metadata: {
          passId: passRow.id,
          displayCode: passRow.display_code,
          reason: 'INVITEE_CANCELLED',
        },
      });

      return {
        success: false,
        error: 'This event invitee has been cancelled.',
        verification: {
          valid: false,
          code: 'INVITEE_CANCELLED',
          message: 'This event invitee has been cancelled.',
          guestName,
          eventTitle,
          isCheckedIn: false,
          isCheckedOut: false,
          canCheckIn: false,
          canCheckOut: false,
          denialReason: 'Event invitee has been cancelled.',
        },
        status: 400,
      };
    }

    if (isVisitorCancelled) {
      auditService.log({
        actorId: actor.id,
        action: 'ACCESS_DENIED',
        ipAddress: clientIp,
        userAgent,
        metadata: {
          passId: passRow.id,
          displayCode: passRow.display_code,
          reason: 'VISIT_CANCELLED',
        },
      });

      return {
        success: false,
        error: 'This visitor invitation has been cancelled.',
        verification: {
          valid: false,
          code: 'VISIT_CANCELLED',
          message: 'This visitor invitation has been cancelled.',
          guestName,
          hostStaffName,
          isCheckedIn: false,
          isCheckedOut: false,
          canCheckIn: false,
          canCheckOut: false,
          denialReason: 'Visitor invitation has been cancelled.',
        },
        status: 400,
      };
    }

    // 8. Authoritative pass validity verification (not checked in yet)
    const verifyRes = accessService.verifyAccessPass({
      code: passRow.display_code,
      consumeUse: false,
      ipAddress: clientIp,
      userAgent,
      actor,
    });

    if (!verifyRes.valid) {
      auditService.log({
        actorId: actor.id,
        action: 'ACCESS_DENIED',
        ipAddress: clientIp,
        userAgent,
        metadata: {
          code: code || passRow.display_code,
          reason: verifyRes.code || 'INVALID_CREDENTIAL',
          message: verifyRes.message || 'Access verification denied',
        },
      });

      return {
        success: false,
        error: verifyRes.message || 'Credential verification failed.',
        verification: {
          valid: false,
          code: verifyRes.code,
          message: verifyRes.message,
          isCheckedIn: false,
          isCheckedOut: false,
          canCheckIn: false,
          canCheckOut: false,
          denialReason: verifyRes.message,
        },
        status: 400,
      };
    }

    // 9. Valid credential awaiting physical arrival
    auditService.log({
      actorId: actor.id,
      action: 'ACCESS_VERIFIED',
      ipAddress: clientIp,
      userAgent,
      metadata: {
        passId: passRow.id,
        displayCode: passRow.display_code,
        passType: passRow.pass_type,
        guestName,
        isCheckedIn: false,
        isCheckedOut: false,
      },
    });

    const response: ReceptionVerificationResponse = {
      valid: true,
      passId: passRow.id,
      passType: passRow.pass_type,
      displayCode: passRow.display_code,
      guestName,
      organization,
      hostStaffName,
      hostStaffDepartment,
      eventTitle,
      eventLocation,
      visitDate: visitDate || undefined,
      validFrom: passRow.valid_from,
      validUntil: passRow.valid_until,
      formattedValidRange: formattedValidRange || undefined,
      passStatus: passRow.status,
      isCheckedIn: false,
      isCheckedOut: false,
      canCheckIn: true,
      canCheckOut: false,
      activeVisitId: null,
      checkedInAt: null,
      checkedOutAt: null,
    };

    return {
      success: true,
      verification: response,
    };
  }

  /**
   * Confirms physical check-in for an authorized guest
   * Atomically records physical attendance and prevents duplicate active check-ins.
   */
  public checkIn(
    actor: SafeUser,
    input: { accessPassId?: string; accessCode?: string; token?: string },
    clientIp?: string,
    userAgent?: string
  ): {
    success: boolean;
    visit?: AccessVisitRecord;
    error?: string;
    status?: number;
  } {
    // 1. RBAC: Only ADMIN and SUPER_ADMIN
    if (actor.role === UserRole.STAFF) {
      return {
        success: false,
        error: 'Forbidden: Reception check-in is restricted to administrative staff.',
        status: 403,
      };
    }

    const db = getDatabase();

    // 2. Resolve access pass
    let pass: any = null;
    if (input.accessPassId) {
      pass = db.prepare('SELECT * FROM access_passes WHERE id = ?').get(input.accessPassId);
    } else if (input.accessCode) {
      const normalizedCode = accessService.normalizeCode(input.accessCode);
      pass = db.prepare('SELECT * FROM access_passes WHERE display_code = ? COLLATE NOCASE').get(normalizedCode);
    } else if (input.token) {
      const tokenHash = accessService.hashToken(input.token);
      pass = db.prepare('SELECT * FROM access_passes WHERE token_hash = ?').get(tokenHash);
    }

    if (!pass) {
      return {
        success: false,
        error: 'Access pass not found.',
        status: 404,
      };
    }

    // 3. Duplicate Check-in Protection: Check if already checked in or checked out
    const existingActive = db.prepare(`
      SELECT * FROM access_visits 
      WHERE access_pass_id = ? AND status = 'CHECKED_IN'
    `).get(pass.id) as any;

    if (existingActive) {
      return {
        success: false,
        error: 'Already checked in.',
        status: 409,
      };
    }

    const existingCompleted = db.prepare(`
      SELECT * FROM access_visits 
      WHERE access_pass_id = ? AND status = 'CHECKED_OUT'
    `).get(pass.id) as any;

    if (existingCompleted && pass.max_uses === 1) {
      return {
        success: false,
        error: 'This credential has already been used and checked out.',
        status: 400,
      };
    }

    // 4. Verify pass validity
    const verifyRes = accessService.verifyAccessPass({
      code: pass.display_code,
      consumeUse: false,
      ipAddress: clientIp,
      userAgent,
      actor,
    });

    if (!verifyRes.valid) {
      auditService.log({
        actorId: actor.id,
        action: 'ACCESS_DENIED',
        ipAddress: clientIp,
        userAgent,
        metadata: {
          passId: pass.id,
          displayCode: pass.display_code,
          reason: verifyRes.code || 'INVALID_ON_CHECKIN',
          message: verifyRes.message,
        },
      });

      return {
        success: false,
        error: verifyRes.message || 'Cannot check in: Access pass is invalid or expired.',
        status: 400,
      };
    }

    // 5. Resolve linked entity and verify lifecycle constraints
    let eventInviteeId: string | null = null;
    let visitorVisitId: string | null = null;
    let guestName = 'Unknown Guest';

    if (pass.pass_type === PassType.EVENT) {
      const invitee = db.prepare(`
        SELECT ei.id, ei.full_name, ei.status, e.status as event_status
        FROM event_invitees ei
        JOIN events e ON ei.event_id = e.id
        WHERE ei.access_pass_id = ?
      `).get(pass.id) as any;

      if (!invitee) {
        return {
          success: false,
          error: 'Associated event invitee record not found.',
          status: 404,
        };
      }

      if (invitee.status === 'CANCELLED') {
        return {
          success: false,
          error: 'Cannot check in: Event invitee is cancelled.',
          status: 400,
        };
      }

      if (invitee.event_status !== EventStatus.APPROVED) {
        return {
          success: false,
          error: 'Cannot check in: Event is not currently approved.',
          status: 400,
        };
      }

      eventInviteeId = invitee.id;
      guestName = invitee.full_name;
    } else if (pass.pass_type === PassType.VISITOR) {
      const visit = db.prepare(`
        SELECT vv.id, vv.visitor_full_name, vv.status
        FROM visitor_visits vv
        WHERE vv.access_pass_id = ?
      `).get(pass.id) as any;

      if (!visit) {
        return {
          success: false,
          error: 'Associated visitor invitation not found.',
          status: 404,
        };
      }

      if (visit.status === 'CANCELLED') {
        return {
          success: false,
          error: 'Cannot check in: Visitor invitation is cancelled.',
          status: 400,
        };
      }

      visitorVisitId = visit.id;
      guestName = visit.visitor_full_name;
    }

    // 6. Concurrency-safe atomic transaction
    const visitId = generateId();
    const nowIso = new Date().toISOString();

    try {
      db.exec('BEGIN IMMEDIATE;');

      const activeCheck = db.prepare(`
        SELECT id FROM access_visits WHERE access_pass_id = ? AND status = 'CHECKED_IN'
      `).get(pass.id);
      if (activeCheck) {
        db.exec('ROLLBACK;');
        return { success: false, error: 'Already checked in.', status: 409 };
      }

      const completedCheck = db.prepare(`
        SELECT id FROM access_visits WHERE access_pass_id = ? AND status = 'CHECKED_OUT'
      `).get(pass.id);
      if (completedCheck && pass.max_uses === 1) {
        db.exec('ROLLBACK;');
        return { success: false, error: 'This credential has already been used and checked out.', status: 400 };
      }

      // Insert access_visits record
      db.prepare(`
        INSERT INTO access_visits (
          id, access_pass_id, pass_type, event_invitee_id, visitor_visit_id,
          checked_in_at, checked_in_by, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'CHECKED_IN', ?, ?)
      `).run(
        visitId,
        pass.id,
        pass.pass_type,
        eventInviteeId,
        visitorVisitId,
        nowIso,
        actor.id,
        nowIso,
        nowIso
      );

      // Update event invitee lifecycle
      if (eventInviteeId) {
        db.prepare(`
          UPDATE event_invitees
          SET status = ?, updated_at = ?
          WHERE id = ?
        `).run(InviteeStatus.CHECKED_IN, nowIso, eventInviteeId);
      }

      // Update visitor visit lifecycle
      if (visitorVisitId) {
        db.prepare(`
          UPDATE visitor_visits
          SET status = ?, updated_at = ?
          WHERE id = ?
        `).run(VisitorVisitStatus.CHECKED_IN, nowIso, visitorVisitId);
      }

      // Increment pass use_count atomically
      db.prepare(`
        UPDATE access_passes
        SET use_count = use_count + 1,
            status = CASE WHEN max_uses IS NOT NULL AND use_count + 1 >= max_uses THEN 'EXHAUSTED' ELSE status END,
            updated_at = ?
        WHERE id = ?
      `).run(nowIso, pass.id);

      db.exec('COMMIT;');

      // 7. Immutable audit logging
      auditService.log({
        actorId: actor.id,
        action: 'ACCESS_CHECKED_IN',
        ipAddress: clientIp,
        userAgent,
        metadata: {
          visitId,
          passId: pass.id,
          passType: pass.pass_type,
          displayCode: pass.display_code,
          eventInviteeId,
          visitorVisitId,
          guestName,
          checkedInAt: nowIso,
        },
      });

      const record = this.getVisitRecordById(visitId);
      return { success: true, visit: record || undefined };
    } catch (err: any) {
      try { db.exec('ROLLBACK;'); } catch {}
      console.error('[ReceptionService] checkIn error:', err);
      return {
        success: false,
        error: 'Database error recording check-in.',
        status: 500,
      };
    }
  }

  /**
   * Confirms physical check-out for a currently checked-in guest
   * A person cannot be checked out before being checked in or checked out twice.
   */
  public checkOut(
    actor: SafeUser,
    input: { accessVisitId?: string; accessPassId?: string; accessCode?: string },
    clientIp?: string,
    userAgent?: string
  ): {
    success: boolean;
    visit?: AccessVisitRecord;
    error?: string;
    status?: number;
  } {
    // 1. RBAC: Only ADMIN and SUPER_ADMIN
    if (actor.role === UserRole.STAFF) {
      return {
        success: false,
        error: 'Forbidden: Reception check-out is restricted to administrative staff.',
        status: 403,
      };
    }

    const db = getDatabase();

    // 2. Locate the active access_visits record
    let visitRow: any = null;
    if (input.accessVisitId) {
      visitRow = db.prepare('SELECT * FROM access_visits WHERE id = ?').get(input.accessVisitId);
    } else if (input.accessPassId) {
      visitRow = db.prepare('SELECT * FROM access_visits WHERE access_pass_id = ? ORDER BY created_at DESC LIMIT 1').get(input.accessPassId);
    } else if (input.accessCode) {
      const normalizedCode = accessService.normalizeCode(input.accessCode);
      const pass = db.prepare('SELECT id FROM access_passes WHERE display_code = ? COLLATE NOCASE').get(normalizedCode) as any;
      if (pass) {
        visitRow = db.prepare('SELECT * FROM access_visits WHERE access_pass_id = ? ORDER BY created_at DESC LIMIT 1').get(pass.id);
      }
    }

    if (!visitRow) {
      return {
        success: false,
        error: 'Access visit record not found.',
        status: 404,
      };
    }

    // 3. Verify status constraints: Must be CHECKED_IN
    if (visitRow.status === 'CHECKED_OUT') {
      return {
        success: false,
        error: 'Person is already checked out.',
        status: 400,
      };
    }

    if (visitRow.status !== 'CHECKED_IN') {
      return {
        success: false,
        error: 'Person cannot be checked out before being checked in.',
        status: 400,
      };
    }

    const nowIso = new Date().toISOString();

    try {
      // 4. Atomic conditional update to prevent race conditions
      const updateRes = db.prepare(`
        UPDATE access_visits
        SET status = 'CHECKED_OUT',
            checked_out_at = ?,
            checked_out_by = ?,
            updated_at = ?
        WHERE id = ? AND status = 'CHECKED_IN'
      `).run(nowIso, actor.id, nowIso, visitRow.id);

      if (updateRes.changes === 0) {
        return {
          success: false,
          error: 'Check-out conflict: Person has already been checked out.',
          status: 409,
        };
      }

      // Update event invitee lifecycle
      if (visitRow.event_invitee_id) {
        db.prepare(`
          UPDATE event_invitees
          SET status = ?, updated_at = ?
          WHERE id = ?
        `).run(InviteeStatus.CHECKED_OUT, nowIso, visitRow.event_invitee_id);
      }

      // Update visitor visit lifecycle
      if (visitRow.visitor_visit_id) {
        db.prepare(`
          UPDATE visitor_visits
          SET status = ?, updated_at = ?
          WHERE id = ?
        `).run(VisitorVisitStatus.CHECKED_OUT, nowIso, visitRow.visitor_visit_id);
      }

      // 5. Immutable audit logging
      auditService.log({
        actorId: actor.id,
        action: 'ACCESS_CHECKED_OUT',
        ipAddress: clientIp,
        userAgent,
        metadata: {
          visitId: visitRow.id,
          passId: visitRow.access_pass_id,
          passType: visitRow.pass_type,
          checkedOutAt: nowIso,
        },
      });

      const updated = this.getVisitRecordById(visitRow.id);
      return { success: true, visit: updated || undefined };
    } catch (err: any) {
      console.error('[ReceptionService] checkOut error:', err);
      return {
        success: false,
        error: 'Database error recording check-out.',
        status: 500,
      };
    }
  }

  /**
   * Authoritative query for currently checked-in persons on premises
   * Only records with status = 'CHECKED_IN' are returned.
   */
  public listActive(
    actor: SafeUser,
    options?: { search?: string }
  ): {
    success: boolean;
    activeVisits: AccessVisitRecord[];
    total: number;
    error?: string;
    status?: number;
  } {
    if (actor.role === UserRole.STAFF) {
      return {
        success: false,
        activeVisits: [],
        total: 0,
        error: 'Forbidden: Active occupancy query restricted to administrators.',
        status: 403,
      };
    }

    const db = getDatabase();
    let sql = `
      SELECT 
        av.id,
        av.access_pass_id as accessPassId,
        av.pass_type as passType,
        av.event_invitee_id as eventInviteeId,
        av.visitor_visit_id as visitorVisitId,
        av.checked_in_at as checkedInAt,
        av.checked_in_by as checkedInBy,
        av.checked_out_at as checkedOutAt,
        av.checked_out_by as checkedOutBy,
        av.status,
        av.denial_reason as denialReason,
        av.created_at as createdAt,
        av.updated_at as updatedAt,
        ap.display_code as displayCode,
        COALESCE(ei.full_name, vv.visitor_full_name, 'Guest') as guestName,
        COALESCE(ei.email, vv.visitor_email) as guestEmail,
        COALESCE(ei.phone, vv.visitor_phone) as guestPhone,
        ei.organization as guestOrganization,
        COALESCE(e.title, (hu.first_name || ' ' || hu.last_name), 'Reception') as hostOrEventTitle,
        e.location as eventLocation,
        (cu.first_name || ' ' || cu.last_name) as checkedInByName
      FROM access_visits av
      JOIN access_passes ap ON av.access_pass_id = ap.id
      LEFT JOIN event_invitees ei ON av.event_invitee_id = ei.id
      LEFT JOIN events e ON ei.event_id = e.id
      LEFT JOIN visitor_visits vv ON av.visitor_visit_id = vv.id
      LEFT JOIN users hu ON vv.host_staff_id = hu.id
      LEFT JOIN users cu ON av.checked_in_by = cu.id
      WHERE av.status = 'CHECKED_IN'
    `;

    const params: string[] = [];
    if (options?.search?.trim()) {
      const q = `%${options.search.trim()}%`;
      sql += `
        AND (
          ei.full_name LIKE ? OR
          vv.visitor_full_name LIKE ? OR
          ap.display_code LIKE ? OR
          e.title LIKE ? OR
          hu.first_name LIKE ? OR
          hu.last_name LIKE ?
        )
      `;
      params.push(q, q, q, q, q, q);
    }

    sql += ' ORDER BY av.checked_in_at DESC';

    const rows = db.prepare(sql).all(...params) as any[];

    const activeVisits: AccessVisitRecord[] = rows.map((r) => ({
      ...r,
      formattedCheckedInAt: r.checkedInAt ? `${formatDateInTimezone(r.checkedInAt)} ${formatTimeInTimezone(r.checkedInAt)}` : undefined,
      formattedCheckedOutAt: r.checkedOutAt ? `${formatDateInTimezone(r.checkedOutAt)} ${formatTimeInTimezone(r.checkedOutAt)}` : undefined,
    }));

    return {
      success: true,
      activeVisits,
      total: activeVisits.length,
    };
  }

  /**
   * Retrieves historical access visits with pagination and search/filtering
   */
  public listHistory(
    actor: SafeUser,
    options?: {
      search?: string;
      status?: string;
      passType?: string;
      date?: string;
      page?: number;
      limit?: number;
    }
  ): {
    success: boolean;
    visits: AccessVisitRecord[];
    total: number;
    page: number;
    limit: number;
    error?: string;
    status?: number;
  } {
    if (actor.role === UserRole.STAFF) {
      return {
        success: false,
        visits: [],
        total: 0,
        page: 1,
        limit: 20,
        error: 'Forbidden: Reception history is restricted to administrators.',
        status: 403,
      };
    }

    const db = getDatabase();
    const page = Math.max(1, options?.page || 1);
    const limit = Math.min(100, Math.max(1, options?.limit || 20));
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE 1=1';
    const params: (string | number)[] = [];

    if (options?.status) {
      whereClause += ' AND av.status = ?';
      params.push(options.status);
    }

    if (options?.passType) {
      whereClause += ' AND av.pass_type = ?';
      params.push(options.passType);
    }

    if (options?.date) {
      whereClause += " AND DATE(av.created_at, '+1 hour') = ?";
      params.push(options.date);
    }

    if (options?.search?.trim()) {
      const q = `%${options.search.trim()}%`;
      whereClause += `
        AND (
          ei.full_name LIKE ? OR
          vv.visitor_full_name LIKE ? OR
          ap.display_code LIKE ? OR
          e.title LIKE ? OR
          hu.first_name LIKE ? OR
          hu.last_name LIKE ?
        )
      `;
      params.push(q, q, q, q, q, q);
    }

    const countSql = `
      SELECT COUNT(*) as total
      FROM access_visits av
      JOIN access_passes ap ON av.access_pass_id = ap.id
      LEFT JOIN event_invitees ei ON av.event_invitee_id = ei.id
      LEFT JOIN events e ON ei.event_id = e.id
      LEFT JOIN visitor_visits vv ON av.visitor_visit_id = vv.id
      LEFT JOIN users hu ON vv.host_staff_id = hu.id
      ${whereClause}
    `;

    const countRow = db.prepare(countSql).get(...params) as any;
    const total = Number(countRow?.total || 0);

    const dataSql = `
      SELECT 
        av.id,
        av.access_pass_id as accessPassId,
        av.pass_type as passType,
        av.event_invitee_id as eventInviteeId,
        av.visitor_visit_id as visitorVisitId,
        av.checked_in_at as checkedInAt,
        av.checked_in_by as checkedInBy,
        av.checked_out_at as checkedOutAt,
        av.checked_out_by as checkedOutBy,
        av.status,
        av.denial_reason as denialReason,
        av.created_at as createdAt,
        av.updated_at as updatedAt,
        ap.display_code as displayCode,
        COALESCE(ei.full_name, vv.visitor_full_name, 'Guest') as guestName,
        COALESCE(ei.email, vv.visitor_email) as guestEmail,
        COALESCE(ei.phone, vv.visitor_phone) as guestPhone,
        ei.organization as guestOrganization,
        COALESCE(e.title, (hu.first_name || ' ' || hu.last_name), 'Reception') as hostOrEventTitle,
        e.location as eventLocation,
        (cu.first_name || ' ' || cu.last_name) as checkedInByName,
        (co.first_name || ' ' || co.last_name) as checkedOutByName
      FROM access_visits av
      JOIN access_passes ap ON av.access_pass_id = ap.id
      LEFT JOIN event_invitees ei ON av.event_invitee_id = ei.id
      LEFT JOIN events e ON ei.event_id = e.id
      LEFT JOIN visitor_visits vv ON av.visitor_visit_id = vv.id
      LEFT JOIN users hu ON vv.host_staff_id = hu.id
      LEFT JOIN users cu ON av.checked_in_by = cu.id
      LEFT JOIN users co ON av.checked_out_by = co.id
      ${whereClause}
      ORDER BY av.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const rows = db.prepare(dataSql).all(...params, limit, offset) as any[];

    const visits: AccessVisitRecord[] = rows.map((r) => ({
      ...r,
      formattedCheckedInAt: r.checkedInAt ? `${formatDateInTimezone(r.checkedInAt)} ${formatTimeInTimezone(r.checkedInAt)}` : undefined,
      formattedCheckedOutAt: r.checkedOutAt ? `${formatDateInTimezone(r.checkedOutAt)} ${formatTimeInTimezone(r.checkedOutAt)}` : undefined,
    }));

    return {
      success: true,
      visits,
      total,
      page,
      limit,
    };
  }

  /**
   * Retrieves summary metrics for the Reception Dashboard
   */
  public getSummary(actor: SafeUser): {
    success: boolean;
    summary: ReceptionSummaryMetrics;
    error?: string;
    status?: number;
  } {
    if (actor.role === UserRole.STAFF) {
      return {
        success: false,
        summary: {
          currentlyCheckedIn: 0,
          todayVisitors: 0,
          todayEventGuests: 0,
          checkedOutToday: 0,
          accessDeniedToday: 0,
        },
        error: 'Forbidden: Reception summary restricted to administrators.',
        status: 403,
      };
    }

    const db = getDatabase();
    const todayStr = getTodayDateString(COMPANY_TIMEZONE);

    // 1. Currently checked in
    const activeRow = db.prepare("SELECT COUNT(*) as count FROM access_visits WHERE status = 'CHECKED_IN'").get() as any;
    const currentlyCheckedIn = Number(activeRow?.count || 0);

    // 2. Today's visitors checked in
    const visitorRow = db.prepare(`
      SELECT COUNT(*) as count FROM access_visits 
      WHERE pass_type = 'VISITOR' 
        AND checked_in_at IS NOT NULL 
        AND DATE(checked_in_at, '+1 hour') = ?
    `).get(todayStr) as any;
    const todayVisitors = Number(visitorRow?.count || 0);

    // 3. Today's event guests checked in
    const eventRow = db.prepare(`
      SELECT COUNT(*) as count FROM access_visits 
      WHERE pass_type = 'EVENT' 
        AND checked_in_at IS NOT NULL 
        AND DATE(checked_in_at, '+1 hour') = ?
    `).get(todayStr) as any;
    const todayEventGuests = Number(eventRow?.count || 0);

    // 4. Checked out today
    const checkedOutRow = db.prepare(`
      SELECT COUNT(*) as count FROM access_visits 
      WHERE status = 'CHECKED_OUT' 
        AND checked_out_at IS NOT NULL 
        AND DATE(checked_out_at, '+1 hour') = ?
    `).get(todayStr) as any;
    const checkedOutToday = Number(checkedOutRow?.count || 0);

    // 5. Access denied today
    const deniedRow = db.prepare(`
      SELECT COUNT(*) as count FROM audit_logs 
      WHERE action = 'ACCESS_DENIED' 
        AND DATE(created_at, '+1 hour') = ?
    `).get(todayStr) as any;
    const accessDeniedToday = Number(deniedRow?.count || 0);

    return {
      success: true,
      summary: {
        currentlyCheckedIn,
        todayVisitors,
        todayEventGuests,
        checkedOutToday,
        accessDeniedToday,
      },
    };
  }

  /**
   * Helper to fetch full populated AccessVisitRecord by ID
   */
  public getVisitRecordById(visitId: string): AccessVisitRecord | null {
    const db = getDatabase();
    const r = db.prepare(`
      SELECT 
        av.id,
        av.access_pass_id as accessPassId,
        av.pass_type as passType,
        av.event_invitee_id as eventInviteeId,
        av.visitor_visit_id as visitorVisitId,
        av.checked_in_at as checkedInAt,
        av.checked_in_by as checkedInBy,
        av.checked_out_at as checkedOutAt,
        av.checked_out_by as checkedOutBy,
        av.status,
        av.denial_reason as denialReason,
        av.created_at as createdAt,
        av.updated_at as updatedAt,
        ap.display_code as displayCode,
        COALESCE(ei.full_name, vv.visitor_full_name, 'Guest') as guestName,
        COALESCE(ei.email, vv.visitor_email) as guestEmail,
        COALESCE(ei.phone, vv.visitor_phone) as guestPhone,
        ei.organization as guestOrganization,
        COALESCE(e.title, (hu.first_name || ' ' || hu.last_name), 'Reception') as hostOrEventTitle,
        e.location as eventLocation,
        (cu.first_name || ' ' || cu.last_name) as checkedInByName,
        (co.first_name || ' ' || co.last_name) as checkedOutByName
      FROM access_visits av
      JOIN access_passes ap ON av.access_pass_id = ap.id
      LEFT JOIN event_invitees ei ON av.event_invitee_id = ei.id
      LEFT JOIN events e ON ei.event_id = e.id
      LEFT JOIN visitor_visits vv ON av.visitor_visit_id = vv.id
      LEFT JOIN users hu ON vv.host_staff_id = hu.id
      LEFT JOIN users cu ON av.checked_in_by = cu.id
      LEFT JOIN users co ON av.checked_out_by = co.id
      WHERE av.id = ?
    `).get(visitId) as any;

    if (!r) return null;

    return {
      ...r,
      formattedCheckedInAt: r.checkedInAt ? `${formatDateInTimezone(r.checkedInAt)} ${formatTimeInTimezone(r.checkedInAt)}` : undefined,
      formattedCheckedOutAt: r.checkedOutAt ? `${formatDateInTimezone(r.checkedOutAt)} ${formatTimeInTimezone(r.checkedOutAt)}` : undefined,
    };
  }
}

export const receptionService = new ReceptionService();
