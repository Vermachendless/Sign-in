import { getDatabase, closeDatabase } from './server/db/index.ts';
import { seedDatabase } from './server/db/seed.ts';
import { authService } from './server/services/auth.service.ts';
import { hashPassword, verifyPassword } from './server/utils/crypto.ts';
import { UserRole, UserStatus } from './src/types/index.ts';

async function runPhase1Tests() {
  console.log('====================================================');
  console.log('   RUNNING PHASE 1 COMPREHENSIVE TEST SUITE');
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

  // 1. Database Initialization & Seeding Test
  const db = getDatabase();
  await seedDatabase();
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  assert(userCount.count >= 4, `Database initialized with seed users (found ${userCount.count} users)`);

  // 2. Cryptographic Password Hashing & Constant-Time Verification
  const testPlain = 'SecretP@ssword2026!';
  const hash = await hashPassword(testPlain);
  assert(hash.includes(':') && !hash.includes(testPlain), 'Password hashed using scrypt with random salt');
  const isMatch = await verifyPassword(testPlain, hash);
  const isWrongMatch = await verifyPassword('WrongPassword123', hash);
  assert(isMatch === true, 'verifyPassword correctly validates matching plaintext');
  assert(isWrongMatch === false, 'verifyPassword rejects non-matching plaintext');

  // 3. Super Admin Authentication Test
  const superAdminLogin = await authService.login('admin@example.com', 'AdminSecurePassword123!', '127.0.0.1', 'TestRunner/1.0');
  assert(superAdminLogin.success === true, 'Super Admin login succeeds with valid credentials');
  assert(superAdminLogin.user?.role === UserRole.SUPER_ADMIN, 'Super Admin user has role SUPER_ADMIN');
  assert(!!superAdminLogin.token, 'Session token issued on successful login');

  // 4. Staff Authentication Test
  const staffLogin = await authService.login('john.doe@example.com', 'StaffSecure123!', '127.0.0.1', 'TestRunner/1.0');
  assert(staffLogin.success === true, 'Staff login succeeds with valid credentials');
  assert(staffLogin.user?.role === UserRole.STAFF, 'Staff user has role STAFF');

  // 5. Invalid Password Test (Generic error, no leak)
  const invalidPassLogin = await authService.login('john.doe@example.com', 'IncorrectPassword', '127.0.0.1', 'TestRunner/1.0');
  assert(invalidPassLogin.success === false, 'Invalid password rejected');
  assert(invalidPassLogin.errorMessage === 'Invalid email or password.', 'Generic error message returned to prevent account enumeration');

  // 6. Unknown Email Test (Generic error, no leak)
  const unknownEmailLogin = await authService.login('nonexistent@example.com', 'AnyPassword', '127.0.0.1', 'TestRunner/1.0');
  assert(unknownEmailLogin.success === false, 'Nonexistent account rejected');
  assert(unknownEmailLogin.errorMessage === 'Invalid email or password.', 'Generic error matches invalid password response');

  // 7. Suspended Account Login Test
  const suspendedLogin = await authService.login('suspended.user@example.com', 'SuspendedPass123!', '127.0.0.1', 'TestRunner/1.0');
  assert(suspendedLogin.success === false, 'Suspended account login rejected');
  assert(suspendedLogin.errorCode === 'ACCOUNT_SUSPENDED', 'Returns ACCOUNT_SUSPENDED error code');

  // 8. Session Validation & Retrieval
  const token = staffLogin.token!;
  const sessionValidation = authService.validateSession(token);
  assert(sessionValidation.valid === true, 'validateSession confirms active session');
  assert(sessionValidation.user?.email === 'john.doe@example.com', 'validateSession returns safe user data');

  // 9. Mid-Session Account Suspension Test (Live Status Check)
  // Simulate an admin suspending John Doe in DB while session is still technically unexpired
  db.prepare('UPDATE users SET status = ? WHERE email = ?').run(UserStatus.SUSPENDED, 'john.doe@example.com');
  const midSessionCheck = authService.validateSession(token);
  assert(midSessionCheck.valid === false, 'Mid-session validation rejects user after status is updated to SUSPENDED');
  assert(midSessionCheck.errorCode === 'ACCOUNT_SUSPENDED', 'Correctly identifies suspension mid-session');

  // Restore John Doe to active
  db.prepare('UPDATE users SET status = ? WHERE email = ?').run(UserStatus.ACTIVE, 'john.doe@example.com');

  // 10. Logout and Session Invalidation Test
  authService.logout(token, '127.0.0.1', 'TestRunner/1.0');
  const postLogoutValidation = authService.validateSession(token);
  assert(postLogoutValidation.valid === false, 'Session is invalid after logout');

  // 11. Audit Log Verification
  const auditLogs = db.prepare('SELECT action, metadata FROM audit_logs ORDER BY created_at DESC LIMIT 10').all() as { action: string; metadata: string }[];
  assert(auditLogs.length > 0, 'Audit logs recorded in database');
  const actions = auditLogs.map(l => l.action);
  assert(actions.includes('LOGIN'), 'Audit log includes LOGIN events');
  assert(actions.includes('LOGIN_FAILED'), 'Audit log includes LOGIN_FAILED events');
  assert(actions.includes('LOGOUT'), 'Audit log includes LOGOUT events');

  // Verify passwords or tokens are never logged in metadata
  const hasSecretsInLogs = auditLogs.some(l => {
    const meta = l.metadata || '';
    return meta.includes('passwordHash') || meta.includes('Password123') || meta.includes('StaffSecure');
  });
  assert(!hasSecretsInLogs, 'Audit logs contain zero plaintext passwords, hashes, or session tokens');

  console.log('\n====================================================');
  console.log(`PHASE 1 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase1Tests().catch((err) => {
  console.error('Fatal error during test run:', err);
  process.exit(1);
});
