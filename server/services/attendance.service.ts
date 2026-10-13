import { dbAdapter } from '../db/adapter.ts';
import { generateId } from '../utils/crypto.ts';
import { auditService } from './audit.service.ts';
import {
  calculateWorkingDuration,
  getTodayDateString,
  formatTimeInTimezone,
  formatDateInTimezone,
  COMPANY_TIMEZONE,
} from '../utils/time.ts';
import {
  AttendanceRecord,
  AttendanceDailyState,
  TodayAttendanceData,
  AttendanceHistoryItem,
  AttendanceStatus,
  VerificationMethod,
} from '../../src/types/index.ts';
import { ApiErrorCode } from '../utils/apiResponse.ts';

interface RawAttendanceRow {
  id: string;
  staff_id: string;
  date: string;
  check_in: string | null;
  check_out: string | null;
  check_in_ip: string | null;
  check_out_ip: string | null;
  check_in_user_agent: string | null;
  check_out_user_agent: string | null;
  check_in_verification_method: string | null;
  check_out_verification_method: string | null;
  status: string;
  override_reason: string | null;
  override_admin_id: string | null;
  created_at: string;
  updated_at: string;
}

function mapRowToAttendanceRecord(row: RawAttendanceRow): AttendanceRecord {
  const duration = calculateWorkingDuration(row.check_in, row.check_out);
  return {
    id: row.id,
    staffId: row.staff_id,
    date: row.date,
    checkIn: row.check_in,
    checkOut: row.check_out,
    checkInIp: row.check_in_ip,
    checkOutIp: row.check_out_ip,
    checkInUserAgent: row.check_in_user_agent,
    checkOutUserAgent: row.check_out_user_agent,
    checkInVerificationMethod: row.check_in_verification_method,
    checkOutVerificationMethod: row.check_out_verification_method,
    status: row.status,
    overrideReason: row.override_reason,
    overrideAdminId: row.override_admin_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    workingDuration: row.check_out ? duration.formatted : null,
    durationSeconds: row.check_out ? duration.totalSeconds : null,
  };
}

class AttendanceService {
  /**
   * Retrieves current staff attendance state for today
   */
  public async getTodayAttendance(staffId: string, customDate?: string): Promise<TodayAttendanceData> {
    const todayDate = customDate || getTodayDateString();

    const row = await dbAdapter.queryOne<RawAttendanceRow>(
      `
      SELECT * FROM attendance
      WHERE staff_id = $1 AND date = $2
      `,
      [staffId, todayDate]
    );

    const serverTime = new Date().toISOString();

    if (!row || !row.check_in) {
      return {
        state: 'NOT_CHECKED_IN',
        attendance: null,
        serverTime,
        companyTimezone: COMPANY_TIMEZONE,
      };
    }

    const attendance = mapRowToAttendanceRecord(row);

    if (row.check_out) {
      const duration = calculateWorkingDuration(row.check_in, row.check_out);
      return {
        state: 'CHECKED_OUT',
        attendance,
        serverTime,
        companyTimezone: COMPANY_TIMEZONE,
        formattedDuration: duration.formatted,
      };
    }

    return {
      state: 'CHECKED_IN',
      attendance,
      serverTime,
      companyTimezone: COMPANY_TIMEZONE,
    };
  }

  /**
   * Authenticated Check-In
   * Rejects duplicate check-ins for the same day
   */
  public async checkIn(params: {
    staffId: string;
    clientIp: string;
    userAgent: string;
    verificationMethod?: string;
    customDate?: string;
    customTime?: string;
  }): Promise<{
    success: boolean;
    attendance?: AttendanceRecord;
    state?: AttendanceDailyState;
    errorCode?: ApiErrorCode | string;
    errorMessage?: string;
  }> {
    const todayDate = params.customDate || getTodayDateString();
    const nowIso = params.customTime || new Date().toISOString();

    // Check if record already exists for today
    const existing = await dbAdapter.queryOne<RawAttendanceRow>(
      `
      SELECT id, check_in, check_out FROM attendance
      WHERE staff_id = $1 AND date = $2
      `,
      [params.staffId, todayDate]
    );

    if (existing && existing.check_in) {
      return {
        success: false,
        errorCode: ApiErrorCode.ALREADY_CHECKED_IN,
        errorMessage: 'You have already checked in today.',
      };
    }

    const id = generateId();
    const verificationMethod = params.verificationMethod || VerificationMethod.OFFICE_IP;
    const initialStatus = AttendanceStatus.PRESENT;

    try {
      await dbAdapter.execute(
        `
        INSERT INTO attendance (
          id, staff_id, date, check_in, check_in_ip, check_in_user_agent,
          check_in_verification_method, status, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        [
          id,
          params.staffId,
          todayDate,
          nowIso,
          params.clientIp,
          params.userAgent,
          verificationMethod,
          initialStatus,
          nowIso,
          nowIso,
        ]
      );

      // Record immutable audit log
      auditService.log({
        actorId: params.staffId,
        action: 'CHECK_IN',
        targetUserId: params.staffId,
        ipAddress: params.clientIp,
        userAgent: params.userAgent,
        metadata: {
          attendanceId: id,
          date: todayDate,
          checkIn: nowIso,
          verificationMethod,
        },
      });

      const newRow = await dbAdapter.queryOne<RawAttendanceRow>(
        `
        SELECT * FROM attendance WHERE id = $1
        `,
        [id]
      );

      const record = newRow ? mapRowToAttendanceRecord(newRow) : ({} as AttendanceRecord);

      return {
        success: true,
        attendance: record,
        state: 'CHECKED_IN',
      };
    } catch (error: unknown) {
      // Check for UNIQUE constraint race condition
      const errorMsg = String(error);
      if (
        errorMsg.includes('UNIQUE constraint failed') ||
        errorMsg.includes('PRIMARY KEY') ||
        errorMsg.includes('uq_attendance_staff_date') ||
        errorMsg.includes('duplicate key')
      ) {
        return {
          success: false,
          errorCode: ApiErrorCode.ALREADY_CHECKED_IN,
          errorMessage: 'You have already checked in today.',
        };
      }
      console.error('[AttendanceService] Check-in error:', error);
      return {
        success: false,
        errorCode: ApiErrorCode.INTERNAL_ERROR,
        errorMessage: 'An unexpected error occurred during check-in.',
      };
    }
  }

  /**
   * Authenticated Check-Out
   * Validates active check-in and prevents duplicate check-outs
   */
  public async checkOut(params: {
    staffId: string;
    clientIp: string;
    userAgent: string;
    verificationMethod?: string;
    customDate?: string;
    customTime?: string;
  }): Promise<{
    success: boolean;
    attendance?: AttendanceRecord;
    state?: AttendanceDailyState;
    formattedDuration?: string;
    errorCode?: ApiErrorCode | string;
    errorMessage?: string;
  }> {
    const todayDate = params.customDate || getTodayDateString();
    const nowIso = params.customTime || new Date().toISOString();

    const existing = await dbAdapter.queryOne<RawAttendanceRow>(
      `
      SELECT * FROM attendance
      WHERE staff_id = $1 AND date = $2
      `,
      [params.staffId, todayDate]
    );

    if (!existing || !existing.check_in) {
      return {
        success: false,
        errorCode: ApiErrorCode.NO_ACTIVE_CHECK_IN,
        errorMessage: 'You cannot check out because you have not checked in today.',
      };
    }

    if (existing.check_out) {
      return {
        success: false,
        errorCode: ApiErrorCode.ALREADY_CHECKED_OUT,
        errorMessage: 'You have already checked out today.',
      };
    }

    const duration = calculateWorkingDuration(existing.check_in, nowIso);
    const verificationMethod = params.verificationMethod || VerificationMethod.OFFICE_IP;

    try {
      const updateRes = await dbAdapter.execute(
        `
        UPDATE attendance
        SET check_out = $1,
            check_out_ip = $2,
            check_out_user_agent = $3,
            check_out_verification_method = $4,
            status = $5,
            updated_at = $6
        WHERE id = $7 AND check_out IS NULL
        `,
        [
          nowIso,
          params.clientIp,
          params.userAgent,
          verificationMethod,
          AttendanceStatus.CHECKED_OUT,
          nowIso,
          existing.id,
        ]
      );

      if (updateRes.rowCount === 0) {
        return {
          success: false,
          errorCode: ApiErrorCode.ALREADY_CHECKED_OUT,
          errorMessage: 'You have already checked out today.',
        };
      }

      // Record immutable audit log
      auditService.log({
        actorId: params.staffId,
        action: 'CHECK_OUT',
        targetUserId: params.staffId,
        ipAddress: params.clientIp,
        userAgent: params.userAgent,
        metadata: {
          attendanceId: existing.id,
          date: todayDate,
          checkIn: existing.check_in,
          checkOut: nowIso,
          duration: duration.formatted,
          durationSeconds: duration.totalSeconds,
          verificationMethod,
        },
      });

      const updatedRow = await dbAdapter.queryOne<RawAttendanceRow>(
        `
        SELECT * FROM attendance WHERE id = $1
        `,
        [existing.id]
      );

      const record = updatedRow ? mapRowToAttendanceRecord(updatedRow) : ({} as AttendanceRecord);

      return {
        success: true,
        attendance: record,
        state: 'CHECKED_OUT',
        formattedDuration: duration.formatted,
      };
    } catch (error) {
      console.error('[AttendanceService] Check-out error:', error);
      return {
        success: false,
        errorCode: ApiErrorCode.INTERNAL_ERROR,
        errorMessage: 'An unexpected error occurred during check-out.',
      };
    }
  }

  /**
   * Retrieves personal attendance history for authenticated staff member
   */
  public async getStaffHistory(staffId: string, limit = 30): Promise<AttendanceHistoryItem[]> {
    const rows = await dbAdapter.query<RawAttendanceRow>(
      `
      SELECT * FROM attendance
      WHERE staff_id = $1
      ORDER BY date DESC, created_at DESC
      LIMIT $2
      `,
      [staffId, limit]
    );

    return (rows || []).map((row) => {
      const record = mapRowToAttendanceRecord(row);
      const duration = calculateWorkingDuration(row.check_in, row.check_out);
      return {
        ...record,
        formattedCheckIn: formatTimeInTimezone(row.check_in),
        formattedCheckOut: formatTimeInTimezone(row.check_out),
        formattedDuration: row.check_out ? duration.formatted : '--',
      };
    });
  }
}

export const attendanceService = new AttendanceService();
