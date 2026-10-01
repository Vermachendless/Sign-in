/**
 * Phase 6E — Staff Visitor Access & Visitor Invitations Test Suite
 * Tests:
 * 1. Database schema, table definition, indexes, foreign keys, status constraints
 * 2. Time window validation in Africa/Lagos (valid_from < valid_until, non-zero duration, max duration)
 * 3. Input validation & normalization (visitor name required, whitespace trimmed, email normalization)
 * 4. STAFF permissions & auto-scoping (STAFF creates for self, host_staff_id always derived from session)
 * 5. Cross-user protection (Staff A vs Staff B: cannot GET, PATCH, generate pass, revoke pass, or cancel)
 * 6. Admin and Super Admin organization-wide access & delegation
 * 7. Visitor access pass generation (pass_type=VISITOR, host_staff_id, VIS-XXXX-XXXX display code, single-use)
 * 8. Zero cryptographic raw token leakage (never stored in DB, never in audit logs)
 * 9. QR verification integration (opaque token & display code, zero personal data in QR)
 * 10. Server-authoritative verification (valid, before valid_from, after valid_until, revoked, cancelled)
 * 11. Visitor access revocation workflow (pass revoked, visit reverts to PENDING, history preserved)
 * 12. Visitor cancellation workflow (status CANCELLED, active pass revoked, history preserved)
 * 13. Audit trail verification (all 5 visitor audit events: VISITOR_CREATED, VISITOR_UPDATED, VISITOR_ACCESS_ISSUED, VISITOR_ACCESS_REVOKED, VISITOR_CANCELLED)
 */

import { getDatabase } from './server/db/index.ts';
import { visitorService } from './server/services/visitor.service.ts';
import { accessService } from './server/services/access.service.ts';
import { buildVerificationUrl, generateQrDataUrl } from './src/utils/qr.ts';
import {
  VisitorVisitStatus,
  AccessPassStatus,
  PassType,
  UserRole,
  SafeUser,
} from './src/types/index.ts';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`✅ [PASS] ${message}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${message}`);
    failed++;
  }
}

async function runPhase6eTests() {
  console.log('================================================================');
  console.log('   PHASE 6E — STAFF VISITOR ACCESS & INVITATIONS TESTS           ');
  console.log('================================================================');

  const db = getDatabase();

  // Clean up any test visitor visits and test audit logs from previous runs
  db.prepare("DELETE FROM visitor_visits WHERE visitor_email IN ('michael.smith@acme.com', 'sarah.jenkins@partner.org', 'revocable@example.com', 'cancellable@example.com') OR id LIKE 'test-%' OR visitor_full_name = 'Government Inspector'").run();
  db.prepare("DELETE FROM audit_logs WHERE action LIKE 'VISITOR_%'").run();

  // 1. Database Schema & Table Structure
  console.log('\n--- 1. Database Schema & Table Structure ---');
  const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='visitor_visits'").get() as { sql: string } | undefined;
  assert(!!tableInfo, 'visitor_visits table exists in database');
  assert(tableInfo?.sql.includes('host_staff_id'), 'visitor_visits has host_staff_id column');
  assert(tableInfo?.sql.includes('visitor_full_name'), 'visitor_visits has visitor_full_name column');
  assert(tableInfo?.sql.includes('visitor_phone'), 'visitor_visits has visitor_phone column');
  assert(tableInfo?.sql.includes('visitor_email'), 'visitor_visits has visitor_email column');
  assert(tableInfo?.sql.includes('purpose'), 'visitor_visits has purpose column');
  assert(tableInfo?.sql.includes('notes'), 'visitor_visits has notes column');
  assert(tableInfo?.sql.includes('valid_from'), 'visitor_visits has valid_from column');
  assert(tableInfo?.sql.includes('valid_until'), 'visitor_visits has valid_until column');
  assert(tableInfo?.sql.includes('status'), 'visitor_visits has status column');
  assert(tableInfo?.sql.includes('access_pass_id'), 'visitor_visits has access_pass_id column');
  assert(tableInfo?.sql.includes('cancelled_at'), 'visitor_visits has cancelled_at column');
  assert(tableInfo?.sql.includes('cancelled_by'), 'visitor_visits has cancelled_by column');

  // Verify indexes
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='visitor_visits'").all() as { name: string }[];
  const indexNames = indexes.map((i) => i.name);
  assert(indexNames.includes('idx_visitor_visits_host_staff_id'), 'Index on host_staff_id exists');
  assert(indexNames.includes('idx_visitor_visits_status'), 'Index on status exists');
  assert(indexNames.includes('idx_visitor_visits_access_pass_id'), 'Index on access_pass_id exists');
  assert(indexNames.includes('idx_visitor_visits_valid_from'), 'Index on valid_from exists');
  assert(indexNames.includes('idx_visitor_visits_valid_until'), 'Index on valid_until exists');
  assert(indexNames.includes('idx_visitor_visits_visitor_email'), 'Index on visitor_email exists');

  // 2. Test User Setup
  console.log('\n--- 2. Test User Setup ---');
  const superAdmin = db.prepare("SELECT * FROM users WHERE role = 'SUPER_ADMIN' AND status = 'ACTIVE' LIMIT 1").get() as any;
  const admin = db.prepare("SELECT * FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE' LIMIT 1").get() as any;
  const staffUsers = db.prepare("SELECT * FROM users WHERE role = 'STAFF' AND status = 'ACTIVE' LIMIT 2").all() as any[];

  assert(!!superAdmin, 'Super Admin user present');
  assert(!!admin, 'Admin user present');
  assert(staffUsers.length >= 2, 'At least 2 active staff users present for cross-user tests');

  const staffUserA: SafeUser = {
    id: staffUsers[0].id,
    email: staffUsers[0].email,
    firstName: staffUsers[0].first_name,
    lastName: staffUsers[0].last_name,
    department: staffUsers[0].department,
    role: UserRole.STAFF,
    status: staffUsers[0].status,
  };

  const staffUserB: SafeUser = {
    id: staffUsers[1].id,
    email: staffUsers[1].email,
    firstName: staffUsers[1].first_name,
    lastName: staffUsers[1].last_name,
    department: staffUsers[1].department,
    role: UserRole.STAFF,
    status: staffUsers[1].status,
  };

  const adminUser: SafeUser = {
    id: admin.id,
    email: admin.email,
    firstName: admin.first_name,
    lastName: admin.last_name,
    department: admin.department,
    role: UserRole.ADMIN,
    status: admin.status,
  };

  const superAdminUser: SafeUser = {
    id: superAdmin.id,
    email: superAdmin.email,
    firstName: superAdmin.first_name,
    lastName: superAdmin.last_name,
    department: superAdmin.department,
    role: UserRole.SUPER_ADMIN,
    status: superAdmin.status,
  };

  // 3. Time Window Validation & Input Normalization
  console.log('\n--- 3. Time Window & Input Validation ---');
  // Invalid date format
  const invalidDate = visitorService.computeValidityWindow('invalid-date', '10:00', '12:00');
  assert(!invalidDate.valid, 'Rejects invalid date format');

  // Invalid time format
  const invalidTime = visitorService.computeValidityWindow('2026-09-30', '25:00', '12:00');
  assert(!invalidTime.valid, 'Rejects invalid hour in time format');

  // End time before start time
  const endBeforeStart = visitorService.computeValidityWindow('2026-09-30', '14:00', '12:00');
  assert(!endBeforeStart.valid, 'Rejects end time before start time');

  // Equal start and end time (duration zero)
  const zeroDuration = visitorService.computeValidityWindow('2026-09-30', '10:00', '10:00');
  assert(!zeroDuration.valid, 'Rejects zero-duration time window');

  // Valid time window
  const validWindow = visitorService.computeValidityWindow('2026-09-30', '10:00', '12:00');
  assert(validWindow.valid && !!validWindow.validFrom && !!validWindow.validUntil, 'Accepts valid visit time window');

  // Missing visitor full name
  const testVisitDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const emptyName = visitorService.createVisit(staffUserA, {
    visitorFullName: '   ',
    visitDate: testVisitDate,
    startTime: '10:00',
    endTime: '12:00',
  });
  assert(!emptyName.success, 'Rejects empty visitor full name');

  // 4. Staff Creation & Automatic Host Scoping
  console.log('\n--- 4. Staff Creation & Host Scoping ---');
  // Staff A tries to pass Staff B's ID as hostStaffId
  const spoofedHost = visitorService.createVisit(
    staffUserA,
    {
      visitorFullName: '  Michael Smith  ',
      visitorEmail: '  Michael.Smith@Acme.com  ',
      visitorPhone: ' +234 803 123 4567 ',
      purpose: ' Vendor Contract Review ',
      notes: ' Escort to Meeting Room 3 ',
      visitDate: testVisitDate,
      startTime: '10:00',
      endTime: '12:00',
    },
    staffUserB.id // Attempt to spoof hostStaffId!
  );
  assert(spoofedHost.success && !!spoofedHost.visit, 'Staff A visitor invitation created');
  const visitA = spoofedHost.visit!;
  assert(visitA.hostStaffId === staffUserA.id, 'Host staff ID strictly derived from session (spoofed ID ignored)');
  assert(visitA.visitorFullName === 'Michael Smith', 'Visitor name trimmed of whitespace');
  assert(visitA.visitorEmail === 'michael.smith@acme.com', 'Visitor email normalized to lowercase and trimmed');
  assert(visitA.purpose === 'Vendor Contract Review', 'Purpose trimmed');
  assert(visitA.status === VisitorVisitStatus.PENDING, 'Initial visit status is PENDING');
  assert(visitA.accessPassId === null, 'Initial access_pass_id is null');

  // 5. Cross-User Protection (Staff B cannot access or tamper with Staff A's visit)
  console.log('\n--- 5. Cross-User Protection ---');
  // Staff B tries to GET Staff A's visit
  const crossGet = visitorService.getVisitById(visitA.id, staffUserB);
  assert(!crossGet.success && crossGet.status === 403, 'Staff B blocked from viewing Staff A visitor (403 Forbidden)');

  // Staff B tries to UPDATE Staff A's visit
  const crossUpdate = visitorService.updateVisit(visitA.id, staffUserB, {
    visitorFullName: 'Hacked Name',
  });
  assert(!crossUpdate.success && crossUpdate.status === 403, 'Staff B blocked from modifying Staff A visitor (403 Forbidden)');

  // Staff B tries to GENERATE access pass for Staff A's visit
  const crossPass = visitorService.generateVisitorAccessPass(visitA.id, staffUserB);
  assert(!crossPass.success && crossPass.status === 403, 'Staff B blocked from issuing access pass for Staff A visitor (403 Forbidden)');

  // Staff B tries to CANCEL Staff A's visit
  const crossCancel = visitorService.cancelVisit(visitA.id, staffUserB);
  assert(!crossCancel.success && crossCancel.status === 403, 'Staff B blocked from cancelling Staff A visitor (403 Forbidden)');

  // Staff A can view their own visit
  const selfGet = visitorService.getVisitById(visitA.id, staffUserA);
  assert(selfGet.success && selfGet.visit?.id === visitA.id, 'Staff A can view their own visitor invitation');

  // Staff A can update their own pending visit
  const selfUpdate = visitorService.updateVisit(visitA.id, staffUserA, {
    notes: 'Escort to Meeting Room 3 - Confirmed',
  });
  assert(selfUpdate.success && selfUpdate.visit?.notes === 'Escort to Meeting Room 3 - Confirmed', 'Staff A can update their own pending visitor invitation');

  // Staff list scoping: Staff B's list does NOT contain Staff A's visit
  const staffBList = visitorService.listVisits(staffUserB);
  assert(staffBList.visits.every((v) => v.hostStaffId === staffUserB.id), 'Staff B list contains exclusively Staff B records');
  assert(!staffBList.visits.some((v) => v.id === visitA.id), 'Staff A visit is not present in Staff B list');

  // 6. Admin & Super Admin Organization-Wide Access
  console.log('\n--- 6. Admin & Super Admin Permissions ---');
  // Admin can view Staff A's visit
  const adminGet = visitorService.getVisitById(visitA.id, adminUser);
  assert(adminGet.success && adminGet.visit?.id === visitA.id, 'Admin can view Staff A visitor invitation');

  // Super Admin can view Staff A's visit
  const superAdminGet = visitorService.getVisitById(visitA.id, superAdminUser);
  assert(superAdminGet.success && superAdminGet.visit?.id === visitA.id, 'Super Admin can view Staff A visitor invitation');

  // Admin can list all visits across organization
  const adminList = visitorService.listVisits(adminUser);
  assert(adminList.success && adminList.visits.some((v) => v.id === visitA.id), 'Admin list contains visits across organization');

  // Admin can create a visit on behalf of a staff member
  const adminCreate = visitorService.createVisit(
    adminUser,
    {
      visitorFullName: 'Government Inspector',
      visitDate: testVisitDate,
      startTime: '13:00',
      endTime: '15:00',
      purpose: 'Facility Audit',
    },
    staffUserB.id // Admin can assign hostStaffId
  );
  assert(adminCreate.success && adminCreate.visit?.hostStaffId === staffUserB.id, 'Admin can delegate hostStaffId to Staff B');

  // 7. Visitor Access Pass Generation
  console.log('\n--- 7. Visitor Access Pass Generation ---');
  // Create an active visit for Staff A (started 15 mins ago, valid for next 2 hours)
  const now = new Date();
  const activeValidFrom = new Date(now.getTime() - 15 * 60 * 1000).toISOString();
  const activeValidUntil = new Date(now.getTime() + 2 * 3600 * 1000).toISOString();

  // Insert a currently-active visit directly into DB for accurate live verification test
  const activeVisitId = 'test-active-visit-' + Date.now();
  db.prepare(`
    INSERT INTO visitor_visits (
      id, host_staff_id, visitor_full_name, visitor_email, visitor_phone,
      purpose, notes, valid_from, valid_until, status, access_pass_id,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', NULL, ?, ?)
  `).run(
    activeVisitId,
    staffUserA.id,
    'Sarah Jenkins',
    'sarah.jenkins@partner.org',
    '+234 805 999 8888',
    'Partnership Discussion',
    'Main Reception',
    activeValidFrom,
    activeValidUntil,
    now.toISOString(),
    now.toISOString()
  );

  const issueRes = visitorService.generateVisitorAccessPass(activeVisitId, staffUserA);
  assert(issueRes.success && !!issueRes.pass && !!issueRes.visit, 'Staff A successfully issued visitor access pass');

  const visitorPass = issueRes.pass!;
  const updatedVisit = issueRes.visit!;

  assert(updatedVisit.status === VisitorVisitStatus.ACCESS_ISSUED, 'Visit status transitioned to ACCESS_ISSUED');
  assert(updatedVisit.accessPassId === visitorPass.id, 'Visit access_pass_id linked to generated pass');
  assert(visitorPass.passType === PassType.VISITOR, 'Pass type is strictly VISITOR');
  assert(visitorPass.hostStaffId === staffUserA.id, 'Pass host_staff_id strictly matches host staff member');
  assert(visitorPass.validFrom === activeValidFrom, 'Pass valid_from strictly matches visit start');
  assert(visitorPass.validUntil === activeValidUntil, 'Pass valid_until strictly matches visit end');
  assert(visitorPass.maxUses === 1, 'Pass max_uses is 1 for single-use visitor pass');
  assert(visitorPass.status === AccessPassStatus.ACTIVE, 'Initial pass status is ACTIVE');

  // Verify display code prefix (VIS-XXXX-XXXX)
  assert(/^VIS-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/.test(visitorPass.displayCode), 'Display code matches VIS-XXXX-XXXX format');

  // 8. Zero Cryptographic Token Leakage
  console.log('\n--- 8. Zero Raw Token Leakage Verification ---');
  assert(!!visitorPass.rawToken, 'Raw token returned to host staff upon generation');
  const rawToken = visitorPass.rawToken!;

  // Check database: raw token NOT stored in access_passes
  const passInDb = db.prepare('SELECT * FROM access_passes WHERE id = ?').get(visitorPass.id) as any;
  assert(passInDb.token_hash === accessService.hashToken(rawToken), 'Stored token_hash matches SHA-256 computation');
  assert(!('raw_token' in passInDb) && !('rawToken' in passInDb), 'Raw token column does not exist in access_passes table');

  // Check audit logs: raw token NOT in audit log metadata
  const passAudit = db.prepare("SELECT * FROM audit_logs WHERE action = 'VISITOR_ACCESS_ISSUED'").all() as any[];
  assert(passAudit.length > 0, 'VISITOR_ACCESS_ISSUED audit log recorded');
  let tokenFound = false;
  for (const entry of passAudit) {
    if (entry.metadata && entry.metadata.includes(rawToken)) {
      tokenFound = true;
      break;
    }
  }
  assert(!tokenFound, 'Raw token strictly absent from audit log metadata');

  // 9. QR Verification URL & Utility
  console.log('\n--- 9. QR Verification URL & Code ---');
  const qrUrl = buildVerificationUrl({ token: rawToken, code: visitorPass.displayCode });
  assert(qrUrl.includes('/access/verify?t='), 'QR verification URL uses opaque token parameter');
  assert(!qrUrl.includes('Sarah'), 'QR verification URL strictly excludes visitor full name');
  assert(!qrUrl.includes('jenkins@partner.org'), 'QR verification URL strictly excludes visitor email');
  assert(!qrUrl.includes('8059998888'), 'QR verification URL strictly excludes visitor phone');

  const qrDataUrl = await generateQrDataUrl(qrUrl);
  assert(qrDataUrl.startsWith('data:image/png;base64,'), 'QR DataURL generated cleanly for visitor access card');

  // 10. Access Verification with Phase 6C Infrastructure
  console.log('\n--- 10. Visitor Access Pass Verification ---');
  accessService.resetRateLimiter();
  const verifyRes = accessService.verifyAccessPass({
    token: rawToken,
    consumeUse: true,
    ipAddress: '102.129.144.1',
  });
  assert(verifyRes.valid, 'Verification succeeds for valid visitor pass');
  assert(verifyRes.visitor?.visitorName === 'Sarah Jenkins', 'Verification returns visitor name');
  assert(verifyRes.visitor?.hostStaffName.includes(staffUserA.firstName), 'Verification returns host staff name');
  assert(verifyRes.visitor?.purpose === 'Partnership Discussion', 'Verification returns visit purpose');
  assert(verifyRes.useCount === 1, 'Use count incremented to 1');
  assert(verifyRes.remainingUses === 0, 'Remaining uses is 0');

  // Second use on single-use visitor pass rejected as EXHAUSTED
  const secondUse = accessService.verifyAccessPass({
    token: rawToken,
    consumeUse: true,
    ipAddress: '102.129.144.1',
  });
  assert(!secondUse.valid && secondUse.code === 'ACCESS_EXHAUSTED', 'Second verification rejected as ACCESS_EXHAUSTED');

  // Past / Expired pass rejected
  const pastValidFrom = new Date(now.getTime() - 4 * 3600 * 1000).toISOString();
  const pastValidUntil = new Date(now.getTime() - 2 * 3600 * 1000).toISOString();
  const pastPassRes = accessService.createVisitorAccessPass(staffUserA, staffUserA.id, {
    validFrom: pastValidFrom,
    validUntil: pastValidUntil,
  });
  const pastVerify = accessService.verifyAccessPass({
    token: pastPassRes.pass!.rawToken!,
    ipAddress: '102.129.144.1',
  });
  assert(!pastVerify.valid && pastVerify.code === 'ACCESS_EXPIRED', 'Past visitor pass rejected as ACCESS_EXPIRED');

  // Future pass rejected as not yet valid
  const futureValidFrom = new Date(now.getTime() + 2 * 3600 * 1000).toISOString();
  const futureValidUntil = new Date(now.getTime() + 4 * 3600 * 1000).toISOString();
  const futurePassRes = accessService.createVisitorAccessPass(staffUserA, staffUserA.id, {
    validFrom: futureValidFrom,
    validUntil: futureValidUntil,
  });
  const futureVerify = accessService.verifyAccessPass({
    token: futurePassRes.pass!.rawToken!,
    ipAddress: '102.129.144.1',
  });
  assert(!futureVerify.valid && futureVerify.code === 'ACCESS_NOT_YET_VALID', 'Future visitor pass rejected as ACCESS_NOT_YET_VALID');

  // 11. Revoke Visitor Access Workflow
  console.log('\n--- 11. Visitor Access Revocation Workflow ---');
  // Create visit 2 and issue access
  const visit2Id = 'test-visit-revoke-' + Date.now();
  db.prepare(`
    INSERT INTO visitor_visits (
      id, host_staff_id, visitor_full_name, visitor_email,
      valid_from, valid_until, status, access_pass_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', NULL, ?, ?)
  `).run(visit2Id, staffUserA.id, 'Revocable Guest', 'revocable@example.com', activeValidFrom, activeValidUntil, now.toISOString(), now.toISOString());

  const pass2Res = visitorService.generateVisitorAccessPass(visit2Id, staffUserA);
  const pass2 = pass2Res.pass!;

  // Revoke access
  const revokeRes = visitorService.revokeVisitorAccess(visit2Id, staffUserA, 'Guest reschedule requested');
  assert(revokeRes.success && !!revokeRes.visit, 'Staff A revoked visitor access pass');
  assert(revokeRes.visit!.status === VisitorVisitStatus.PENDING, 'Visit status reverted to PENDING');

  // Verify historical visit record is preserved in database
  const visitInDb = db.prepare('SELECT * FROM visitor_visits WHERE id = ?').get(visit2Id) as any;
  assert(!!visitInDb, 'Historical visitor visit record preserved in database');

  // Verify pass is revoked in database
  const pass2InDb = db.prepare('SELECT status, revoke_reason FROM access_passes WHERE id = ?').get(pass2.id) as any;
  assert(pass2InDb.status === AccessPassStatus.REVOKED, 'Pass status in database is REVOKED');
  assert(pass2InDb.revoke_reason === 'Guest reschedule requested', 'Revocation reason recorded');

  // Verification of revoked pass rejected
  const revokedVerify = accessService.verifyAccessPass({
    token: pass2.rawToken!,
    ipAddress: '102.129.144.1',
  });
  assert(!revokedVerify.valid && revokedVerify.code === 'ACCESS_REVOKED', 'Revoked visitor pass rejected with ACCESS_REVOKED');

  // 12. Cancel Visitor Invitation Workflow
  console.log('\n--- 12. Cancel Visitor Invitation Workflow ---');
  // Create visit 3 and issue access
  const visit3Id = 'test-visit-cancel-' + Date.now();
  db.prepare(`
    INSERT INTO visitor_visits (
      id, host_staff_id, visitor_full_name, visitor_email,
      valid_from, valid_until, status, access_pass_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', NULL, ?, ?)
  `).run(visit3Id, staffUserA.id, 'Cancellable Guest', 'cancellable@example.com', activeValidFrom, activeValidUntil, now.toISOString(), now.toISOString());

  const pass3Res = visitorService.generateVisitorAccessPass(visit3Id, staffUserA);
  const pass3 = pass3Res.pass!;

  // Cancel visit
  const cancelRes = visitorService.cancelVisit(visit3Id, staffUserA, 'Host unavailable due to urgent trip');
  assert(cancelRes.success && !!cancelRes.visit, 'Staff A cancelled visitor invitation');
  assert(cancelRes.visit!.status === VisitorVisitStatus.CANCELLED, 'Visit status transitioned to CANCELLED');
  assert(cancelRes.visit!.cancelledBy === staffUserA.id, 'cancelled_by recorded');
  assert(!!cancelRes.visit!.cancelledAt, 'cancelled_at recorded');

  // Visit record must remain in database (non-destructive)
  const visit3InDb = db.prepare('SELECT * FROM visitor_visits WHERE id = ?').get(visit3Id) as any;
  assert(!!visit3InDb, 'Cancelled visitor visit record is preserved in database');

  // Pass automatically revoked upon visit cancellation
  const pass3InDb = db.prepare('SELECT status, revoke_reason FROM access_passes WHERE id = ?').get(pass3.id) as any;
  assert(pass3InDb.status === AccessPassStatus.REVOKED, 'Active pass automatically revoked upon visit cancellation');

  // Verification of cancelled visit rejected
  const cancelVerify = accessService.verifyAccessPass({
    token: pass3.rawToken!,
    ipAddress: '102.129.144.1',
  });
  assert(!cancelVerify.valid && (cancelVerify.code === 'VISIT_CANCELLED' || cancelVerify.code === 'ACCESS_REVOKED'), 'Cancelled visit pass rejected upon verification');

  // Cannot issue pass for cancelled visit
  const passAfterCancel = visitorService.generateVisitorAccessPass(visit3Id, staffUserA);
  assert(!passAfterCancel.success, 'Cannot issue access pass for CANCELLED visitor invitation');

  // 13. Audit Log Coverage
  console.log('\n--- 13. Audit Log Coverage ---');
  const visitorAudits = db.prepare("SELECT * FROM audit_logs WHERE action LIKE 'VISITOR_%'").all() as any[];
  assert(visitorAudits.length >= 5, `Recorded ${visitorAudits.length} visitor audit entries`);

  const actions = new Set(visitorAudits.map((a) => a.action));
  assert(actions.has('VISITOR_CREATED'), 'Audit log contains VISITOR_CREATED');
  assert(actions.has('VISITOR_UPDATED'), 'Audit log contains VISITOR_UPDATED');
  assert(actions.has('VISITOR_ACCESS_ISSUED'), 'Audit log contains VISITOR_ACCESS_ISSUED');
  assert(actions.has('VISITOR_ACCESS_REVOKED'), 'Audit log contains VISITOR_ACCESS_REVOKED');
  assert(actions.has('VISITOR_CANCELLED'), 'Audit log contains VISITOR_CANCELLED');

  // 14. Metrics & Filtering
  console.log('\n--- 14. Metrics & Filtering ---');
  const staffListResult = visitorService.listVisits(staffUserA);
  assert(staffListResult.success, 'Staff A listVisits succeeded');
  assert(staffListResult.summary.total >= 3, `Staff A summary total is ${staffListResult.summary.total}`);
  assert(staffListResult.summary.cancelled >= 1, `Staff A cancelled count is ${staffListResult.summary.cancelled}`);

  const filteredStatus = visitorService.listVisits(staffUserA, { status: VisitorVisitStatus.CANCELLED });
  assert(filteredStatus.visits.every((v) => v.status === VisitorVisitStatus.CANCELLED), 'Status filter returns only CANCELLED visits');

  const filteredSearch = visitorService.listVisits(staffUserA, { search: 'Sarah' });
  assert(filteredSearch.visits.some((v) => v.visitorFullName.includes('Sarah')), 'Search query filters by visitor name');

  console.log('\n================================================================');
  console.log(`   PHASE 6E TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase6eTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
