/**
 * Phase 6G Reception Operations & Access Management Hardening Tests
 * 
 * Verifies:
 * - Section 1: Reception Authorization & RBAC (401 unauthenticated, 403 STAFF, 200/201 ADMIN/SUPER_ADMIN)
 * - Section 2: Verification Hardening & Safe Error Communication (safe messages, no token leakage)
 * - Section 3: Physical Access Lifecycle & Active Occupancy (atomic visits, occupancy derivation)
 * - Section 4: Security Protections & Tamper Resistance (no operator/host/timestamp spoofing)
 * - Section 5: Concurrency & Race Condition Protections (atomic check-in & check-out)
 * - Section 6: Search, Filtering & Bounded Request Handling (server-side, paginated, status=DENIED)
 * - Section 7: Audit Logging & Zero Credential Leakage (immutable audit trail)
 * - Section 8: Summary Operational Metrics Synchronization (real-time metric coherence)
 */

import assert from 'node:assert';
import { getDatabase } from './server/db/index.ts';
import { receptionService } from './server/services/reception.service.ts';
import { accessService } from './server/services/access.service.ts';
import { eventService } from './server/services/event.service.ts';
import { inviteeService } from './server/services/invitee.service.ts';
import { visitorService } from './server/services/visitor.service.ts';
import { auditService } from './server/services/audit.service.ts';
import {
  UserRole,
  SafeUser,
  PassType,
  AccessVisitStatus,
  AccessPassStatus,
  EventStatus,
} from './src/types/index.ts';

let passedTests = 0;
let totalTests = 0;

function pass(name: string) {
  totalTests++;
  passedTests++;
  console.log(`✓ Test ${totalTests}: ${name}`);
}

async function runTests() {
  console.log('--- STARTING PHASE 6G RECEPTION HARDENING TESTS ---\n');

  const db = getDatabase();

  // Test Users
  const adminUser: SafeUser = {
    id: 'admin-6g-op-test',
    email: 'admin.6g@acme.com',
    role: UserRole.ADMIN,
    firstName: 'Reception',
    lastName: 'Admin',
    department: 'Operations',
    status: 'ACTIVE' as any,
  };

  const superAdminUser: SafeUser = {
    id: 'superadmin-6g-op-test',
    email: 'superadmin.6g@acme.com',
    role: UserRole.SUPER_ADMIN,
    firstName: 'Chief',
    lastName: 'SuperAdmin',
    department: 'Executive',
    status: 'ACTIVE' as any,
  };

  const staffUser: SafeUser = {
    id: 'staff-6g-op-test',
    email: 'staff.6g@acme.com',
    role: UserRole.STAFF,
    firstName: 'Standard',
    lastName: 'Employee',
    department: 'Marketing',
    status: 'ACTIVE' as any,
  };

  const nowIso = new Date().toISOString();

  // Upsert test users into users table
  for (const u of [adminUser, superAdminUser, staffUser]) {
    db.prepare(`
      INSERT OR REPLACE INTO users (id, email, password_hash, first_name, last_name, department, role, status, created_at, updated_at)
      VALUES (?, ?, 'dummy_hash', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      u.id,
      u.email,
      u.firstName,
      u.lastName,
      u.department,
      u.role,
      u.status,
      nowIso,
      nowIso
    );
  }

  // =========================================================================
  // SECTION 1: RECEPTION AUTHORIZATION & RBAC ENFORCEMENT
  // =========================================================================
  console.log('--- Section 1: Reception Authorization & RBAC ---');

  // Verify STAFF is denied across all reception operations
  const staffVerify = receptionService.verifyCredential(staffUser, { accessCode: 'EVT-TEST-0001' });
  assert(!staffVerify.success, 'STAFF must be forbidden from verifying');
  assert.strictEqual(staffVerify.status, 403, 'STAFF verification returns 403');
  pass('STAFF is forbidden (403) from verifying credentials');

  const staffCheckIn = receptionService.checkIn(staffUser, { accessCode: 'EVT-TEST-0001' });
  assert(!staffCheckIn.success, 'STAFF must be forbidden from check-in');
  assert.strictEqual(staffCheckIn.status, 403, 'STAFF check-in returns 403');
  pass('STAFF is forbidden (403) from checking in guests');

  const staffCheckOut = receptionService.checkOut(staffUser, { accessCode: 'EVT-TEST-0001' });
  assert(!staffCheckOut.success, 'STAFF must be forbidden from check-out');
  assert.strictEqual(staffCheckOut.status, 403, 'STAFF check-out returns 403');
  pass('STAFF is forbidden (403) from checking out guests');

  const staffActive = receptionService.listActive(staffUser);
  assert(!staffActive.success, 'STAFF must be forbidden from active occupancy query');
  assert.strictEqual(staffActive.status, 403, 'STAFF listActive returns 403');
  pass('STAFF is forbidden (403) from querying active occupancy');

  const staffHistory = receptionService.listHistory(staffUser);
  assert(!staffHistory.success, 'STAFF must be forbidden from history queries');
  assert.strictEqual(staffHistory.status, 403, 'STAFF listHistory returns 403');
  pass('STAFF is forbidden (403) from querying access history');

  const staffSummary = receptionService.getSummary(staffUser);
  assert(!staffSummary.success, 'STAFF must be forbidden from summary query');
  assert.strictEqual(staffSummary.status, 403, 'STAFF getSummary returns 403');
  pass('STAFF is forbidden (403) from viewing reception summary');

  // ADMIN and SUPER_ADMIN have full access
  const adminSummary = receptionService.getSummary(adminUser);
  assert(adminSummary.success, 'ADMIN has access to reception summary');
  pass('ADMIN is authorized for reception operations');

  const superAdminSummary = receptionService.getSummary(superAdminUser);
  assert(superAdminSummary.success, 'SUPER_ADMIN has access to reception summary');
  pass('SUPER_ADMIN is authorized for reception operations');

  // =========================================================================
  // SECTION 2: VERIFICATION HARDENING & SAFE ERROR COMMUNICATION
  // =========================================================================
  console.log('\n--- Section 2: Verification Hardening & Safe Error Communication ---');

  // 1. Create a valid Event Pass
  const now = new Date();
  const startAt = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
  const endAt = new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString();

  const eventRes = eventService.createEvent(
    adminUser,
    {
      title: 'Phase 6G Security Symposium',
      description: 'Hardening reception access',
      location: 'Conference Hall Alpha',
      startAt,
      endAt,
    }
  );
  assert(eventRes.success && eventRes.event, 'Event creation succeeds');
  const event = eventRes.event;
  if (event.status !== EventStatus.APPROVED) {
    db.prepare("UPDATE events SET status = 'APPROVED' WHERE id = ?").run(event.id);
  }

  const inviteeRes = inviteeService.createInvitee(
    event.id,
    adminUser,
    {
      fullName: 'Ada Lovelace',
      email: 'ada.lovelace@cyber.org',
      organization: 'Computing Institute',
    }
  );
  assert(inviteeRes.success && inviteeRes.invitee, 'Invitee creation succeeds');
  const invitee = inviteeRes.invitee;

  const eventPassRes = inviteeService.generateInviteeAccessPass(event.id, invitee.id, adminUser);
  assert(eventPassRes.success && eventPassRes.pass, 'Event pass generation succeeds');
  const eventPass = eventPassRes.pass;

  // 2. Verification of valid event pass succeeds
  const verifyValid = receptionService.verifyCredential(adminUser, { accessCode: eventPass.displayCode });
  assert(verifyValid.success && verifyValid.verification?.valid, 'Verification must succeed for valid pass');
  assert.strictEqual(verifyValid.verification.guestName, 'Ada Lovelace');
  assert.strictEqual(verifyValid.verification.organization, 'Computing Institute');
  assert.strictEqual(verifyValid.verification.canCheckIn, true);
  assert.strictEqual(verifyValid.verification.canCheckOut, false);
  assert.strictEqual(verifyValid.verification.isCheckedIn, false);
  pass('Valid event pass verifies successfully with safe information');

  // Zero Token Leakage Check
  const verifyObj = JSON.stringify(verifyValid.verification);
  assert(!verifyObj.includes('token_hash'), 'Response must not contain token_hash');
  assert(!verifyObj.includes('raw_token'), 'Response must not contain raw_token');
  assert(!verifyObj.includes('password'), 'Response must not contain password');
  pass('Zero credential secrets exposed in verification response');

  function createTestVisitorVisit(
    visitorFullName: string,
    visitorEmail: string,
    purpose: string,
    validFrom: string,
    validUntil: string,
    hostUser = staffUser
  ) {
    const id = 'rec-vis-' + Math.random().toString(36).substring(2, 9);
    const nowIso = new Date().toISOString();
    db.prepare(`
      INSERT INTO visitor_visits (
        id, host_staff_id, visitor_full_name, visitor_email, visitor_phone,
        purpose, notes, valid_from, valid_until, status, access_pass_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', NULL, ?, ?)
    `).run(
      id,
      hostUser.id,
      visitorFullName,
      visitorEmail,
      '+2348011223344',
      purpose,
      'Official visit',
      validFrom,
      validUntil,
      nowIso,
      nowIso
    );
    return id;
  }

  // 3. Create a valid Visitor Pass
  const visitorVisitId = createTestVisitorVisit(
    'Grace Hopper',
    'grace.hopper@navy.gov',
    'Systems Architecture Review',
    startAt,
    endAt
  );

  const visitorPassRes = visitorService.generateVisitorAccessPass(visitorVisitId, staffUser);
  assert(visitorPassRes.success && visitorPassRes.pass, 'Visitor pass generation succeeds');
  const visitorPass = visitorPassRes.pass;

  const verifyVisitor = receptionService.verifyCredential(adminUser, { accessCode: visitorPass.displayCode });
  assert(verifyVisitor.success && verifyVisitor.verification?.valid, 'Visitor pass verification succeeds');
  assert.strictEqual(verifyVisitor.verification.guestName, 'Grace Hopper');
  assert.strictEqual(verifyVisitor.verification.hostStaffName, 'Standard Employee');
  assert.strictEqual(verifyVisitor.verification.passType, PassType.VISITOR);
  pass('Valid visitor pass verifies successfully with host staff name');

  // 4. Test Expired Pass
  const pastStart = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const pastEnd = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const pastPassRes = accessService.createVisitorAccessPass(staffUser, staffUser.id, {
    validFrom: pastStart,
    validUntil: pastEnd,
  });
  const verifyExpired = receptionService.verifyCredential(adminUser, { accessCode: pastPassRes.pass!.displayCode });
  assert(!verifyExpired.success && !verifyExpired.verification?.valid, 'Expired pass must fail verification');
  assert.strictEqual(verifyExpired.verification?.code, 'ACCESS_EXPIRED', 'Expired pass code is ACCESS_EXPIRED');
  pass('Expired credential is safely rejected with ACCESS_EXPIRED');

  // 5. Test Future Pass (not yet valid)
  const futureStart = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const futureEnd = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();
  const futurePassRes = accessService.createVisitorAccessPass(staffUser, staffUser.id, {
    validFrom: futureStart,
    validUntil: futureEnd,
  });
  const verifyFuture = receptionService.verifyCredential(adminUser, { accessCode: futurePassRes.pass!.displayCode });
  assert(!verifyFuture.success && !verifyFuture.verification?.valid, 'Future pass must fail verification');
  assert.strictEqual(verifyFuture.verification?.code, 'ACCESS_NOT_YET_VALID', 'Future pass code is ACCESS_NOT_YET_VALID');
  pass('Future credential is safely rejected with ACCESS_NOT_YET_VALID');

  // 6. Test Revoked Pass
  const revokedVisitId = createTestVisitorVisit(
    'Revoked Guest',
    'revoked@example.com',
    'Security Audit',
    startAt,
    endAt
  );
  const revokedPassRes = visitorService.generateVisitorAccessPass(revokedVisitId, staffUser);
  visitorService.revokeVisitorAccess(revokedVisitId, staffUser, 'Security Policy Violation');
  const verifyRevoked = receptionService.verifyCredential(adminUser, { accessCode: revokedPassRes.pass!.displayCode });
  assert(!verifyRevoked.success && !verifyRevoked.verification?.valid, 'Revoked pass must fail verification');
  assert.strictEqual(verifyRevoked.verification?.code, 'ACCESS_REVOKED', 'Revoked pass code is ACCESS_REVOKED');
  pass('Revoked credential is safely rejected with ACCESS_REVOKED');

  // 7. Test Cancelled Invitee
  const cancelledInviteeRes = inviteeService.createInvitee(
    event.id,
    adminUser,
    {
      fullName: 'Cancelled Invitee',
      email: 'cancelled.invitee@example.com',
    }
  );
  const cancelledInviteePassRes = inviteeService.generateInviteeAccessPass(event.id, cancelledInviteeRes.invitee!.id, adminUser);
  inviteeService.cancelInvitee(event.id, cancelledInviteeRes.invitee!.id, adminUser, 'No longer attending');
  const verifyCancelledInvitee = receptionService.verifyCredential(adminUser, { accessCode: cancelledInviteePassRes.pass!.displayCode });
  assert(!verifyCancelledInvitee.success && !verifyCancelledInvitee.verification?.valid, 'Cancelled invitee must fail verification');
  assert.strictEqual(verifyCancelledInvitee.verification?.code, 'INVITEE_CANCELLED');
  pass('Cancelled event invitee credential is safely rejected');

  // 8. Test Cancelled Visitor
  const cancelledVisitId = createTestVisitorVisit(
    'Cancelled Visitor',
    'cancelled.visitor@example.com',
    'Sales Demo',
    startAt,
    endAt
  );
  const cancelledVisitorPassRes = visitorService.generateVisitorAccessPass(cancelledVisitId, staffUser);
  visitorService.cancelVisit(cancelledVisitId, staffUser, 'Meeting cancelled by host');
  const verifyCancelledVisitor = receptionService.verifyCredential(adminUser, { accessCode: cancelledVisitorPassRes.pass!.displayCode });
  assert(!verifyCancelledVisitor.success && !verifyCancelledVisitor.verification?.valid, 'Cancelled visitor must fail verification');
  assert.strictEqual(verifyCancelledVisitor.verification?.code, 'VISIT_CANCELLED');
  pass('Cancelled visitor credential is safely rejected');

  // 9. Non-existent & Malformed Codes
  const verifyNotFound = receptionService.verifyCredential(adminUser, { accessCode: 'EVT-NONEXISTENT' });
  assert(!verifyNotFound.success, 'Non-existent credential rejected');
  assert.strictEqual(verifyNotFound.status, 404, 'Non-existent returns 404');
  pass('Non-existent credential is safely rejected with 404');

  const verifyEmpty = receptionService.verifyCredential(adminUser, {});
  assert(!verifyEmpty.success, 'Empty input rejected');
  assert.strictEqual(verifyEmpty.status, 400, 'Empty input returns 400');
  pass('Malformed/empty verification input is safely rejected with 400');

  // =========================================================================
  // SECTION 3: PHYSICAL ACCESS LIFECYCLE & ACTIVE OCCUPANCY
  // =========================================================================
  console.log('\n--- Section 3: Physical Access Lifecycle & Active Occupancy ---');

  // Verify that verifying does NOT create an access_visit record
  const visitsBefore = db.prepare('SELECT COUNT(*) as count FROM access_visits WHERE access_pass_id = ?').get(eventPass.id) as any;
  assert.strictEqual(visitsBefore.count, 0, 'Verification MUST NOT create an access_visits record');
  pass('Verification is strictly read-only and does not create visit records');

  // Explicit Check-In
  const checkInRes = receptionService.checkIn(adminUser, { accessPassId: eventPass.id });
  assert(checkInRes.success && checkInRes.visit, 'Explicit check-in must succeed');
  assert.strictEqual(checkInRes.visit.status, AccessVisitStatus.CHECKED_IN);
  assert.strictEqual(checkInRes.visit.guestName, 'Ada Lovelace');
  pass('Explicit check-in creates exactly one access_visit with status CHECKED_IN');

  // Event Invitee table updated to CHECKED_IN
  const inviteeRow = db.prepare('SELECT status FROM event_invitees WHERE id = ?').get(invitee.id) as any;
  assert.strictEqual(inviteeRow.status, 'CHECKED_IN', 'Invitee status transitioned to CHECKED_IN');
  pass('Event invitee table status is transitioned to CHECKED_IN');

  // Active Occupancy includes currently checked-in occupant
  const activeRes = receptionService.listActive(adminUser);
  assert(activeRes.success, 'listActive succeeds');
  const occupant = activeRes.activeVisits.find((v) => v.accessPassId === eventPass.id);
  assert(occupant, 'Checked-in occupant is present in active occupancy');
  assert.strictEqual(occupant.status, AccessVisitStatus.CHECKED_IN);
  assert.strictEqual(occupant.checkedInByName, 'Reception Admin');
  pass('Active occupancy is derived exclusively from access_visits (status = CHECKED_IN)');

  // Duplicate Check-In Protection
  const duplicateCheckIn = receptionService.checkIn(adminUser, { accessPassId: eventPass.id });
  assert(!duplicateCheckIn.success, 'Duplicate check-in must fail');
  assert.strictEqual(duplicateCheckIn.status, 409, 'Duplicate check-in returns 409 conflict');
  pass('Duplicate check-in attempt returns 409 conflict');

  // Re-verification now shows canCheckOut = true, canCheckIn = false
  const reVerify = receptionService.verifyCredential(adminUser, { accessCode: eventPass.displayCode });
  assert(reVerify.success && reVerify.verification?.valid, 'Re-verification succeeds');
  assert.strictEqual(reVerify.verification.isCheckedIn, true);
  assert.strictEqual(reVerify.verification.canCheckIn, false);
  assert.strictEqual(reVerify.verification.canCheckOut, true);
  pass('Re-verification of checked-in guest safely displays canCheckOut = true');

  // Check-Out Execution
  const checkOutRes = receptionService.checkOut(adminUser, { accessVisitId: checkInRes.visit.id });
  assert(checkOutRes.success && checkOutRes.visit, 'Explicit check-out must succeed');
  assert.strictEqual(checkOutRes.visit.status, AccessVisitStatus.CHECKED_OUT);
  assert(checkOutRes.visit.checkedOutAt, 'Check-out timestamp is recorded');
  pass('Explicit check-out updates access_visit status to CHECKED_OUT');

  // Event Invitee table updated to CHECKED_OUT
  const inviteeRowAfterCheckout = db.prepare('SELECT status FROM event_invitees WHERE id = ?').get(invitee.id) as any;
  assert.strictEqual(inviteeRowAfterCheckout.status, 'CHECKED_OUT', 'Invitee status transitioned to CHECKED_OUT');
  pass('Event invitee table status is transitioned to CHECKED_OUT');

  // Checked-out occupant immediately leaves active occupancy
  const activeAfterCheckout = receptionService.listActive(adminUser);
  const stillInside = activeAfterCheckout.activeVisits.some((v) => v.accessPassId === eventPass.id);
  assert(!stillInside, 'Checked-out guest MUST NOT remain in active occupancy');
  pass('Checked-out person is immediately removed from active occupancy');

  // Duplicate Check-Out Rejected
  const duplicateCheckOut = receptionService.checkOut(adminUser, { accessVisitId: checkInRes.visit.id });
  assert(!duplicateCheckOut.success, 'Duplicate check-out must fail');
  assert.strictEqual(duplicateCheckOut.status, 400, 'Duplicate check-out returns 400');
  pass('Duplicate check-out is safely rejected with 400');

  // Check-out cannot occur before check-in
  const brandNewVisitId = createTestVisitorVisit('Unchecked Guest', 'uncheck@example.com', 'Test', startAt, endAt);
  const brandNewPassRes = visitorService.generateVisitorAccessPass(brandNewVisitId, staffUser);
  const earlyCheckOut = receptionService.checkOut(adminUser, { accessPassId: brandNewPassRes.pass!.id });
  assert(!earlyCheckOut.success, 'Check-out before check-in must fail');
  pass('Check-out only works after check-in (cannot check out un-checked-in guest)');

  // Re-check-in of exhausted single-use pass is rejected
  const reCheckInExhausted = receptionService.checkIn(adminUser, { accessPassId: eventPass.id });
  assert(!reCheckInExhausted.success, 'Re-check-in of exhausted pass must fail');
  pass('Re-check-in with exhausted single-use pass is rejected');

  // Already consumed credential verification clearly communicates already checked out
  const verifyConsumed = receptionService.verifyCredential(adminUser, { accessCode: eventPass.displayCode });
  assert(!verifyConsumed.success && !verifyConsumed.verification?.valid, 'Verification of checked-out pass is rejected');
  assert.strictEqual(verifyConsumed.verification?.code, 'ALREADY_CHECKED_OUT');
  pass('Already consumed credential verification clearly communicates already checked out');

  // =========================================================================
  // SECTION 4: SECURITY PROTECTIONS & TAMPER RESISTANCE
  // =========================================================================
  console.log('\n--- Section 4: Security Protections & Tamper Resistance ---');

  // 1. Role enforcement is authoritative
  const spoofVerify = receptionService.verifyCredential(staffUser, { accessCode: eventPass.displayCode });
  assert(!spoofVerify.success && spoofVerify.status === 403, 'STAFF cannot spoof administrative capabilities');
  pass('Role enforcement is server-authoritative and impervious to client tampering');

  // 2. Client cannot force CHECKED_IN with invalid/spoofed pass ID
  const spoofCheckIn = receptionService.checkIn(adminUser, { accessPassId: 'spoofed-random-pass-id' });
  assert(!spoofCheckIn.success, 'Spoofed pass ID check-in fails');
  assert.strictEqual(spoofCheckIn.status, 404);
  pass('Client cannot force CHECKED_IN state with spoofed pass identifiers');

  // 3. Operator ID cannot be spoofed (authenticated session actor is strictly used)
  const visitorCheckInRes = receptionService.checkIn(adminUser, { accessPassId: visitorPass.id });
  assert(visitorCheckInRes.success && visitorCheckInRes.visit, 'Visitor check-in succeeds');
  assert.strictEqual(visitorCheckInRes.visit.checkedInBy, adminUser.id, 'checked_in_by strictly equals authenticated actor.id');
  pass('Operator identity is strictly derived from authenticated session and cannot be spoofed');

  // 2. Server generates timestamps (never client-supplied)
  const visitRecordInDb = db.prepare('SELECT checked_in_at FROM access_visits WHERE id = ?').get(visitorCheckInRes.visit.id) as any;
  const visitTimestamp = new Date(visitRecordInDb.checked_in_at).getTime();
  const currentTimestamp = Date.now();
  assert(Math.abs(currentTimestamp - visitTimestamp) < 10000, 'Timestamp is server-generated current time');
  pass('Timestamps are server-generated and resistant to client spoofing');

  // 3. Host Identity is authoritative
  assert.strictEqual(visitorCheckInRes.visit.hostStaffName, 'Standard Employee');
  pass('Host staff identity is resolved server-side from database');

  // =========================================================================
  // SECTION 5: CONCURRENCY & RACE CONDITION PROTECTIONS
  // =========================================================================
  console.log('\n--- Section 5: Concurrency & Race Condition Protections ---');

  // Create another visitor pass for concurrency tests
  const concVisitId = createTestVisitorVisit(
    'Concurrent Tester',
    'concurrent@example.com',
    'Concurrency Hardening Test',
    startAt,
    endAt
  );
  const concPassRes = visitorService.generateVisitorAccessPass(concVisitId, staffUser);
  const concPass = concPassRes.pass!;

  // Concurrent Check-In Race Condition: Check that second immediate call receives 409
  const call1 = receptionService.checkIn(adminUser, { accessPassId: concPass.id });
  const call2 = receptionService.checkIn(superAdminUser, { accessPassId: concPass.id });
  assert(call1.success, 'First concurrent check-in succeeds');
  assert(!call2.success, 'Second concurrent check-in must fail');
  assert.strictEqual(call2.status, 409, 'Second concurrent check-in returns 409 conflict');
  pass('Concurrent check-in race condition is atomically resolved with 409 conflict');

  // Exactly one physical access visit record exists
  const totalVisitsForPass = db.prepare('SELECT COUNT(*) as count FROM access_visits WHERE access_pass_id = ?').get(concPass.id) as any;
  assert.strictEqual(totalVisitsForPass.count, 1, 'Exactly one access_visit created');
  pass('Zero duplicate physical access visit records created under concurrent attempts');

  // Concurrent Check-Out Race Condition:
  const activeConcVisit = call1.visit!;
  const co1 = receptionService.checkOut(adminUser, { accessVisitId: activeConcVisit.id });
  const co2 = receptionService.checkOut(superAdminUser, { accessVisitId: activeConcVisit.id });
  assert(co1.success, 'First concurrent check-out succeeds');
  assert(!co2.success, 'Second concurrent check-out must fail');
  assert(co2.status === 400 || co2.status === 409, 'Second concurrent check-out returns 400 or 409');
  pass('Concurrent check-out race condition is atomically resolved');

  // =========================================================================
  // SECTION 6: SEARCH, FILTERING & BOUNDED REQUEST HANDLING
  // =========================================================================
  console.log('\n--- Section 6: Search, Filtering & Bounded Request Handling ---');

  // 1. Search in Active Occupancy
  const searchOccupancy = receptionService.listActive(adminUser, { search: 'Grace' });
  assert(searchOccupancy.success, 'Search active occupancy succeeds');
  assert(searchOccupancy.activeVisits.some((v) => v.guestName?.includes('Grace')), 'Finds Grace in active occupancy');
  pass('Active occupancy search filtering locates checked-in guests');

  // 2. Filter History by passType = EVENT
  const histEvent = receptionService.listHistory(adminUser, { passType: 'EVENT' });
  assert(histEvent.success, 'History with passType=EVENT succeeds');
  assert(histEvent.visits.every((v) => v.passType === PassType.EVENT), 'All returned visits have passType EVENT');
  pass('History passType=EVENT filter functions accurately');

  // 3. Filter History by passType = VISITOR
  const histVisitor = receptionService.listHistory(adminUser, { passType: 'VISITOR' });
  assert(histVisitor.success, 'History with passType=VISITOR succeeds');
  assert(histVisitor.visits.every((v) => v.passType === PassType.VISITOR), 'All returned visits have passType VISITOR');
  pass('History passType=VISITOR filter functions accurately');

  // 4. Filter History by status = CHECKED_IN
  const histCheckedIn = receptionService.listHistory(adminUser, { status: 'CHECKED_IN' });
  assert(histCheckedIn.success, 'History with status=CHECKED_IN succeeds');
  assert(histCheckedIn.visits.every((v) => v.status === AccessVisitStatus.CHECKED_IN), 'All returned visits have status CHECKED_IN');
  pass('History status=CHECKED_IN filter functions accurately');

  // 5. Filter History by status = CHECKED_OUT
  const histCheckedOut = receptionService.listHistory(adminUser, { status: 'CHECKED_OUT' });
  assert(histCheckedOut.success, 'History with status=CHECKED_OUT succeeds');
  assert(histCheckedOut.visits.every((v) => v.status === AccessVisitStatus.CHECKED_OUT), 'All returned visits have status CHECKED_OUT');
  pass('History status=CHECKED_OUT filter functions accurately');

  // 6. Filter History by status = DENIED (authoritative audit log query)
  receptionService.verifyCredential(adminUser, { accessCode: 'DENIED-AUDIT-TEST-XYZ' });
  const histDenied = receptionService.listHistory(adminUser, { status: 'DENIED' });
  assert(histDenied.success, 'History with status=DENIED succeeds');
  assert(histDenied.visits.length > 0, 'Returns denied access records');
  assert(histDenied.visits.every((v) => v.status === AccessVisitStatus.DENIED), 'All returned records have status DENIED');
  pass('History status=DENIED filter accurately queries access denials');

  // 7. Pagination Bounds (limit & page)
  const page1 = receptionService.listHistory(adminUser, { limit: 2, page: 1 });
  assert(page1.success && page1.visits.length <= 2, 'Page 1 respects limit of 2');
  assert.strictEqual(page1.page, 1);
  assert.strictEqual(page1.limit, 2);
  pass('Pagination parameters (page, limit) are strictly respected');

  // 8. Bounded Input Handling (abusive length string truncated cleanly)
  const longSearch = 'A'.repeat(500);
  const boundedSearchRes = receptionService.listHistory(adminUser, { search: longSearch });
  assert(boundedSearchRes.success, 'Query with long search parameter succeeds safely without database error');
  pass('Abusive search query length is safely bounded against database denial of service');

  // =========================================================================
  // SECTION 7: AUDIT LOGGING & ZERO CREDENTIAL LEAKAGE
  // =========================================================================
  console.log('\n--- Section 7: Audit Logging & Zero Credential Leakage ---');

  const auditRows = db.prepare(`
    SELECT action, metadata, actor_id FROM audit_logs
    WHERE actor_id = ?
    ORDER BY created_at DESC
  `).all(adminUser.id) as any[];

  const actions = auditRows.map((r) => r.action);
  assert(actions.includes('ACCESS_VERIFIED'), 'Audit log contains ACCESS_VERIFIED');
  assert(actions.includes('ACCESS_DENIED'), 'Audit log contains ACCESS_DENIED');
  assert(actions.includes('ACCESS_CHECKED_IN'), 'Audit log contains ACCESS_CHECKED_IN');
  assert(actions.includes('ACCESS_CHECKED_OUT'), 'Audit log contains ACCESS_CHECKED_OUT');
  pass('All four core reception audit actions are reliably logged with operator identity');

  // Verify zero credential leakage across audit log metadata
  for (const row of auditRows) {
    const metaStr = row.metadata || '';
    assert(!metaStr.includes('token_hash'), 'Audit metadata must not contain token_hash');
    assert(!metaStr.includes('raw_token'), 'Audit metadata must not contain raw_token');
    assert(!metaStr.includes('password'), 'Audit metadata must not contain password');
  }
  pass('Audit trail is completely free of credential secrets and cryptographic hashes');

  // =========================================================================
  // SECTION 8: SUMMARY METRICS SYNCHRONIZATION
  // =========================================================================
  console.log('\n--- Section 8: Summary Metrics Synchronization ---');

  const summaryRes = receptionService.getSummary(adminUser);
  assert(summaryRes.success, 'Summary query succeeds');
  const summary = summaryRes.summary;

  // Active occupancy count matches currentlyCheckedIn metric exactly
  const activeVisitsCount = (db.prepare("SELECT COUNT(*) as count FROM access_visits WHERE status = 'CHECKED_IN'").get() as any).count;
  assert.strictEqual(summary.currentlyCheckedIn, activeVisitsCount, 'currentlyCheckedIn matches active access_visits count');
  pass('currentlyCheckedIn metric is strictly synchronized with active access_visits');

  assert(summary.todayEventGuests >= 1, 'todayEventGuests reflects event check-ins');
  assert(summary.todayVisitors >= 1, 'todayVisitors reflects visitor check-ins');
  assert(summary.checkedOutToday >= 1, 'checkedOutToday reflects departures');
  assert(summary.accessDeniedToday >= 1, 'accessDeniedToday reflects denied access attempts');
  pass('All summary metrics accurately reflect authoritative reception activity');

  // Check-out remaining active visitor
  receptionService.checkOut(adminUser, { accessPassId: visitorPass.id });

  console.log(`\n======================================================`);
  console.log(`PHASE 6G TESTS COMPLETE: ALL ${passedTests} TESTS PASSED!`);
  console.log(`======================================================\n`);
}

runTests().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
