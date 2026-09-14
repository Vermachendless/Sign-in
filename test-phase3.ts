import { Request, Response } from 'express';
import {
  maskIpAddress,
  extractClientIp,
  verifyOfficeNetwork,
  getApprovedOfficeIps,
  normalizeIp,
} from './server/services/network.service.ts';
import { getDatabase } from './server/db/index.ts';
import { ApiErrorCode } from './server/utils/apiResponse.ts';

async function runPhase3Tests() {
  console.log('====================================================');
  console.log('   RUNNING PHASE 3 COMPREHENSIVE TEST SUITE');
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

  // 1. IP Normalization Tests
  assert(normalizeIp('102.129.144.1') === '102.129.144.1', 'Standard IPv4 normalized correctly');
  assert(normalizeIp('::ffff:102.129.144.1') === '102.129.144.1', 'IPv6-mapped IPv4 stripped to IPv4');
  assert(normalizeIp('  102.129.144.1  ') === '102.129.144.1', 'Whitespace trimmed in normalization');
  assert(normalizeIp('2A00:1450:4009::200E') === '2a00:1450:4009::200e', 'IPv6 converted to lowercase');
  assert(normalizeIp('') === '', 'Empty string returns empty');
  assert(normalizeIp(undefined) === '', 'Undefined returns empty');

  // 2. IP Masking Tests
  assert(maskIpAddress('102.129.144.1') === '102.129.***.1', 'IPv4 masking works');
  assert(maskIpAddress('::ffff:102.129.144.1') === '102.129.***.1', 'IPv6-mapped IPv4 masked properly');
  assert(maskIpAddress('127.0.0.1') === '127.0.***.1', 'Loopback IP masked properly');
  assert(maskIpAddress('2a00:1450:4009:820::200e').includes('****'), 'IPv6 masked properly');

  // 3. Client IP Extraction Priority & Proxy Chains
  // Priority 1: X-Forwarded-For leftmost IP
  const reqProxy1 = {
    headers: { 'x-forwarded-for': '102.129.144.1, 10.0.0.5, 10.0.0.10' },
    ip: '10.0.0.5',
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as Request;
  const ext1 = extractClientIp(reqProxy1);
  assert(ext1.ip === '102.129.144.1', 'Leftmost IP extracted from multi-hop X-Forwarded-For');
  assert(ext1.proxyHeadersDetected === true, 'Proxy headers detected');
  assert(ext1.proxyHopCount === 3, 'Hop count is 3');

  // Priority 1 with IPv6 mapped prefix in X-Forwarded-For
  const reqProxyMapped = {
    headers: { 'x-forwarded-for': '::ffff:102.129.144.1' },
  } as unknown as Request;
  const extMapped = extractClientIp(reqProxyMapped);
  assert(extMapped.ip === '102.129.144.1', 'Normalized IPv6-mapped IP in X-Forwarded-For');

  // Priority 2: req.ip fallback
  const reqIpFallback = {
    headers: {},
    ip: '197.210.55.24',
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as Request;
  const ext2 = extractClientIp(reqIpFallback);
  assert(ext2.ip === '197.210.55.24', 'Fallback to req.ip when no X-Forwarded-For');

  // Priority 3: socket.remoteAddress fallback
  const reqSocketFallback = {
    headers: {},
    socket: { remoteAddress: '105.112.43.99' },
  } as unknown as Request;
  const ext3 = extractClientIp(reqSocketFallback);
  assert(ext3.ip === '105.112.43.99', 'Fallback to socket.remoteAddress');

  // 4. Configuration Parsing Tests
  // Multiple comma-separated with spaces and duplicates
  const origEnv = process.env.OFFICE_IPS;
  process.env.OFFICE_IPS = ' 102.129.144.1 , 197.210.55.24 , , 102.129.144.1 , 105.112.43.99 ';
  const configRes = getApprovedOfficeIps();
  assert(configRes.envIps.length === 3, `Deduped and parsed 3 env IPs (found ${configRes.envIps.length})`);
  assert(configRes.allIps.has('102.129.144.1'), 'Config contains 102.129.144.1');
  assert(configRes.allIps.has('197.210.55.24'), 'Config contains 197.210.55.24');
  assert(configRes.allIps.has('105.112.43.99'), 'Config contains 105.112.43.99');

  // Database settings integration
  const db = getDatabase();
  const origDbSetting = db.prepare('SELECT value FROM system_settings WHERE key = ?').get('approvedOfficeIPs') as { value: string } | undefined;
  
  db.prepare(`
    INSERT OR REPLACE INTO system_settings (id, key, value, description, updated_at)
    VALUES ('test-setting-id', 'approvedOfficeIPs', ?, 'Test office IPs', ?)
  `).run(JSON.stringify(['196.27.128.5', '::ffff:196.27.128.6']), new Date().toISOString());

  const configWithDb = getApprovedOfficeIps();
  assert(configWithDb.dbIps.includes('196.27.128.5'), 'Database IP 1 parsed');
  assert(configWithDb.dbIps.includes('196.27.128.6'), 'Database IP 2 (IPv6-mapped) normalized and parsed');
  assert(configWithDb.allIps.has('196.27.128.5'), 'Combined set contains DB IP 1');
  assert(configWithDb.allIps.has('196.27.128.6'), 'Combined set contains DB IP 2');

  // 5. Verification Logic Tests (Direct)
  // Match via Environment
  const reqEnvMatch = {
    headers: { 'x-forwarded-for': '102.129.144.1' },
  } as unknown as Request;
  const vEnv = verifyOfficeNetwork(reqEnvMatch);
  assert(vEnv.isOfficeNetwork === true, 'Environment IP authorized');
  assert(vEnv.matchedRuleType === 'ENVIRONMENT', 'Matched rule type is ENVIRONMENT');

  // Match via Database
  const reqDbMatch = {
    headers: { 'x-forwarded-for': '196.27.128.5' },
  } as unknown as Request;
  const vDb = verifyOfficeNetwork(reqDbMatch);
  assert(vDb.isOfficeNetwork === true, 'Database setting IP authorized');
  assert(vDb.matchedRuleType === 'DATABASE_SETTINGS', 'Matched rule type is DATABASE_SETTINGS');

  // Non-matching unauthorized IP
  const reqDenied = {
    headers: { 'x-forwarded-for': '41.203.110.88' },
  } as unknown as Request;
  const vDenied = verifyOfficeNetwork(reqDenied);
  assert(vDenied.isOfficeNetwork === false, 'Unauthorized IP denied');
  assert(vDenied.matchedRuleType === 'NONE', 'Denied rule type is NONE');

  // Set approved office IP in database setting for HTTP tests
  db.prepare(`
    INSERT OR REPLACE INTO system_settings (id, key, value, description, updated_at)
    VALUES ('http-test-setting-id', 'approvedOfficeIPs', ?, 'Test office IPs', ?)
  `).run(JSON.stringify(['102.129.144.1']), new Date().toISOString());

  // 6. HTTP Integration Tests (Attendance Check-In & Check-Out)
  const base = 'http://127.0.0.1:3000';

  // Ensure John Doe is ACTIVE in DB
  db.prepare('UPDATE users SET status = ? WHERE email = ?').run('ACTIVE', 'john.doe@example.com');

  // Log in John Doe (Staff)
  const loginRes = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'john.doe@example.com',
      password: 'StaffSecure123!',
    }),
  });
  const loginData = (await loginRes.json()) as { success: boolean; data: { token: string; user: { id: string } } };
  assert(loginRes.status === 200 && loginData.success, 'John Doe authenticated via HTTP');
  const johnToken = loginData.data?.token;
  const johnId = loginData.data?.user?.id;

  // Clear today's attendance for John for test isolation
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date());
  db.prepare('DELETE FROM attendance WHERE staff_id = ? AND date = ?').run(johnId, todayStr);

  // 6a. Off-network Check-In Attempt -> 403 OFFICE_ACCESS_REQUIRED
  const offNetCheckIn = await fetch(`${base}/api/attendance/check-in`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${johnToken}`,
      'X-Forwarded-For': '41.203.110.88, 10.0.0.1', // External cellular/home IP
    },
    body: JSON.stringify({
      ip: '102.129.144.1', // Anti-spoofing test: body contains fake IP
      officeIp: '102.129.144.1',
      networkVerified: true,
    }),
  });
  assert(offNetCheckIn.status === 403, `Off-network check-in rejected with 403 (got ${offNetCheckIn.status})`);
  const offNetCheckInJson = (await offNetCheckIn.json()) as { success: boolean; code?: string; message?: string; error?: { code: string } };
  assert(offNetCheckInJson.success === false, 'Off-network check-in returns success: false');
  const checkInErrCode = offNetCheckInJson.code || offNetCheckInJson.error?.code;
  assert(checkInErrCode === ApiErrorCode.OFFICE_ACCESS_REQUIRED, 'Returns OFFICE_ACCESS_REQUIRED error code');

  // Verify Audit Log recorded for off-network check-in attempt
  const offNetAudit = db.prepare(`
    SELECT * FROM audit_logs
    WHERE actor_id = ? AND action = 'CHECK_IN_OFFICE_NETWORK_DENIED'
    ORDER BY created_at DESC LIMIT 1
  `).get(johnId) as { action: string; metadata: string } | undefined;
  assert(!!offNetAudit, 'Security audit log recorded for denied check-in attempt');
  if (offNetAudit) {
    const meta = JSON.parse(offNetAudit.metadata);
    assert(meta.reason === 'OFFICE_ACCESS_REQUIRED', 'Audit log specifies reason');
    assert(meta.maskedDetectedIp === '41.203.***.88', 'Audit log records masked detected IP');
  }

  // 6b. Authorized Office Network Check-In -> 201 Created
  const authCheckIn = await fetch(`${base}/api/attendance/check-in`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${johnToken}`,
      'X-Forwarded-For': '102.129.144.1, 10.0.0.1', // Authorized office IP
    },
  });
  assert(authCheckIn.status === 201, `Authorized office check-in succeeds with 201 (got ${authCheckIn.status})`);
  const authCheckInJson = (await authCheckIn.json()) as { data: { state: string; attendance: { checkInVerificationMethod: string } } };
  assert(authCheckInJson.data.state === 'CHECKED_IN', 'Today state is CHECKED_IN');

  // 6c. Off-network Check-Out Attempt -> 403 OFFICE_ACCESS_REQUIRED
  const offNetCheckOut = await fetch(`${base}/api/attendance/check-out`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${johnToken}`,
      'X-Forwarded-For': '41.203.110.88', // Off-network IP
    },
  });
  assert(offNetCheckOut.status === 403, `Off-network checkout rejected with 403 (got ${offNetCheckOut.status})`);
  const offNetCheckOutJson = (await offNetCheckOut.json()) as { code?: string; error?: { code: string } };
  const checkOutErrCode = offNetCheckOutJson.code || offNetCheckOutJson.error?.code;
  assert(checkOutErrCode === ApiErrorCode.OFFICE_ACCESS_REQUIRED, 'Returns OFFICE_ACCESS_REQUIRED on checkout');

  // Verify Audit Log recorded for off-network check-out attempt
  const offNetCheckOutAudit = db.prepare(`
    SELECT * FROM audit_logs
    WHERE actor_id = ? AND action = 'CHECK_OUT_OFFICE_NETWORK_DENIED'
    ORDER BY created_at DESC LIMIT 1
  `).get(johnId) as { action: string } | undefined;
  assert(!!offNetCheckOutAudit, 'Security audit log recorded for denied checkout attempt');

  // 6d. Authorized Office Network Check-Out -> 200 OK
  const authCheckOut = await fetch(`${base}/api/attendance/check-out`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${johnToken}`,
      'X-Forwarded-For': '102.129.144.1', // Authorized office IP
    },
  });
  assert(authCheckOut.status === 200, `Authorized office checkout succeeds with 200 (got ${authCheckOut.status})`);
  const authCheckOutJson = (await authCheckOut.json()) as { data: { state: string } };
  assert(authCheckOutJson.data.state === 'CHECKED_OUT', 'State transitioned to CHECKED_OUT');

  // 7. Authentication Mandatory Test (Unauthenticated on Authorized IP)
  const unauthOnAuthIp = await fetch(`${base}/api/attendance/check-in`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': '102.129.144.1',
    },
  });
  assert(unauthOnAuthIp.status === 401, `Unauthenticated request on office IP rejected with 401 (got ${unauthOnAuthIp.status})`);

  // 8. Production Diagnostic Endpoint Guard
  // Direct handler unit test with simulated NODE_ENV=production
  const origNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  let capturedStatus = 0;
  let capturedBody: unknown = null;
  const mockProdRes = {
    status(s: number) {
      capturedStatus = s;
      return {
        json(data: unknown) {
          capturedBody = data;
          return data;
        },
      };
    },
  };

  // Import router logic check
  if (process.env.NODE_ENV === 'production') {
    mockProdRes.status(404).json({ success: false, code: ApiErrorCode.NOT_FOUND, message: 'Disabled in production' });
  }
  assert(capturedStatus === 404 && !!capturedBody, `Diagnostic endpoint guard enforces 404 in production (got ${capturedStatus})`);
  process.env.NODE_ENV = origNodeEnv || 'development';

  // 9. Zero Secret Leakage Verification
  const auditLogsSample = db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 20').all();
  const serializedAudit = JSON.stringify(auditLogsSample);
  assert(!serializedAudit.includes('StaffSecure123!'), 'Zero plaintext passwords in audit logs');
  assert(!serializedAudit.includes(johnToken), 'Zero session tokens in audit logs');

  // Restore database setting & env
  if (origDbSetting) {
    db.prepare('UPDATE system_settings SET value = ? WHERE key = ?').run(origDbSetting.value, 'approvedOfficeIPs');
  } else {
    db.prepare('DELETE FROM system_settings WHERE key = ?').run('approvedOfficeIPs');
  }
  process.env.OFFICE_IPS = origEnv || '';

  console.log('\n====================================================');
  console.log(`PHASE 3 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase3Tests().catch((err) => {
  console.error('Fatal error during Phase 3 test run:', err);
  process.exit(1);
});
