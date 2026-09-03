import { getDatabase } from './server/db/index.ts';
import { seedDatabase } from './server/db/seed.ts';
import { authService } from './server/services/auth.service.ts';
import { attendanceService } from './server/services/attendance.service.ts';
import { calculateWorkingDuration, getTodayDateString } from './server/utils/time.ts';
import { ApiErrorCode } from './server/utils/apiResponse.ts';

async function runPhase2Tests() {
  console.log('====================================================');
  console.log('   RUNNING PHASE 2 COMPREHENSIVE TEST SUITE');
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

  const db = getDatabase();
  await seedDatabase();

  // Clean up any test attendance records from previous runs to ensure clean test state
  db.prepare('DELETE FROM attendance').run();

  // 1. Working Duration Calculation Unit Tests
  const normalDuration = calculateWorkingDuration(
    '2026-09-02T08:42:00.000Z',
    '2026-09-02T17:13:00.000Z'
  );
  assert(normalDuration.formatted === '8h 31m', `Calculates 8h 31m correctly (got ${normalDuration.formatted})`);
  assert(normalDuration.totalSeconds === 30660, `Total seconds calculated correctly (got ${normalDuration.totalSeconds})`);

  const zeroDuration = calculateWorkingDuration(
    '2026-09-02T08:00:00.000Z',
    '2026-09-02T08:00:00.000Z'
  );
  assert(zeroDuration.formatted === '0h 0m', 'Zero duration handled safely');

  const negativeDuration = calculateWorkingDuration(
    '2026-09-02T17:00:00.000Z',
    '2026-09-02T08:00:00.000Z' // End before start
  );
  assert(negativeDuration.formatted === '0h 0m' && negativeDuration.totalSeconds === 0, 'Reversed timestamps produce safe 0h 0m duration');

  const invalidTimestamp = calculateWorkingDuration('invalid-date', '2026-09-02T08:00:00.000Z');
  assert(invalidTimestamp.formatted === '0h 0m', 'Invalid timestamp produces safe 0h 0m duration');

  // Authenticate Staff 1 (John Doe)
  const johnLogin = await authService.login('john.doe@example.com', 'StaffSecure123!', '127.0.0.1', 'TestRunner/2.0');
  assert(johnLogin.success === true, 'John Doe authenticated');
  const johnId = johnLogin.user!.id;
  const johnToken = johnLogin.token!;

  // Authenticate Staff 2 (Jane Smith)
  const janeLogin = await authService.login('jane.smith@example.com', 'StaffSecure123!', '127.0.0.1', 'TestRunner/2.0');
  assert(janeLogin.success === true, 'Jane Smith authenticated');
  const janeId = janeLogin.user!.id;
  const janeToken = janeLogin.token!;

  const testDate = getTodayDateString();

  // 2. Initial State: NOT_CHECKED_IN
  const initialJohnState = attendanceService.getTodayAttendance(johnId, testDate);
  assert(initialJohnState.state === 'NOT_CHECKED_IN', 'Initial attendance state is NOT_CHECKED_IN');
  assert(initialJohnState.attendance === null, 'Initial attendance record is null');

  // 3. State Transition: NOT_CHECKED_IN -> CHECK_OUT (Invalid, MUST FAIL)
  const invalidCheckout = attendanceService.checkOut({
    staffId: johnId,
    clientIp: '127.0.0.1',
    userAgent: 'TestRunner/2.0',
    customDate: testDate,
  });
  assert(invalidCheckout.success === false, 'Cannot check out when NOT_CHECKED_IN');
  assert(invalidCheckout.errorCode === ApiErrorCode.NO_ACTIVE_CHECK_IN, 'Returns NO_ACTIVE_CHECK_IN error code');

  // 4. State Transition: NOT_CHECKED_IN -> CHECK_IN (Valid)
  const checkInTime = '2026-09-02T08:42:00.000Z';
  const checkInResult = attendanceService.checkIn({
    staffId: johnId,
    clientIp: '127.0.0.1',
    userAgent: 'TestRunner/2.0',
    customDate: testDate,
    customTime: checkInTime,
  });
  assert(checkInResult.success === true, 'Staff check-in succeeds');
  assert(checkInResult.state === 'CHECKED_IN', 'New state is CHECKED_IN');
  assert(checkInResult.attendance?.checkIn === checkInTime, 'Check-in timestamp correctly stored');
  assert(checkInResult.attendance?.staffId === johnId, 'Record belongs to authenticated staff ID');

  // 5. Database Verification after Check-in
  const dbRecord = db.prepare('SELECT * FROM attendance WHERE staff_id = ? AND date = ?').get(johnId, testDate) as { check_in: string; check_out: string | null; status: string };
  assert(dbRecord && dbRecord.check_in === checkInTime, 'Attendance record verified in SQLite database');
  assert(dbRecord.check_out === null, 'check_out is null during active session');

  // 6. Verify Today's Attendance State after Check-in
  const checkedInState = attendanceService.getTodayAttendance(johnId, testDate);
  assert(checkedInState.state === 'CHECKED_IN', 'getTodayAttendance reports CHECKED_IN');
  assert(checkedInState.attendance?.checkIn === checkInTime, 'Check-in time retrievable');

  // 7. State Transition: CHECKED_IN -> CHECK_IN (Duplicate Check-In, MUST FAIL)
  const duplicateCheckIn = attendanceService.checkIn({
    staffId: johnId,
    clientIp: '127.0.0.1',
    userAgent: 'TestRunner/2.0',
    customDate: testDate,
  });
  assert(duplicateCheckIn.success === false, 'Duplicate check-in on same day is rejected');
  assert(duplicateCheckIn.errorCode === ApiErrorCode.ALREADY_CHECKED_IN, 'Returns ALREADY_CHECKED_IN error code');
  assert(duplicateCheckIn.errorMessage === 'You have already checked in today.', 'Returns user-friendly error message');

  // 8. State Transition: CHECKED_IN -> CHECK_OUT (Valid)
  const checkOutTime = '2026-09-02T17:13:00.000Z';
  const checkOutResult = attendanceService.checkOut({
    staffId: johnId,
    clientIp: '127.0.0.1',
    userAgent: 'TestRunner/2.0',
    customDate: testDate,
    customTime: checkOutTime,
  });
  assert(checkOutResult.success === true, 'Staff check-out succeeds');
  assert(checkOutResult.state === 'CHECKED_OUT', 'New state is CHECKED_OUT');
  assert(checkOutResult.formattedDuration === '8h 31m', `Working duration calculated as 8h 31m (got ${checkOutResult.formattedDuration})`);
  assert(checkOutResult.attendance?.checkOut === checkOutTime, 'Check-out timestamp persisted');

  // 9. State Transition: CHECKED_OUT -> CHECK_OUT (Duplicate Check-Out, MUST FAIL)
  const duplicateCheckOut = attendanceService.checkOut({
    staffId: johnId,
    clientIp: '127.0.0.1',
    userAgent: 'TestRunner/2.0',
    customDate: testDate,
  });
  assert(duplicateCheckOut.success === false, 'Duplicate checkout on same day is rejected');
  assert(duplicateCheckOut.errorCode === ApiErrorCode.ALREADY_CHECKED_OUT, 'Returns ALREADY_CHECKED_OUT error code');
  assert(duplicateCheckOut.errorMessage === 'You have already checked out today.', 'Returns user-friendly error message');

  // 10. State Transition: CHECKED_OUT -> CHECK_IN (Cannot re-check in after checkout on same day, MUST FAIL)
  const checkInAfterCheckout = attendanceService.checkIn({
    staffId: johnId,
    clientIp: '127.0.0.1',
    userAgent: 'TestRunner/2.0',
    customDate: testDate,
  });
  assert(checkInAfterCheckout.success === false, 'Cannot check in again after completed checkout');
  assert(checkInAfterCheckout.errorCode === ApiErrorCode.ALREADY_CHECKED_IN, 'Returns ALREADY_CHECKED_IN');

  // 11. Staff History Isolation Test: Staff 1 history does NOT contain Staff 2 records
  // Insert a record for Jane Smith on a different date
  attendanceService.checkIn({
    staffId: janeId,
    clientIp: '127.0.0.1',
    userAgent: 'TestRunner/2.0',
    customDate: '2026-09-01',
    customTime: '2026-09-01T08:30:00.000Z',
  });
  attendanceService.checkOut({
    staffId: janeId,
    clientIp: '127.0.0.1',
    userAgent: 'TestRunner/2.0',
    customDate: '2026-09-01',
    customTime: '2026-09-01T17:00:00.000Z',
  });

  const johnHistory = attendanceService.getStaffHistory(johnId);
  const janeHistory = attendanceService.getStaffHistory(janeId);

  assert(johnHistory.length === 1, `John history has 1 record (found ${johnHistory.length})`);
  assert(johnHistory.every(r => r.staffId === johnId), 'All records in John history belong strictly to John');
  assert(janeHistory.length === 1, `Jane history has 1 record (found ${janeHistory.length})`);
  assert(janeHistory.every(r => r.staffId === janeId), 'All records in Jane history belong strictly to Jane');

  // 12. HTTP Endpoint Verification with Authorization & Reverse Proxy
  const base = 'http://127.0.0.1:3000';

  // 12a. Unauthenticated Check-In -> 401 Unauthorized
  const unauthCheckIn = await fetch(`${base}/api/attendance/check-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  assert(unauthCheckIn.status === 401, `Unauthenticated check-in rejected with 401 (got ${unauthCheckIn.status})`);

  // 12b. Unauthenticated Check-Out -> 401 Unauthorized
  const unauthCheckOut = await fetch(`${base}/api/attendance/check-out`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  assert(unauthCheckOut.status === 401, `Unauthenticated check-out rejected with 401 (got ${unauthCheckOut.status})`);

  // 12c. Unauthenticated My-History -> 401 Unauthorized
  const unauthHistory = await fetch(`${base}/api/attendance/my-history`);
  assert(unauthHistory.status === 401, `Unauthenticated my-history rejected with 401 (got ${unauthHistory.status})`);

  // 12d. Jane checks in via HTTP with Bearer Token
  const janeHttpCheckIn = await fetch(`${base}/api/attendance/check-in`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${janeToken}`,
      'X-Forwarded-For': '102.129.144.1, 10.0.0.1',
    },
    body: JSON.stringify({ userId: 'spoofed-id-trying-to-check-in-john' }), // IDOR attack test
  });
  assert(janeHttpCheckIn.status === 201, `Jane HTTP check-in succeeds with 201 (got ${janeHttpCheckIn.status})`);
  const janeCheckInJson = await janeHttpCheckIn.json() as { data: { attendance: { staffId: string } } };
  assert(janeCheckInJson.data.attendance.staffId === janeId, 'Server strictly used session identity, ignoring spoofed userId body');

  // 12e. Jane checks today's attendance via HTTP
  const janeTodayRes = await fetch(`${base}/api/attendance/today`, {
    headers: { 'Authorization': `Bearer ${janeToken}` },
  });
  assert(janeTodayRes.status === 200, 'Jane GET /api/attendance/today returns 200');
  const janeTodayJson = await janeTodayRes.json() as { data: { state: string } };
  assert(janeTodayJson.data.state === 'CHECKED_IN', 'Jane today state is CHECKED_IN');

  // 12f. Jane checks out via HTTP
  const janeHttpCheckOut = await fetch(`${base}/api/attendance/check-out`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${janeToken}` },
  });
  assert(janeHttpCheckOut.status === 200, `Jane HTTP check-out succeeds with 200 (got ${janeHttpCheckOut.status})`);

  // 12g. Jane history via HTTP
  const janeHttpHistory = await fetch(`${base}/api/attendance/my-history`, {
    headers: { 'Authorization': `Bearer ${janeToken}` },
  });
  assert(janeHttpHistory.status === 200, 'Jane GET /api/attendance/my-history returns 200');
  const janeHistoryJson = await janeHttpHistory.json() as { data: { history: unknown[] } };
  assert(janeHistoryJson.data.history.length === 2, `Jane history contains 2 records (today and previous day)`);

  // 13. Audit Log Verification
  const auditRows = db.prepare(`
    SELECT action, actor_id, target_user_id, metadata FROM audit_logs
    WHERE action IN ('CHECK_IN', 'CHECK_OUT')
    ORDER BY created_at DESC
  `).all() as { action: string; actor_id: string; target_user_id: string; metadata: string }[];

  assert(auditRows.length >= 4, `Audit logs recorded for check-ins and check-outs (found ${auditRows.length})`);
  const checkInLogs = auditRows.filter(l => l.action === 'CHECK_IN');
  const checkOutLogs = auditRows.filter(l => l.action === 'CHECK_OUT');
  assert(checkInLogs.length >= 2, 'CHECK_IN actions logged in audit table');
  assert(checkOutLogs.length >= 2, 'CHECK_OUT actions logged in audit table');

  // Verify zero sensitive data leakage in attendance audit logs
  const auditHasLeakedSecrets = auditRows.some(l => {
    const meta = l.metadata || '';
    return meta.includes('password') || meta.includes('token') || meta.includes('secret');
  });
  assert(!auditHasLeakedSecrets, 'Attendance audit logs contain zero tokens, secrets, or passwords');

  console.log('\n====================================================');
  console.log(`PHASE 2 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase2Tests().catch((err) => {
  console.error('Fatal error during Phase 2 test run:', err);
  process.exit(1);
});
