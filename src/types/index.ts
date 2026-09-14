export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  STAFF = 'STAFF',
}

export enum UserStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  REMOVED = 'REMOVED',
}

export enum AttendanceStatus {
  PRESENT = 'PRESENT',
  LATE = 'LATE',
  CHECKED_OUT = 'CHECKED_OUT',
  INCOMPLETE = 'INCOMPLETE',
  ABSENT = 'ABSENT',
}

export enum VerificationMethod {
  OFFICE_IP = 'OFFICE_IP',
  GPS = 'GPS',
  QR_CODE = 'QR_CODE',
  ADMIN_OVERRIDE = 'ADMIN_OVERRIDE',
  SUPER_ADMIN = 'SUPER_ADMIN',
}

export type AttendanceDailyState = 'NOT_CHECKED_IN' | 'CHECKED_IN' | 'CHECKED_OUT';

export interface AttendanceRecord {
  id: string;
  staffId: string;
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  checkInIp?: string | null;
  checkOutIp?: string | null;
  checkInUserAgent?: string | null;
  checkOutUserAgent?: string | null;
  checkInVerificationMethod?: string | null;
  checkOutVerificationMethod?: string | null;
  status: AttendanceStatus | string;
  overrideReason?: string | null;
  overrideAdminId?: string | null;
  createdAt: string;
  updatedAt: string;
  workingDuration?: string | null;
  durationSeconds?: number | null;
}

export interface TodayAttendanceData {
  state: AttendanceDailyState;
  attendance: AttendanceRecord | null;
  serverTime: string;
  companyTimezone: string;
  formattedDuration?: string | null;
}

export interface AttendanceHistoryItem extends AttendanceRecord {
  formattedCheckIn?: string;
  formattedCheckOut?: string;
  formattedDuration?: string;
}

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  department?: string | null;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SafeUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  department?: string | null;
  role: UserRole;
  status: UserStatus;
}

export interface Session {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  actorId?: string | null;
  action: string;
  targetUserId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: string | null;
  createdAt: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  code?: string;
  message?: string;
  errors?: Record<string, string>;
}

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

export type DatePreset = 'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'custom';

export interface AttendanceReportQuery {
  startDate?: string;
  endDate?: string;
  preset?: DatePreset | string;
  staffId?: string;
  department?: string;
  accountStatus?: 'ALL' | 'ACTIVE' | 'SUSPENDED' | string;
  attendanceStatus?: 'ALL' | 'CHECKED_IN' | 'CHECKED_OUT' | 'NOT_CHECKED_IN' | string;
  page?: number;
  limit?: number;
  sort?: 'date' | 'staffName' | 'department' | 'checkIn' | 'checkOut' | 'workingDuration' | 'status' | string;
  order?: 'asc' | 'desc' | string;
}

export interface AttendanceReportRow {
  id: string;
  date: string;
  formattedDate: string;
  staffId: string;
  staffName: string;
  email: string;
  department: string | null;
  accountStatus: UserStatus;
  checkIn: string | null;
  checkOut: string | null;
  formattedCheckIn: string;
  formattedCheckOut: string;
  workingDuration: string | null;
  durationSeconds: number | null;
  status: string;
  verificationMethod: string | null;
  maskedIp: string | null;
}

export interface AttendanceReportSummary {
  startDate: string;
  endDate: string;
  daysInPeriod: number;
  totalStaffInScope: number;
  totalActiveStaff: number;
  totalRecords: number;
  completedShifts: number;
  incompleteShifts: number;
  uniqueStaffAttended: number;
  totalWorkingSeconds: number;
  totalWorkingFormatted: string;
  averageWorkingSeconds: number;
  averageWorkingDurationFormatted: string;
  attendanceRate: number;
  attendanceRateDescription: string;
}

export interface AttendanceReportResponse {
  filters: {
    startDate: string;
    endDate: string;
    staffId?: string;
    department?: string;
    accountStatus?: string;
    attendanceStatus?: string;
  };
  summary: AttendanceReportSummary;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
  records: AttendanceReportRow[];
}

export interface OfficeNetworkConfig {
  approvedIps: string[];
  dbIps: string[];
  envIps: string[];
  currentDetectedIp: string;
  maskedDetectedIp: string;
  isCurrentIpApproved: boolean;
  isCurrentIpLoopback: boolean;
  ruleType: string;
  proxyHeadersDetected: boolean;
  proxyHopCount: number;
}


