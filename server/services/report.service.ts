import { getDatabase } from '../db/index.ts';
import { auditService } from './audit.service.ts';
import { maskIpAddress } from './network.service.ts';
import {
  calculateWorkingDuration,
  formatTimeInTimezone,
  formatDateInTimezone,
  getTodayDateString,
  getDateRangeForPreset,
  isValidDateString,
  getDaysBetweenDates,
  COMPANY_TIMEZONE,
} from '../utils/time.ts';
import {
  AttendanceReportQuery,
  AttendanceReportResponse,
  AttendanceReportRow,
  AttendanceReportSummary,
  SafeUser,
  UserRole,
  UserStatus,
} from '../../src/types/index.ts';
import { ApiErrorCode } from '../utils/apiResponse.ts';

interface RawReportDbRow {
  id: string;
  date: string;
  check_in: string | null;
  check_out: string | null;
  check_in_ip: string | null;
  check_out_ip: string | null;
  check_in_verification_method: string | null;
  check_out_verification_method: string | null;
  status: string;
  staff_id: string;
  first_name: string;
  last_name: string;
  email: string;
  department: string | null;
  user_status: UserStatus;
}

export class ReportService {
  /**
   * Sanitizes a single cell value for CSV export to prevent Formula Injection (CSV Injection)
   * Escapes values beginning with =, +, -, @, \t, \r by prepending a single quote (')
   */
  public sanitizeCsvValue(val: unknown): string {
    if (val === null || val === undefined) return '';
    let str = String(val).trim();
    if (str.length === 0) return '';

    // If starts with potential formula trigger, neutralize with leading single quote
    if (/^[=+\-@\t\r]/.test(str)) {
      str = `'${str}`;
    }

    // Standard RFC 4180 escaping
    if (/[",\n\r]/.test(str)) {
      str = `"${str.replace(/"/g, '""')}"`;
    }

    return str;
  }

  /**
   * Sanitizes text for XML Spreadsheet 2003
   */
  public sanitizeXmlValue(val: unknown): string {
    if (val === null || val === undefined) return '';
    let str = String(val).trim();
    if (str.length === 0) return '';

    if (/^[=+\-@\t\r]/.test(str)) {
      str = `'${str}`;
    }

    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Resolves and validates date filters
   */
  public resolveDateRange(query: AttendanceReportQuery): {
    valid: boolean;
    startDate: string;
    endDate: string;
    errorMessage?: string;
  } {
    let startDate = query.startDate?.trim();
    let endDate = query.endDate?.trim();

    // If a preset is requested
    if (query.preset && query.preset !== 'custom') {
      const presetRange = getDateRangeForPreset(query.preset);
      startDate = presetRange.startDate;
      endDate = presetRange.endDate;
    }

    // Default to current month if no dates provided
    if (!startDate && !endDate) {
      const defaultRange = getDateRangeForPreset('this_month');
      startDate = defaultRange.startDate;
      endDate = defaultRange.endDate;
    } else if (startDate && !endDate) {
      endDate = startDate;
    } else if (!startDate && endDate) {
      startDate = endDate;
    }

    if (!isValidDateString(startDate)) {
      return {
        valid: false,
        startDate: '',
        endDate: '',
        errorMessage: `Invalid start date format '${startDate}'. Expected YYYY-MM-DD.`,
      };
    }

    if (!isValidDateString(endDate)) {
      return {
        valid: false,
        startDate: '',
        endDate: '',
        errorMessage: `Invalid end date format '${endDate}'. Expected YYYY-MM-DD.`,
      };
    }

    if (startDate! > endDate!) {
      return {
        valid: false,
        startDate: '',
        endDate: '',
        errorMessage: `Start date (${startDate}) cannot be after end date (${endDate}).`,
      };
    }

    const days = getDaysBetweenDates(startDate!, endDate!);
    if (days > 366) {
      return {
        valid: false,
        startDate: '',
        endDate: '',
        errorMessage: `Date range exceeds maximum allowed limit of 365 days (selected: ${days} days).`,
      };
    }

    return {
      valid: true,
      startDate: startDate!,
      endDate: endDate!,
    };
  }

  /**
   * Builds the core WHERE clause and parameters for report queries
   */
  private buildQueryFilter(
    startDate: string,
    endDate: string,
    query: AttendanceReportQuery
  ): {
    whereClause: string;
    params: (string | number)[];
  } {
    let whereClause = ` WHERE a.date >= ? AND a.date <= ?`;
    const params: (string | number)[] = [startDate, endDate];

    // Staff filter
    if (query.staffId && query.staffId !== 'all' && query.staffId.trim()) {
      whereClause += ` AND u.id = ?`;
      params.push(query.staffId.trim());
    }

    // Department filter
    if (query.department && query.department !== 'all' && query.department.trim()) {
      whereClause += ` AND u.department = ?`;
      params.push(query.department.trim());
    }

    // Account status filter
    if (query.accountStatus && query.accountStatus !== 'ALL') {
      whereClause += ` AND u.status = ?`;
      params.push(query.accountStatus);
    }

    // Attendance status filter
    if (query.attendanceStatus && query.attendanceStatus !== 'ALL') {
      const status = query.attendanceStatus.toUpperCase();
      if (status === 'CHECKED_OUT') {
        whereClause += ` AND a.check_out IS NOT NULL`;
      } else if (status === 'CHECKED_IN' || status === 'INCOMPLETE') {
        whereClause += ` AND a.check_in IS NOT NULL AND a.check_out IS NULL`;
      } else if (status === 'PRESENT') {
        whereClause += ` AND a.check_in IS NOT NULL`;
      } else {
        whereClause += ` AND a.status = ?`;
        params.push(query.attendanceStatus);
      }
    }

    return { whereClause, params };
  }

  /**
   * Safely maps user sort input to verified SQL ORDER BY clause
   */
  private getOrderByClause(sort?: string, order?: string): string {
    const isAsc = String(order).toLowerCase() === 'asc';
    const direction = isAsc ? 'ASC' : 'DESC';

    switch (sort) {
      case 'date':
        return ` ORDER BY a.date ${direction}, a.created_at ${direction}`;
      case 'staffName':
        return ` ORDER BY u.last_name ${direction}, u.first_name ${direction}`;
      case 'department':
        return ` ORDER BY u.department ${direction} NULLS LAST, u.last_name ASC`;
      case 'checkIn':
        return ` ORDER BY a.check_in ${direction} NULLS LAST`;
      case 'checkOut':
        return ` ORDER BY a.check_out ${direction} NULLS LAST`;
      case 'workingDuration':
        return ` ORDER BY (CASE WHEN a.check_out IS NOT NULL AND a.check_in IS NOT NULL THEN (strftime('%s', a.check_out) - strftime('%s', a.check_in)) ELSE 0 END) ${direction}`;
      case 'status':
        return ` ORDER BY a.status ${direction}`;
      default:
        return ` ORDER BY a.date DESC, a.check_in DESC NULLS LAST, a.created_at DESC`;
    }
  }

  /**
   * Generates a paginated attendance report with comprehensive summary statistics
   */
  public getAttendanceReport(
    actor: SafeUser,
    query: AttendanceReportQuery,
    ipAddress?: string,
    userAgent?: string
  ): {
    success: boolean;
    data?: AttendanceReportResponse;
    errorCode?: ApiErrorCode;
    errorMessage?: string;
  } {
    const db = getDatabase();

    // 1. Resolve date range
    const dateRange = this.resolveDateRange(query);
    if (!dateRange.valid) {
      return {
        success: false,
        errorCode: ApiErrorCode.VALIDATION_ERROR,
        errorMessage: dateRange.errorMessage,
      };
    }

    const { startDate, endDate } = dateRange;
    const daysInPeriod = getDaysBetweenDates(startDate, endDate);

    // 2. Build filtered SQL
    const { whereClause, params } = this.buildQueryFilter(startDate, endDate, query);

    // 3. Count total matching rows for pagination
    const countSql = `
      SELECT COUNT(*) AS total
      FROM attendance a
      JOIN users u ON a.staff_id = u.id
      ${whereClause}
    `;
    const totalRow = db.prepare(countSql).get(...params) as { total: number } | undefined;
    const totalRecords = totalRow?.total || 0;

    // 4. Calculate Summary Aggregations
    // Total staff in scope
    let staffCountSql = `SELECT COUNT(*) AS total_staff, SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) AS active_staff FROM users WHERE role != 'SUPER_ADMIN'`;
    const staffCountParams: (string | number)[] = [];
    if (query.department && query.department !== 'all' && query.department.trim()) {
      staffCountSql += ` AND department = ?`;
      staffCountParams.push(query.department.trim());
    }
    if (query.staffId && query.staffId !== 'all' && query.staffId.trim()) {
      staffCountSql += ` AND id = ?`;
      staffCountParams.push(query.staffId.trim());
    }
    const staffCountRow = db.prepare(staffCountSql).get(...staffCountParams) as { total_staff: number; active_staff: number } | undefined;
    const totalStaffInScope = staffCountRow?.total_staff || 0;
    const totalActiveStaff = staffCountRow?.active_staff || 0;

    // Fetch all matching rows in period (without pagination limit) to compute exact working seconds and completed shift metrics
    const aggSql = `
      SELECT 
        a.id, a.check_in, a.check_out, a.staff_id
      FROM attendance a
      JOIN users u ON a.staff_id = u.id
      ${whereClause}
    `;
    const allMatchingRows = db.prepare(aggSql).all(...params) as Array<{
      id: string;
      check_in: string | null;
      check_out: string | null;
      staff_id: string;
    }>;

    let completedShifts = 0;
    let incompleteShifts = 0;
    let totalWorkingSeconds = 0;
    const attendedStaffSet = new Set<string>();

    for (const r of allMatchingRows) {
      if (r.check_in) {
        attendedStaffSet.add(r.staff_id);
        if (r.check_out) {
          completedShifts++;
          const duration = calculateWorkingDuration(r.check_in, r.check_out);
          totalWorkingSeconds += duration.totalSeconds;
        } else {
          incompleteShifts++;
        }
      }
    }

    const uniqueStaffAttended = attendedStaffSet.size;
    const averageWorkingSeconds = completedShifts > 0 ? Math.round(totalWorkingSeconds / completedShifts) : 0;
    const avgHours = Math.floor(averageWorkingSeconds / 3600);
    const avgMinutes = Math.floor((averageWorkingSeconds % 3600) / 60);
    const averageWorkingDurationFormatted = `${avgHours}h ${avgMinutes}m`;

    const totalHours = Math.floor(totalWorkingSeconds / 3600);
    const totalMins = Math.floor((totalWorkingSeconds % 3600) / 60);
    const totalWorkingFormatted = `${totalHours}h ${totalMins}m`;

    // Attendance Rate calculation
    let attendanceRate = 0;
    let attendanceRateDescription = '';

    if (daysInPeriod === 1) {
      const denominator = totalActiveStaff > 0 ? totalActiveStaff : Math.max(totalStaffInScope, 1);
      attendanceRate = Math.min(100, Math.round((uniqueStaffAttended / denominator) * 100));
      attendanceRateDescription = `${uniqueStaffAttended} of ${denominator} active staff members recorded attendance today.`;
    } else {
      const expectedShiftDays = Math.max(totalActiveStaff * daysInPeriod, 1);
      attendanceRate = Math.min(100, Math.round((allMatchingRows.length / expectedShiftDays) * 100));
      attendanceRateDescription = `Calculated across ${allMatchingRows.length} attendance records against ${totalActiveStaff} active staff over ${daysInPeriod} days.`;
    }

    const summary: AttendanceReportSummary = {
      startDate,
      endDate,
      daysInPeriod,
      totalStaffInScope,
      totalActiveStaff,
      totalRecords,
      completedShifts,
      incompleteShifts,
      uniqueStaffAttended,
      totalWorkingSeconds,
      totalWorkingFormatted,
      averageWorkingSeconds,
      averageWorkingDurationFormatted,
      attendanceRate,
      attendanceRateDescription,
    };

    // 5. Pagination & Data Query
    const rawPage = Number(query.page);
    const rawLimit = Number(query.limit);
    const page = !isNaN(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
    const limit = !isNaN(rawLimit) && rawLimit >= 1 ? Math.min(Math.floor(rawLimit), 100) : 25;
    const offset = (page - 1) * limit;
    const totalPages = Math.ceil(totalRecords / limit) || 1;

    const orderBy = this.getOrderByClause(query.sort, query.order);

    const dataSql = `
      SELECT 
        a.id,
        a.date,
        a.check_in,
        a.check_out,
        a.check_in_ip,
        a.check_out_ip,
        a.check_in_verification_method,
        a.check_out_verification_method,
        a.status,
        u.id AS staff_id,
        u.first_name,
        u.last_name,
        u.email,
        u.department,
        u.status AS user_status
      FROM attendance a
      JOIN users u ON a.staff_id = u.id
      ${whereClause}
      ${orderBy}
      LIMIT ? OFFSET ?
    `;

    const dataParams = [...params, limit, offset];
    const rows = (db.prepare(dataSql).all(...dataParams) as unknown) as RawReportDbRow[];

    const records: AttendanceReportRow[] = rows.map((r) => {
      const duration = calculateWorkingDuration(r.check_in, r.check_out);
      return {
        id: r.id,
        date: r.date,
        formattedDate: formatDateInTimezone(r.date),
        staffId: r.staff_id,
        staffName: `${r.first_name} ${r.last_name}`.trim(),
        email: r.email,
        department: r.department,
        accountStatus: r.user_status,
        checkIn: r.check_in,
        checkOut: r.check_out,
        formattedCheckIn: formatTimeInTimezone(r.check_in),
        formattedCheckOut: formatTimeInTimezone(r.check_out),
        workingDuration: r.check_out ? duration.formatted : (r.check_in ? 'In Progress' : '--'),
        durationSeconds: r.check_out ? duration.totalSeconds : null,
        status: r.check_out ? 'CHECKED_OUT' : (r.check_in ? 'CHECKED_IN' : r.status),
        verificationMethod: r.check_in_verification_method || r.check_out_verification_method || 'OFFICE_IP',
        maskedIp: r.check_in_ip ? maskIpAddress(r.check_in_ip) : null,
      };
    });

    // 6. Record Audit Log for Report Generation
    auditService.log({
      actorId: actor.id,
      action: 'ATTENDANCE_REPORT_GENERATED',
      ipAddress,
      userAgent,
      metadata: {
        reportType: 'ATTENDANCE_REPORT',
        startDate,
        endDate,
        staffId: query.staffId || 'ALL',
        department: query.department || 'ALL',
        attendanceStatus: query.attendanceStatus || 'ALL',
        totalResults: totalRecords,
      },
    });

    return {
      success: true,
      data: {
        filters: {
          startDate,
          endDate,
          staffId: query.staffId,
          department: query.department,
          accountStatus: query.accountStatus,
          attendanceStatus: query.attendanceStatus,
        },
        summary,
        pagination: {
          page,
          limit,
          total: totalRecords,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
        records,
      },
    };
  }

  /**
   * Retrieves all matching report rows for export (up to maximum safety export limit)
   */
  public getAllMatchingReportRows(
    query: AttendanceReportQuery,
    maxExportLimit = 10000
  ): {
    success: boolean;
    startDate?: string;
    endDate?: string;
    records?: AttendanceReportRow[];
    summary?: AttendanceReportSummary;
    errorCode?: ApiErrorCode;
    errorMessage?: string;
  } {
    const db = getDatabase();

    const dateRange = this.resolveDateRange(query);
    if (!dateRange.valid) {
      return {
        success: false,
        errorCode: ApiErrorCode.VALIDATION_ERROR,
        errorMessage: dateRange.errorMessage,
      };
    }

    const { startDate, endDate } = dateRange;
    const { whereClause, params } = this.buildQueryFilter(startDate, endDate, query);
    const orderBy = this.getOrderByClause(query.sort, query.order);

    const exportSql = `
      SELECT 
        a.id,
        a.date,
        a.check_in,
        a.check_out,
        a.check_in_ip,
        a.check_out_ip,
        a.check_in_verification_method,
        a.check_out_verification_method,
        a.status,
        u.id AS staff_id,
        u.first_name,
        u.last_name,
        u.email,
        u.department,
        u.status AS user_status
      FROM attendance a
      JOIN users u ON a.staff_id = u.id
      ${whereClause}
      ${orderBy}
      LIMIT ?
    `;

    const rows = (db.prepare(exportSql).all(...params, maxExportLimit) as unknown) as RawReportDbRow[];

    const records: AttendanceReportRow[] = rows.map((r) => {
      const duration = calculateWorkingDuration(r.check_in, r.check_out);
      return {
        id: r.id,
        date: r.date,
        formattedDate: formatDateInTimezone(r.date),
        staffId: r.staff_id,
        staffName: `${r.first_name} ${r.last_name}`.trim(),
        email: r.email,
        department: r.department,
        accountStatus: r.user_status,
        checkIn: r.check_in,
        checkOut: r.check_out,
        formattedCheckIn: formatTimeInTimezone(r.check_in),
        formattedCheckOut: formatTimeInTimezone(r.check_out),
        workingDuration: r.check_out ? duration.formatted : (r.check_in ? 'In Progress' : '--'),
        durationSeconds: r.check_out ? duration.totalSeconds : null,
        status: r.check_out ? 'CHECKED_OUT' : (r.check_in ? 'CHECKED_IN' : r.status),
        verificationMethod: r.check_in_verification_method || r.check_out_verification_method || 'OFFICE_IP',
        maskedIp: r.check_in_ip ? maskIpAddress(r.check_in_ip) : null,
      };
    });

    return {
      success: true,
      startDate,
      endDate,
      records,
    };
  }

  /**
   * Generates sanitized CSV export content
   */
  public generateCsvExport(
    actor: SafeUser,
    query: AttendanceReportQuery,
    ipAddress?: string,
    userAgent?: string
  ): {
    success: boolean;
    csvContent?: string;
    filename?: string;
    recordCount?: number;
    errorCode?: ApiErrorCode;
    errorMessage?: string;
  } {
    const result = this.getAllMatchingReportRows(query);
    if (!result.success || !result.records) {
      return {
        success: false,
        errorCode: result.errorCode || ApiErrorCode.VALIDATION_ERROR,
        errorMessage: result.errorMessage || 'Failed to generate export dataset.',
      };
    }

    const { startDate, endDate, records } = result;

    const headers = [
      'Date',
      'Staff Name',
      'Email',
      'Department',
      'Account Status',
      'Check-In Time',
      'Check-Out Time',
      'Working Duration',
      'Attendance Status',
      'Verification Method',
      'Masked IP',
    ];

    const lines: string[] = [headers.map((h) => this.sanitizeCsvValue(h)).join(',')];

    for (const r of records) {
      const row = [
        this.sanitizeCsvValue(r.date),
        this.sanitizeCsvValue(r.staffName),
        this.sanitizeCsvValue(r.email),
        this.sanitizeCsvValue(r.department || 'Unassigned'),
        this.sanitizeCsvValue(r.accountStatus),
        this.sanitizeCsvValue(r.formattedCheckIn),
        this.sanitizeCsvValue(r.formattedCheckOut),
        this.sanitizeCsvValue(r.workingDuration || '--'),
        this.sanitizeCsvValue(r.status),
        this.sanitizeCsvValue(r.verificationMethod || 'OFFICE_IP'),
        this.sanitizeCsvValue(r.maskedIp || '--'),
      ];
      lines.push(row.join(','));
    }

    const csvContent = '\uFEFF' + lines.join('\r\n'); // Include UTF-8 BOM for Excel compatibility
    const filename = `attendance-report-${startDate}-to-${endDate}.csv`;

    // Audit log for export
    auditService.log({
      actorId: actor.id,
      action: 'ATTENDANCE_REPORT_EXPORTED',
      ipAddress,
      userAgent,
      metadata: {
        exportFormat: 'CSV',
        startDate,
        endDate,
        staffId: query.staffId || 'ALL',
        department: query.department || 'ALL',
        recordCount: records.length,
      },
    });

    return {
      success: true,
      csvContent,
      filename,
      recordCount: records.length,
    };
  }

  /**
   * Generates sanitized XML Spreadsheet 2003 (.xls/.xlsx compatible) export content
   */
  public generateExcelExport(
    actor: SafeUser,
    query: AttendanceReportQuery,
    ipAddress?: string,
    userAgent?: string
  ): {
    success: boolean;
    excelContent?: string;
    filename?: string;
    recordCount?: number;
    errorCode?: ApiErrorCode;
    errorMessage?: string;
  } {
    const result = this.getAllMatchingReportRows(query);
    if (!result.success || !result.records) {
      return {
        success: false,
        errorCode: result.errorCode || ApiErrorCode.VALIDATION_ERROR,
        errorMessage: result.errorMessage || 'Failed to generate export dataset.',
      };
    }

    const { startDate, endDate, records } = result;

    const dataRowsXml = records
      .map((r) => {
        return `      <Row>
        <Cell><Data ss:Type="String">${this.sanitizeXmlValue(r.date)}</Data></Cell>
        <Cell><Data ss:Type="String">${this.sanitizeXmlValue(r.staffName)}</Data></Cell>
        <Cell><Data ss:Type="String">${this.sanitizeXmlValue(r.email)}</Data></Cell>
        <Cell><Data ss:Type="String">${this.sanitizeXmlValue(r.department || 'Unassigned')}</Data></Cell>
        <Cell><Data ss:Type="String">${this.sanitizeXmlValue(r.accountStatus)}</Data></Cell>
        <Cell><Data ss:Type="String">${this.sanitizeXmlValue(r.formattedCheckIn)}</Data></Cell>
        <Cell><Data ss:Type="String">${this.sanitizeXmlValue(r.formattedCheckOut)}</Data></Cell>
        <Cell><Data ss:Type="String">${this.sanitizeXmlValue(r.workingDuration || '--')}</Data></Cell>
        <Cell><Data ss:Type="String">${this.sanitizeXmlValue(r.status)}</Data></Cell>
        <Cell><Data ss:Type="String">${this.sanitizeXmlValue(r.verificationMethod || 'OFFICE_IP')}</Data></Cell>
        <Cell><Data ss:Type="String">${this.sanitizeXmlValue(r.maskedIp || '--')}</Data></Cell>
      </Row>`;
      })
      .join('\n');

    const generatedAt = new Date().toISOString();

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">
  <Title>Attendance Report</Title>
  <Author>Attendance Management System</Author>
  <Created>${generatedAt}</Created>
 </DocumentProperties>
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Center"/>
   <Font ss:FontName="Segoe UI" x:Family="Swiss" ss:Size="11" ss:Color="#1E293B"/>
  </Style>
  <Style ss:ID="Header">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
   </Borders>
   <Font ss:FontName="Segoe UI" x:Family="Swiss" ss:Size="11" ss:Color="#0F172A" ss:Bold="1"/>
   <Interior ss:Color="#F1F5F9" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="Title">
   <Font ss:FontName="Segoe UI" x:Family="Swiss" ss:Size="14" ss:Color="#0F172A" ss:Bold="1"/>
  </Style>
  <Style ss:ID="SubTitle">
   <Font ss:FontName="Segoe UI" x:Family="Swiss" ss:Size="10" ss:Color="#64748B"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="Attendance Records">
  <Table ss:DefaultColumnWidth="110" ss:DefaultRowHeight="20">
   <Column ss:Width="90"/>
   <Column ss:Width="130"/>
   <Column ss:Width="160"/>
   <Column ss:Width="120"/>
   <Column ss:Width="100"/>
   <Column ss:Width="90"/>
   <Column ss:Width="90"/>
   <Column ss:Width="100"/>
   <Column ss:Width="110"/>
   <Column ss:Width="120"/>
   <Column ss:Width="110"/>
   <Row ss:Height="26">
    <Cell ss:StyleID="Header"><Data ss:Type="String">Date</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">Staff Name</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">Email</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">Department</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">Account Status</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">Check-In</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">Check-Out</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">Duration</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">Status</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">Verification</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">Masked IP</Data></Cell>
   </Row>
${dataRowsXml}
  </Table>
 </Worksheet>
 <Worksheet ss:Name="Report Summary">
  <Table ss:DefaultColumnWidth="140" ss:DefaultRowHeight="20">
   <Column ss:Width="180"/>
   <Column ss:Width="250"/>
   <Row ss:Height="24">
    <Cell ss:StyleID="Title"><Data ss:Type="String">Attendance Report Summary</Data></Cell>
   </Row>
   <Row>
    <Cell ss:StyleID="SubTitle"><Data ss:Type="String">Generated: ${generatedAt} (${COMPANY_TIMEZONE})</Data></Cell>
   </Row>
   <Row><Cell><Data ss:Type="String"></Data></Cell></Row>
   <Row>
    <Cell ss:StyleID="Header"><Data ss:Type="String">Metric</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">Value</Data></Cell>
   </Row>
   <Row>
    <Cell><Data ss:Type="String">Period</Data></Cell>
    <Cell><Data ss:Type="String">${startDate} to ${endDate}</Data></Cell>
   </Row>
   <Row>
    <Cell><Data ss:Type="String">Total Records Exported</Data></Cell>
    <Cell><Data ss:Type="Number">${records.length}</Data></Cell>
   </Row>
   <Row>
    <Cell><Data ss:Type="String">Generated By</Data></Cell>
    <Cell><Data ss:Type="String">${this.sanitizeXmlValue(actor.firstName)} ${this.sanitizeXmlValue(actor.lastName)} (${this.sanitizeXmlValue(actor.email)})</Data></Cell>
   </Row>
  </Table>
 </Worksheet>
</Workbook>`;

    const filename = `attendance-report-${startDate}-to-${endDate}.xls`;

    // Audit log for export
    auditService.log({
      actorId: actor.id,
      action: 'ATTENDANCE_REPORT_EXPORTED',
      ipAddress,
      userAgent,
      metadata: {
        exportFormat: 'EXCEL',
        startDate,
        endDate,
        staffId: query.staffId || 'ALL',
        department: query.department || 'ALL',
        recordCount: records.length,
      },
    });

    return {
      success: true,
      excelContent: xml,
      filename,
      recordCount: records.length,
    };
  }
}

export const reportService = new ReportService();
