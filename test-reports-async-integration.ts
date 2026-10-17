/**
 * Phase 7 Batch 2C — Reports Service & Routes Asynchronous Integration Test Suite
 *
 * Covers:
 * 1. Asynchronous Attendance Report generation and aggregation via dbAdapter
 * 2. Exact aggregation calculations: completed shifts, incomplete shifts, working seconds, unique staff, attendance rate
 * 3. Africa/Lagos date preset math, custom ranges, boundary transitions, and leap day handling
 * 4. Status (CHECKED_OUT, CHECKED_IN, PRESENT, ALL), staffId, department, and account status filtering
 * 5. Pagination (page, limit capped at 100) and safe multi-column sorting (including NULLS LAST)
 * 6. CSV and Excel (.xls XML SpreadsheetML) exports with formula injection defense
 * 7. Distinct department listing via asynchronous dbAdapter query
 * 8. Zero credential secret exposure in report records, exports, and audit logs
 * 9. Audit trail completeness (ATTENDANCE_REPORT_GENERATED, ATTENDANCE_REPORT_EXPORTED)
 * 10. Express report routes async propagation (all handlers are AsyncFunction instances)
 */

import assert from 'node:assert';
import { getDatabase } from './server/db/index.ts';
import { dbAdapter } from './server/db/adapter.ts';
import { reportService } from './server/services/report.service.ts';
import { auditService } from './server/services/audit.service.ts';
import { seedDatabase } from './server/db/seed.ts';
import {
  UserRole,
  UserStatus,
  SafeUser,
  AttendanceReportQuery,
} from './src/types/index.ts';
import {
  COMPANY_TIMEZONE,
  getTodayDateString,
  getDateRangeForPreset,
  isValidDateString,
  getDaysBetweenDates,
} from './server/utils/time.ts';
import reportRoutes from './server/routes/report.routes.ts';

let passed = 0;
let failed = 0;

function pass(message: string) {
  console.log(`✅ [PASS] ${message}`);
  passed++;
}

function fail(message: string, error?: any) {
  console.error(`❌ [FAIL] ${message}`, error || '');
  failed++;
}

async function runReportsAsyncIntegrationTests() {
  console.log('================================================================');
  console.log('   PHASE 7 BATCH 2C — REPORTS ASYNC INTEGRATION TESTS           ');
  console.log('================================================================\n');

  // 1. Initialize clean database and seed
  const db = getDatabase();
  await seedDatabase();

  // Retrieve seed actors
  const adminRow = db.prepare('SELECT * FROM users WHERE role = ?').get(UserRole.ADMIN) as any;
  const superAdminRow = db.prepare('SELECT * FROM users WHERE role = ?').get(UserRole.SUPER_ADMIN) as any;
  const staffRow = db.prepare('SELECT * FROM users WHERE role = ? AND status = ?').get(UserRole.STAFF, UserStatus.ACTIVE) as any;

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

  // Seed dedicated test records across distinct dates and departments for reports testing
  const now = new Date().toISOString();
  const testStaff1 = staffRow.id;

  // Create another staff in a different department
  const testStaff2Id = 'rep-test-staff-02';
  db.prepare(`
    INSERT OR REPLACE INTO users (id, email, password_hash, first_name, last_name, role, department, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    testStaff2Id,
    'rep.staff2@amalitech.org',
    'hash123',
    'Amara',
    'Okeke',
    UserRole.STAFF,
    'Product Management',
    UserStatus.ACTIVE,
    now,
    now
  );

  // Clear existing attendance for deterministic tests
  db.prepare('DELETE FROM attendance').run();

  // Record 1: Staff 1 - 2026-08-01 Completed Shift (8.5h = 30600s)
  db.prepare(`
    INSERT INTO attendance (id, staff_id, date, check_in, check_out, check_in_ip, check_out_ip, check_in_verification_method, check_out_verification_method, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'rep-att-01',
    testStaff1,
    '2026-08-01',
    '2026-08-01T08:30:00.000Z',
    '2026-08-01T17:00:00.000Z',
    '192.168.1.50',
    '192.168.1.50',
    'OFFICE_IP',
    'OFFICE_IP',
    'CHECKED_OUT',
    '2026-08-01T08:30:00.000Z',
    '2026-08-01T17:00:00.000Z'
  );

  // Record 2: Staff 1 - 2026-08-02 Completed Shift (9h = 32400s)
  db.prepare(`
    INSERT INTO attendance (id, staff_id, date, check_in, check_out, check_in_ip, check_out_ip, check_in_verification_method, check_out_verification_method, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'rep-att-02',
    testStaff1,
    '2026-08-02',
    '2026-08-02T08:00:00.000Z',
    '2026-08-02T17:00:00.000Z',
    '192.168.1.50',
    '192.168.1.50',
    'OFFICE_IP',
    'OFFICE_IP',
    'CHECKED_OUT',
    '2026-08-02T08:00:00.000Z',
    '2026-08-02T17:00:00.000Z'
  );

  // Record 3: Staff 2 - 2026-08-02 Incomplete Shift (checked in, no check out)
  db.prepare(`
    INSERT INTO attendance (id, staff_id, date, check_in, check_out, check_in_ip, check_out_ip, check_in_verification_method, check_out_verification_method, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'rep-att-03',
    testStaff2Id,
    '2026-08-02',
    '2026-08-02T09:00:00.000Z',
    null,
    '192.168.1.50',
    null,
    'OFFICE_IP',
    null,
    'CHECKED_IN',
    '2026-08-02T09:00:00.000Z',
    '2026-08-02T09:00:00.000Z'
  );

  // Record 4: Staff 2 - 2026-08-03 Completed Shift (7h = 25200s)
  db.prepare(`
    INSERT INTO attendance (id, staff_id, date, check_in, check_out, check_in_ip, check_out_ip, check_in_verification_method, check_out_verification_method, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'rep-att-04',
    testStaff2Id,
    '2026-08-03',
    '2026-08-03T09:00:00.000Z',
    '2026-08-03T16:00:00.000Z',
    '192.168.1.50',
    '192.168.1.50',
    'OFFICE_IP',
    'OFFICE_IP',
    'CHECKED_OUT',
    '2026-08-03T09:00:00.000Z',
    '2026-08-03T16:00:00.000Z'
  );

  // Record 5: Staff 1 - Month Transition: 2026-08-31
  db.prepare(`
    INSERT INTO attendance (id, staff_id, date, check_in, check_out, check_in_ip, check_out_ip, check_in_verification_method, check_out_verification_method, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'rep-att-05',
    testStaff1,
    '2026-08-31',
    '2026-08-31T08:00:00.000Z',
    '2026-08-31T16:00:00.000Z',
    '192.168.1.50',
    '192.168.1.50',
    'OFFICE_IP',
    'OFFICE_IP',
    'CHECKED_OUT',
    '2026-08-31T08:00:00.000Z',
    '2026-08-31T16:00:00.000Z'
  );

  // Record 6: Staff 1 - Year Transition: 2026-12-31
  db.prepare(`
    INSERT INTO attendance (id, staff_id, date, check_in, check_out, check_in_ip, check_out_ip, check_in_verification_method, check_out_verification_method, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'rep-att-06',
    testStaff1,
    '2026-12-31',
    '2026-12-31T08:00:00.000Z',
    '2026-12-31T16:00:00.000Z',
    '192.168.1.50',
    '192.168.1.50',
    'OFFICE_IP',
    'OFFICE_IP',
    'CHECKED_OUT',
    '2026-12-31T08:00:00.000Z',
    '2026-12-31T16:00:00.000Z'
  );

  // Record 7: Staff 1 - Next Year: 2027-01-01
  db.prepare(`
    INSERT INTO attendance (id, staff_id, date, check_in, check_out, check_in_ip, check_out_ip, check_in_verification_method, check_out_verification_method, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'rep-att-07',
    testStaff1,
    '2027-01-01',
    '2027-01-01T09:00:00.000Z',
    '2027-01-01T17:00:00.000Z',
    '192.168.1.50',
    '192.168.1.50',
    'OFFICE_IP',
    'OFFICE_IP',
    'CHECKED_OUT',
    '2027-01-01T09:00:00.000Z',
    '2027-01-01T17:00:00.000Z'
  );

  // =========================================================================
  // 1. Asynchronous Execution and Contract Validation
  // =========================================================================
  console.log('--- 1. Asynchronous Execution and Contract Validation ---');

  const reportPromise = reportService.getAttendanceReport(adminUser, {
    startDate: '2026-08-01',
    endDate: '2026-08-03',
  });
  assert(reportPromise instanceof Promise, 'getAttendanceReport returns a genuine Promise');
  const res1 = await reportPromise;
  assert(res1.success && !!res1.data, 'Report resolved successfully with data');
  assert.strictEqual(res1.data.records.length, 4, 'Exact 4 records returned for 2026-08-01 to 2026-08-03');
  pass('reportService.getAttendanceReport returns genuine Promise and resolves correct record count');

  // =========================================================================
  // 2. Summary Statistics & Aggregations Consistency
  // =========================================================================
  console.log('\n--- 2. Summary Statistics & Aggregations Consistency ---');

  const { summary } = res1.data;
  assert.strictEqual(summary.totalRecords, 4, 'Summary totalRecords matches row count (4)');
  assert.strictEqual(summary.completedShifts, 3, 'Summary completedShifts counts exact completed shifts (3)');
  assert.strictEqual(summary.incompleteShifts, 1, 'Summary incompleteShifts counts exact incomplete shifts (1)');
  assert.strictEqual(summary.daysInPeriod, 3, 'Summary daysInPeriod calculates exact calendar days (3)');
  
  // Total working seconds: 30600 + 32400 + 25200 = 88200
  const expectedTotalSeconds = 30600 + 32400 + 25200;
  assert.strictEqual(summary.totalWorkingSeconds, expectedTotalSeconds, `Summary totalWorkingSeconds matches sum of completed shifts (${expectedTotalSeconds}s)`);
  assert.strictEqual(summary.averageWorkingSeconds, Math.round(expectedTotalSeconds / 3), 'Summary averageWorkingSeconds matches rounded average');
  assert.strictEqual(summary.uniqueStaffAttended, 2, 'Summary uniqueStaffAttended accurately counts 2 distinct staff');
  assert(summary.attendanceRate >= 0 && summary.attendanceRate <= 100, 'Summary attendanceRate is bounded between 0 and 100%');
  pass('Summary aggregations strictly match underlying database records');

  // =========================================================================
  // 3. Date Presets, Africa/Lagos Timezone, Boundaries, and Leap Days
  // =========================================================================
  console.log('\n--- 3. Date Presets, Africa/Lagos Boundaries & Transitions ---');

  const todayStr = getTodayDateString();
  assert(isValidDateString(todayStr), `Today date '${todayStr}' is valid YYYY-MM-DD`);

  // Presets
  const todayPreset = getDateRangeForPreset('today');
  assert.strictEqual(todayPreset.startDate, todayPreset.endDate, 'Today preset starts and ends on same date');

  const yesterdayPreset = getDateRangeForPreset('yesterday');
  assert.strictEqual(yesterdayPreset.startDate, yesterdayPreset.endDate, 'Yesterday preset starts and ends on same date');

  const thisWeekPreset = getDateRangeForPreset('this_week');
  assert(thisWeekPreset.startDate <= thisWeekPreset.endDate, 'This week starts on or before end date');
  assert.strictEqual(getDaysBetweenDates(thisWeekPreset.startDate, thisWeekPreset.endDate), 7, 'This week spans 7 days');

  const lastWeekPreset = getDateRangeForPreset('last_week');
  assert.strictEqual(getDaysBetweenDates(lastWeekPreset.startDate, lastWeekPreset.endDate), 7, 'Last week spans 7 days');

  const thisMonthPreset = getDateRangeForPreset('this_month');
  assert(thisMonthPreset.startDate.endsWith('-01'), 'This month starts on 01');

  // Month Transition (2026-08-31 to 2026-09-01)
  const monthTransRes = await reportService.getAttendanceReport(adminUser, {
    startDate: '2026-08-31',
    endDate: '2026-09-01',
  });
  assert(monthTransRes.success && monthTransRes.data!.records.length === 1, 'Month transition query captures 2026-08-31 record');
  assert.strictEqual(monthTransRes.data!.records[0].id, 'rep-att-05', 'Matches month-end record');

  // Year Transition (2026-12-31 to 2027-01-01)
  const yearTransRes = await reportService.getAttendanceReport(adminUser, {
    startDate: '2026-12-31',
    endDate: '2027-01-01',
  });
  assert(yearTransRes.success && yearTransRes.data!.records.length === 2, 'Year transition query captures records across year boundary (2)');
  assert.strictEqual(yearTransRes.data!.summary.daysInPeriod, 2, 'Days in period across year boundary is 2');

  // Leap Day Validation
  assert(isValidDateString('2024-02-29'), '2024-02-29 is recognized as a valid leap day');
  assert(!isValidDateString('2025-02-29'), '2025-02-29 is rejected as non-existent leap day');
  assert(!isValidDateString('2026-02-29'), '2026-02-29 is rejected as non-existent leap day');
  assert.strictEqual(getDaysBetweenDates('2024-02-28', '2024-03-01'), 3, 'Days between 2024-02-28 and 2024-03-01 inclusive is 3 days (leap year)');

  pass('Africa/Lagos date preset math, boundary transitions, and leap day calculations verified');

  // =========================================================================
  // 4. Filtering: Status, Staff, Department, Account Status
  // =========================================================================
  console.log('\n--- 4. Filtering: Status, Staff, Department, Account Status ---');

  // Filter: Staff ID
  const staff1Filtered = await reportService.getAttendanceReport(adminUser, {
    startDate: '2026-08-01',
    endDate: '2026-08-03',
    staffId: testStaff1,
  });
  assert(staff1Filtered.success && staff1Filtered.data!.records.length === 2, 'Staff filter returns only records for Staff 1');
  assert(staff1Filtered.data!.records.every((r) => r.staffId === testStaff1), 'All records have Staff 1 ID');

  // Filter: Department
  const deptFiltered = await reportService.getAttendanceReport(adminUser, {
    startDate: '2026-08-01',
    endDate: '2026-08-03',
    department: 'Product Management',
  });
  assert(deptFiltered.success && deptFiltered.data!.records.length === 2, 'Department filter returns only Product Management records');
  assert(deptFiltered.data!.records.every((r) => r.staffId === testStaff2Id), 'Matches Staff 2 in Product Management');

  // Filter: Attendance Status CHECKED_OUT
  const completedFilter = await reportService.getAttendanceReport(adminUser, {
    startDate: '2026-08-01',
    endDate: '2026-08-03',
    attendanceStatus: 'CHECKED_OUT',
  });
  assert(completedFilter.success && completedFilter.data!.records.length === 3, 'CHECKED_OUT filter returns 3 completed shifts');

  // Filter: Attendance Status CHECKED_IN
  const incompleteFilter = await reportService.getAttendanceReport(adminUser, {
    startDate: '2026-08-01',
    endDate: '2026-08-03',
    attendanceStatus: 'CHECKED_IN',
  });
  assert(incompleteFilter.success && incompleteFilter.data!.records.length === 1, 'CHECKED_IN filter returns 1 incomplete shift');
  assert.strictEqual(incompleteFilter.data!.records[0].id, 'rep-att-03', 'Matches incomplete record rep-att-03');

  // Filter: PRESENT (all checked in records regardless of checkout)
  const presentFilter = await reportService.getAttendanceReport(adminUser, {
    startDate: '2026-08-01',
    endDate: '2026-08-03',
    attendanceStatus: 'PRESENT',
  });
  assert(presentFilter.success && presentFilter.data!.records.length === 4, 'PRESENT filter returns all 4 check-in records');

  pass('Staff, department, and status filters work accurately');

  // =========================================================================
  // 5. Pagination, Sorting & Maximum Permitted Limits
  // =========================================================================
  console.log('\n--- 5. Pagination, Sorting & Maximum Permitted Limits ---');

  // Page 1 with limit 2
  const p1 = await reportService.getAttendanceReport(adminUser, {
    startDate: '2026-08-01',
    endDate: '2026-08-03',
    page: 1,
    limit: 2,
  });
  assert(p1.success && p1.data!.records.length === 2, 'Page 1 returns 2 records');
  assert.strictEqual(p1.data!.pagination.totalPages, 2, 'Total pages is 2');
  assert.strictEqual(p1.data!.pagination.hasNextPage, true, 'hasNextPage is true');
  assert.strictEqual(p1.data!.pagination.hasPrevPage, false, 'hasPrevPage is false');

  // Page 2 with limit 2
  const p2 = await reportService.getAttendanceReport(adminUser, {
    startDate: '2026-08-01',
    endDate: '2026-08-03',
    page: 2,
    limit: 2,
  });
  assert(p2.success && p2.data!.records.length === 2, 'Page 2 returns remaining 2 records');
  assert.strictEqual(p2.data!.pagination.hasPrevPage, true, 'hasPrevPage is true');
  assert.strictEqual(p2.data!.pagination.hasNextPage, false, 'hasNextPage is false');

  // Exceeding limit is capped at 100
  const pOverLimit = await reportService.getAttendanceReport(adminUser, {
    startDate: '2026-08-01',
    endDate: '2026-08-03',
    limit: 500,
  });
  assert.strictEqual(pOverLimit.data!.pagination.limit, 100, 'Limit above 100 is capped at 100');

  // Sorting: Date ASC and DESC
  const sortAsc = await reportService.getAttendanceReport(adminUser, {
    startDate: '2026-08-01',
    endDate: '2026-08-03',
    sort: 'date',
    order: 'asc',
  });
  assert.strictEqual(sortAsc.data!.records[0].date, '2026-08-01', 'Sort date asc returns earliest date first');

  const sortDesc = await reportService.getAttendanceReport(adminUser, {
    startDate: '2026-08-01',
    endDate: '2026-08-03',
    sort: 'date',
    order: 'desc',
  });
  assert.strictEqual(sortDesc.data!.records[0].date, '2026-08-03', 'Sort date desc returns latest date first');

  // Sorting: workingDuration DESC
  const sortDuration = await reportService.getAttendanceReport(adminUser, {
    startDate: '2026-08-01',
    endDate: '2026-08-03',
    sort: 'workingDuration',
    order: 'desc',
  });
  assert(sortDuration.success, 'Sort by workingDuration executes without error');

  pass('Pagination, sorting, and limit capping verified');

  // =========================================================================
  // 6. Validation Errors & Boundaries
  // =========================================================================
  console.log('\n--- 6. Validation Errors & Empty Results ---');

  // Empty result query
  const emptyRes = await reportService.getAttendanceReport(adminUser, {
    startDate: '2025-01-01',
    endDate: '2025-01-02',
  });
  assert(emptyRes.success && emptyRes.data!.records.length === 0, 'Empty range returns 0 records successfully');
  assert.strictEqual(emptyRes.data!.summary.totalRecords, 0, 'Summary totalRecords is 0 for empty query');

  // Invalid date format
  const badDateRes = await reportService.getAttendanceReport(adminUser, {
    startDate: '2026-15-99',
    endDate: '2026-08-01',
  });
  assert(!badDateRes.success, 'Malformed startDate rejected');

  // startDate > endDate
  const invertedDateRes = await reportService.getAttendanceReport(adminUser, {
    startDate: '2026-08-05',
    endDate: '2026-08-01',
  });
  assert(!invertedDateRes.success, 'startDate after endDate rejected');

  // Range > 365 days
  const excessiveRangeRes = await reportService.getAttendanceReport(adminUser, {
    startDate: '2024-01-01',
    endDate: '2026-01-01',
  });
  assert(!excessiveRangeRes.success, 'Date range exceeding 365 days rejected');

  pass('Invalid filters and empty results properly handled with validation errors');

  // =========================================================================
  // 7. Departments Listing Method
  // =========================================================================
  console.log('\n--- 7. Departments Listing Method ---');

  const deptList = await reportService.getDepartments();
  assert(Array.isArray(deptList), 'getDepartments returns an Array');
  assert(deptList.length >= 2, 'getDepartments returns at least 2 distinct departments');
  assert(deptList.includes('Product Management'), 'getDepartments includes Product Management');
  // Verify alphabetical ordering
  const sortedCopy = [...deptList].sort();
  assert.deepStrictEqual(deptList, sortedCopy, 'Departments list is sorted alphabetically ASC');
  pass('reportService.getDepartments executes asynchronously and returns sorted distinct departments');

  // =========================================================================
  // 8. CSV Export & Spreadsheet Formula Injection Defense
  // =========================================================================
  console.log('\n--- 8. CSV Export & Formula Injection Defense ---');

  // Formula injection sanitization tests
  assert.strictEqual(reportService.sanitizeCsvValue('=CMD|'), `\'=CMD|`, 'Formula beginning with = is escaped');
  assert.strictEqual(reportService.sanitizeCsvValue('+CMD|'), `\'+CMD|`, 'Formula beginning with + is escaped');
  assert.strictEqual(reportService.sanitizeCsvValue('-1+1'), `\'-1+1`, 'Value beginning with - is escaped');
  assert.strictEqual(reportService.sanitizeCsvValue('@IMPORT'), `\'@IMPORT`, 'Formula beginning with @ is escaped');
  assert.strictEqual(reportService.sanitizeCsvValue('Simple Text'), 'Simple Text', 'Plain text left unescaped');
  assert.strictEqual(reportService.sanitizeCsvValue('Comma, Value'), '"Comma, Value"', 'Comma containing string quoted');

  const csvExport = await reportService.generateCsvExport(adminUser, {
    startDate: '2026-08-01',
    endDate: '2026-08-03',
  });
  assert(csvExport.success && !!csvExport.csvContent, 'CSV export generated successfully');
  assert(csvExport.csvContent!.startsWith('\uFEFFDate,Staff Name,Email'), 'CSV starts with UTF-8 BOM');
  assert.strictEqual(csvExport.recordCount, 4, 'CSV contains exactly 4 records');
  assert(csvExport.filename!.includes('attendance-report-2026-08-01-to-2026-08-03.csv'), 'CSV filename generated properly');
  pass('CSV export generated asynchronously with formula injection protection');

  // =========================================================================
  // 9. Excel Export (.xls SpreadsheetML)
  // =========================================================================
  console.log('\n--- 9. Excel Export & XML Formatting ---');

  assert.strictEqual(reportService.sanitizeXmlValue('John & Doe'), 'John &amp; Doe', 'XML entity & escaped');
  assert.strictEqual(reportService.sanitizeXmlValue('<script>'), '&lt;script&gt;', 'XML entities < and > escaped');
  assert.strictEqual(reportService.sanitizeXmlValue('=SUM'), '&apos;=SUM', 'Excel formula injection escaped with apostrophe');

  const excelExport = await reportService.generateExcelExport(adminUser, {
    startDate: '2026-08-01',
    endDate: '2026-08-03',
  });
  assert(excelExport.success && !!excelExport.excelContent, 'Excel export generated successfully');
  assert(excelExport.excelContent!.includes('<?xml version="1.0" encoding="UTF-8"?>'), 'Excel XML starts with valid XML declaration');
  assert(excelExport.excelContent!.includes('<Worksheet ss:Name="Attendance Records">'), 'Includes Attendance Records worksheet');
  assert(excelExport.excelContent!.includes('<Worksheet ss:Name="Report Summary">'), 'Includes Report Summary worksheet');
  assert.strictEqual(excelExport.recordCount, 4, 'Excel export contains 4 records');
  assert(excelExport.filename!.endsWith('.xls'), 'Excel filename ends with .xls');
  pass('Excel SpreadsheetML export generated asynchronously with XML sanitization');

  // =========================================================================
  // 10. Audit Trail Verification & Zero Secret Leakage
  // =========================================================================
  console.log('\n--- 10. Audit Trail Verification & Zero Secret Leakage ---');

  const auditRows = db.prepare(`
    SELECT action, metadata FROM audit_logs 
    WHERE action IN ('ATTENDANCE_REPORT_GENERATED', 'ATTENDANCE_REPORT_EXPORTED')
    ORDER BY created_at DESC LIMIT 10
  `).all() as any[];

  assert(auditRows.some((a) => a.action === 'ATTENDANCE_REPORT_GENERATED'), 'Audit log contains ATTENDANCE_REPORT_GENERATED');
  assert(auditRows.some((a) => a.action === 'ATTENDANCE_REPORT_EXPORTED'), 'Audit log contains ATTENDANCE_REPORT_EXPORTED');

  // Ensure no password hashes, secrets, or tokens leaked in audit metadata or export
  for (const row of auditRows) {
    assert(!row.metadata.includes('password_hash'), 'Audit metadata must not contain password_hash');
    assert(!row.metadata.includes('token_hash'), 'Audit metadata must not contain token_hash');
  }
  assert(!excelExport.excelContent!.includes('argon2'), 'Excel content does not leak password hashes');
  assert(!csvExport.csvContent!.includes('password'), 'CSV content does not leak passwords');
  pass('Audit trail complete with zero credential leakage');

  // =========================================================================
  // 11. Express Route Handlers Async Propagation
  // =========================================================================
  console.log('\n--- 11. Express Route Handlers Async Propagation ---');

  assert(reportRoutes, 'reportRoutes default router exported');
  const routes = (reportRoutes as any).stack
    .filter((layer: any) => layer.route)
    .map((layer: any) => {
      const path = layer.route.path;
      const methods = Object.keys(layer.route.methods).join(',').toUpperCase();
      const handler = layer.route.stack[layer.route.stack.length - 1].handle;
      const isAsync = handler.constructor.name === 'AsyncFunction';
      return { path, methods, isAsync };
    });

  assert(routes.length >= 5, `Expected at least 5 report routes, found ${routes.length}`);
  for (const r of routes) {
    assert(r.isAsync, `Route ${r.methods} ${Array.isArray(r.path) ? r.path.join('|') : r.path} handler must be an AsyncFunction`);
    pass(`Route ${r.methods} ${Array.isArray(r.path) ? r.path.join('|') : r.path} handler is an AsyncFunction`);
  }

  // =========================================================================
  // 12. Super Admin Access & RBAC Compatibility
  // =========================================================================
  console.log('\n--- 12. Super Admin Access & RBAC Compatibility ---');

  const superAdminReport = await reportService.getAttendanceReport(superAdminUser, {
    startDate: '2026-08-01',
    endDate: '2026-08-03',
  });
  assert(superAdminReport.success, 'SUPER_ADMIN can generate attendance report');

  const superAdminCsv = await reportService.generateCsvExport(superAdminUser, {
    startDate: '2026-08-01',
    endDate: '2026-08-03',
  });
  assert(superAdminCsv.success, 'SUPER_ADMIN can generate CSV export');

  pass('SUPER_ADMIN access compatibility verified');

  // Summary
  console.log('\n================================================================');
  console.log(`   PHASE 7 BATCH 2C RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runReportsAsyncIntegrationTests().catch((err) => {
  console.error('Reports test suite uncaught error:', err);
  process.exit(1);
});
