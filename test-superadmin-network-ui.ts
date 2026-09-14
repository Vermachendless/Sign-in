import { getDatabase } from './server/db/index.ts';
import {
  validateIpFormat,
  getOfficeNetworkSettings,
  addApprovedOfficeIp,
  removeApprovedOfficeIp,
  verifyOfficeNetwork,
  getApprovedOfficeIps,
} from './server/services/network.service.ts';
import { Request } from 'express';
import { attendanceService } from './server/services/attendance.service.ts';
import { authService } from './server/services/auth.service.ts';

async function runSuperAdminNetworkTests() {
  console.log('================================================================');
  console.log('   SUPER ADMIN OFFICE NETWORK & ATTENDANCE ACCESS TEST SUITE');
  console.log('================================================================\n');

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

  // Backup original state
  const originalEnvOfficeIps = process.env.OFFICE_IPS;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDbSetting = db.prepare('SELECT value FROM system_settings WHERE key = ?').get('approvedOfficeIPs') as
    | { value: string }
    | undefined;

  try {
    // ----------------------------------------------------------------
    // 1. UNIT TESTS: validateIpFormat
    // ----------------------------------------------------------------
    console.log('\n--- 1. IP Validation Format Tests ---');
    assert(validateIpFormat('102.129.144.1') === true, 'Valid IPv4 accepted (102.129.144.1)');
    assert(validateIpFormat('197.210.55.24') === true, 'Valid IPv4 accepted (197.210.55.24)');
    assert(validateIpFormat('127.0.0.1') === true, 'Loopback IPv4 is valid IP format');
    assert(validateIpFormat('2a00:1450:4009:820::200e') === true, 'Valid IPv6 accepted (2a00:1450:...)');
    assert(validateIpFormat('::1') === true, 'Valid IPv6 loopback format accepted (::1)');
    assert(validateIpFormat('999.999.999.999') === false, 'Out-of-range IPv4 rejected (999.999.999.999)');
    assert(validateIpFormat('not-an-ip') === false, 'Arbitrary string rejected');
    assert(validateIpFormat('') === false, 'Empty string rejected');
    assert(validateIpFormat('192.168.1.') === false, 'Truncated IPv4 rejected');
    assert(validateIpFormat('192.168.1.1.5') === false, '5-segment IP rejected');

    // ----------------------------------------------------------------
    // 2. SUPER ADMIN PERSISTENCE: addApprovedOfficeIp & removeApprovedOfficeIp
    // ----------------------------------------------------------------
    console.log('\n--- 2. Database Persistence & Audit Logging Tests ---');
    const superAdminRow = db.prepare("SELECT id FROM users WHERE role = 'SUPER_ADMIN' LIMIT 1").get() as { id: string };
    const testActorId = superAdminRow.id;
    const testOfficeIp1 = '196.200.100.1';
    const testOfficeIp2 = '196.200.100.2';

    // Clear db office IPs for clean slate
    db.prepare('DELETE FROM system_settings WHERE key = ?').run('approvedOfficeIPs');
    delete process.env.OFFICE_IPS;

    // Add first office IP
    const addRes1 = addApprovedOfficeIp(testActorId, testOfficeIp1, '196.200.100.1', 'TestRunner/1.0');
    assert(addRes1.success === true, 'Successfully added testOfficeIp1');
    assert(addRes1.approvedIps.includes(testOfficeIp1), 'approvedIps includes testOfficeIp1');

    // Verify it persisted in database
    const dbRow1 = db.prepare('SELECT value, updated_by FROM system_settings WHERE key = ?').get('approvedOfficeIPs') as
      | { value: string; updated_by: string }
      | undefined;
    assert(!!dbRow1, 'system_settings row exists for approvedOfficeIPs');
    const parsedIps1 = JSON.parse(dbRow1!.value);
    assert(Array.isArray(parsedIps1) && parsedIps1.includes(testOfficeIp1), 'Parsed DB JSON contains testOfficeIp1');
    assert(dbRow1!.updated_by === testActorId, 'Updated by is recorded as testActorId');

    // Verify Audit Log was recorded
    const auditRow1 = db.prepare(
      'SELECT action, actor_id, metadata FROM audit_logs WHERE action = ? ORDER BY created_at DESC LIMIT 1'
    ).get('OFFICE_IP_ADDED') as { action: string; actor_id: string; metadata: string } | undefined;
    assert(!!auditRow1, 'Audit log created with action OFFICE_IP_ADDED');
    assert(auditRow1?.actor_id === testActorId, 'Audit log contains correct actor_id');
    const auditMeta1 = JSON.parse(auditRow1!.metadata);
    assert(auditMeta1.addedIp === testOfficeIp1, 'Audit metadata records addedIp');

    // Add second office IP
    const addRes2 = addApprovedOfficeIp(testActorId, testOfficeIp2, '196.200.100.1', 'TestRunner/1.0');
    assert(addRes2.success === true, 'Successfully added testOfficeIp2');
    assert(addRes2.approvedIps.includes(testOfficeIp2), 'approvedIps includes testOfficeIp2');
    assert(addRes2.approvedIps.length === 2, 'Total approved IPs is now 2');

    // Remove first office IP
    const remRes1 = removeApprovedOfficeIp(testActorId, testOfficeIp1, '196.200.100.1', 'TestRunner/1.0');
    assert(remRes1.success === true, 'Successfully removed testOfficeIp1');
    assert(!remRes1.approvedIps.includes(testOfficeIp1), 'testOfficeIp1 no longer in approvedIps');
    assert(remRes1.approvedIps.includes(testOfficeIp2), 'testOfficeIp2 remains in approvedIps');

    // Verify Audit Log for removal
    const auditRowRem = db.prepare(
      'SELECT action, actor_id, metadata FROM audit_logs WHERE action = ? ORDER BY created_at DESC LIMIT 1'
    ).get('OFFICE_IP_REMOVED') as { action: string; actor_id: string; metadata: string } | undefined;
    assert(!!auditRowRem, 'Audit log created with action OFFICE_IP_REMOVED');
    const auditMetaRem = JSON.parse(auditRowRem!.metadata);
    assert(auditMetaRem.removedIp === testOfficeIp1, 'Audit metadata records removedIp');

    // ----------------------------------------------------------------
    // 3. PRODUCTION LOOPBACK IMMUNITY IN SETTINGS
    // ----------------------------------------------------------------
    console.log('\n--- 3. Production Loopback Immunity in Settings ---');
    process.env.NODE_ENV = 'production';
    const prodLoopbackAdd = addApprovedOfficeIp(testActorId, '127.0.0.1', '127.0.0.1');
    assert(prodLoopbackAdd.success === false, 'Cannot add 127.0.0.1 as approved office IP in production');
    assert(prodLoopbackAdd.error?.includes('Loopback addresses'), 'Clear error message explaining rejection');

    const prodIpv6LoopbackAdd = addApprovedOfficeIp(testActorId, '::1', '::1');
    assert(prodIpv6LoopbackAdd.success === false, 'Cannot add ::1 as approved office IP in production');

    // Reset NODE_ENV
    process.env.NODE_ENV = 'test';

    // ----------------------------------------------------------------
    // 4. GET OFFICE NETWORK SETTINGS & EVALUATION
    // ----------------------------------------------------------------
    console.log('\n--- 4. getOfficeNetworkSettings Inspection ---');
    const mockReqApproved = {
      headers: { 'x-forwarded-for': testOfficeIp2 },
      ip: '10.0.0.1',
      socket: { remoteAddress: '10.0.0.1' },
    } as unknown as Request;

    const settingsResult = getOfficeNetworkSettings(mockReqApproved);
    assert(settingsResult.currentDetectedIp === testOfficeIp2, `Detected IP is ${testOfficeIp2}`);
    assert(settingsResult.isCurrentIpApproved === true, 'Current detected IP is evaluated as approved');
    assert(settingsResult.dbIps.includes(testOfficeIp2), 'dbIps list contains testOfficeIp2');

    const mockReqUnapproved = {
      headers: { 'x-forwarded-for': '203.0.113.199' },
      ip: '10.0.0.1',
      socket: { remoteAddress: '10.0.0.1' },
    } as unknown as Request;

    const unapprovedSettings = getOfficeNetworkSettings(mockReqUnapproved);
    assert(unapprovedSettings.currentDetectedIp === '203.0.113.199', 'Detected IP is 203.0.113.199');
    assert(unapprovedSettings.isCurrentIpApproved === false, 'Current detected IP is NOT approved');

    // ----------------------------------------------------------------
    // 5. ATTENDANCE INTEGRATION WITH SUPER ADMIN CONFIGURED IP
    // ----------------------------------------------------------------
    console.log('\n--- 5. Attendance Service Integration with Approved IP ---');
    // Ensure test office IP 196.200.100.2 is in DB
    addApprovedOfficeIp(testActorId, testOfficeIp2);

    // Verify verification directly
    const directVerifyMatch = verifyOfficeNetwork(mockReqApproved);
    assert(directVerifyMatch.isOfficeNetwork === true, 'verifyOfficeNetwork returns true for configured office IP');
    assert(directVerifyMatch.matchedRuleType === 'DATABASE_SETTINGS', 'Matched rule type is DATABASE_SETTINGS');

    const directVerifyFail = verifyOfficeNetwork(mockReqUnapproved);
    assert(directVerifyFail.isOfficeNetwork === false, 'verifyOfficeNetwork returns false for unknown IP');
    assert(directVerifyFail.matchedRuleType === 'NONE', 'Matched rule type is NONE');

    // Now remove testOfficeIp2
    removeApprovedOfficeIp(testActorId, testOfficeIp2);
    const directVerifyAfterRemoval = verifyOfficeNetwork(mockReqApproved);
    assert(directVerifyAfterRemoval.isOfficeNetwork === false, 'After Super Admin removal, verifyOfficeNetwork fails closed');
    assert(directVerifyAfterRemoval.matchedRuleType === 'NONE', 'Matched rule type is NONE after removal');

    // ----------------------------------------------------------------
    // 6. RBAC & SUPER_ADMIN EXCLUSIVITY CHECKS
    // ----------------------------------------------------------------
    console.log('\n--- 6. Super Admin Exclusivity & RBAC Verification ---');
    // Query users to find superadmin, admin, staff
    const superAdminUser = db.prepare("SELECT * FROM users WHERE role = 'SUPER_ADMIN' AND status = 'ACTIVE' LIMIT 1").get() as any;
    const adminUser = db.prepare("SELECT * FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE' LIMIT 1").get() as any;
    const staffUser = db.prepare("SELECT * FROM users WHERE role = 'STAFF' AND status = 'ACTIVE' LIMIT 1").get() as any;

    assert(!!superAdminUser, 'Active SUPER_ADMIN user exists in database');
    assert(!!adminUser, 'Active ADMIN user exists in database');
    assert(!!staffUser, 'Active STAFF user exists in database');

    console.log(`Verified Roles: SUPER_ADMIN (${superAdminUser?.email}), ADMIN (${adminUser?.email}), STAFF (${staffUser?.email})`);

    // ----------------------------------------------------------------
    // 7. LIVE HTTP API RBAC & FUNCTIONALITY VERIFICATION
    // ----------------------------------------------------------------
    console.log('\n--- 7. Live HTTP API Endpoint & RBAC Verification ---');

    async function login(email: string, pass: string): Promise<string> {
      const res = await fetch('http://127.0.0.1:3000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: pass }),
      });
      const cookie = res.headers.get('set-cookie');
      if (!cookie) throw new Error(`Login failed for ${email}`);
      return cookie.split(';')[0];
    }

    const superAdminCookie = await login('admin@example.com', 'AdminSecurePassword123!');
    const adminCookie = await login('manager@example.com', 'ManagerSecure123!');
    const staffCookie = await login('john.doe@example.com', 'StaffSecure123!');

    // 7.1 GET /api/admin/office-network
    const getSuperRes = await fetch('http://127.0.0.1:3000/api/admin/office-network', {
      headers: { Cookie: superAdminCookie },
    });
    assert(getSuperRes.status === 200, 'SUPER_ADMIN can access GET /api/admin/office-network (200 OK)');
    const getSuperJson = await getSuperRes.json();
    assert(getSuperJson.success === true && Array.isArray(getSuperJson.data.approvedIps), 'Response contains approvedIps array');

    const getAdminRes = await fetch('http://127.0.0.1:3000/api/admin/office-network', {
      headers: { Cookie: adminCookie },
    });
    assert(getAdminRes.status === 403, 'ADMIN is blocked from GET /api/admin/office-network (403 Forbidden)');

    const getStaffRes = await fetch('http://127.0.0.1:3000/api/admin/office-network', {
      headers: { Cookie: staffCookie },
    });
    assert(getStaffRes.status === 403, 'STAFF is blocked from GET /api/admin/office-network (403 Forbidden)');

    const getAnonRes = await fetch('http://127.0.0.1:3000/api/admin/office-network');
    assert(getAnonRes.status === 401, 'Anonymous request is rejected from GET /api/admin/office-network (401 Unauthorized)');

    // 7.2 POST /api/admin/office-network
    const postIp = '197.210.88.99';
    const postSuperRes = await fetch('http://127.0.0.1:3000/api/admin/office-network', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: superAdminCookie,
      },
      body: JSON.stringify({ ip: postIp }),
    });
    assert(postSuperRes.status === 201, 'SUPER_ADMIN can add office IP via POST /api/admin/office-network (201 Created)');
    const postSuperJson = await postSuperRes.json();
    assert(postSuperJson.data.approvedIps.includes(postIp), 'Added IP is present in response approvedIps');

    const postAdminRes = await fetch('http://127.0.0.1:3000/api/admin/office-network', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
      },
      body: JSON.stringify({ ip: '197.210.88.100' }),
    });
    assert(postAdminRes.status === 403, 'ADMIN cannot add office IP via POST /api/admin/office-network (403 Forbidden)');

    const postStaffRes = await fetch('http://127.0.0.1:3000/api/admin/office-network', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: staffCookie,
      },
      body: JSON.stringify({ ip: '197.210.88.100' }),
    });
    assert(postStaffRes.status === 403, 'STAFF cannot add office IP via POST /api/admin/office-network (403 Forbidden)');

    // 7.3 POST /api/admin/office-network/add-current
    const addCurrentSuperRes = await fetch('http://127.0.0.1:3000/api/admin/office-network/add-current', {
      method: 'POST',
      headers: {
        Cookie: superAdminCookie,
        'x-forwarded-for': '197.210.88.105',
      },
    });
    assert(addCurrentSuperRes.status === 200, 'SUPER_ADMIN can use POST /api/admin/office-network/add-current (200 OK)');
    const addCurrentJson = await addCurrentSuperRes.json();
    assert(addCurrentJson.data.approvedIps.includes('197.210.88.105'), 'Current detected IP added successfully');

    const addCurrentAdminRes = await fetch('http://127.0.0.1:3000/api/admin/office-network/add-current', {
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
    assert(addCurrentAdminRes.status === 403, 'ADMIN cannot use add-current (403 Forbidden)');

    // 7.4 DELETE /api/admin/office-network/:ip
    const delSuperRes = await fetch(`http://127.0.0.1:3000/api/admin/office-network/${postIp}`, {
      method: 'DELETE',
      headers: { Cookie: superAdminCookie },
    });
    assert(delSuperRes.status === 200, 'SUPER_ADMIN can remove office IP via DELETE /api/admin/office-network/:ip (200 OK)');
    const delSuperJson = await delSuperRes.json();
    assert(!delSuperJson.data.approvedIps.includes(postIp), 'Removed IP no longer in approvedIps');

    const delAdminRes = await fetch(`http://127.0.0.1:3000/api/admin/office-network/${postIp}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
    assert(delAdminRes.status === 403, 'ADMIN cannot delete office IP (403 Forbidden)');

    const delStaffRes = await fetch(`http://127.0.0.1:3000/api/admin/office-network/${postIp}`, {
      method: 'DELETE',
      headers: { Cookie: staffCookie },
    });
    assert(delStaffRes.status === 403, 'STAFF cannot delete office IP (403 Forbidden)');

  } finally {
    // Restore original state
    if (originalEnvOfficeIps !== undefined) {
      process.env.OFFICE_IPS = originalEnvOfficeIps;
    } else {
      delete process.env.OFFICE_IPS;
    }

    if (originalNodeEnv !== undefined) {
      process.env.NODE_ENV = originalNodeEnv;
    }

    if (originalDbSetting) {
      db.prepare(`
        INSERT INTO system_settings (id, key, value, description, updated_at)
        VALUES ('restore', 'approvedOfficeIPs', ?, 'Restored', datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(originalDbSetting.value);
    } else {
      db.prepare('DELETE FROM system_settings WHERE key = ?').run('approvedOfficeIPs');
    }
  }

  console.log('\n================================================================');
  console.log(`   SUPER ADMIN OFFICE NETWORK TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runSuperAdminNetworkTests().catch((err) => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
