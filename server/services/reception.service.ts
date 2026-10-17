import { dbAdapter, type DbAdapter } from '../db/adapter.ts';
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

/**
 * Computes ISO UTC boundaries for a single calendar date in Africa/Lagos (+01:00)
 */
function getLagosDateRange(dateStr: string): { startIso: string; endIso: string } {
  const startMs = new Date(`${dateStr}T00:00:00+01:00`).getTime();
  const endMs = startMs + 24 * 60 * 60 * 1000;
  return {
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
  };
}

/**
 * Computes ISO UTC boundaries for an inclusive calendar date range in Africa/Lagos (+01:00)
 */
function getLagosRangeForDates(startDate?: string, endDate?: string): { startIso?: string; endIso?: string } {
  let startIso: string | undefined;
  let endIso: string | undefined;
  if (startDate) {
    startIso = new Date(`${startDate}T00:00:00+01:00`).toISOString();
  }
  if (endDate) {
    const endMs = new Date(`${endDate}T00:00:00+01:00`).getTime() + 24 * 60 * 60 * 1000;
    endIso = new Date(endMs).toISOString();
  }
  return { startIso, endIso };
}

export class ReceptionService {
  /**
   * Helper to map a raw database query row to a strongly-typed AccessVisitRecord.
   * Handles casing variations between SQLite and PostgreSQL.
   */
  private mapAccessVisitRecord(r: any): AccessVisitRecord {
    const checkedInAt = r.checkedInAt ?? r.checked_in_at ?? null;
    const checkedOutAt = r.checkedOutAt ?? r.checked_out_at ?? null;
    return {
      id: r.id,
      accessPassId: r.accessPassId ?? r.access_pass_id,
      passType: r.passType ?? r.pass_type,
      eventInviteeId: r.eventInviteeId ?? r.event_invitee_id ?? null,
      visitorVisitId: r.visitorVisitId ?? r.visitor_visit_id ?? null,
      checkedInAt,
      checkedInBy: r.checkedInBy ?? r.checked_in_by ?? null,
      checkedOutAt,
      checkedOutBy: r.checkedOutBy ?? r.checked_out_by ?? null,
      status: r.status,
      denialReason: r.denialReason ?? r.denial_reason ?? null,
      createdAt: r.createdAt ?? r.created_at,
      updatedAt: r.updatedAt ?? r.updated_at,
      displayCode: r.displayCode ?? r.display_code,
      guestName: r.guestName ?? r.guest_name,
      guestEmail: r.guestEmail ?? r.guest_email ?? null,
      guestPhone: r.guestPhone ?? r.guest_phone ?? null,
      guestOrganization: r.guestOrganization ?? r.guest_organization ?? null,
      purpose: r.purpose ?? null,
      hostStaffName: r.hostStaffName ?? r.host_staff_name ?? null,
      eventTitle: r.eventTitle ?? r.event_title ?? null,
      hostOrEventTitle: r.hostOrEventTitle ?? r.host_or_event_title ?? null,
      eventLocation: r.eventLocation ?? r.event_location ?? null,
      checkedInByName: r.checkedInByName ?? r.checked_in_by_name ?? null,
      checkedOutByName: r.checkedOutByName ?? r.checked_out_by_name ?? null,
      formattedCheckedInAt: checkedInAt ? `${formatDateInTimezone(checkedInAt)} ${formatTimeInTimezone(checkedInAt)}` : undefined,
      formattedCheckedOutAt: checkedOutAt ? `${formatDateInTimezone(checkedOutAt)} ${formatTimeInTimezone(checkedOutAt)}` : undefined,
    };
  }

  /**
   * Authoritative credential verification for reception desk
   * Verification is strictly separated from physical check-in.
   * Does NOT consume the pass and does NOT create a check-in visit.
   */
  public async verifyCredential(
    actor: SafeUser,
    input: { accessCode?: string; token?: string },
    clientIp?: string,
    userAgent?: string
  ): Promise<{
    success: boolean;
    verification?: ReceptionVerificationResponse;
    error?: string;
    status?: number;
  }> {
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

    // 2. Resolve the underlying access pass record first
    let passRow: any = null;
    if (token) {
      const tokenHash = accessService.hashToken(token);
      passRow = await dbAdapter.queryOne<any>('SELECT * FROM access_passes WHERE token_hash = $1', [tokenHash]);
    } else if (code) {
      const normalizedCode = accessService.normalizeCode(code);
      passRow = await dbAdapter.queryOne<any>('SELECT * FROM access_passes WHERE LOWER(display_code) = LOWER($1)', [normalizedCode]);
    }

    if (!passRow) {
      await auditService.log({
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
    let isInviteeCancelled = false;
    let isVisitorCancelled = false;

    if (passRow.pass_type === PassType.EVENT) {
      const invitee = await dbAdapter.queryOne<any>(`
        SELECT ei.id, ei.full_name, ei.organization, ei.status,
               e.title as event_title, e.location as event_location, e.start_at, e.end_at, e.status as event_status
        FROM event_invitees ei
        JOIN events e ON ei.event_id = e.id
        WHERE ei.access_pass_id = $1
      `, [passRow.id]);

      if (invitee) {
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
      const visit = await dbAdapter.queryOne<any>(`
        SELECT vv.id, vv.visitor_full_name, vv.purpose, vv.status, vv.valid_from, vv.valid_until,
               u.first_name, u.last_name, u.department
        FROM visitor_visits vv
        JOIN users u ON vv.host_staff_id = u.id
        WHERE vv.access_pass_id = $1
      `, [passRow.id]);

      if (visit) {
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
    const latestVisit = await dbAdapter.queryOne<any>(`
      SELECT * FROM access_visits 
      WHERE access_pass_id = $1
      ORDER BY created_at DESC 
      LIMIT 1
    `, [passRow.id]);

    const isCheckedIn = latestVisit?.status === 'CHECKED_IN';
    const isCheckedOut = latestVisit?.status === 'CHECKED_OUT';

    // 5. Handle already checked-in state
    if (isCheckedIn) {
      await auditService.log({
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
      await auditService.log({
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
      await auditService.log({
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
      await auditService.log({
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
    const verifyRes = await accessService.verifyAccessPass({
      code: passRow.display_code,
      consumeUse: false,
      ipAddress: clientIp,
      userAgent,
      actor,
    });

    if (!verifyRes.valid) {
      await auditService.log({
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
    await auditService.log({
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
  public async checkIn(
    actor: SafeUser,
    input: { accessPassId?: string; accessCode?: string; token?: string },
    clientIp?: string,
    userAgent?: string
  ): Promise<{
    success: boolean;
    visit?: AccessVisitRecord;
    error?: string;
    status?: number;
  }> {
    // 1. RBAC: Only ADMIN and SUPER_ADMIN
    if (actor.role === UserRole.STAFF) {
      return {
        success: false,
        error: 'Forbidden: Reception check-in is restricted to administrative staff.',
        status: 403,
      };
    }

    // 2. Resolve access pass
    let pass: any = null;
    if (input.accessPassId) {
      pass = await dbAdapter.queryOne<any>('SELECT * FROM access_passes WHERE id = $1', [input.accessPassId]);
    } else if (input.accessCode) {
      const normalizedCode = accessService.normalizeCode(input.accessCode);
      pass = await dbAdapter.queryOne<any>('SELECT * FROM access_passes WHERE LOWER(display_code) = LOWER($1)', [normalizedCode]);
    } else if (input.token) {
      const tokenHash = accessService.hashToken(input.token);
      pass = await dbAdapter.queryOne<any>('SELECT * FROM access_passes WHERE token_hash = $1', [tokenHash]);
    }

    if (!pass) {
      return {
        success: false,
        error: 'Access pass not found.',
        status: 404,
      };
    }

    // 3. Duplicate Check-in Protection: Check if already checked in or checked out
    const existingActive = await dbAdapter.queryOne<any>(`
      SELECT * FROM access_visits 
      WHERE access_pass_id = $1 AND status = 'CHECKED_IN'
    `, [pass.id]);

    if (existingActive) {
      return {
        success: false,
        error: 'Already checked in.',
        status: 409,
      };
    }

    const existingCompleted = await dbAdapter.queryOne<any>(`
      SELECT * FROM access_visits 
      WHERE access_pass_id = $1 AND status = 'CHECKED_OUT'
    `, [pass.id]);

    if (existingCompleted && pass.max_uses === 1) {
      return {
        success: false,
        error: 'This credential has already been used and checked out.',
        status: 400,
      };
    }

    // 4. Verify pass validity
    const verifyRes = await accessService.verifyAccessPass({
      code: pass.display_code,
      consumeUse: false,
      ipAddress: clientIp,
      userAgent,
      actor,
    });

    if (!verifyRes.valid) {
      await auditService.log({
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
      const invitee = await dbAdapter.queryOne<any>(`
        SELECT ei.id, ei.full_name, ei.status, e.status as event_status
        FROM event_invitees ei
        JOIN events e ON ei.event_id = e.id
        WHERE ei.access_pass_id = $1
      `, [pass.id]);

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
      const visit = await dbAdapter.queryOne<any>(`
        SELECT vv.id, vv.visitor_full_name, vv.status
        FROM visitor_visits vv
        WHERE vv.access_pass_id = $1
      `, [pass.id]);

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
      await dbAdapter.transaction(async (tx) => {
        const activeCheck = await tx.queryOne<any>(`
          SELECT id FROM access_visits WHERE access_pass_id = $1 AND status = 'CHECKED_IN'
        `, [pass.id]);
        if (activeCheck) {
          const err: any = new Error('Already checked in.');
          err.status = 409;
          throw err;
        }

        const completedCheck = await tx.queryOne<any>(`
          SELECT id FROM access_visits WHERE access_pass_id = $1 AND status = 'CHECKED_OUT'
        `, [pass.id]);
        if (completedCheck && pass.max_uses === 1) {
          const err: any = new Error('This credential has already been used and checked out.');
          err.status = 400;
          throw err;
        }

        // Insert access_visits record
        await tx.execute(`
          INSERT INTO access_visits (
            id, access_pass_id, pass_type, event_invitee_id, visitor_visit_id,
            checked_in_at, checked_in_by, status, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'CHECKED_IN', $8, $9)
        `, [
          visitId,
          pass.id,
          pass.pass_type,
          eventInviteeId,
          visitorVisitId,
          nowIso,
          actor.id,
          nowIso,
          nowIso,
        ]);

        // Update event invitee lifecycle
        if (eventInviteeId) {
          await tx.execute(`
            UPDATE event_invitees
            SET status = $1, updated_at = $2
            WHERE id = $3
          `, [InviteeStatus.CHECKED_IN, nowIso, eventInviteeId]);
        }

        // Update visitor visit lifecycle
        if (visitorVisitId) {
          await tx.execute(`
            UPDATE visitor_visits
            SET status = $1, updated_at = $2
            WHERE id = $3
          `, [VisitorVisitStatus.CHECKED_IN, nowIso, visitorVisitId]);
        }

        // Increment pass use_count atomically
        await tx.execute(`
          UPDATE access_passes
          SET use_count = use_count + 1,
              status = CASE WHEN max_uses IS NOT NULL AND use_count + 1 >= max_uses THEN 'EXHAUSTED' ELSE status END,
              updated_at = $1
          WHERE id = $2
        `, [nowIso, pass.id]);
      });

      // 7. Immutable audit logging after successful transaction commit
      await auditService.log({
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

      const record = await this.getVisitRecordById(visitId);
      return { success: true, visit: record || undefined };
    } catch (err: any) {
      if (err.status) {
        return {
          success: false,
          error: err.message,
          status: err.status,
        };
      }
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
  public async checkOut(
    actor: SafeUser,
    input: { accessVisitId?: string; accessPassId?: string; accessCode?: string },
    clientIp?: string,
    userAgent?: string
  ): Promise<{
    success: boolean;
    visit?: AccessVisitRecord;
    error?: string;
    status?: number;
  }> {
    // 1. RBAC: Only ADMIN and SUPER_ADMIN
    if (actor.role === UserRole.STAFF) {
      return {
        success: false,
        error: 'Forbidden: Reception check-out is restricted to administrative staff.',
        status: 403,
      };
    }

    // 2. Locate the active access_visits record
    let visitRow: any = null;
    if (input.accessVisitId) {
      visitRow = await dbAdapter.queryOne<any>('SELECT * FROM access_visits WHERE id = $1', [input.accessVisitId]);
    } else if (input.accessPassId) {
      visitRow = await dbAdapter.queryOne<any>('SELECT * FROM access_visits WHERE access_pass_id = $1 ORDER BY created_at DESC LIMIT 1', [input.accessPassId]);
    } else if (input.accessCode) {
      const normalizedCode = accessService.normalizeCode(input.accessCode);
      const pass = await dbAdapter.queryOne<any>('SELECT id FROM access_passes WHERE LOWER(display_code) = LOWER($1)', [normalizedCode]);
      if (pass) {
        visitRow = await dbAdapter.queryOne<any>('SELECT * FROM access_visits WHERE access_pass_id = $1 ORDER BY created_at DESC LIMIT 1', [pass.id]);
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
      await dbAdapter.transaction(async (tx) => {
        // 4. Atomic conditional update to prevent race conditions
        const updateRes = await tx.execute(`
          UPDATE access_visits
          SET status = 'CHECKED_OUT',
              checked_out_at = $1,
              checked_out_by = $2,
              updated_at = $3
          WHERE id = $4 AND status = 'CHECKED_IN'
        `, [nowIso, actor.id, nowIso, visitRow.id]);

        if (updateRes.rowCount === 0) {
          const err: any = new Error('Check-out conflict: Person has already been checked out.');
          err.status = 409;
          throw err;
        }

        // Update event invitee lifecycle
        if (visitRow.event_invitee_id) {
          await tx.execute(`
            UPDATE event_invitees
            SET status = $1, updated_at = $2
            WHERE id = $3
          `, [InviteeStatus.CHECKED_OUT, nowIso, visitRow.event_invitee_id]);
        }

        // Update visitor visit lifecycle
        if (visitRow.visitor_visit_id) {
          await tx.execute(`
            UPDATE visitor_visits
            SET status = $1, updated_at = $2
            WHERE id = $3
          `, [VisitorVisitStatus.CHECKED_OUT, nowIso, visitRow.visitor_visit_id]);
        }
      });

      // 5. Immutable audit logging after successful transaction commit
      await auditService.log({
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

      const updated = await this.getVisitRecordById(visitRow.id);
      return { success: true, visit: updated || undefined };
    } catch (err: any) {
      if (err.status) {
        return {
          success: false,
          error: err.message,
          status: err.status,
        };
      }
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
  public async listActive(
    actor: SafeUser,
    options?: { search?: string }
  ): Promise<{
    success: boolean;
    activeVisits: AccessVisitRecord[];
    total: number;
    error?: string;
    status?: number;
  }> {
    if (actor.role === UserRole.STAFF) {
      return {
        success: false,
        activeVisits: [],
        total: 0,
        error: 'Forbidden: Active occupancy query restricted to administrators.',
        status: 403,
      };
    }

    let sql = `
      SELECT 
        av.id,
        av.access_pass_id as access_pass_id,
        av.pass_type as pass_type,
        av.event_invitee_id as event_invitee_id,
        av.visitor_visit_id as visitor_visit_id,
        av.checked_in_at as checked_in_at,
        av.checked_in_by as checked_in_by,
        av.checked_out_at as checked_out_at,
        av.checked_out_by as checked_out_by,
        av.status,
        av.denial_reason as denial_reason,
        av.created_at as created_at,
        av.updated_at as updated_at,
        ap.display_code as display_code,
        COALESCE(ei.full_name, vv.visitor_full_name, 'Guest') as guest_name,
        COALESCE(ei.email, vv.visitor_email) as guest_email,
        COALESCE(ei.phone, vv.visitor_phone) as guest_phone,
        ei.organization as guest_organization,
        vv.purpose as purpose,
        (hu.first_name || ' ' || hu.last_name) as host_staff_name,
        e.title as event_title,
        COALESCE(e.title, (hu.first_name || ' ' || hu.last_name), 'Reception') as host_or_event_title,
        e.location as event_location,
        (cu.first_name || ' ' || cu.last_name) as checked_in_by_name,
        (co.first_name || ' ' || co.last_name) as checked_out_by_name
      FROM access_visits av
      JOIN access_passes ap ON av.access_pass_id = ap.id
      LEFT JOIN event_invitees ei ON av.event_invitee_id = ei.id
      LEFT JOIN events e ON ei.event_id = e.id
      LEFT JOIN visitor_visits vv ON av.visitor_visit_id = vv.id
      LEFT JOIN users hu ON vv.host_staff_id = hu.id
      LEFT JOIN users cu ON av.checked_in_by = cu.id
      LEFT JOIN users co ON av.checked_out_by = co.id
      WHERE av.status = 'CHECKED_IN'
    `;

    const params: string[] = [];
    if (options?.search?.trim()) {
      const sanitizedSearch = options.search.trim().slice(0, 100);
      const q = `%${sanitizedSearch}%`;
      sql += `
        AND (
          ei.full_name LIKE $1 OR
          vv.visitor_full_name LIKE $2 OR
          ap.display_code LIKE $3 OR
          e.title LIKE $4 OR
          hu.first_name LIKE $5 OR
          hu.last_name LIKE $6
        )
      `;
      params.push(q, q, q, q, q, q);
    }

    sql += ' ORDER BY av.checked_in_at DESC';

    const rows = await dbAdapter.query<any>(sql, params);
    const activeVisits = rows.map((r) => this.mapAccessVisitRecord(r));

    return {
      success: true,
      activeVisits,
      total: activeVisits.length,
    };
  }

  /**
   * Retrieves historical access visits with pagination and search/filtering
   */
  public async listHistory(
    actor: SafeUser,
    options?: {
      search?: string;
      status?: string;
      passType?: string;
      date?: string;
      startDate?: string;
      endDate?: string;
      page?: number;
      limit?: number;
    }
  ): Promise<{
    success: boolean;
    visits: AccessVisitRecord[];
    total: number;
    page: number;
    limit: number;
    error?: string;
    status?: number;
  }> {
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

    const page = Math.max(1, options?.page || 1);
    const limit = Math.min(100, Math.max(1, options?.limit || 20));
    const offset = (page - 1) * limit;

    // Special handling for status === 'DENIED': Query authoritative audit logs for ACCESS_DENIED
    if (options?.status === 'DENIED') {
      let auditWhere = "WHERE al.action = 'ACCESS_DENIED'";
      const auditParams: (string | number)[] = [];
      let paramIdx = 1;

      if (options?.startDate && options?.endDate) {
        const { startIso, endIso } = getLagosRangeForDates(options.startDate, options.endDate);
        auditWhere += ` AND al.created_at >= $${paramIdx++} AND al.created_at < $${paramIdx++}`;
        auditParams.push(startIso!, endIso!);
      } else if (options?.startDate) {
        const { startIso } = getLagosRangeForDates(options.startDate, undefined);
        auditWhere += ` AND al.created_at >= $${paramIdx++}`;
        auditParams.push(startIso!);
      } else if (options?.endDate) {
        const { endIso } = getLagosRangeForDates(undefined, options.endDate);
        auditWhere += ` AND al.created_at < $${paramIdx++}`;
        auditParams.push(endIso!);
      } else if (options?.date) {
        const { startIso, endIso } = getLagosDateRange(options.date);
        auditWhere += ` AND al.created_at >= $${paramIdx++} AND al.created_at < $${paramIdx++}`;
        auditParams.push(startIso, endIso);
      }

      if (options?.search?.trim()) {
        const sanitizedSearch = options.search.trim().slice(0, 100);
        const q = `%${sanitizedSearch}%`;
        auditWhere += `
          AND (
            al.metadata LIKE $${paramIdx++} OR
            u.first_name LIKE $${paramIdx++} OR
            u.last_name LIKE $${paramIdx++}
          )
        `;
        auditParams.push(q, q, q);
      }

      const countSql = `
        SELECT COUNT(*) as count
        FROM audit_logs al
        LEFT JOIN users u ON al.actor_id = u.id
        ${auditWhere}
      `;
      const countRow = await dbAdapter.queryOne<{ count: number | string }>(countSql, [...auditParams]);
      const total = Number(countRow?.count || 0);

      const limitParam = `$${paramIdx++}`;
      const offsetParam = `$${paramIdx++}`;
      const dataSql = `
        SELECT 
          al.id,
          al.created_at as created_at,
          al.actor_id as actor_id,
          al.metadata,
          (u.first_name || ' ' || u.last_name) as checked_in_by_name
        FROM audit_logs al
        LEFT JOIN users u ON al.actor_id = u.id
        ${auditWhere}
        ORDER BY al.created_at DESC
        LIMIT ${limitParam} OFFSET ${offsetParam}
      `;
      const rows = await dbAdapter.query<any>(dataSql, [...auditParams, limit, offset]);

      const visits: AccessVisitRecord[] = rows.map((r) => {
        let meta: any = {};
        try {
          meta = JSON.parse(r.metadata || '{}');
        } catch {}
        return {
          id: r.id,
          accessPassId: meta.passId || 'none',
          passType: (meta.passType as PassType) || PassType.VISITOR,
          status: AccessVisitStatus.DENIED,
          denialReason: meta.message || meta.reason || 'Access denied',
          displayCode: meta.displayCode || meta.code || '—',
          guestName: meta.guestName || 'Access Attempt',
          checkedInByName: r.checked_in_by_name || 'Desk Operator',
          createdAt: r.created_at,
          updatedAt: r.created_at,
          formattedCheckedInAt: `${formatDateInTimezone(r.created_at)} ${formatTimeInTimezone(r.created_at)}`,
        };
      });

      return {
        success: true,
        visits,
        total,
        page,
        limit,
      };
    }

    let whereClause = 'WHERE 1=1';
    const params: (string | number)[] = [];
    let paramIdx = 1;

    if (options?.status) {
      whereClause += ` AND av.status = $${paramIdx++}`;
      params.push(options.status);
    }

    if (options?.passType) {
      whereClause += ` AND av.pass_type = $${paramIdx++}`;
      params.push(options.passType);
    }

    if (options?.startDate && options?.endDate) {
      const { startIso, endIso } = getLagosRangeForDates(options.startDate, options.endDate);
      whereClause += ` AND av.created_at >= $${paramIdx++} AND av.created_at < $${paramIdx++}`;
      params.push(startIso!, endIso!);
    } else if (options?.startDate) {
      const { startIso } = getLagosRangeForDates(options.startDate, undefined);
      whereClause += ` AND av.created_at >= $${paramIdx++}`;
      params.push(startIso!);
    } else if (options?.endDate) {
      const { endIso } = getLagosRangeForDates(undefined, options.endDate);
      whereClause += ` AND av.created_at < $${paramIdx++}`;
      params.push(endIso!);
    } else if (options?.date) {
      const { startIso, endIso } = getLagosDateRange(options.date);
      whereClause += ` AND av.created_at >= $${paramIdx++} AND av.created_at < $${paramIdx++}`;
      params.push(startIso, endIso);
    }

    if (options?.search?.trim()) {
      const sanitizedSearch = options.search.trim().slice(0, 100);
      const q = `%${sanitizedSearch}%`;
      whereClause += `
        AND (
          ei.full_name LIKE $${paramIdx++} OR
          vv.visitor_full_name LIKE $${paramIdx++} OR
          ap.display_code LIKE $${paramIdx++} OR
          e.title LIKE $${paramIdx++} OR
          hu.first_name LIKE $${paramIdx++} OR
          hu.last_name LIKE $${paramIdx++}
        )
      `;
      params.push(q, q, q, q, q, q);
    }

    const countSql = `
      SELECT COUNT(*) as count
      FROM access_visits av
      JOIN access_passes ap ON av.access_pass_id = ap.id
      LEFT JOIN event_invitees ei ON av.event_invitee_id = ei.id
      LEFT JOIN events e ON ei.event_id = e.id
      LEFT JOIN visitor_visits vv ON av.visitor_visit_id = vv.id
      LEFT JOIN users hu ON vv.host_staff_id = hu.id
      ${whereClause}
    `;

    const countRow = await dbAdapter.queryOne<{ count: number | string }>(countSql, [...params]);
    const total = Number(countRow?.count || 0);

    const limitParam = `$${paramIdx++}`;
    const offsetParam = `$${paramIdx++}`;
    const dataSql = `
      SELECT 
        av.id,
        av.access_pass_id as access_pass_id,
        av.pass_type as pass_type,
        av.event_invitee_id as event_invitee_id,
        av.visitor_visit_id as visitor_visit_id,
        av.checked_in_at as checked_in_at,
        av.checked_in_by as checked_in_by,
        av.checked_out_at as checked_out_at,
        av.checked_out_by as checked_out_by,
        av.status,
        av.denial_reason as denial_reason,
        av.created_at as created_at,
        av.updated_at as updated_at,
        ap.display_code as display_code,
        COALESCE(ei.full_name, vv.visitor_full_name, 'Guest') as guest_name,
        COALESCE(ei.email, vv.visitor_email) as guest_email,
        COALESCE(ei.phone, vv.visitor_phone) as guest_phone,
        ei.organization as guest_organization,
        vv.purpose as purpose,
        (hu.first_name || ' ' || hu.last_name) as host_staff_name,
        e.title as event_title,
        COALESCE(e.title, (hu.first_name || ' ' || hu.last_name), 'Reception') as host_or_event_title,
        e.location as event_location,
        (cu.first_name || ' ' || cu.last_name) as checked_in_by_name,
        (co.first_name || ' ' || co.last_name) as checked_out_by_name
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
      LIMIT ${limitParam} OFFSET ${offsetParam}
    `;

    const rows = await dbAdapter.query<any>(dataSql, [...params, limit, offset]);
    const visits = rows.map((r) => this.mapAccessVisitRecord(r));

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
  public async getSummary(actor: SafeUser): Promise<{
    success: boolean;
    summary: ReceptionSummaryMetrics;
    error?: string;
    status?: number;
  }> {
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

    const todayStr = getTodayDateString(COMPANY_TIMEZONE);
    const { startIso, endIso } = getLagosDateRange(todayStr);

    // 1. Currently checked in
    const activeRow = await dbAdapter.queryOne<{ count: number | string }>(
      "SELECT COUNT(*) as count FROM access_visits WHERE status = 'CHECKED_IN'"
    );
    const currentlyCheckedIn = Number(activeRow?.count || 0);

    // 2. Today's visitors checked in
    const visitorRow = await dbAdapter.queryOne<{ count: number | string }>(
      `SELECT COUNT(*) as count FROM access_visits 
       WHERE pass_type = 'VISITOR' 
         AND checked_in_at IS NOT NULL 
         AND checked_in_at >= $1 AND checked_in_at < $2`,
      [startIso, endIso]
    );
    const todayVisitors = Number(visitorRow?.count || 0);

    // 3. Today's event guests checked in
    const eventRow = await dbAdapter.queryOne<{ count: number | string }>(
      `SELECT COUNT(*) as count FROM access_visits 
       WHERE pass_type = 'EVENT' 
         AND checked_in_at IS NOT NULL 
         AND checked_in_at >= $1 AND checked_in_at < $2`,
      [startIso, endIso]
    );
    const todayEventGuests = Number(eventRow?.count || 0);

    // 4. Checked out today
    const checkedOutRow = await dbAdapter.queryOne<{ count: number | string }>(
      `SELECT COUNT(*) as count FROM access_visits 
       WHERE status = 'CHECKED_OUT' 
         AND checked_out_at IS NOT NULL 
         AND checked_out_at >= $1 AND checked_out_at < $2`,
      [startIso, endIso]
    );
    const checkedOutToday = Number(checkedOutRow?.count || 0);

    // 5. Access denied today
    const deniedRow = await dbAdapter.queryOne<{ count: number | string }>(
      `SELECT COUNT(*) as count FROM audit_logs 
       WHERE action = 'ACCESS_DENIED' 
         AND created_at >= $1 AND created_at < $2`,
      [startIso, endIso]
    );
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
  public async getVisitRecordById(visitId: string, tx?: DbAdapter): Promise<AccessVisitRecord | null> {
    const runner = tx || dbAdapter;
    const sql = `
      SELECT 
        av.id,
        av.access_pass_id as access_pass_id,
        av.pass_type as pass_type,
        av.event_invitee_id as event_invitee_id,
        av.visitor_visit_id as visitor_visit_id,
        av.checked_in_at as checked_in_at,
        av.checked_in_by as checked_in_by,
        av.checked_out_at as checked_out_at,
        av.checked_out_by as checked_out_by,
        av.status,
        av.denial_reason as denial_reason,
        av.created_at as created_at,
        av.updated_at as updated_at,
        ap.display_code as display_code,
        COALESCE(ei.full_name, vv.visitor_full_name, 'Guest') as guest_name,
        COALESCE(ei.email, vv.visitor_email) as guest_email,
        COALESCE(ei.phone, vv.visitor_phone) as guest_phone,
        ei.organization as guest_organization,
        vv.purpose as purpose,
        (hu.first_name || ' ' || hu.last_name) as host_staff_name,
        e.title as event_title,
        COALESCE(e.title, (hu.first_name || ' ' || hu.last_name), 'Reception') as host_or_event_title,
        e.location as event_location,
        (cu.first_name || ' ' || cu.last_name) as checked_in_by_name,
        (co.first_name || ' ' || co.last_name) as checked_out_by_name
      FROM access_visits av
      JOIN access_passes ap ON av.access_pass_id = ap.id
      LEFT JOIN event_invitees ei ON av.event_invitee_id = ei.id
      LEFT JOIN events e ON ei.event_id = e.id
      LEFT JOIN visitor_visits vv ON av.visitor_visit_id = vv.id
      LEFT JOIN users hu ON vv.host_staff_id = hu.id
      LEFT JOIN users cu ON av.checked_in_by = cu.id
      LEFT JOIN users co ON av.checked_out_by = co.id
      WHERE av.id = $1
    `;
    const r = await runner.queryOne<any>(sql, [visitId]);
    if (!r) return null;

    return this.mapAccessVisitRecord(r);
  }
}

export const receptionService = new ReceptionService();
