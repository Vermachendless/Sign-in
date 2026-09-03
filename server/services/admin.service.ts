import { getDatabase } from '../db/index.ts';
import { generateId, hashPassword } from '../utils/crypto.ts';
import { auditService } from './audit.service.ts';
import { authService } from './auth.service.ts';
import { maskIpAddress } from './network.service.ts';
import {
  getTodayDateString,
  formatTimeInTimezone,
  calculateWorkingDuration,
  COMPANY_TIMEZONE,
} from '../utils/time.ts';
import {
  SafeUser,
  UserRole,
  UserStatus,
  AttendanceStatus,
} from '../../src/types/index.ts';
import { ApiErrorCode } from '../utils/apiResponse.ts';

export interface TodayAttendanceOverviewItem {
  staffId: string;
  firstName: string;
  lastName: string;
  email: string;
  department: string | null;
  role: UserRole;
  status: UserStatus;
  attendanceId: string | null;
  checkIn: string | null;
  checkOut: string | null;
  formattedCheckIn: string;
  formattedCheckOut: string;
  workingDuration: string | null;
  durationSeconds: number | null;
  attendanceStatus: string;
  checkInVerificationMethod: string | null;
  checkOutVerificationMethod: string | null;
  maskedCheckInIp: string | null;
}

export interface AdminDashboardSummary {
  date: string;
  companyTimezone: string;
  serverTime: string;
  activeStaffCount: number;
  totalStaffCount: number;
  checkedInCount: number;
  checkedOutCount: number;
  notCheckedInCount: number;
  attendancePercentage: number;
  todayRecords: TodayAttendanceOverviewItem[];
}

export interface StaffListItem extends SafeUser {
  createdAt: string;
  totalAttendedDays: number;
  todayStatus: 'NOT_CHECKED_IN' | 'CHECKED_IN' | 'CHECKED_OUT';
}

export interface StaffDetailResponse {
  user: SafeUser & { createdAt: string; updatedAt: string };
  stats: {
    totalAttendedDays: number;
    totalCheckedOutDays: number;
  };
  recentAttendance: {
    id: string;
    date: string;
    checkIn: string | null;
    checkOut: string | null;
    formattedCheckIn: string;
    formattedCheckOut: string;
    workingDuration: string | null;
    status: string;
    verificationMethod: string | null;
    maskedIp: string | null;
  }[];
}

interface RawUserRow {
  id: string;
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  department: string | null;
  role: UserRole;
  status: UserStatus;
  created_at: string;
  updated_at: string;
}

interface RawTodayRow {
  staff_id: string;
  first_name: string;
  last_name: string;
  email: string;
  department: string | null;
  role: UserRole;
  status: UserStatus;
  attendance_id: string | null;
  check_in: string | null;
  check_out: string | null;
  check_in_ip: string | null;
  check_in_verification_method: string | null;
  check_out_verification_method: string | null;
  attendance_status: string | null;
}

export class AdminService {
  /**
   * Retrieves full Today Overview dashboard metrics and attendance rows
   */
  public getDashboardSummary(customDate?: string): AdminDashboardSummary {
    const db = getDatabase();
    const todayDate = customDate || getTodayDateString();
    const serverTime = new Date().toISOString();

    // Query all active staff accounts with today's attendance record via LEFT JOIN
    const rows = (db.prepare(`
      SELECT 
        u.id AS staff_id,
        u.first_name,
        u.last_name,
        u.email,
        u.department,
        u.role,
        u.status,
        a.id AS attendance_id,
        a.check_in,
        a.check_out,
        a.check_in_ip,
        a.check_in_verification_method,
        a.check_out_verification_method,
        a.status AS attendance_status
      FROM users u
      LEFT JOIN attendance a ON a.staff_id = u.id AND a.date = ?
      WHERE u.role = 'STAFF' AND u.status = 'ACTIVE'
      ORDER BY u.last_name ASC, u.first_name ASC
    `).all(todayDate) as unknown) as RawTodayRow[];

    // Count all staff accounts in system
    const totalStaffRow = db.prepare(`
      SELECT 
        COUNT(*) AS total_staff,
        SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) AS active_staff
      FROM users
      WHERE role = 'STAFF'
    `).get() as { total_staff: number; active_staff: number };

    const activeStaffCount = totalStaffRow?.active_staff || 0;
    const totalStaffCount = totalStaffRow?.total_staff || 0;

    let checkedInCount = 0;
    let checkedOutCount = 0;
    let notCheckedInCount = 0;

    const todayRecords: TodayAttendanceOverviewItem[] = rows.map((row) => {
      let attState: string;
      let duration = { formatted: '--', totalSeconds: 0 };

      if (!row.check_in) {
        attState = 'NOT_CHECKED_IN';
        notCheckedInCount++;
      } else if (row.check_out) {
        attState = 'CHECKED_OUT';
        checkedOutCount++;
        duration = calculateWorkingDuration(row.check_in, row.check_out);
      } else {
        attState = 'CHECKED_IN';
        checkedInCount++;
      }

      return {
        staffId: row.staff_id,
        firstName: row.first_name,
        lastName: row.last_name,
        email: row.email,
        department: row.department,
        role: row.role,
        status: row.status,
        attendanceId: row.attendance_id,
        checkIn: row.check_in,
        checkOut: row.check_out,
        formattedCheckIn: formatTimeInTimezone(row.check_in),
        formattedCheckOut: formatTimeInTimezone(row.check_out),
        workingDuration: row.check_out ? duration.formatted : null,
        durationSeconds: row.check_out ? duration.totalSeconds : null,
        attendanceStatus: attState,
        checkInVerificationMethod: row.check_in_verification_method,
        checkOutVerificationMethod: row.check_out_verification_method,
        maskedCheckInIp: row.check_in_ip ? maskIpAddress(row.check_in_ip) : null,
      };
    });

    const attendedCount = checkedInCount + checkedOutCount;
    const attendancePercentage = activeStaffCount > 0
      ? Math.round((attendedCount / activeStaffCount) * 100)
      : 0;

    return {
      date: todayDate,
      companyTimezone: COMPANY_TIMEZONE,
      serverTime,
      activeStaffCount,
      totalStaffCount,
      checkedInCount,
      checkedOutCount,
      notCheckedInCount,
      attendancePercentage,
      todayRecords,
    };
  }

  /**
   * List staff members with search, status, and role filters
   */
  public listStaff(filters?: {
    search?: string;
    status?: UserStatus | string;
    role?: UserRole | string;
  }): StaffListItem[] {
    const db = getDatabase();
    const todayDate = getTodayDateString();

    let query = `
      SELECT 
        u.id, u.email, u.first_name, u.last_name, u.phone, u.department, u.role, u.status, u.created_at,
        (SELECT COUNT(*) FROM attendance WHERE staff_id = u.id AND check_in IS NOT NULL) AS total_attended_days,
        (SELECT a.check_in FROM attendance a WHERE a.staff_id = u.id AND a.date = ?) AS today_check_in,
        (SELECT a.check_out FROM attendance a WHERE a.staff_id = u.id AND a.date = ?) AS today_check_out
      FROM users u
      WHERE 1=1
    `;
    const params: (string | number | null)[] = [todayDate, todayDate];

    if (filters?.role) {
      query += ` AND u.role = ?`;
      params.push(filters.role);
    } else {
      // By default list STAFF and ADMIN (or all users)
      query += ` AND u.role != 'SUPER_ADMIN'`;
    }

    if (filters?.status) {
      query += ` AND u.status = ?`;
      params.push(filters.status);
    }

    if (filters?.search && filters.search.trim()) {
      const term = `%${filters.search.trim()}%`;
      query += ` AND (u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ? OR u.department LIKE ?)`;
      params.push(term, term, term, term);
    }

    query += ` ORDER BY u.created_at DESC`;

    const rows = (db.prepare(query).all(...params) as unknown) as Array<{
      id: string;
      email: string;
      first_name: string;
      last_name: string;
      phone: string | null;
      department: string | null;
      role: UserRole;
      status: UserStatus;
      created_at: string;
      total_attended_days: number;
      today_check_in: string | null;
      today_check_out: string | null;
    }>;

    return rows.map((r) => {
      let todayStatus: 'NOT_CHECKED_IN' | 'CHECKED_IN' | 'CHECKED_OUT' = 'NOT_CHECKED_IN';
      if (r.today_check_in) {
        todayStatus = r.today_check_out ? 'CHECKED_OUT' : 'CHECKED_IN';
      }

      return {
        id: r.id,
        email: r.email,
        firstName: r.first_name,
        lastName: r.last_name,
        phone: r.phone,
        department: r.department,
        role: r.role,
        status: r.status,
        createdAt: r.created_at,
        totalAttendedDays: r.total_attended_days || 0,
        todayStatus,
      };
    });
  }

  /**
   * Get detailed profile & historical attendance for a staff member
   */
  public getStaffById(staffId: string): StaffDetailResponse | null {
    const db = getDatabase();

    const user = (db.prepare(`
      SELECT id, email, first_name, last_name, phone, department, role, status, created_at, updated_at
      FROM users
      WHERE id = ?
    `).get(staffId) as unknown) as RawUserRow | undefined;

    if (!user) {
      return null;
    }

    const stats = (db.prepare(`
      SELECT 
        COUNT(CASE WHEN check_in IS NOT NULL THEN 1 END) AS total_attended,
        COUNT(CASE WHEN check_out IS NOT NULL THEN 1 END) AS total_checked_out
      FROM attendance
      WHERE staff_id = ?
    `).get(staffId) as unknown) as { total_attended: number; total_checked_out: number };

    const recentAttendanceRows = (db.prepare(`
      SELECT id, date, check_in, check_out, check_in_ip, check_in_verification_method, status
      FROM attendance
      WHERE staff_id = ?
      ORDER BY date DESC, created_at DESC
      LIMIT 15
    `).all(staffId) as unknown) as Array<{
      id: string;
      date: string;
      check_in: string | null;
      check_out: string | null;
      check_in_ip: string | null;
      check_in_verification_method: string | null;
      status: string;
    }>;

    const recentAttendance = recentAttendanceRows.map((r) => {
      const duration = calculateWorkingDuration(r.check_in, r.check_out);
      return {
        id: r.id,
        date: r.date,
        checkIn: r.check_in,
        checkOut: r.check_out,
        formattedCheckIn: formatTimeInTimezone(r.check_in),
        formattedCheckOut: formatTimeInTimezone(r.check_out),
        workingDuration: r.check_out ? duration.formatted : '--',
        status: r.status,
        verificationMethod: r.check_in_verification_method,
        maskedIp: r.check_in_ip ? maskIpAddress(r.check_in_ip) : null,
      };
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        phone: user.phone,
        department: user.department,
        role: user.role,
        status: user.status,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
      },
      stats: {
        totalAttendedDays: stats?.total_attended || 0,
        totalCheckedOutDays: stats?.total_checked_out || 0,
      },
      recentAttendance,
    };
  }

  /**
   * Create a new staff account with password hashing & privilege verification
   */
  public async createStaff(
    actor: SafeUser,
    data: {
      firstName: string;
      lastName: string;
      email: string;
      password: string;
      phone?: string;
      department?: string;
      role?: UserRole;
      status?: UserStatus;
    },
    ipAddress?: string,
    userAgent?: string
  ): Promise<{
    success: boolean;
    user?: SafeUser;
    errorCode?: ApiErrorCode | string;
    errorMessage?: string;
  }> {
    const db = getDatabase();
    const firstName = (data.firstName || '').trim();
    const lastName = (data.lastName || '').trim();
    const email = (data.email || '').trim().toLowerCase();
    const password = data.password;
    const phone = data.phone ? data.phone.trim() : null;
    const department = data.department ? data.department.trim() : null;
    const role = data.role || UserRole.STAFF;
    const status = data.status || UserStatus.ACTIVE;

    // 1. Validation
    if (!firstName || !lastName) {
      return {
        success: false,
        errorCode: ApiErrorCode.VALIDATION_ERROR,
        errorMessage: 'First name and last name are required.',
      };
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      return {
        success: false,
        errorCode: ApiErrorCode.VALIDATION_ERROR,
        errorMessage: 'Please enter a valid email address.',
      };
    }

    if (!password || password.length < 8) {
      return {
        success: false,
        errorCode: ApiErrorCode.VALIDATION_ERROR,
        errorMessage: 'Password must be at least 8 characters long.',
      };
    }

    // 2. Privilege Boundary Check:
    // A regular ADMIN cannot create a SUPER_ADMIN or ADMIN.
    if (actor.role === UserRole.ADMIN) {
      if (role === UserRole.SUPER_ADMIN || role === UserRole.ADMIN) {
        return {
          success: false,
          errorCode: ApiErrorCode.FORBIDDEN,
          errorMessage: 'Administrators are only authorized to create standard Staff accounts.',
        };
      }
    }

    if (role === UserRole.SUPER_ADMIN && actor.role !== UserRole.SUPER_ADMIN) {
      return {
        success: false,
        errorCode: ApiErrorCode.FORBIDDEN,
        errorMessage: 'Super Administrator accounts can only be created by an active Super Administrator.',
      };
    }

    // 3. Duplicate Email Check
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      return {
        success: false,
        errorCode: ApiErrorCode.ALREADY_EXISTS,
        errorMessage: 'An account with this email address already exists.',
      };
    }

    // 4. Secure Password Hashing
    const passwordHash = await hashPassword(password);
    const id = generateId();
    const now = new Date().toISOString();

    try {
      db.prepare(`
        INSERT INTO users (
          id, email, password_hash, first_name, last_name, phone, department, role, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        email,
        passwordHash,
        firstName,
        lastName,
        phone,
        department,
        role,
        status,
        now,
        now
      );

      // 5. Immutable Audit Log (strictly ZERO plaintext passwords or hashes)
      auditService.log({
        actorId: actor.id,
        action: 'STAFF_CREATED',
        targetUserId: id,
        ipAddress,
        userAgent,
        metadata: {
          targetEmail: email,
          role,
          status,
          department,
        },
      });

      const safeUser: SafeUser = {
        id,
        email,
        firstName,
        lastName,
        phone,
        department,
        role,
        status,
      };

      return {
        success: true,
        user: safeUser,
      };
    } catch (error) {
      console.error('[AdminService] createStaff error:', error);
      return {
        success: false,
        errorCode: ApiErrorCode.INTERNAL_ERROR,
        errorMessage: 'Failed to create staff account.',
      };
    }
  }

  /**
   * Update permitted staff profile fields with privilege protection
   */
  public updateStaff(
    actor: SafeUser,
    staffId: string,
    data: {
      firstName?: string;
      lastName?: string;
      email?: string;
      phone?: string;
      department?: string;
      role?: UserRole;
    },
    ipAddress?: string,
    userAgent?: string
  ): {
    success: boolean;
    user?: SafeUser;
    errorCode?: ApiErrorCode | string;
    errorMessage?: string;
  } {
    const db = getDatabase();

    const existing = (db.prepare(`
      SELECT id, email, first_name, last_name, phone, department, role, status, created_at, updated_at
      FROM users
      WHERE id = ?
    `).get(staffId) as unknown) as RawUserRow | undefined;

    if (!existing) {
      return {
        success: false,
        errorCode: ApiErrorCode.NOT_FOUND,
        errorMessage: 'Staff account not found.',
      };
    }

    // Privilege Boundaries
    if (existing.role === UserRole.SUPER_ADMIN && actor.role !== UserRole.SUPER_ADMIN) {
      return {
        success: false,
        errorCode: ApiErrorCode.FORBIDDEN,
        errorMessage: 'Unauthorized: Cannot modify a Super Administrator account.',
      };
    }

    if (actor.role === UserRole.ADMIN && existing.role === UserRole.ADMIN && actor.id !== existing.id) {
      return {
        success: false,
        errorCode: ApiErrorCode.FORBIDDEN,
        errorMessage: 'Unauthorized: Cannot modify other Administrator accounts.',
      };
    }

    // If role change requested, verify actor authority
    if (data.role && data.role !== existing.role) {
      if (actor.role === UserRole.ADMIN) {
        return {
          success: false,
          errorCode: ApiErrorCode.FORBIDDEN,
          errorMessage: 'Administrators cannot alter account roles.',
        };
      }
      if (data.role === UserRole.SUPER_ADMIN && actor.role !== UserRole.SUPER_ADMIN) {
        return {
          success: false,
          errorCode: ApiErrorCode.FORBIDDEN,
          errorMessage: 'Only Super Administrators can promote accounts to Super Administrator.',
        };
      }
    }

    const newFirstName = data.firstName !== undefined ? data.firstName.trim() : existing.first_name;
    const newLastName = data.lastName !== undefined ? data.lastName.trim() : existing.last_name;
    const newPhone = data.phone !== undefined ? (data.phone ? data.phone.trim() : null) : existing.phone;
    const newDepartment = data.department !== undefined ? (data.department ? data.department.trim() : null) : existing.department;
    const newRole = data.role !== undefined ? data.role : existing.role;

    let newEmail = existing.email;
    if (data.email !== undefined && data.email.trim().toLowerCase() !== existing.email) {
      newEmail = data.email.trim().toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(newEmail)) {
        return {
          success: false,
          errorCode: ApiErrorCode.VALIDATION_ERROR,
          errorMessage: 'Please provide a valid email address.',
        };
      }

      // Check duplicate
      const duplicate = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(newEmail, staffId);
      if (duplicate) {
        return {
          success: false,
          errorCode: ApiErrorCode.ALREADY_EXISTS,
          errorMessage: 'An account with this email address already exists.',
        };
      }
    }

    if (!newFirstName || !newLastName) {
      return {
        success: false,
        errorCode: ApiErrorCode.VALIDATION_ERROR,
        errorMessage: 'First name and last name cannot be empty.',
      };
    }

    const now = new Date().toISOString();

    try {
      db.prepare(`
        UPDATE users
        SET first_name = ?, last_name = ?, email = ?, phone = ?, department = ?, role = ?, updated_at = ?
        WHERE id = ?
      `).run(
        newFirstName,
        newLastName,
        newEmail,
        newPhone,
        newDepartment,
        newRole,
        now,
        staffId
      );

      // If role changed, invalidate user sessions to force re-evaluation of RBAC
      if (newRole !== existing.role) {
        authService.invalidateAllUserSessions(staffId);
      }

      const changedFields: string[] = [];
      if (newFirstName !== existing.first_name) changedFields.push('firstName');
      if (newLastName !== existing.last_name) changedFields.push('lastName');
      if (newEmail !== existing.email) changedFields.push('email');
      if (newPhone !== existing.phone) changedFields.push('phone');
      if (newDepartment !== existing.department) changedFields.push('department');
      if (newRole !== existing.role) changedFields.push('role');

      auditService.log({
        actorId: actor.id,
        action: 'STAFF_UPDATED',
        targetUserId: staffId,
        ipAddress,
        userAgent,
        metadata: {
          changedFields,
          previousRole: existing.role,
          newRole,
        },
      });

      const updatedUser: SafeUser = {
        id: staffId,
        email: newEmail,
        firstName: newFirstName,
        lastName: newLastName,
        phone: newPhone,
        department: newDepartment,
        role: newRole,
        status: existing.status,
      };

      return {
        success: true,
        user: updatedUser,
      };
    } catch (error) {
      console.error('[AdminService] updateStaff error:', error);
      return {
        success: false,
        errorCode: ApiErrorCode.INTERNAL_ERROR,
        errorMessage: 'Failed to update staff account.',
      };
    }
  }

  /**
   * Set staff status (ACTIVE vs SUSPENDED vs REMOVED)
   * Invalidates active sessions upon suspension
   * Preserves all historical attendance records
   */
  public setStaffStatus(
    actor: SafeUser,
    staffId: string,
    newStatus: UserStatus,
    ipAddress?: string,
    userAgent?: string
  ): {
    success: boolean;
    user?: SafeUser;
    errorCode?: ApiErrorCode | string;
    errorMessage?: string;
  } {
    const db = getDatabase();

    const existing = (db.prepare(`
      SELECT id, email, first_name, last_name, phone, department, role, status, created_at, updated_at
      FROM users
      WHERE id = ?
    `).get(staffId) as unknown) as RawUserRow | undefined;

    if (!existing) {
      return {
        success: false,
        errorCode: ApiErrorCode.NOT_FOUND,
        errorMessage: 'Staff account not found.',
      };
    }

    // 1. Prevent Self-Deactivation / Lockout
    if (actor.id === staffId) {
      return {
        success: false,
        errorCode: ApiErrorCode.VALIDATION_ERROR,
        errorMessage: 'You cannot alter your own account active status.',
      };
    }

    // 2. Privilege Boundaries
    if (existing.role === UserRole.SUPER_ADMIN) {
      return {
        success: false,
        errorCode: ApiErrorCode.FORBIDDEN,
        errorMessage: 'Super Administrator accounts cannot be suspended.',
      };
    }

    if (actor.role === UserRole.ADMIN && existing.role === UserRole.ADMIN) {
      return {
        success: false,
        errorCode: ApiErrorCode.FORBIDDEN,
        errorMessage: 'Administrators cannot alter the status of other Administrators.',
      };
    }

    // 3. Validate status value
    if (![UserStatus.ACTIVE, UserStatus.SUSPENDED, UserStatus.REMOVED].includes(newStatus)) {
      return {
        success: false,
        errorCode: ApiErrorCode.VALIDATION_ERROR,
        errorMessage: 'Invalid status value.',
      };
    }

    const now = new Date().toISOString();

    try {
      db.prepare(`
        UPDATE users
        SET status = ?, updated_at = ?
        WHERE id = ?
      `).run(newStatus, now, staffId);

      // If suspended or removed, revoke all active sessions immediately
      if (newStatus === UserStatus.SUSPENDED || newStatus === UserStatus.REMOVED) {
        authService.invalidateAllUserSessions(staffId);
      }

      // Record audit event
      const auditAction = newStatus === UserStatus.ACTIVE ? 'STAFF_ACTIVATED' : 'STAFF_DEACTIVATED';
      auditService.log({
        actorId: actor.id,
        action: auditAction,
        targetUserId: staffId,
        ipAddress,
        userAgent,
        metadata: {
          previousStatus: existing.status,
          newStatus,
          targetEmail: existing.email,
        },
      });

      const updatedUser: SafeUser = {
        id: staffId,
        email: existing.email,
        firstName: existing.first_name,
        lastName: existing.last_name,
        phone: existing.phone,
        department: existing.department,
        role: existing.role,
        status: newStatus,
      };

      return {
        success: true,
        user: updatedUser,
      };
    } catch (error) {
      console.error('[AdminService] setStaffStatus error:', error);
      return {
        success: false,
        errorCode: ApiErrorCode.INTERNAL_ERROR,
        errorMessage: 'Failed to update account status.',
      };
    }
  }
}

export const adminService = new AdminService();
