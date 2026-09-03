import { getDatabase } from './server/db/index.ts';
import { seedDatabase } from './server/db/seed.ts';
import { reportService } from './server/services/report.service.ts';
import { authService } from './server/services/auth.service.ts';
import { attendanceService } from './server/services/attendance.service.ts';
import {
  getDateRangeForPreset,
  isValidDateString,
  getDaysBetweenDates,
  calculateWorkingDuration,
  getTodayDateString,
} from './server/utils/time.ts';
import { UserRole, UserStatus, SafeUser } from './src/types/index.ts';

async function runPhase5Tests() {
  console.log('====================================================');
  console.log('   RUNNING PHASE 5 COMPREHENSIVE TEST SUITE');
  console.log('   (ATTENDANCE REPORTS, EXPORTS, AUDIT & SECURITY)');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}`);
      failed++;
    }
  }

  // 1. Initialize clean database
  const db = getDatabase();
  await seedDatabase();

  // Retrieve seed users for testing
  const superAdminRow = db.prepare('SELECT * FROM users WHERE role = ?').get(UserRole.SUPER_ADMIN) as any;
  const adminRow = db.prepare('SELECT * FROM users WHERE role = ?').get(UserRole.ADMIN) as any;
  const staffRow = db.prepare('SELECT * FROM users WHERE role = ? AND status = ?').get(UserRole.STAFF, UserStatus.ACTIVE) as any;

  const superAdminUser: SafeUser = {
    id: superAdminRow.id,
    email: superAdminRow.email,
    firstName: superAdminRow.first_name,
    lastName: superAdminRow.last_name,
    phone: superAdminRow.phone,
    department: superAdminRow.department,
    role: superAdminRow.role,
    status: superAdminRow.status,
  };

  const adminUser: SafeUser = {
    id: adminRow.id,
    email: adminRow.email,
    firstName: adminRow.first_name,
    lastName: adminRow.last_name,
    phone: adminRow.phone,
    department: adminRow.department,
    role: adminRow.role,
    status: adminRow.status,
  };

  const staffUser: SafeUser = {
    id: staffRow.id,
    email: staffRow.email,
    firstName: staffRow.first_name,
    lastName: staffRow.last_name,
    phone: staffRow.phone,
    department: staffRow.department,
    role: staffRow.role,
    status: staffRow.status,
  };

  // Seed structured attendance history for deterministic testing
  const testStaff1 = staffRow.id;
  const testStaff2 = db.prepare('SELECT id FROM users WHERE role = ? AND id != ? LIMIT 1').get(UserRole.STAFF, testStaff1) as any;
  const testStaff2Id = testStaff2 ? testStaff2.id : testStaff1;

  // Insert test records across specific past dates
  const insertAttendance = db.prepare(`
    INSERT OR REPLACE INTO attendance (
      id, staff_id, date, check_in, check_out, check_in_ip, check_out_ip,
      check_in_verification_method, check_out_verification_method, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertAttendance.run(
    'test-att-01',
    testStaff1,
    '2026-08-01',
    '2026-08-01T08:00:00.000Z',
    '2026-08-01T16:30:00.000Z', // 8h 30m (30600s)
    '192.168.1.50',
    '192.168.1.50',
    'OFFICE_IP',
    'OFFICE_IP',
    'CHECKED_OUT',
    '2026-08-01T08:00:00.000Z',
    '2026-08-01T16:30:00.000Z'
  );

  insertAttendance.run(
    'test-att-02',
    testStaff1,
    '2026-08-02',
    '2026-08-02T08:15:00.000Z',
    '2026-08-02T17:15:00.000Z', // 9h 00m (32400s)
    '192.168.1.50',
    '192.168.1.50',
    'OFFICE_IP',
    'OFFICE_IP',
    'CHECKED_OUT',
    '2026-08-02T08:15:00.000Z',
    '2026-08-02T17:15:00.000Z'
  );

  insertAttendance.run(
    'test-att-03',
    testStaff2Id,
    '2026-08-02',
    '2026-08-02T09:00:00.000Z',
    null, // Incomplete shift
    '192.168.1.50',
    null,
    'OFFICE_IP',
    null,
    'CHECKED_IN',
    '2026-08-02T09:00:00.000Z',
    '2026-08-02T09:00:00.000Z'
  );

  // ==========================================
  // SECTION 1: DATE UTILITIES & PRESET MATH
  // ==========================================
  console.log('\n--- Section 1: Date Validation & Preset Calculations ---');

  assert(isValidDateString('2026-09-02'), 'Valid YYYY-MM-DD date recognized as valid');
  assert(!isValidDateString('2026-02-31'), 'Non-existent calendar date (Feb 31) rejected');
  assert(!isValidDateString('invalid-date'), 'Malformed string rejected');
  assert(!isValidDateString('02-09-2026'), 'Incorrect format rejected');
  assert(!isValidDateString(null), 'Null date rejected');

  assert(getDaysBetweenDates('2026-09-01', '2026-09-01') === 1, 'Same day calculates to 1 calendar day');
  assert(getDaysBetweenDates('2026-09-01', '2026-09-07') === 7, 'Week duration calculates to 7 calendar days');

  const todayRange = getDateRangeForPreset('today');
  assert(todayRange.startDate === todayRange.endDate, 'Today preset returns identical start and end dates');

  const yesterdayRange = getDateRangeForPreset('yesterday');
  assert(yesterdayRange.startDate === yesterdayRange.endDate, 'Yesterday preset returns identical start and end dates');

  const thisWeekRange = getDateRangeForPreset('this_week');
  assert(isValidDateString(thisWeekRange.startDate) && isValidDateString(thisWeekRange.endDate), 'This week preset returns valid date range');
  assert(thisWeekRange.startDate <= thisWeekRange.endDate, 'This week start is before or equal to end date');

  const lastWeekRange = getDateRangeForPreset('last_week');
  assert(getDaysBetweenDates(lastWeekRange.startDate, lastWeekRange.endDate) === 7, 'Last week preset calculates exactly 7 days');

  const thisMonthRange = getDateRangeForPreset('this_month');
  assert(thisMonthRange.startDate.endsWith('-01'), 'This month preset starts on the 1st of the month');

  const lastMonthRange = getDateRangeForPreset('last_month');
  assert(lastMonthRange.startDate.endsWith('-01'), 'Last month preset starts on the 1st of previous month');

  // ==========================================
  // SECTION 2: INPUT VALIDATION & DATE BOUNDS
  // ==========================================
  console.log('\n--- Section 2: Input Validation & Date Bounds ---');

  const invalidStart = reportService.resolveDateRange({ startDate: '2026-13-45', endDate: '2026-09-02' });
  assert(!invalidStart.valid, 'Invalid start date format properly rejected');

  const startAfterEnd = reportService.resolveDateRange({ startDate: '2026-09-10', endDate: '2026-09-01' });
  assert(!startAfterEnd.valid, 'startDate > endDate properly rejected with validation error');

  const excessiveRange = reportService.resolveDateRange({ startDate: '2024-01-01', endDate: '2026-01-01' });
  assert(!excessiveRange.valid, 'Range exceeding 365 days rejected');

  const validRange = reportService.resolveDateRange({ startDate: '2026-08-01', endDate: '2026-08-31' });
  assert(validRange.valid && validRange.startDate === '2026-08-01' && validRange.endDate === '2026-08-31', 'Valid custom date range correctly parsed');

  // ==========================================
  // SECTION 3: ATTENDANCE REPORT GENERATION
  // ==========================================
  console.log('\n--- Section 3: Attendance Report Generation & Filtering ---');

  const augReport = reportService.getAttendanceReport(adminUser, {
    startDate: '2026-08-01',
    endDate: '2026-08-03',
  });

  assert(augReport.success && !!augReport.data, 'Report generated successfully for valid date range');
  assert(augReport.data!.records.length === 3, `Returns exact attendance records for period (expected 3, got ${augReport.data!.records.length})`);
  assert(augReport.data!.summary.totalRecords === 3, 'Summary totalRecords matches row count');
  assert(augReport.data!.summary.completedShifts === 2, 'Summary correctly counts 2 completed shifts');
  assert(augReport.data!.summary.incompleteShifts === 1, 'Summary correctly counts 1 incomplete shift');
  assert(augReport.data!.summary.totalWorkingSeconds === 30600 + 32400, 'Summary accurately computes sum of completed shift durations (63000s)');
  assert(augReport.data!.summary.averageWorkingSeconds === Math.round(63000 / 2), 'Summary accurately computes average shift duration (31500s / 8h 45m)');
  assert(augReport.data!.summary.uniqueStaffAttended >= 1, 'Summary calculates distinct attended staff');

  // Filter by specific staff ID
  const staff1Report = reportService.getAttendanceReport(adminUser, {
    startDate: '2026-08-01',
    endDate: '2026-08-03',
    staffId: testStaff1,
  });

  assert(staff1Report.success, 'Staff-filtered report generated successfully');
  assert(staff1Report.data!.records.every((r) => r.staffId === testStaff1), 'All returned records match filtered staff ID');
  assert(staff1Report.data!.records.length === 2, 'Returns exactly 2 records for Staff 1');

  // Filter by completed status
  const completedReport = reportService.getAttendanceReport(adminUser, {
    startDate: '2026-08-01',
    endDate: '2026-08-03',
    attendanceStatus: 'CHECKED_OUT',
  });

  assert(completedReport.success && completedReport.data!.records.length === 2, 'Attendance status filter (CHECKED_OUT) matches only completed shifts');

  // Filter by incomplete status
  const incompleteReport = reportService.getAttendanceReport(adminUser, {
    startDate: '2026-08-01',
    endDate: '2026-08-03',
    attendanceStatus: 'CHECKED_IN',
  });

  assert(incompleteReport.success && incompleteReport.data!.records.length === 1, 'Attendance status filter (CHECKED_IN) matches only incomplete shifts');

  // Filter by department
  const deptReport = reportService.getAttendanceReport(adminUser, {
    startDate: '2026-08-01',
    endDate: '2026-08-03',
    department: staffRow.department || 'Engineering',
  });
  assert(deptReport.success, 'Department filter query executes without error');

  // ==========================================
  // SECTION 4: SERVER-SIDE PAGINATION & SORTING
  // ==========================================
  console.log('\n--- Section 4: Server-Side Pagination & Safe Sorting ---');

  const page1 = reportService.getAttendanceReport(adminUser, {
    startDate: '2026-08-01',
    endDate: '2026-08-03',
    page: 1,
    limit: 2,
  });

  assert(page1.success && page1.data!.records.length === 2, 'Page 1 returns exact page size limit (2)');
  assert(page1.data!.pagination.page === 1, 'Pagination metadata reflects page 1');
  assert(page1.data!.pagination.total === 3, 'Pagination metadata reflects total count (3)');
  assert(page1.data!.pagination.totalPages === 2, 'Pagination metadata calculates total pages (2)');
  assert(page1.data!.pagination.hasNextPage === true, 'Pagination metadata indicates next page available');

  const page2 = reportService.getAttendanceReport(adminUser, {
    startDate: '2026-08-01',
    endDate: '2026-08-03',
    page: 2,
    limit: 2,
  });

  assert(page2.success && page2.data!.records.length === 1, 'Page 2 returns remaining single record');
  assert(page2.data!.pagination.hasPrevPage === true, 'Page 2 indicates previous page available');

  // Sorting tests
  const sortedAsc = reportService.getAttendanceReport(adminUser, {
    startDate: '2026-08-01',
    endDate: '2026-08-03',
    sort: 'date',
    order: 'asc',
  });
  assert(sortedAsc.data!.records[0].date === '2026-08-01', 'Ascending date sort returns earliest date first');

  const sortedDesc = reportService.getAttendanceReport(adminUser, {
    startDate: '2026-08-01',
    endDate: '2026-08-03',
    sort: 'date',
    order: 'desc',
  });
  assert(sortedDesc.data!.records[0].date === '2026-08-02', 'Descending date sort returns latest date first');

  // ==========================================
  // SECTION 5: CSV EXPORT & FORMULA INJECTION DEFENSE
  // ==========================================
  console.log('\n--- Section 5: CSV Export & Spreadsheet Security ---');

  // Formula injection sanitization tests
  assert(reportService.sanitizeCsvValue('=SUM(A1:A10)') === `'=SUM(A1:A10)`, 'Formula beginning with = is escaped with leading apostrophe');
  assert(reportService.sanitizeCsvValue('+CMD|') === `'+CMD|`, 'Formula beginning with + is escaped with leading apostrophe');
  assert(reportService.sanitizeCsvValue('-1+1') === `'-1+1`, 'Value beginning with - is escaped with leading apostrophe');
  assert(reportService.sanitizeCsvValue('@IMPORT') === `'@IMPORT`, 'Formula beginning with @ is escaped with leading apostrophe');
  assert(reportService.sanitizeCsvValue('Standard Name') === 'Standard Name', 'Normal string left intact without alteration');
  assert(reportService.sanitizeCsvValue('Name, with comma') === '"Name, with comma"', 'Comma containing string properly quoted per RFC 4180');

  const csvResult = reportService.generateCsvExport(adminUser, {
    startDate: '2026-08-01',
    endDate: '2026-08-03',
  });

  assert(csvResult.success && !!csvResult.csvContent, 'CSV export generated successfully');
  assert(csvResult.csvContent!.startsWith('\uFEFFDate,Staff Name,Email'), 'CSV starts with UTF-8 BOM and correct header column names');
  assert(csvResult.csvContent!.includes('2026-08-01'), 'CSV contains row data for 2026-08-01');
  assert(csvResult.filename!.includes('attendance-report-2026-08-01-to-2026-08-03.csv'), 'CSV generates sanitized structured filename');

  // ==========================================
  // SECTION 6: EXCEL EXPORT & XML COMPATIBILITY
  // ==========================================
  console.log('\n--- Section 6: Excel Export & XML Formatting ---');

  assert(reportService.sanitizeXmlValue('John & Jane <dev>') === 'John &amp; Jane &lt;dev&gt;', 'XML entities (&, <, >) safely escaped');
  assert(reportService.sanitizeXmlValue('=CMD') === '&apos;=CMD', 'Excel formula injection sanitized with apostrophe in XML');

  const excelResult = reportService.generateExcelExport(adminUser, {
    startDate: '2026-08-01',
    endDate: '2026-08-03',
  });

  assert(excelResult.success && !!excelResult.excelContent, 'Excel export generated successfully');
  assert(excelResult.excelContent!.includes('<?xml version="1.0" encoding="UTF-8"?>'), 'Excel XML starts with valid XML declaration');
  assert(excelResult.excelContent!.includes('<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"'), 'Workbook conforms to SpreadsheetML schema');
  assert(excelResult.excelContent!.includes('<Worksheet ss:Name="Attendance Records">'), 'Includes Attendance Records worksheet');
  assert(excelResult.excelContent!.includes('<Worksheet ss:Name="Report Summary">'), 'Includes Report Summary worksheet');
  assert(excelResult.filename!.endsWith('.xls'), 'Filename formatted with .xls extension');

  // ==========================================
  // SECTION 7: SECURITY, ANTI-IDOR & SECRET PRIVACY
  // ==========================================
  console.log('\n--- Section 7: Security, SQL Injection & Data Privacy ---');

  // SQL Injection tests in filters
  const sqlInjStaff = reportService.getAttendanceReport(adminUser, {
    startDate: '2026-08-01',
    endDate: '2026-08-03',
    staffId: `' OR '1'='1`,
  });
  assert(sqlInjStaff.success && sqlInjStaff.data!.records.length === 0, 'SQL injection attempt in staffId harmlessly yields 0 records without error');

  const sqlInjSort = reportService.getAttendanceReport(adminUser, {
    startDate: '2026-08-01',
    endDate: '2026-08-03',
    sort: 'date; DROP TABLE attendance;--',
  });
  assert(sqlInjSort.success, 'SQL injection in sort parameter safely falls back to default whitelist sort');

  // Secret leakage check
  const sampleRecord = augReport.data!.records[0];
  assert(!('password_hash' in sampleRecord) && !('password' in sampleRecord), 'Password hashes strictly excluded from report row response');
  assert(!('token_hash' in sampleRecord) && !('token' in sampleRecord), 'Session tokens strictly excluded from report row response');
  assert(!excelResult.excelContent!.includes('argon2'), 'Password hash algorithms absent from Excel export');
  assert(!csvResult.csvContent!.includes('password'), 'Passwords absent from CSV export');

  // ==========================================
  // SECTION 8: AUDIT LOGGING VERIFICATION
  // ==========================================
  console.log('\n--- Section 8: Audit Trail Verification ---');

  const reportAudit = db.prepare(`
    SELECT * FROM audit_logs 
    WHERE action = 'ATTENDANCE_REPORT_GENERATED' AND actor_id = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(adminUser.id) as any;

  assert(!!reportAudit, 'ATTENDANCE_REPORT_GENERATED audit log successfully recorded');
  assert(reportAudit.metadata.includes('ATTENDANCE_REPORT'), 'Audit log records report metadata');

  const exportAudit = db.prepare(`
    SELECT * FROM audit_logs 
    WHERE action = 'ATTENDANCE_REPORT_EXPORTED' AND actor_id = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(adminUser.id) as any;

  assert(!!exportAudit, 'ATTENDANCE_REPORT_EXPORTED audit log successfully recorded');
  assert(!exportAudit.metadata.includes('password') && !exportAudit.metadata.includes('token'), 'Audit logs contain zero secrets or credentials');

  // ==========================================
  // SECTION 9: PHASE 3 ATTENDANCE FLOW REGRESSION
  // ==========================================
  console.log('\n--- Section 9: Phase 3 Attendance Mutation Regression ---');

  const todayStr = getTodayDateString();
  const checkInAttempt = attendanceService.checkIn({
    staffId: staffRow.id,
    clientIp: '192.168.1.50',
    userAgent: 'Mocha/Test',
  });

  // Either succeeds or returns ALREADY_CHECKED_IN
  assert(
    checkInAttempt.success || checkInAttempt.errorCode === 'ALREADY_CHECKED_IN',
    'Attendance check-in flow operates consistently with Phase 2/3 rules'
  );

  // ==========================================
  // FINAL REPORT SUMMARY
  // ==========================================
  console.log('\n====================================================');
  console.log(`   PHASE 5 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase5Tests().catch((err) => {
  console.error('Fatal error running Phase 5 tests:', err);
  process.exit(1);
});
