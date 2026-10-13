import { authService } from './server/services/auth.service.ts';
import { auditService, AuditLoggingError, AuditFailureDiagnostics } from './server/services/audit.service.ts';
import { requireAuth, optionalAuth, AuthenticatedRequest } from './server/middleware/auth.ts';
import { dbAdapter } from './server/db/adapter.ts';
import { hashPassword, hashToken } from './server/utils/crypto.ts';
import { UserRole, UserStatus } from './src/types/index.ts';

// In-memory test store simulating PostgreSQL async behavior
interface MockUser {
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

interface MockSession {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  created_at: string;
  ip_address: string | null;
  user_agent: string | null;
}

interface MockAuditLog {
  id: string;
  actor_id: string | null;
  action: string;
  target_user_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  metadata: string | null;
  created_at: string;
}

async function runTests() {
  console.log('========================================================');
  console.log('   RUNNING ASYNC AUTH & AUDIT LOGGING UNIT TEST SUITE   ');
  console.log('      (PostgreSQL Asynchronous Compatibility Check)     ');
  console.log('========================================================\n');

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

  // Set up in-memory mock state
  const mockUsers: MockUser[] = [];
  const mockSessions: MockSession[] = [];
  const mockAuditLogs: MockAuditLog[] = [];

  const rawPassword = 'SecurePassword123!';
  const hashedPassword = await hashPassword(rawPassword);

  const activeUserId = 'user-active-1';
  mockUsers.push({
    id: activeUserId,
    email: 'active.user@example.com',
    password_hash: hashedPassword,
    first_name: 'Active',
    last_name: 'User',
    phone: '1234567890',
    department: 'Engineering',
    role: UserRole.STAFF,
    status: UserStatus.ACTIVE,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const suspendedUserId = 'user-suspended-2';
  mockUsers.push({
    id: suspendedUserId,
    email: 'suspended.user@example.com',
    password_hash: hashedPassword,
    first_name: 'Suspended',
    last_name: 'User',
    phone: null,
    department: null,
    role: UserRole.STAFF,
    status: UserStatus.SUSPENDED,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const removedUserId = 'user-removed-3';
  mockUsers.push({
    id: removedUserId,
    email: 'removed.user@example.com',
    password_hash: hashedPassword,
    first_name: 'Removed',
    last_name: 'User',
    phone: null,
    department: null,
    role: UserRole.STAFF,
    status: UserStatus.REMOVED,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  // Mock dbAdapter methods to simulate PostgreSQL async promise return
  const originalQueryOne = dbAdapter.queryOne.bind(dbAdapter);
  const originalQuery = dbAdapter.query.bind(dbAdapter);
  const originalExecute = dbAdapter.execute.bind(dbAdapter);
  const originalIsPostgres = dbAdapter.isPostgres.bind(dbAdapter);

  let shouldSimulateDbError = false;

  (dbAdapter as any).isPostgres = () => true;

  (dbAdapter as any).queryOne = async <T = any>(sql: string, params: any[] = []): Promise<T | null> => {
    if (shouldSimulateDbError) {
      throw new Error('Simulated PostgreSQL Connection Error');
    }
    // Simulate query for user by email
    if (sql.includes('FROM users') && sql.includes('LOWER(email) = LOWER($1)')) {
      const email = params[0]?.toLowerCase();
      const user = mockUsers.find((u) => u.email.toLowerCase() === email);
      return (user as any) || null;
    }

    // Simulate query for session by token_hash
    if (sql.includes('FROM sessions s') && sql.includes('WHERE s.token_hash = $1')) {
      const tokenHashVal = params[0];
      const session = mockSessions.find((s) => s.token_hash === tokenHashVal);
      if (!session) return null;
      const user = mockUsers.find((u) => u.id === session.user_id);
      if (!user) return null;

      return {
        id: session.id,
        user_id: session.user_id,
        token_hash: session.token_hash,
        expires_at: session.expires_at,
        created_at: session.created_at,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        phone: user.phone,
        department: user.department,
        role: user.role,
        status: user.status,
      } as any;
    }

    return null;
  };

  (dbAdapter as any).execute = async (sql: string, params: any[] = []): Promise<{ rowCount: number }> => {
    if (shouldSimulateDbError) {
      throw new Error('Simulated PostgreSQL Connection Error');
    }
    // Simulate session insertion
    if (sql.includes('INSERT INTO sessions')) {
      const [id, user_id, token_hash, expires_at, ip_address, user_agent, created_at] = params;
      mockSessions.push({
        id,
        user_id,
        token_hash,
        expires_at,
        created_at,
        ip_address,
        user_agent,
      });
      return { rowCount: 1 };
    }

    // Simulate session deletion by session id
    if (sql.includes('DELETE FROM sessions WHERE id = $1')) {
      const [id] = params;
      const idx = mockSessions.findIndex((s) => s.id === id);
      if (idx !== -1) {
        mockSessions.splice(idx, 1);
        return { rowCount: 1 };
      }
      return { rowCount: 0 };
    }

    // Simulate session deletion by user_id
    if (sql.includes('DELETE FROM sessions WHERE user_id = $1')) {
      const [userId] = params;
      let count = 0;
      for (let i = mockSessions.length - 1; i >= 0; i--) {
        if (mockSessions[i].user_id === userId) {
          mockSessions.splice(i, 1);
          count++;
        }
      }
      return { rowCount: count };
    }

    // Simulate audit log insertion
    if (sql.includes('INSERT INTO audit_logs')) {
      const [id, actor_id, action, target_user_id, ip_address, user_agent, metadata, created_at] = params;
      mockAuditLogs.push({
        id,
        actor_id,
        action,
        target_user_id,
        ip_address,
        user_agent,
        metadata,
        created_at,
      });
      return { rowCount: 1 };
    }

    return { rowCount: 0 };
  };

  try {
    // ------------------------------------------------------------------
    // TEST 1: Login with valid credentials
    // ------------------------------------------------------------------
    console.log('\n--- Test 1: Active User Login ---');
    const loginResult = await authService.login('active.user@example.com', rawPassword, '127.0.0.1', 'JestTest/1.0');
    assert(loginResult.success === true, 'Login succeeds for active user');
    assert(!!loginResult.token, 'Login returns a valid session token');
    assert(loginResult.user?.email === 'active.user@example.com', 'Login returns safe user details');
    assert(mockSessions.length === 1, 'Session record asynchronously created in sessions table');
    const lastAudit = mockAuditLogs[mockAuditLogs.length - 1];
    assert(lastAudit?.action === 'LOGIN', 'Audit log records LOGIN event');
    assert(lastAudit?.target_user_id === activeUserId, 'Audit log contains target user ID');

    // ------------------------------------------------------------------
    // TEST 2: Validate active session
    // ------------------------------------------------------------------
    console.log('\n--- Test 2: Asynchronous Session Validation ---');
    const validToken = loginResult.token!;
    const validationResult = await authService.validateSession(validToken);
    assert(validationResult.valid === true, 'Session is reported as valid');
    assert(validationResult.user?.id === activeUserId, 'Session validation returns safe user payload');
    assert(!!validationResult.session?.expiresAt, 'Session validation returns session metadata');

    // ------------------------------------------------------------------
    // TEST 3: Login failures & audit logging
    // ------------------------------------------------------------------
    console.log('\n--- Test 3: Login Failure Paths ---');
    // Non-existent user
    const notFoundLogin = await authService.login('unknown@example.com', 'wrongpass', '127.0.0.1', 'Test/1.0');
    assert(notFoundLogin.success === false && notFoundLogin.errorCode === 'INVALID_CREDENTIALS', 'Non-existent user rejected');
    assert(mockAuditLogs.some((l) => l.action === 'LOGIN_FAILED' && l.metadata?.includes('ACCOUNT_NOT_FOUND')), 'Audit records ACCOUNT_NOT_FOUND failure');

    // Suspended account
    const suspendedLogin = await authService.login('suspended.user@example.com', rawPassword, '127.0.0.1', 'Test/1.0');
    assert(suspendedLogin.success === false && suspendedLogin.errorCode === 'ACCOUNT_SUSPENDED', 'Suspended account login rejected');
    assert(mockAuditLogs.some((l) => l.action === 'LOGIN_FAILED' && l.metadata?.includes('ACCOUNT_SUSPENDED')), 'Audit records ACCOUNT_SUSPENDED failure');

    // Removed account
    const removedLogin = await authService.login('removed.user@example.com', rawPassword, '127.0.0.1', 'Test/1.0');
    assert(removedLogin.success === false && removedLogin.errorCode === 'INVALID_CREDENTIALS', 'Removed account login rejected');

    // Incorrect password
    const wrongPassLogin = await authService.login('active.user@example.com', 'WrongPassword!', '127.0.0.1', 'Test/1.0');
    assert(wrongPassLogin.success === false && wrongPassLogin.errorCode === 'INVALID_CREDENTIALS', 'Incorrect password rejected');
    assert(mockAuditLogs.some((l) => l.action === 'LOGIN_FAILED' && l.metadata?.includes('INCORRECT_PASSWORD')), 'Audit records INCORRECT_PASSWORD failure');

    // ------------------------------------------------------------------
    // TEST 4: Expired session handling
    // ------------------------------------------------------------------
    console.log('\n--- Test 4: Expired Session Handling ---');
    // Artificially expire the session
    const activeSession = mockSessions[0];
    activeSession.expires_at = new Date(Date.now() - 60000).toISOString();
    const expiredValidation = await authService.validateSession(validToken);
    assert(expiredValidation.valid === false, 'Expired session is rejected');
    assert(expiredValidation.errorCode === 'UNAUTHORIZED', 'Expired session returns UNAUTHORIZED');
    assert(expiredValidation.errorMessage === 'Session has expired.', 'Expired session returns clear message');
    assert(mockSessions.length === 0, 'Expired session is automatically purged from database');

    // ------------------------------------------------------------------
    // TEST 5: Suspended account mid-session
    // ------------------------------------------------------------------
    console.log('\n--- Test 5: Mid-Session Account Suspension ---');
    // Log in again
    const reLogin = await authService.login('active.user@example.com', rawPassword, '127.0.0.1', 'Test/1.0');
    const midSessionToken = reLogin.token!;
    // Change user status to suspended in mock user table
    const targetUser = mockUsers.find((u) => u.id === activeUserId)!;
    targetUser.status = UserStatus.SUSPENDED;

    const suspendedMidCheck = await authService.validateSession(midSessionToken);
    assert(suspendedMidCheck.valid === false, 'Mid-session validation detects suspended user');
    assert(suspendedMidCheck.errorCode === 'ACCOUNT_SUSPENDED', 'Returns ACCOUNT_SUSPENDED error code');

    // Restore user
    targetUser.status = UserStatus.ACTIVE;

    // ------------------------------------------------------------------
    // TEST 6: Logout
    // ------------------------------------------------------------------
    console.log('\n--- Test 6: Asynchronous Logout ---');
    await authService.logout(midSessionToken, '127.0.0.1', 'Test/1.0');
    assert(mockSessions.length === 0, 'Session record deleted from database upon logout');
    const postLogoutValidation = await authService.validateSession(midSessionToken);
    assert(postLogoutValidation.valid === false, 'Session token invalid after logout');
    const logoutAudit = mockAuditLogs[mockAuditLogs.length - 1];
    assert(logoutAudit?.action === 'LOGOUT', 'Audit log records LOGOUT event');

    // ------------------------------------------------------------------
    // TEST 7: Invalidate all user sessions
    // ------------------------------------------------------------------
    console.log('\n--- Test 7: Invalidate All User Sessions ---');
    // Create multiple sessions for the user
    await authService.login('active.user@example.com', rawPassword, '127.0.0.1', 'Device1');
    await authService.login('active.user@example.com', rawPassword, '127.0.0.1', 'Device2');
    assert(mockSessions.length === 2, 'Two sessions created for user');

    await authService.invalidateAllUserSessions(activeUserId);
    assert(mockSessions.length === 0, 'All sessions for user invalidated and deleted');

    // ------------------------------------------------------------------
    // TEST 8: Audit log metadata sanitation, reliability & async error safety
    // ------------------------------------------------------------------
    console.log('\n--- Test 8: Audit Log Reliability, Diagnostics & Safety ---');

    // Reset failure diagnostics state for clean test run
    auditService.clearFailureDiagnostics();
    assert(auditService.getFailureCount() === 0, 'auditService diagnostics initialized with 0 failures');

    // 8a. Successful write returns AuditLogResult with success: true and auditId
    const writeResult = await auditService.log({
      actorId: activeUserId,
      action: 'SECURITY_TEST',
      metadata: {
        password: 'SensitivePassword123',
        passwordHash: 'SecretHashXYZ',
        token: 'SensitiveSessionTokenABC',
        sessionToken: 'AnotherSecretToken123',
        regularField: 'safeValue',
      },
    });

    assert(writeResult.success === true, 'Successful audit write returns success: true');
    assert(typeof writeResult.auditId === 'string' && writeResult.auditId.length > 0, 'Successful audit write returns generated auditId');
    assert(writeResult.error === undefined, 'Successful audit write has no error property');

    const secAudit = mockAuditLogs.find((l) => l.action === 'SECURITY_TEST');
    assert(!!secAudit, 'Audit log record persisted to database');
    const parsedMetadata = JSON.parse(secAudit!.metadata || '{}');
    assert(
      !parsedMetadata.password &&
      !parsedMetadata.passwordHash &&
      !parsedMetadata.token &&
      !parsedMetadata.sessionToken,
      'Passwords, hashes, and tokens completely stripped from audit metadata'
    );
    assert(parsedMetadata.regularField === 'safeValue', 'Non-sensitive fields retained in audit metadata');

    // 8b. Default non-rejecting behavior: on DB failure, returns { success: false, error }
    shouldSimulateDbError = true;
    let didThrowNonStrict = false;
    let failedResult: any = null;
    try {
      failedResult = await auditService.log({
        actorId: activeUserId,
        action: 'FAILED_DB_TEST',
        ipAddress: '192.168.1.50',
      });
    } catch {
      didThrowNonStrict = true;
    }
    assert(!didThrowNonStrict, 'auditService.log in default mode does not throw on database failure');
    assert(failedResult !== null && failedResult.success === false, 'auditService.log returns success: false on DB error');
    assert(failedResult?.error instanceof Error, 'auditService.log returns error instance in result on DB error');

    // 8c. Failure diagnostics tracking
    assert(auditService.getFailureCount() === 1, 'auditService tracks failure count (1 failure recorded)');
    const lastFailure = auditService.getLastFailure();
    assert(lastFailure !== null, 'auditService.getLastFailure() returns failure diagnostic object');
    assert(lastFailure?.action === 'FAILED_DB_TEST', 'Diagnostic records failed action accurately');
    assert(lastFailure?.actorId === activeUserId, 'Diagnostic records actorId');
    assert(lastFailure?.ipAddress === '192.168.1.50', 'Diagnostic records client IP');
    assert(typeof lastFailure?.errorMessage === 'string', 'Diagnostic captures error message');

    // 8d. Strict mode (throwOnError: true) throws AuditLoggingError
    let thrownError: any = null;
    try {
      await auditService.log(
        { action: 'STRICT_MODE_TEST', actorId: activeUserId },
        { throwOnError: true }
      );
    } catch (err) {
      thrownError = err;
    }
    assert(thrownError instanceof AuditLoggingError, 'Strict mode throws AuditLoggingError');
    assert(thrownError?.diagnostics?.action === 'STRICT_MODE_TEST', 'AuditLoggingError contains structured diagnostics');
    assert(thrownError?.originalError !== undefined, 'AuditLoggingError contains original database error');
    assert(auditService.getFailureCount() === 2, 'Failure count incremented to 2');

    // 8e. Failure listener callback and exception isolation
    let listenerReceivedAction = '';
    let listenerCalls = 0;
    const unsubscribeListener = auditService.onFailure((diag) => {
      listenerCalls++;
      listenerReceivedAction = diag.action;
      // Intentionally throw inside listener to verify isolation
      throw new Error('Listener deliberately exploded');
    });

    let didThrowWithBuggyListener = false;
    let listenerTestResult: any = null;
    try {
      listenerTestResult = await auditService.log({ action: 'LISTENER_ISOLATION_TEST' });
    } catch {
      didThrowWithBuggyListener = true;
    }
    assert(!didThrowWithBuggyListener, 'Buggy listener throwing does not crash auditService.log');
    assert(listenerTestResult?.success === false, 'auditService.log still reports failure cleanly despite listener exception');
    assert(listenerCalls === 1 && listenerReceivedAction === 'LISTENER_ISOLATION_TEST', 'Listener received failure diagnostic before error');

    // Verify unsubscribe works
    unsubscribeListener();
    await auditService.log({ action: 'AFTER_UNSUBSCRIBE_TEST' });
    assert(listenerCalls === 1, 'Unsubscribed listener is no longer called');

    // 8f. Fire-and-forget callers without await or catch do not trigger unhandled promise rejections
    let unhandledRejectionCount = 0;
    const unhandledHandler = () => {
      unhandledRejectionCount++;
    };
    process.on('unhandledRejection', unhandledHandler);

    // Call fire-and-forget with DB failure active
    auditService.log({ action: 'FIRE_AND_FORGET_DB_ERROR' });

    // Wait a brief tick for Promise microtasks to resolve
    await new Promise((r) => setTimeout(r, 50));
    process.removeListener('unhandledRejection', unhandledHandler);

    assert(unhandledRejectionCount === 0, 'Fire-and-forget call during DB error produces 0 unhandled promise rejections');

    // 8g. Clear diagnostics
    auditService.clearFailureDiagnostics();
    assert(auditService.getFailureCount() === 0, 'clearFailureDiagnostics resets failure count to 0');
    assert(auditService.getLastFailure() === null, 'clearFailureDiagnostics empties failure ring buffer');

    // Reset DB error simulation
    shouldSimulateDbError = false;

    // ------------------------------------------------------------------
    // TEST 9: Middleware requireAuth & optionalAuth
    // ------------------------------------------------------------------
    console.log('\n--- Test 9: Middleware Propagation ---');
    // Generate valid session
    const finalLogin = await authService.login('active.user@example.com', rawPassword, '127.0.0.1', 'MiddlewareTest');
    const middlewareToken = finalLogin.token!;

    // Helper for fake Express response
    const createMockRes = () => {
      const res: any = {
        statusCode: 200,
        headersSent: false,
        jsonPayload: null,
        status(code: number) {
          this.statusCode = code;
          return this;
        },
        json(data: any) {
          this.jsonPayload = data;
          return this;
        },
      };
      return res;
    }

    // 9a. requireAuth missing token
    let nextCalled = false;
    const reqNoToken: AuthenticatedRequest = { cookies: {}, headers: {} } as any;
    const resNoToken = createMockRes();
    await requireAuth(reqNoToken, resNoToken, () => { nextCalled = true; });
    assert(!nextCalled && resNoToken.statusCode === 401, 'requireAuth rejects request missing token with 401');

    // 9b. requireAuth valid token in cookie
    nextCalled = false;
    const reqCookie: AuthenticatedRequest = { cookies: { session_token: middlewareToken }, headers: {} } as any;
    const resCookie = createMockRes();
    await requireAuth(reqCookie, resCookie, () => { nextCalled = true; });
    assert(nextCalled && reqCookie.user?.id === activeUserId, 'requireAuth validates cookie token and sets req.user');

    // 9c. requireAuth valid token in Bearer header
    nextCalled = false;
    const reqBearer: AuthenticatedRequest = { cookies: {}, headers: { authorization: `Bearer ${middlewareToken}` } } as any;
    const resBearer = createMockRes();
    await requireAuth(reqBearer, resBearer, () => { nextCalled = true; });
    assert(nextCalled && reqBearer.user?.id === activeUserId, 'requireAuth validates Bearer token and sets req.user');

    // 9d. optionalAuth without token
    nextCalled = false;
    const reqOptEmpty: AuthenticatedRequest = { cookies: {}, headers: {} } as any;
    const resOptEmpty = createMockRes();
    await optionalAuth(reqOptEmpty, resOptEmpty, () => { nextCalled = true; });
    assert(nextCalled && !reqOptEmpty.user, 'optionalAuth continues when token is absent');

    // 9e. optionalAuth with valid token
    nextCalled = false;
    const reqOptValid: AuthenticatedRequest = { cookies: { session_token: middlewareToken }, headers: {} } as any;
    const resOptValid = createMockRes();
    await optionalAuth(reqOptValid, resOptValid, () => { nextCalled = true; });
    assert(nextCalled && reqOptValid.user?.id === activeUserId, 'optionalAuth populates req.user when valid token provided');

    // 9f. Database error handling in requireAuth
    shouldSimulateDbError = true;
    nextCalled = false;
    const reqDbErr: AuthenticatedRequest = { cookies: { session_token: middlewareToken }, headers: {} } as any;
    const resDbErr = createMockRes();
    await requireAuth(reqDbErr, resDbErr, () => { nextCalled = true; });
    assert(!nextCalled && resDbErr.statusCode === 500, 'requireAuth returns 500 on database failure');
    shouldSimulateDbError = false;

  } finally {
    // Restore original dbAdapter methods
    (dbAdapter as any).queryOne = originalQueryOne;
    (dbAdapter as any).query = originalQuery;
    (dbAdapter as any).execute = originalExecute;
    (dbAdapter as any).isPostgres = originalIsPostgres;
  }

  console.log('\n========================================================');
  console.log(`RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal error in test suite:', err);
  process.exit(1);
});
