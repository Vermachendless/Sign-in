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
  actorName?: string | null;
  actorEmail?: string | null;
  actorRole?: string | null;
  targetUserName?: string | null;
  targetUserEmail?: string | null;
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

export enum EventStatus {
  DRAFT = 'DRAFT',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
  COMPLETED = 'COMPLETED',
}

export interface EventRecord {
  id: string;
  title: string;
  description: string | null;
  location: string;
  startAt: string;
  endAt: string;
  status: EventStatus;
  createdBy: string;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  creatorName?: string | null;
  creatorEmail?: string | null;
  creatorRole?: string | null;
  approverName?: string | null;
  approverEmail?: string | null;
  formattedStart?: string;
  formattedEnd?: string;
}

export interface CreateEventInput {
  title: string;
  description?: string | null;
  location: string;
  startAt: string;
  endAt: string;
}

export interface UpdateEventInput {
  title?: string;
  description?: string | null;
  location?: string;
  startAt?: string;
  endAt?: string;
}

export enum PassType {
  EVENT = 'EVENT',
  VISITOR = 'VISITOR',
}

export enum AccessPassStatus {
  ACTIVE = 'ACTIVE',
  REVOKED = 'REVOKED',
  EXPIRED = 'EXPIRED',
  EXHAUSTED = 'EXHAUSTED',
}

export interface AccessPassRecord {
  id: string;
  passType: PassType;
  eventId?: string | null;
  hostStaffId?: string | null;
  displayCode: string;
  validFrom: string;
  validUntil: string;
  status: AccessPassStatus;
  maxUses?: number | null;
  useCount: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string | null;
  revokedBy?: string | null;
  revokeReason?: string | null;
  rawToken?: string;
  eventTitle?: string | null;
  eventLocation?: string | null;
  creatorName?: string | null;
  hostStaffName?: string | null;
  revokerName?: string | null;
  formattedValidFrom?: string;
  formattedValidUntil?: string;
}

export interface VerificationResult {
  valid: boolean;
  code?: string;
  message?: string;
  passType?: PassType;
  displayCode?: string;
  event?: {
    id: string;
    title: string;
    location: string;
    startAt: string;
    endAt: string;
  } | null;
  invitee?: {
    id: string;
    fullName: string;
    organization?: string | null;
  } | null;
  visitor?: {
    id: string;
    visitorName: string;
    hostStaffName: string;
    hostStaffDepartment?: string | null;
    visitDate: string;
    visitTime: string;
    purpose?: string | null;
    status: string;
  } | null;
  validFrom?: string;
  validUntil?: string;
  maxUses?: number | null;
  useCount?: number;
  remainingUses?: number | null;
}

export enum InviteeStatus {
  INVITED = 'INVITED',
  ACCESS_ISSUED = 'ACCESS_ISSUED',
  CHECKED_IN = 'CHECKED_IN',
  CHECKED_OUT = 'CHECKED_OUT',
  CANCELLED = 'CANCELLED',
}

export interface EventInviteeRecord {
  id: string;
  eventId: string;
  fullName: string;
  phone?: string | null;
  email?: string | null;
  organization?: string | null;
  notes?: string | null;
  status: InviteeStatus;
  accessPassId?: string | null;
  invitedBy: string;
  createdAt: string;
  updatedAt: string;
  invitedByName?: string | null;
  accessPass?: AccessPassRecord | null;
}

export interface CreateInviteeInput {
  fullName: string;
  phone?: string | null;
  email?: string | null;
  organization?: string | null;
  notes?: string | null;
}

export interface UpdateInviteeInput {
  fullName?: string;
  phone?: string | null;
  email?: string | null;
  organization?: string | null;
  notes?: string | null;
}

export interface EventInviteesSummary {
  total: number;
  accessIssued: number;
  cancelled: number;
  invited: number;
}

export enum VisitorVisitStatus {
  PENDING = 'PENDING',
  ACCESS_ISSUED = 'ACCESS_ISSUED',
  CHECKED_IN = 'CHECKED_IN',
  CHECKED_OUT = 'CHECKED_OUT',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

export enum AccessVisitStatus {
  VERIFIED = 'VERIFIED',
  CHECKED_IN = 'CHECKED_IN',
  CHECKED_OUT = 'CHECKED_OUT',
  DENIED = 'DENIED',
  CANCELLED = 'CANCELLED',
}

export interface AccessVisitRecord {
  id: string;
  accessPassId: string;
  passType: PassType;
  eventInviteeId?: string | null;
  visitorVisitId?: string | null;
  checkedInAt?: string | null;
  checkedInBy?: string | null;
  checkedOutAt?: string | null;
  checkedOutBy?: string | null;
  status: AccessVisitStatus;
  denialReason?: string | null;
  createdAt: string;
  updatedAt: string;
  guestName?: string;
  guestEmail?: string | null;
  guestPhone?: string | null;
  guestOrganization?: string | null;
  hostOrEventTitle?: string;
  eventLocation?: string | null;
  displayCode?: string;
  checkedInByName?: string | null;
  checkedOutByName?: string | null;
  formattedCheckedInAt?: string;
  formattedCheckedOutAt?: string;
}

export interface ReceptionSummaryMetrics {
  currentlyCheckedIn: number;
  todayVisitors: number;
  todayEventGuests: number;
  checkedOutToday: number;
  accessDeniedToday: number;
}

export interface ReceptionVerificationResponse {
  valid: boolean;
  code?: string;
  message?: string;
  passId?: string;
  passType?: PassType;
  displayCode?: string;
  guestName?: string;
  organization?: string | null;
  hostStaffName?: string | null;
  hostStaffDepartment?: string | null;
  eventTitle?: string | null;
  eventLocation?: string | null;
  visitDate?: string;
  validFrom?: string;
  validUntil?: string;
  formattedValidRange?: string;
  passStatus?: string;
  isCheckedIn: boolean;
  isCheckedOut: boolean;
  canCheckIn: boolean;
  canCheckOut: boolean;
  activeVisitId?: string | null;
  checkedInAt?: string | null;
  checkedOutAt?: string | null;
  denialReason?: string | null;
}

export interface VisitorVisitRecord {
  id: string;
  hostStaffId: string;
  visitorFullName: string;
  visitorPhone?: string | null;
  visitorEmail?: string | null;
  purpose?: string | null;
  notes?: string | null;
  validFrom: string;
  validUntil: string;
  status: VisitorVisitStatus;
  accessPassId?: string | null;
  createdAt: string;
  updatedAt: string;
  cancelledAt?: string | null;
  cancelledBy?: string | null;
  hostStaffName?: string | null;
  hostStaffDepartment?: string | null;
  hostStaffEmail?: string | null;
  cancelledByName?: string | null;
  accessPass?: AccessPassRecord | null;
  formattedDate?: string;
  formattedTimeRange?: string;
}

export interface CreateVisitorVisitInput {
  visitorFullName: string;
  visitorPhone?: string | null;
  visitorEmail?: string | null;
  purpose?: string | null;
  notes?: string | null;
  visitDate: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string;   // HH:mm
}

export interface UpdateVisitorVisitInput {
  visitorFullName?: string;
  visitorPhone?: string | null;
  visitorEmail?: string | null;
  purpose?: string | null;
  notes?: string | null;
  visitDate?: string;
  startTime?: string;
  endTime?: string;
}

export interface VisitorVisitsSummary {
  total: number;
  today: number;
  upcoming: number;
  accessIssued: number;
  pending: number;
  cancelled: number;
}

