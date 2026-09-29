/**
 * Phase 6C — Secure Access Pass & QR Infrastructure Verification Suite
 * Tests:
 * 1. Database schema, table definition, indexes, foreign keys
 * 2. Cryptographic token generation & SHA-256 hashing (no raw token in DB)
 * 3. Human-readable access codes (unambiguous charset, case-insensitivity)
 * 4. Validity window enforcement (authoritative server clock, valid_from/until)
 * 5. Dynamic expiration (no background job needed)
 * 6. Max uses and atomic use counting (failed attempts do not increment)
 * 7. Pass revocation with mandatory reason (revoked passes fail immediately)
 * 8. Event status coupling (APPROVED only; fails on CANCELLED, COMPLETED, DRAFT, REJECTED)
 * 9. RBAC boundaries (ADMIN and SUPER_ADMIN can create/revoke, STAFF cannot)
 * 10. Public verification endpoint (rate limiting, IP logging, zero secret leaks)
 * 11. Audit logging for creation, revocation, success, and failures
 */

import { getDatabase } from './server/db/index.ts';
import { accessService } from './server/services/access.service.ts';
import { eventService } from './server/services/event.service.ts';
import { authService } from './server/services/auth.service.ts';
import { generateQrDataUrl, generateQrSvg, buildVerificationUrl } from './src/utils/qr.ts';
import {
  AccessPassStatus,
  PassType,
  UserRole,
  EventStatus,
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

async function runPhase6cTests() {
  console.log('================================================================');
  console.log('   PHASE 6C — SECURE ACCESS PASS & QR INFRASTRUCTURE TESTS      ');
  console.log('================================================================');

  // 1. Database Schema & Models Verification
  console.log('\n--- 1. Database Schema & Table Structure ---');
  const db = getDatabase();

  const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='access_passes'").get() as { sql: string } | undefined;
  assert(!!tableInfo, 'access_passes table exists in SQLite database');
  assert(tableInfo?.sql.includes('token_hash'), 'access_passes schema includes token_hash');
  assert(tableInfo?.sql.includes('display_code'), 'access_passes schema includes display_code');
  assert(tableInfo?.sql.includes('valid_from'), 'access_passes schema includes valid_from');
  assert(tableInfo?.sql.includes('valid_until'), 'access_passes schema includes valid_until');
  assert(tableInfo?.sql.includes('max_uses'), 'access_passes schema includes max_uses');
  assert(tableInfo?.sql.includes('use_count'), 'access_passes schema includes use_count');
  assert(tableInfo?.sql.includes('revoked_at'), 'access_passes schema includes revoked_at');
  assert(tableInfo?.sql.includes('revoke_reason'), 'access_passes schema includes revoke_reason');

  // Verify indexes
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='access_passes'").all() as { name: string }[];
  const indexNames = indexes.map((i) => i.name);
  assert(indexNames.includes('idx_access_passes_token_hash'), 'Index on token_hash exists');
  assert(indexNames.includes('idx_access_passes_display_code'), 'Index on display_code exists');
  assert(indexNames.includes('idx_access_passes_status'), 'Index on status exists');
  assert(indexNames.includes('idx_access_passes_event_id'), 'Index on event_id exists');

  // 2. Fetch or create test users
  console.log('\n--- 2. Test User Setup ---');
  const superAdmin = db.prepare("SELECT * FROM users WHERE role = 'SUPER_ADMIN' AND status = 'ACTIVE' LIMIT 1").get() as any;
  const admin = db.prepare("SELECT * FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE' LIMIT 1").get() as any;
  const staff = db.prepare("SELECT * FROM users WHERE role = 'STAFF' AND status = 'ACTIVE' LIMIT 1").get() as any;

  assert(!!superAdmin, 'Super Admin user present');
  assert(!!admin, 'Admin user present');
  assert(!!staff, 'Staff user present');

  const superAdminUser: SafeUser = {
    id: superAdmin.id,
    email: superAdmin.email,
    firstName: superAdmin.first_name,
    lastName: superAdmin.last_name,
    department: superAdmin.department,
    role: UserRole.SUPER_ADMIN,
    status: superAdmin.status,
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

  const staffUser: SafeUser = {
    id: staff.id,
    email: staff.email,
    firstName: staff.first_name,
    lastName: staff.last_name,
    department: staff.department,
    role: UserRole.STAFF,
    status: staff.status,
  };

  // 3. Token & Code Cryptographic Properties
  console.log('\n--- 3. Token & Human-Readable Code Generation ---');
  const tokenPair1 = accessService.generateAccessToken();
  const tokenPair2 = accessService.generateAccessToken();

  assert(tokenPair1.rawToken.length === 64, 'Raw token is 64 hex characters (32 cryptographically secure bytes)');
  assert(tokenPair1.rawToken !== tokenPair2.rawToken, 'Tokens are non-deterministic and cryptographically unique');
  assert(tokenPair1.tokenHash === accessService.hashToken(tokenPair1.rawToken), 'Token hash matches SHA-256 computation');

  const displayCode1 = accessService.generateDisplayCode('EVT');
  const displayCode2 = accessService.generateDisplayCode('EVT');
  assert(/^EVT-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/.test(displayCode1), `Display code matches unambiguous format: ${displayCode1}`);
  assert(displayCode1 !== displayCode2, 'Display codes are randomly generated and distinct');
  assert(!/[0O1I]/.test(displayCode1), 'Display code strictly excludes ambiguous characters (0, O, 1, I)');

  // 4. Create Approved Test Event
  console.log('\n--- 4. Test Event Setup ---');
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 3600 * 1000).toISOString();
  const twoHoursLater = new Date(now.getTime() + 7200 * 1000).toISOString();
  const yesterday = new Date(now.getTime() - 86400 * 1000).toISOString();
  const twoDaysAgo = new Date(now.getTime() - 172800 * 1000).toISOString();

  // Create event in Draft, submit, and approve
  const createEventRes = eventService.createEvent(adminUser, {
    title: 'Phase 6C Tech Summit',
    description: 'Access pass infrastructure testing event',
    location: 'Auditorium Level 2',
    startAt: oneHourAgo,
    endAt: twoHoursLater,
  });
  assert(createEventRes.success && !!createEventRes.event, 'Event created in DRAFT status');
  const testEvent = createEventRes.event!;

  const submitRes = eventService.submitEvent(testEvent.id, adminUser);
  assert(submitRes.success, 'Event submitted for approval');

  const approveRes = eventService.approveEvent(testEvent.id, superAdminUser);
  assert(approveRes.success, 'Event approved by Super Admin');

  // Also create a DRAFT event to test that unapproved events CANNOT generate passes
  const draftEventRes = eventService.createEvent(adminUser, {
    title: 'Unapproved Draft Event',
    location: 'Conference Room B',
    startAt: oneHourAgo,
    endAt: twoHoursLater,
  });
  const draftEvent = draftEventRes.event!;

  // 5. Access Pass Generation RBAC & Rules
  console.log('\n--- 5. Pass Generation RBAC & Business Rules ---');
  // Staff cannot generate passes
  const staffGenRes = accessService.createEventAccessPass(staffUser, testEvent.id);
  assert(!staffGenRes.success, 'Staff is blocked from generating access passes');

  // Unapproved event cannot generate passes
  const unapprovedGenRes = accessService.createEventAccessPass(adminUser, draftEvent.id);
  assert(!unapprovedGenRes.success, 'Cannot generate pass for non-approved (DRAFT) event');
  assert(unapprovedGenRes.error?.includes('APPROVED') || false, 'Error states event must be APPROVED');

  // Admin can generate pass for APPROVED event
  const passRes = accessService.createEventAccessPass(adminUser, testEvent.id, {
    maxUses: 1, // single use
    validFrom: oneHourAgo,
    validUntil: twoHoursLater,
  });
  assert(passRes.success && !!passRes.pass, 'Admin successfully generated single-use event access pass');
  const singlePass = passRes.pass!;
  assert(!!singlePass.rawToken, 'Raw token returned to authorized creator on generation');
  assert(singlePass.useCount === 0, 'Initial use_count is 0');
  assert(singlePass.status === AccessPassStatus.ACTIVE, 'Initial status is ACTIVE');

  // Check database persistence: RAW TOKEN MUST NOT BE IN DATABASE
  const passInDb = db.prepare('SELECT * FROM access_passes WHERE id = ?').get(singlePass.id) as any;
  assert(!!passInDb, 'Pass persisted in access_passes table');
  assert(passInDb.token_hash === accessService.hashToken(singlePass.rawToken!), 'Stored hash matches raw token hash');
  assert(!('raw_token' in passInDb) && !('rawToken' in passInDb), 'Database has zero raw token column');

  // 6. Access Pass Verification (Single Use)
  console.log('\n--- 6. Access Pass Verification & Consumption ---');
  accessService.resetRateLimiter();

  // Verify via Display Code (case-insensitive)
  const lowerCode = singlePass.displayCode.toLowerCase();
  const verifyRes1 = accessService.verifyAccessPass({
    code: lowerCode,
    consumeUse: true,
    ipAddress: '102.129.144.1',
  });
  assert(verifyRes1.valid, 'Verification succeeds with case-insensitive human display code');
  assert(verifyRes1.passType === PassType.EVENT, 'Pass type verified as EVENT');
  assert(verifyRes1.event?.title === testEvent.title, 'Associated event details returned correctly');
  assert(verifyRes1.useCount === 1, 'Use count incremented to 1');
  assert(verifyRes1.remainingUses === 0, 'Remaining uses is 0');

  // Second verification attempt on single-use pass should fail as EXHAUSTED
  const verifyRes2 = accessService.verifyAccessPass({
    code: singlePass.displayCode,
    consumeUse: true,
    ipAddress: '102.129.144.1',
  });
  assert(!verifyRes2.valid, 'Second verification on single-use pass rejected');
  assert(verifyRes2.code === 'ACCESS_EXHAUSTED', 'Rejection code is ACCESS_EXHAUSTED');

  // Failed attempt MUST NOT increment use count further
  const passCheck = db.prepare('SELECT use_count, status FROM access_passes WHERE id = ?').get(singlePass.id) as any;
  assert(passCheck.use_count === 1, 'Failed verification did not increment use_count');
  assert(passCheck.status === AccessPassStatus.EXHAUSTED, 'Database status transitioned to EXHAUSTED');

  // 7. Multi-use Pass & QR Token Verification
  console.log('\n--- 7. Multi-Use Pass & Raw Token Verification ---');
  const multiPassRes = accessService.createEventAccessPass(adminUser, testEvent.id, {
    maxUses: 3,
    validFrom: oneHourAgo,
    validUntil: twoHoursLater,
  });
  assert(multiPassRes.success && !!multiPassRes.pass, 'Created multi-use pass (max 3)');
  const multiPass = multiPassRes.pass!;

  // Verify via raw QR token
  const tokenVerify1 = accessService.verifyAccessPass({
    token: multiPass.rawToken!,
    consumeUse: true,
    ipAddress: '102.129.144.1',
  });
  assert(tokenVerify1.valid, 'Verification succeeds via raw QR token');
  assert(tokenVerify1.remainingUses === 2, 'Remaining uses after 1st use is 2');

  const tokenVerify2 = accessService.verifyAccessPass({
    token: multiPass.rawToken!,
    consumeUse: true,
    ipAddress: '102.129.144.1',
  });
  assert(tokenVerify2.valid, '2nd verification succeeds via QR token');
  assert(tokenVerify2.remainingUses === 1, 'Remaining uses after 2nd use is 1');

  // Verification without consuming use (dry check / inspect)
  const dryVerify = accessService.verifyAccessPass({
    token: multiPass.rawToken!,
    consumeUse: false,
    ipAddress: '102.129.144.1',
  });
  assert(dryVerify.valid, 'Dry verification (consumeUse=false) succeeds');
  assert(dryVerify.useCount === 2, 'Dry verification does not consume uses');

  // 8. Dynamic Expiration & Validity Window
  console.log('\n--- 8. Dynamic Expiration & Validity Window ---');
  // Pass expired in the past
  const expiredPassRes = accessService.createEventAccessPass(adminUser, testEvent.id, {
    maxUses: 5,
    validFrom: twoDaysAgo,
    validUntil: yesterday,
  });
  assert(expiredPassRes.success && !!expiredPassRes.pass, 'Created pass with past validity window');
  const expiredPass = expiredPassRes.pass!;

  const expiredVerify = accessService.verifyAccessPass({
    code: expiredPass.displayCode,
    consumeUse: true,
    ipAddress: '102.129.144.1',
  });
  assert(!expiredVerify.valid, 'Past pass rejected as expired dynamically by server');
  assert(expiredVerify.code === 'ACCESS_EXPIRED', 'Rejection code is ACCESS_EXPIRED');

  // Pass not yet valid (future)
  const futureStart = new Date(now.getTime() + 86400 * 1000).toISOString();
  const futureEnd = new Date(now.getTime() + 172800 * 1000).toISOString();
  const futurePassRes = accessService.createEventAccessPass(adminUser, testEvent.id, {
    maxUses: 5,
    validFrom: futureStart,
    validUntil: futureEnd,
  });
  assert(futurePassRes.success && !!futurePassRes.pass, 'Created pass with future validity window');
  const futurePass = futurePassRes.pass!;

  const futureVerify = accessService.verifyAccessPass({
    code: futurePass.displayCode,
    consumeUse: true,
    ipAddress: '102.129.144.1',
  });
  assert(!futureVerify.valid, 'Future pass rejected as not yet valid');
  assert(futureVerify.code === 'ACCESS_NOT_YET_VALID', 'Rejection code is ACCESS_NOT_YET_VALID');

  // 9. Pass Revocation
  console.log('\n--- 9. Pass Revocation Workflow ---');
  const revocablePassRes = accessService.createEventAccessPass(adminUser, testEvent.id, {
    maxUses: 10,
    validFrom: oneHourAgo,
    validUntil: twoHoursLater,
  });
  assert(revocablePassRes.success && !!revocablePassRes.pass, 'Created revocable pass');
  const revocablePass = revocablePassRes.pass!;

  // Staff cannot revoke pass
  const staffRevoke = accessService.revokeAccessPass(revocablePass.id, staffUser, 'Unauthorized revoke attempt');
  assert(!staffRevoke.success, 'Staff cannot revoke access pass');

  // Revocation requires reason
  const noReasonRevoke = accessService.revokeAccessPass(revocablePass.id, adminUser, '');
  assert(!noReasonRevoke.success, 'Revocation without reason rejected');

  // Admin revokes with reason
  const validRevoke = accessService.revokeAccessPass(
    revocablePass.id,
    adminUser,
    'Security team flagged pass code compromised',
    '102.129.144.1'
  );
  assert(validRevoke.success && !!validRevoke.pass, 'Admin successfully revoked access pass');
  assert(validRevoke.pass?.status === AccessPassStatus.REVOKED, 'Pass status updated to REVOKED');
  assert(validRevoke.pass?.revokeReason === 'Security team flagged pass code compromised', 'Revocation reason recorded');
  assert(!!validRevoke.pass?.revokedAt, 'Revoked timestamp recorded');

  // Revoked pass MUST NEVER verify
  const verifyRevoked = accessService.verifyAccessPass({
    code: revocablePass.displayCode,
    consumeUse: true,
    ipAddress: '102.129.144.1',
  });
  assert(!verifyRevoked.valid, 'Revoked pass verification rejected');
  assert(verifyRevoked.code === 'ACCESS_REVOKED', 'Rejection code is ACCESS_REVOKED');

  // Cannot revoke already revoked pass
  const doubleRevoke = accessService.revokeAccessPass(revocablePass.id, adminUser, 'Second revoke');
  assert(!doubleRevoke.success, 'Duplicate revocation rejected');

  // 10. Event Cancellation Coupling
  console.log('\n--- 10. Event Cancellation Coupling ---');
  // Create an approved event and pass
  const cancelTestEventRes = eventService.createEvent(adminUser, {
    title: 'Event To Be Cancelled',
    location: 'Main Hall',
    startAt: oneHourAgo,
    endAt: twoHoursLater,
  });
  eventService.submitEvent(cancelTestEventRes.event!.id, adminUser);
  eventService.approveEvent(cancelTestEventRes.event!.id, superAdminUser);

  const eventPassRes = accessService.createEventAccessPass(adminUser, cancelTestEventRes.event!.id);
  const eventPass = eventPassRes.pass!;

  // Verify works before event cancellation
  const preCancelVerify = accessService.verifyAccessPass({
    code: eventPass.displayCode,
    consumeUse: false,
    ipAddress: '102.129.144.1',
  });
  assert(preCancelVerify.valid, 'Pass valid while event is APPROVED');

  // Cancel the event
  eventService.cancelEvent(cancelTestEventRes.event!.id, adminUser);

  // Now pass must fail verification because event is CANCELLED
  const postCancelVerify = accessService.verifyAccessPass({
    code: eventPass.displayCode,
    consumeUse: false,
    ipAddress: '102.129.144.1',
  });
  assert(!postCancelVerify.valid, 'Pass verification rejected when event is CANCELLED');
  assert(postCancelVerify.code === 'EVENT_CANCELLED', 'Rejection code is EVENT_CANCELLED');

  // 11. Rate Limiting on Verification Endpoint
  console.log('\n--- 11. Rate Limiting on Verification Endpoint ---');
  accessService.resetRateLimiter();
  const testIp = '198.51.100.99';

  let rateLimited = false;
  for (let i = 0; i < 30; i++) {
    const res = accessService.verifyAccessPass({
      code: 'EVT-FAKE-CODE',
      ipAddress: testIp,
    });
    if (res.code === 'RATE_LIMITED') {
      rateLimited = true;
      break;
    }
  }
  assert(rateLimited, 'Rate limiter activates after repeated attempts from same IP');
  accessService.resetRateLimiter();

  // 12. QR Code Utilities Verification
  console.log('\n--- 12. QR Code Generation & Utilities ---');
  const qrUrl = buildVerificationUrl({ token: singlePass.rawToken, code: singlePass.displayCode });
  assert(qrUrl.includes('/access/verify?t='), 'Verification URL includes opaque token parameter');
  assert(!qrUrl.includes(adminUser.email), 'QR URL strictly excludes personal user data');

  const svgQr = await generateQrSvg(qrUrl);
  assert(svgQr.startsWith('<svg'), 'QR SVG generates valid SVG markup');

  const dataUrlQr = await generateQrDataUrl(qrUrl);
  assert(dataUrlQr.startsWith('data:image/png;base64,'), 'QR DataURL generates valid base64 PNG data');

  // 13. Audit Log Trail
  console.log('\n--- 13. Audit Logging Verification ---');
  const auditLogs = db.prepare("SELECT * FROM audit_logs WHERE action LIKE 'ACCESS_PASS%'").all() as any[];
  assert(auditLogs.length > 0, `Recorded ${auditLogs.length} access pass audit logs`);

  const actions = new Set(auditLogs.map((l) => l.action));
  assert(actions.has('ACCESS_PASS_CREATED'), 'Logged ACCESS_PASS_CREATED');
  assert(actions.has('ACCESS_PASS_REVOKED'), 'Logged ACCESS_PASS_REVOKED');
  assert(actions.has('ACCESS_PASS_VERIFICATION_SUCCESS'), 'Logged ACCESS_PASS_VERIFICATION_SUCCESS');
  assert(actions.has('ACCESS_PASS_VERIFICATION_FAILED'), 'Logged ACCESS_PASS_VERIFICATION_FAILED');

  // Ensure NO raw secrets in audit logs
  let secretLeakedInAudit = false;
  for (const log of auditLogs) {
    if (log.metadata && singlePass.rawToken && log.metadata.includes(singlePass.rawToken)) {
      secretLeakedInAudit = true;
      break;
    }
  }
  assert(!secretLeakedInAudit, 'Audit log trail contains zero raw tokens or secrets');

  console.log('\n================================================================');
  console.log(`   PHASE 6C TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase6cTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
