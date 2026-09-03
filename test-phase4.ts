import { getDatabase } from './server/db/index.ts';
import { seedDatabase } from './server/db/seed.ts';
import { adminService } from './server/services/admin.service.ts';
import { authService } from './server/services/auth.service.ts';
import { verifyPassword } from './server/utils/crypto.ts';
import { UserRole, UserStatus } from './src/types/index.ts';

async function runPhase4Tests() {
  console.log('====================================================');
  console.log('   RUNNING PHASE 4 COMPREHENSIVE TEST SUITE');
  console.log('   (ADMIN DASHBOARD + STAFF MANAGEMENT + RBAC)');
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

  // Ensure fresh DB seed
  const db = getDatabase();
  await seedDatabase();

  // Retrieve seed users for testing
  const superAdmin = db.prepare('SELECT * FROM users WHERE role = ?').get(UserRole.SUPER_ADMIN) as any;
  const admin = db.prepare('SELECT * FROM users WHERE role = ?').get(UserRole.ADMIN) as any;
  const staff = db.prepare('SELECT * FROM users WHERE role = ? AND status = ?').get(UserRole.STAFF, UserStatus.ACTIVE) as any;

  assert(!!superAdmin && !!admin && !!staff, 'Initial seed users retrieved for testing');

  // ==========================================
  // SECTION 1: DASHBOARD SUMMARY
  // ==========================================
  console.log('\n--- Section 1: Admin Dashboard Summary ---');

  const summary = await adminService.getDashboardSummary();
  assert(!!summary.date, 'Dashboard summary returns current local date string');
  assert(typeof summary.activeStaffCount === 'number', 'Summary returns active staff count');
  assert(typeof summary.checkedInCount === 'number', 'Summary returns checked-in count');
  assert(typeof summary.checkedOutCount === 'number', 'Summary returns checked-out count');
  assert(typeof summary.notCheckedInCount === 'number', 'Summary returns not checked-in count');
  assert(summary.notCheckedInCount + summary.checkedInCount + summary.checkedOutCount === summary.activeStaffCount, 'Sum of today attendance states matches total active staff');
  assert(summary.todayRecords.length >= summary.activeStaffCount, 'Summary todayRecords includes all active staff');
  assert(summary.todayRecords.every((r: any) => !r.passwordHash), 'Password hashes strictly excluded from dashboard records');

  // ==========================================
  // SECTION 2: STAFF LISTING & FILTERING
  // ==========================================
  console.log('\n--- Section 2: Staff Listing & Filtering ---');

  const fullList = await adminService.listStaff();
  assert(fullList.length >= 3, `Staff listing returns staff members (found ${fullList.length})`);
  assert(fullList.every((s: any) => !s.passwordHash), 'Password hashes strictly omitted from staff listing');

  // Search by name
  const searchByName = await adminService.listStaff({ search: 'John' });
  assert(searchByName.some((s) => s.firstName.toLowerCase().includes('john')), 'Search query filters by first name');

  // Search by email (manager@example.com)
  const searchByEmail = await adminService.listStaff({ search: 'manager@example.com' });
  assert(searchByEmail.some((s) => s.email === 'manager@example.com'), 'Search query filters by email');

  // Filter by status
  const filterActive = await adminService.listStaff({ status: UserStatus.ACTIVE });
  assert(filterActive.every((s) => s.status === UserStatus.ACTIVE), 'Status filter returns only ACTIVE users');

  // Filter by role
  const filterRole = await adminService.listStaff({ role: UserRole.STAFF });
  assert(filterRole.every((s) => s.role === UserRole.STAFF), 'Role filter returns only STAFF users');

  // ==========================================
  // SECTION 3: STAFF CREATION & PRIVILEGE BOUNDARIES
  // ==========================================
  console.log('\n--- Section 3: Staff Creation & RBAC Boundaries ---');

  const testEmail = `new.staff.${Date.now()}@example.com`;
  const rawPassword = 'StrongPassword2026!';

  // Admin creates normal Staff
  const createResult = await adminService.createStaff(
    { id: admin.id, email: admin.email, firstName: admin.first_name, lastName: admin.last_name, role: admin.role as UserRole, status: admin.status as UserStatus },
    {
      email: testEmail,
      password: rawPassword,
      firstName: 'Chidi',
      lastName: 'Okafor',
      phone: '+234 801 234 5678',
      department: 'Engineering',
      role: UserRole.STAFF,
    },
    '102.129.144.1',
    'TestAgent/1.0'
  );

  assert(createResult.success === true, 'Admin can successfully create a new STAFF member');
  assert(!!createResult.user && createResult.user.email === testEmail, 'Created user object returned with correct email');
  assert(!('passwordHash' in (createResult.user || {})), 'Password hash never returned in create response');

  // Verify password was hashed with scrypt
  const createdDbUser = db.prepare('SELECT * FROM users WHERE email = ?').get(testEmail) as any;
  assert(!!createdDbUser && createdDbUser.password_hash.includes(':'), 'Created user password is securely hashed in database');
  const passValid = await verifyPassword(rawPassword, createdDbUser.password_hash);
  assert(passValid === true, 'User can authenticate against newly created password hash');

  // Duplicate email rejection
  const duplicateResult = await adminService.createStaff(
    { id: admin.id, email: admin.email, firstName: admin.first_name, lastName: admin.last_name, role: admin.role as UserRole, status: admin.status as UserStatus },
    {
      email: testEmail,
      password: 'AnotherPassword123!',
      firstName: 'Duplicate',
      lastName: 'User',
    }
  );
  assert(duplicateResult.success === false, 'Duplicate email registration rejected');
  assert(duplicateResult.errorCode === 'ALREADY_EXISTS', 'Rejection code is ALREADY_EXISTS');

  // Validation: Short password (< 8 chars)
  const shortPassResult = await adminService.createStaff(
    { id: admin.id, email: admin.email, firstName: admin.first_name, lastName: admin.last_name, role: admin.role as UserRole, status: admin.status as UserStatus },
    {
      email: `short.${Date.now()}@example.com`,
      password: '123',
      firstName: 'Short',
      lastName: 'Pass',
    }
  );
  assert(shortPassResult.success === false, 'Short password (< 8 chars) rejected');
  assert(shortPassResult.errorCode === 'VALIDATION_ERROR', 'Validation error returned for short password');

  // Validation: Invalid email format
  const invalidEmailResult = await adminService.createStaff(
    { id: admin.id, email: admin.email, firstName: admin.first_name, lastName: admin.last_name, role: admin.role as UserRole, status: admin.status as UserStatus },
    {
      email: 'not-an-email',
      password: 'ValidPassword123!',
      firstName: 'Invalid',
      lastName: 'Email',
    }
  );
  assert(invalidEmailResult.success === false, 'Malformed email address rejected');

  // Privilege Boundary: Admin CANNOT create a SUPER_ADMIN
  const adminTrySuperAdmin = await adminService.createStaff(
    { id: admin.id, email: admin.email, firstName: admin.first_name, lastName: admin.last_name, role: admin.role as UserRole, status: admin.status as UserStatus },
    {
      email: `super.${Date.now()}@example.com`,
      password: 'ValidPassword123!',
      firstName: 'Fake',
      lastName: 'Super',
      role: UserRole.SUPER_ADMIN,
    }
  );
  assert(adminTrySuperAdmin.success === false, 'Standard Admin CANNOT create a SUPER_ADMIN account');
  assert(adminTrySuperAdmin.errorCode === 'FORBIDDEN', 'Rejection code is FORBIDDEN for privilege violation');

  // Privilege Boundary: Super Admin CAN create an ADMIN
  const superAdminCreatesAdmin = await adminService.createStaff(
    { id: superAdmin.id, email: superAdmin.email, firstName: superAdmin.first_name, lastName: superAdmin.last_name, role: superAdmin.role as UserRole, status: superAdmin.status as UserStatus },
    {
      email: `sub.admin.${Date.now()}@example.com`,
      password: 'ValidPassword123!',
      firstName: 'Sub',
      lastName: 'Admin',
      role: UserRole.ADMIN,
    }
  );
  assert(superAdminCreatesAdmin.success === true, 'Super Admin CAN create an ADMIN account');

  // ==========================================
  // SECTION 4: STAFF PROFILE RETRIEVAL & DETAIL
  // ==========================================
  console.log('\n--- Section 4: Staff Profile Retrieval & Stats ---');

  const newStaffId = createdDbUser.id;
  const staffDetail = await adminService.getStaffById(newStaffId);
  assert(staffDetail !== null, 'getStaffById returns valid detail object for existing user');
  assert(staffDetail?.user.id === newStaffId, 'Profile contains matching staff ID');
  assert(typeof staffDetail?.stats.totalAttendedDays === 'number', 'Detail includes lifetime attended days counter');
  assert(Array.isArray(staffDetail?.recentAttendance), 'Detail includes recent attendance array');

  // Non-existent user
  const nonExistentDetail = await adminService.getStaffById('non-existent-uuid');
  assert(nonExistentDetail === null, 'getStaffById returns null for non-existent ID');

  // ==========================================
  // SECTION 5: STAFF PROFILE UPDATE
  // ==========================================
  console.log('\n--- Section 5: Staff Profile Update & Privilege Boundaries ---');

  const updateResult = await adminService.updateStaff(
    { id: admin.id, email: admin.email, firstName: admin.first_name, lastName: admin.last_name, role: admin.role as UserRole, status: admin.status as UserStatus },
    newStaffId,
    {
      firstName: 'Chidi-Updated',
      lastName: 'Okafor-New',
      department: 'Platform Engineering',
      phone: '+234 809 999 8888',
    },
    '102.129.144.1',
    'TestAgent/1.0'
  );

  assert(updateResult.success === true, 'Admin successfully updates staff details');
  assert(updateResult.user?.firstName === 'Chidi-Updated', 'First name updated successfully');
  assert(updateResult.user?.department === 'Platform Engineering', 'Department updated successfully');

  // Privilege Boundary: Admin CANNOT promote a user to SUPER_ADMIN
  const adminTryPromote = await adminService.updateStaff(
    { id: admin.id, email: admin.email, firstName: admin.first_name, lastName: admin.last_name, role: admin.role as UserRole, status: admin.status as UserStatus },
    newStaffId,
    { role: UserRole.SUPER_ADMIN }
  );
  assert(adminTryPromote.success === false, 'Admin CANNOT elevate a user to SUPER_ADMIN');
  assert(adminTryPromote.errorCode === 'FORBIDDEN', 'Elevation attempt rejected with FORBIDDEN');

  // Privilege Boundary: Admin CANNOT edit a SUPER_ADMIN
  const adminTryEditSuper = await adminService.updateStaff(
    { id: admin.id, email: admin.email, firstName: admin.first_name, lastName: admin.last_name, role: admin.role as UserRole, status: admin.status as UserStatus },
    superAdmin.id,
    { firstName: 'HackedName' }
  );
  assert(adminTryEditSuper.success === false, 'Admin CANNOT modify a Super Admin profile');
  assert(adminTryEditSuper.errorCode === 'FORBIDDEN', 'Modification of higher role rejected with FORBIDDEN');

  // ==========================================
  // SECTION 6: STAFF STATUS MANAGEMENT & SESSION REVOCATION
  // ==========================================
  console.log('\n--- Section 6: Account Status & Session Invalidation ---');

  // 1. Log in as the new staff to create an active session
  const loginRes = await authService.login(testEmail, rawPassword, '102.129.144.1', 'TestRunner/1.0');
  assert(loginRes.success === true && !!loginRes.token, 'Staff logs in successfully and receives active session token');

  // Verify session is valid
  const sessionCheckBefore = await authService.validateSession(loginRes.token!);
  assert(sessionCheckBefore.valid === true, 'Session token is active and valid');

  // 2. Admin suspends the staff account
  const suspendResult = await adminService.setStaffStatus(
    { id: admin.id, email: admin.email, firstName: admin.first_name, lastName: admin.last_name, role: admin.role as UserRole, status: admin.status as UserStatus },
    newStaffId,
    UserStatus.SUSPENDED,
    '102.129.144.1',
    'TestAgent/1.0'
  );
  assert(suspendResult.success === true, 'Admin successfully suspends staff account');
  assert(suspendResult.user?.status === UserStatus.SUSPENDED, 'User status set to SUSPENDED');

  // 3. Verify ALL active sessions were invalidated upon suspension
  const sessionCheckAfter = await authService.validateSession(loginRes.token!);
  assert(sessionCheckAfter.valid === false, 'Active sessions immediately invalidated upon account suspension');

  // 4. Verify suspended user cannot log in
  const suspendedLoginAttempt = await authService.login(testEmail, rawPassword, '102.129.144.1', 'TestRunner/1.0');
  assert(suspendedLoginAttempt.success === false, 'Suspended user cannot authenticate');
  assert(suspendedLoginAttempt.errorMessage?.toLowerCase().includes('suspended'), 'Clear suspension error message returned');

  // 5. Reactivate the staff account
  const reactivateResult = await adminService.setStaffStatus(
    { id: admin.id, email: admin.email, firstName: admin.first_name, lastName: admin.last_name, role: admin.role as UserRole, status: admin.status as UserStatus },
    newStaffId,
    UserStatus.ACTIVE,
    '102.129.144.1',
    'TestAgent/1.0'
  );
  assert(reactivateResult.success === true, 'Admin can reactivate suspended account');
  assert(reactivateResult.user?.status === UserStatus.ACTIVE, 'User status restored to ACTIVE');

  // 6. Verify reactivated user can log in again
  const reactivatedLogin = await authService.login(testEmail, rawPassword, '102.129.144.1', 'TestRunner/1.0');
  assert(reactivatedLogin.success === true, 'Reactivated user can log in again');

  // 7. Non-destructive Soft Removal
  const softRemoveResult = await adminService.setStaffStatus(
    { id: admin.id, email: admin.email, firstName: admin.first_name, lastName: admin.last_name, role: admin.role as UserRole, status: admin.status as UserStatus },
    newStaffId,
    UserStatus.REMOVED
  );
  assert(softRemoveResult.success === true, 'Staff soft-removed non-destructively');
  const removedUserInDb = db.prepare('SELECT * FROM users WHERE id = ?').get(newStaffId) as any;
  assert(!!removedUserInDb && removedUserInDb.status === UserStatus.REMOVED, 'User record retained in DB with REMOVED status (no permanent row deletion)');

  // 8. Self-suspension prevention
  const selfSuspend = await adminService.setStaffStatus(
    { id: admin.id, email: admin.email, firstName: admin.first_name, lastName: admin.last_name, role: admin.role as UserRole, status: admin.status as UserStatus },
    admin.id,
    UserStatus.SUSPENDED
  );
  assert(selfSuspend.success === false, 'Administrator cannot suspend their own account');
  assert(selfSuspend.errorCode === 'VALIDATION_ERROR', 'Self-suspension rejected with VALIDATION_ERROR');

  // ==========================================
  // SECTION 7: AUDIT LOGGING VERIFICATION
  // ==========================================
  console.log('\n--- Section 7: Audit Trail Verification ---');

  const auditLogs = db.prepare('SELECT * FROM audit_logs WHERE target_user_id = ? ORDER BY created_at DESC').all(newStaffId) as any[];
  assert(auditLogs.length >= 3, `All sensitive actions audited for user (found ${auditLogs.length} audit entries)`);
  const actions = auditLogs.map((l) => l.action);
  assert(actions.includes('STAFF_CREATED'), 'STAFF_CREATED logged to audit trail');
  assert(actions.includes('STAFF_UPDATED'), 'STAFF_UPDATED logged to audit trail');
  assert(actions.includes('STAFF_DEACTIVATED'), 'STAFF_DEACTIVATED logged to audit trail');
  assert(actions.includes('STAFF_ACTIVATED'), 'STAFF_ACTIVATED logged to audit trail');

  // Summary
  console.log('\n====================================================');
  console.log(`PHASE 4 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase4Tests().catch((err) => {
  console.error('Fatal error during Phase 4 test execution:', err);
  process.exit(1);
});
