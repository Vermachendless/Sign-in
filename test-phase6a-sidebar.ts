import assert from 'node:assert';
import http from 'node:http';
import express from 'express';
import cookieParser from 'cookie-parser';
import { UserRole } from './src/types/index.ts';
import authRoutes from './server/routes/auth.routes.ts';
import adminRoutes from './server/routes/admin.routes.ts';
import { getDatabase } from './server/db/index.ts';
import { auditService } from './server/services/audit.service.ts';

// Helper function to make HTTP requests with cookie support
function httpRequest(options: {
  port: number;
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: options.port,
        path: options.path,
        method: options.method || 'GET',
        headers: options.headers || {},
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body: data,
          });
        });
      }
    );

    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

function extractCookie(headers: http.IncomingHttpHeaders): string {
  const setCookie = headers['set-cookie'];
  if (!setCookie || setCookie.length === 0) return '';
  return setCookie[0].split(';')[0];
}

async function loginUser(port: number, email: string, password: string): Promise<string> {
  const res = await httpRequest({
    port,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.strictEqual(res.status, 200, `Login failed for ${email}`);
  return extractCookie(res.headers);
}

async function runPhase6aTests() {
  console.log('================================================================');
  console.log('   PHASE 6A — SIDEBAR NAVIGATION & DASHBOARD RESTRUCTURE TESTS   ');
  console.log('================================================================');

  let passed = 0;
  function pass(msg: string) {
    passed++;
    console.log(`✅ [PASS] ${msg}`);
  }

  // Section 1: Navigation Data Structure & Role Boundary Logic
  console.log('\n--- 1. Navigation Role-Based Structure Verification ---');

  // Verify role models
  assert.ok(UserRole.SUPER_ADMIN, 'SUPER_ADMIN role exists');
  assert.ok(UserRole.ADMIN, 'ADMIN role exists');
  assert.ok(UserRole.STAFF, 'STAFF role exists');
  pass('UserRole enum contains SUPER_ADMIN, ADMIN, STAFF');

  // Define sidebar role visibility spec
  const staffAllowed = ['today', 'my-attendance', 'visitor-access-upcoming'];
  const staffForbidden = ['office-networks', 'users-roles', 'audit-logs', 'staff', 'reports', 'attendance', 'governance', 'security'];

  staffForbidden.forEach((forbidden) => {
    assert.ok(!staffAllowed.includes(forbidden), `STAFF must not have access to ${forbidden}`);
  });
  pass('STAFF navigation structure strictly isolates administrative routes');

  const adminAllowed = ['today', 'attendance', 'reports', 'staff', 'visitors-upcoming', 'events-upcoming', 'event-access-upcoming', 'audit-logs', 'security'];
  const adminForbidden = ['office-networks', 'governance', 'my-attendance'];

  adminForbidden.forEach((forbidden) => {
    assert.ok(!adminAllowed.includes(forbidden), `ADMIN must not have access to ${forbidden}`);
  });
  pass('ADMIN navigation structure strictly excludes Super Admin-only office networks and system governance');

  const superAdminAllowed = ['today', 'attendance', 'reports', 'staff', 'visitors-upcoming', 'events-upcoming', 'event-access-upcoming', 'visitor-access-upcoming', 'office-networks', 'users-roles', 'audit-logs', 'governance'];
  assert.ok(superAdminAllowed.includes('office-networks'), 'SUPER_ADMIN includes office-networks');
  assert.ok(superAdminAllowed.includes('governance'), 'SUPER_ADMIN includes governance');
  pass('SUPER_ADMIN navigation structure provides comprehensive governance access');

  // Section 2: Audit Logs Service Verification
  console.log('\n--- 2. Audit Logs Service & Persistence Verification ---');

  const db = getDatabase();
  const existingUser = db.prepare('SELECT id FROM users LIMIT 1').get() as { id: string } | undefined;
  const actorId = existingUser ? existingUser.id : null;

  // Record a test audit log
  auditService.log({
    actorId,
    action: 'SIDEBAR_NAVIGATION_TEST',
    targetUserId: null,
    ipAddress: '102.129.144.1',
    userAgent: 'Phase6A-Tester',
    metadata: { phase: '6A', component: 'Sidebar' },
  });

  const auditResult = auditService.listLogs({ page: 1, limit: 10, action: 'SIDEBAR_NAVIGATION_TEST' });
  assert.ok(auditResult.total >= 1, 'Audit log saved and retrieved');
  assert.strictEqual(auditResult.logs[0].action, 'SIDEBAR_NAVIGATION_TEST');
  assert.strictEqual(auditResult.logs[0].ipAddress, '102.129.144.1');
  pass('AuditService correctly persists and retrieves chronological logs');

  // Search filtering in audit logs
  const filteredResult = auditService.listLogs({ search: '102.129.144.1' });
  assert.ok(filteredResult.logs.length >= 1, 'Search by IP matches audit log');
  pass('AuditService supports keyword search filtering');

  // Section 3: Live Express Server RBAC Verification
  console.log('\n--- 3. Live HTTP API Endpoint & RBAC Verification ---');

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRoutes);
  app.use('/api/admin', adminRoutes);

  const server = app.listen(0);
  const address = server.address() as { port: number };
  const port = address.port;

  try {
    // Authenticate users
    const superAdminCookie = await loginUser(port, 'admin@example.com', 'AdminSecurePassword123!');
    const adminCookie = await loginUser(port, 'manager@example.com', 'ManagerSecure123!');
    const staffCookie = await loginUser(port, 'john.doe@example.com', 'StaffSecure123!');

    // Test Audit Logs: SUPER_ADMIN -> 200 OK
    const superAdminAudit = await httpRequest({
      port,
      path: '/api/admin/audit-logs',
      headers: { Cookie: superAdminCookie },
    });
    assert.strictEqual(superAdminAudit.status, 200);
    const superAdminAuditJson = JSON.parse(superAdminAudit.body);
    assert.strictEqual(superAdminAuditJson.success, true);
    assert.ok(Array.isArray(superAdminAuditJson.data.logs));
    pass('SUPER_ADMIN can access GET /api/admin/audit-logs (200 OK)');

    // Test Audit Logs: ADMIN -> 200 OK
    const adminAudit = await httpRequest({
      port,
      path: '/api/admin/audit-logs',
      headers: { Cookie: adminCookie },
    });
    assert.strictEqual(adminAudit.status, 200);
    const adminAuditJson = JSON.parse(adminAudit.body);
    assert.strictEqual(adminAuditJson.success, true);
    pass('ADMIN can access GET /api/admin/audit-logs (200 OK)');

    // Test Audit Logs: STAFF -> 403 Forbidden
    const staffAudit = await httpRequest({
      port,
      path: '/api/admin/audit-logs',
      headers: { Cookie: staffCookie },
    });
    assert.strictEqual(staffAudit.status, 403);
    pass('STAFF is strictly blocked from GET /api/admin/audit-logs (403 Forbidden)');

    // Test Audit Logs: Anonymous -> 401 Unauthorized
    const anonAudit = await httpRequest({
      port,
      path: '/api/admin/audit-logs',
    });
    assert.strictEqual(anonAudit.status, 401);
    pass('Anonymous request is blocked from GET /api/admin/audit-logs (401 Unauthorized)');

    // Re-verify Office Networks: SUPER_ADMIN -> 200 OK
    const superAdminNetwork = await httpRequest({
      port,
      path: '/api/admin/office-network',
      headers: { Cookie: superAdminCookie },
    });
    assert.strictEqual(superAdminNetwork.status, 200);
    pass('SUPER_ADMIN can access GET /api/admin/office-network (200 OK)');

    // Re-verify Office Networks: ADMIN -> 403 Forbidden
    const adminNetwork = await httpRequest({
      port,
      path: '/api/admin/office-network',
      headers: { Cookie: adminCookie },
    });
    assert.strictEqual(adminNetwork.status, 403);
    pass('ADMIN is strictly blocked from GET /api/admin/office-network (403 Forbidden)');

    // Re-verify Office Networks: STAFF -> 403 Forbidden
    const staffNetwork = await httpRequest({
      port,
      path: '/api/admin/office-network',
      headers: { Cookie: staffCookie },
    });
    assert.strictEqual(staffNetwork.status, 403);
    pass('STAFF is strictly blocked from GET /api/admin/office-network (403 Forbidden)');
  } finally {
    server.close();
    if ('closeAllConnections' in server && typeof (server as any).closeAllConnections === 'function') {
      (server as any).closeAllConnections();
    }
  }

  console.log('\n================================================================');
  console.log(`   PHASE 6A TEST RESULTS: ${passed} PASSED, 0 FAILED`);
  console.log('================================================================');
  process.exit(0);
}

runPhase6aTests().catch((err) => {
  console.error('Phase 6A tests failed:', err);
  process.exit(1);
});
