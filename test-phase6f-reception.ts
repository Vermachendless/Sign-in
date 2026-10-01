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
  AccessVisitStatus,
  InviteeStatus,
  VisitorVisitStatus,
  PassType,
  AccessPassStatus,
  EventStatus,
} from './src/types/index.ts';

async function runPhase6FTests() {
  console.log('--- STARTING PHASE 6F RECEPTION & ACCESS VERIFICATION TESTS ---');
  let testCount = 0;
  const pass = (name: string) => {
    testCount++;
    console.log(`✓ Test ${testCount}: ${name}`);
  };

  const db = getDatabase();

  // Test Actors
  const adminUser: SafeUser = {
    id: 'admin-reception-test',
    email: 'admin.reception@acme.com',
    role: UserRole.ADMIN,
    status: 'ACTIVE' as any,
    firstName: 'Admin',
    lastName: 'Receptionist',
    department: 'Operations',
  };

  const superAdminUser: SafeUser = {
    id: 'superadmin-reception-test',
    email: 'superadmin.reception@acme.com',
    role: UserRole.SUPER_ADMIN,
    status: 'ACTIVE' as any,
    firstName: 'Super',
    lastName: 'Admin',
    department: 'Executive',
  };

  const staffUser: SafeUser = {
    id: 'staff-reception-test',
    email: 'staff.reception@acme.com',
    role: UserRole.STAFF,
    status: 'ACTIVE' as any,
    firstName: 'Staff',
    lastName: 'Member',
    department: 'Engineering',
  };

  // Seed test users into database if not present
  for (const u of [adminUser, superAdminUser, staffUser]) {
    const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(u.id);
    if (!existing) {
      db.prepare(`
        INSERT INTO users (id, email, password_hash, first_name, last_name, role, department, status, created_at, updated_at)
        VALUES (?, ?, 'hash', ?, ?, ?, ?, 'ACTIVE', datetime('now'), datetime('now'))
      `).run(u.id, u.email, u.firstName, u.lastName, u.role, u.department);
    }
  }

  // Clean up any leftovers from previous test runs
  db.prepare("DELETE FROM access_visits WHERE access_pass_id IN (SELECT id FROM access_passes WHERE display_code LIKE 'REC-%')").run();
  db.prepare("DELETE FROM access_passes WHERE display_code LIKE 'REC-%'").run();
  db.prepare("DELETE FROM event_invitees WHERE email IN ('rec.invitee@example.com', 'rec.cancelled@example.com')").run();
  db.prepare("DELETE FROM visitor_visits WHERE visitor_email IN ('rec.visitor@example.com', 'rec.cancelled.visitor@example.com')").run();
  db.prepare("DELETE FROM events WHERE title LIKE 'Reception Test Event%'").run();

  // =========================================================================
  // SECTION 1: DATABASE SCHEMA & CONSTRAINTS VALIDATION
  // =========================================================================
  console.log('\n--- Section 1: Database Schema & Constraints ---');

  const accessVisitsTable = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='access_visits'").get() as { sql: string } | undefined;
  assert(accessVisitsTable, 'access_visits table must exist in SQLite database');
  assert(accessVisitsTable.sql.includes('access_pass_id'), 'access_visits table must contain access_pass_id foreign key');
  assert(accessVisitsTable.sql.includes('pass_type'), 'access_visits table must contain pass_type');
  assert(accessVisitsTable.sql.includes('event_invitee_id'), 'access_visits table must contain event_invitee_id');
  assert(accessVisitsTable.sql.includes('visitor_visit_id'), 'access_visits table must contain visitor_visit_id');
  assert(accessVisitsTable.sql.includes('checked_in_at'), 'access_visits table must contain checked_in_at');
  assert(accessVisitsTable.sql.includes('checked_in_by'), 'access_visits table must contain checked_in_by');
  assert(accessVisitsTable.sql.includes('checked_out_at'), 'access_visits table must contain checked_out_at');
  assert(accessVisitsTable.sql.includes('checked_out_by'), 'access_visits table must contain checked_out_by');
  assert(accessVisitsTable.sql.includes('CHECKED_IN'), 'access_visits table status constraint must include CHECKED_IN');
  assert(accessVisitsTable.sql.includes('CHECKED_OUT'), 'access_visits table status constraint must include CHECKED_OUT');
  pass('access_visits schema has correct columns and CHECK constraint');

  const visitorVisitsTable = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='visitor_visits'").get() as { sql: string } | undefined;
  assert(visitorVisitsTable && visitorVisitsTable.sql.includes('CHECKED_IN'), 'visitor_visits table status constraint must allow CHECKED_IN');
  assert(visitorVisitsTable.sql.includes('CHECKED_OUT'), 'visitor_visits table status constraint must allow CHECKED_OUT');
  pass('visitor_visits schema allows CHECKED_IN and CHECKED_OUT');

  const eventInviteesTable = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='event_invitees'").get() as { sql: string } | undefined;
  assert(eventInviteesTable && eventInviteesTable.sql.includes('CHECKED_IN'), 'event_invitees table status constraint must allow CHECKED_IN');
  assert(eventInviteesTable.sql.includes('CHECKED_OUT'), 'event_invitees table status constraint must allow CHECKED_OUT');
  pass('event_invitees schema allows CHECKED_IN and CHECKED_OUT');

  // Verify indexes
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='access_visits'").all() as { name: string }[];
  const indexNames = indexes.map((i) => i.name);
  assert(indexNames.includes('idx_access_visits_access_pass_id'), 'Index on access_pass_id must exist');
  assert(indexNames.includes('idx_access_visits_status'), 'Index on status must exist');
  assert(indexNames.includes('idx_access_visits_checked_in_at'), 'Index on checked_in_at must exist');
  assert(indexNames.includes('idx_access_visits_checked_out_at'), 'Index on checked_out_at must exist');
  pass('access_visits required indexes exist');

  // =========================================================================
  // SECTION 2: RBAC ACCESS CONTROL (STAFF MUST RECEIVE 403)
  // =========================================================================
  console.log('\n--- Section 2: Role-Based Access Control ---');

  const staffVerify = receptionService.verifyCredential(staffUser, { accessCode: 'ANY-CODE' });
  assert(!staffVerify.success, 'STAFF must not be authorized to verify credentials');
  assert.strictEqual(staffVerify.status, 403, 'STAFF must receive 403 on verifyCredential');
  pass('STAFF is forbidden (403) from verifying credentials');

  const staffCheckIn = receptionService.checkIn(staffUser, { accessCode: 'ANY-CODE' });
  assert(!staffCheckIn.success, 'STAFF must not be authorized to check in');
  assert.strictEqual(staffCheckIn.status, 403, 'STAFF must receive 403 on checkIn');
  pass('STAFF is forbidden (403) from checking in guests');

  const staffCheckOut = receptionService.checkOut(staffUser, { accessCode: 'ANY-CODE' });
  assert(!staffCheckOut.success, 'STAFF must not be authorized to check out');
  assert.strictEqual(staffCheckOut.status, 403, 'STAFF must receive 403 on checkOut');
  pass('STAFF is forbidden (403) from checking out guests');

  const staffActive = receptionService.listActive(staffUser);
  assert(!staffActive.success, 'STAFF must not be authorized to list active occupancy');
  assert.strictEqual(staffActive.status, 403, 'STAFF must receive 403 on listActive');
  pass('STAFF is forbidden (403) from listing active guests');

  const staffHistory = receptionService.listHistory(staffUser);
  assert(!staffHistory.success, 'STAFF must not be authorized to list access history');
  assert.strictEqual(staffHistory.status, 403, 'STAFF must receive 403 on listHistory');
  pass('STAFF is forbidden (403) from querying access history');

  const staffSummary = receptionService.getSummary(staffUser);
  assert(!staffSummary.success, 'STAFF must not be authorized to view reception summary');
  assert.strictEqual(staffSummary.status, 403, 'STAFF must receive 403 on getSummary');
  pass('STAFF is forbidden (403) from viewing reception summary');

  // ADMIN and SUPER_ADMIN have access
  const adminSummary = receptionService.getSummary(adminUser);
  assert(adminSummary.success, 'ADMIN must have access to reception summary');
  pass('ADMIN has access to reception summary');

  const superAdminSummary = receptionService.getSummary(superAdminUser);
  assert(superAdminSummary.success, 'SUPER_ADMIN must have access to reception summary');
  pass('SUPER_ADMIN has access to reception summary');

  // =========================================================================
  // SECTION 3: EVENT INVITEE WORKFLOW (VERIFY -> CHECK-IN -> CHECK-OUT)
  // =========================================================================
  console.log('\n--- Section 3: Event Invitee Lifecycle Workflow ---');

  // 1. Create an approved event
  const now = new Date();
  const startAt = new Date(now.getTime() - 30 * 60 * 1000).toISOString(); // started 30 mins ago
  const endAt = new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString(); // ends in 4 hours

  const eventRes = eventService.createEvent(
    adminUser,
    {
      title: 'Reception Test Event Gala',
      description: 'Test event for Phase 6F reception check-in verification',
      location: 'Grand Ballroom - Level 2',
      startAt,
      endAt,
    }
  );
  assert(eventRes.success && eventRes.event, 'Event creation must succeed');
  const event = eventRes.event;

  // Approve event if pending
  if (event.status !== EventStatus.APPROVED) {
    db.prepare("UPDATE events SET status = 'APPROVED' WHERE id = ?").run(event.id);
  }

  // 2. Add an invitee and issue access pass
  const inviteeRes = inviteeService.createInvitee(
    event.id,
    adminUser,
    {
      fullName: 'Alice Henderson',
      email: 'rec.invitee@example.com',
      phone: '+2348011223344',
      organization: 'Henderson Capital',
    }
  );
  assert(inviteeRes.success && inviteeRes.invitee, 'Invitee creation must succeed');
  const invitee = inviteeRes.invitee;

  // Issue pass
  const passRes = inviteeService.generateInviteeAccessPass(event.id, invitee.id, adminUser);
  assert(passRes.success && passRes.pass, 'Access pass issuance must succeed');
  const eventPass = passRes.pass;
  pass('Event invitee created and access pass issued');

  // 3. Verification step (Strict separation principle: Verification answers "Is credential valid?")
  const preVerify = receptionService.verifyCredential(adminUser, { accessCode: eventPass.displayCode });
  assert(preVerify.success, 'Verification must succeed');
  assert(preVerify.verification?.valid === true, 'Verification result must be valid');
  assert.strictEqual(preVerify.verification?.guestName, 'Alice Henderson', 'Guest name matches invitee');
  assert.strictEqual(preVerify.verification?.organization, 'Henderson Capital', 'Organization matches');
  assert.strictEqual(preVerify.verification?.eventTitle, 'Reception Test Event Gala', 'Event title matches');
  assert.strictEqual(preVerify.verification?.isCheckedIn, false, 'Guest is NOT yet checked in');
  assert.strictEqual(preVerify.verification?.isCheckedOut, false, 'Guest is NOT checked out');
  assert.strictEqual(preVerify.verification?.canCheckIn, true, 'Receptionist can confirm check-in');
  assert.strictEqual(preVerify.verification?.canCheckOut, false, 'Cannot check out before check-in');
  pass('Verification succeeds without checking in');

  // Verify that the pass is NOT consumed by verifyCredential
  const passCheck1 = db.prepare('SELECT use_count, status FROM access_passes WHERE id = ?').get(eventPass.id) as any;
  assert.strictEqual(passCheck1.use_count, 0, 'Verification MUST NOT increment pass use_count');
  assert.strictEqual(passCheck1.status, AccessPassStatus.ACTIVE, 'Pass status remains ACTIVE');

  // Verify that NO access_visits record exists
  const visitCheck1 = db.prepare('SELECT COUNT(*) as count FROM access_visits WHERE access_pass_id = ?').get(eventPass.id) as any;
  assert.strictEqual(visitCheck1.count, 0, 'No access_visits row must exist after pure verification');
  pass('Single-use pass preserved: verification does not consume pass or create visit');

  // 4. Explicit Check-In Confirmation by receptionist
  const checkInRes = receptionService.checkIn(adminUser, { accessPassId: eventPass.id });
  assert(checkInRes.success, 'Explicit check-in confirmation must succeed');
  assert(checkInRes.visit, 'Check-in visit record must be returned');
  assert.strictEqual(checkInRes.visit?.status, AccessVisitStatus.CHECKED_IN, 'Visit status must be CHECKED_IN');
  assert(checkInRes.visit?.checkedInAt, 'checkedInAt must be populated');
  assert.strictEqual(checkInRes.visit?.guestName, 'Alice Henderson', 'Visit has guest name');
  assert.strictEqual(checkInRes.visit?.passType, PassType.EVENT, 'Visit passType is EVENT');
  pass('Explicit check-in creates CHECKED_IN visit record');

  // Verify invitee lifecycle update
  const inviteeCheck = db.prepare('SELECT status FROM event_invitees WHERE id = ?').get(invitee.id) as any;
  assert.strictEqual(inviteeCheck.status, InviteeStatus.CHECKED_IN, 'Invitee status transitioned to CHECKED_IN');
  pass('Event invitee status transitioned to CHECKED_IN');

  // Verify pass consumption on check-in
  const passCheck2 = db.prepare('SELECT use_count, status FROM access_passes WHERE id = ?').get(eventPass.id) as any;
  assert.strictEqual(passCheck2.use_count, 1, 'Check-in increments use_count to 1');
  assert.strictEqual(passCheck2.status, AccessPassStatus.EXHAUSTED, 'Pass status is EXHAUSTED after max_uses reached');
  pass('Single-use pass atomically consumed on explicit check-in');

  // 5. Duplicate Check-In Protection
  const dupCheckIn = receptionService.checkIn(adminUser, { accessPassId: eventPass.id });
  assert(!dupCheckIn.success, 'Duplicate check-in must be rejected');
  assert.strictEqual(dupCheckIn.status, 409, 'Duplicate check-in returns 409 conflict');
  assert(dupCheckIn.error?.toLowerCase().includes('already checked in'), 'Error indicates already checked in');
  pass('Duplicate check-in protection prevents double entry (409)');

  // 6. Verification while checked in
  const midVerify = receptionService.verifyCredential(adminUser, { accessCode: eventPass.displayCode });
  assert(midVerify.success, 'Verification of checked-in guest succeeds');
  assert.strictEqual(midVerify.verification?.isCheckedIn, true, 'Verification reflects isCheckedIn = true');
  assert.strictEqual(midVerify.verification?.canCheckIn, false, 'Cannot check in again');
  assert.strictEqual(midVerify.verification?.canCheckOut, true, 'Can check out');
  assert(midVerify.verification?.activeVisitId, 'Provides active visit ID for checkout');
  pass('Re-verification shows guest is currently checked in with canCheckOut = true');

  // 7. Active Occupancy Query
  const activeList1 = receptionService.listActive(adminUser);
  assert(activeList1.success, 'listActive must succeed');
  const foundActive = activeList1.activeVisits.find((v) => v.accessPassId === eventPass.id);
  assert(foundActive, 'Checked-in guest must appear in active occupancy list');
  assert.strictEqual(foundActive?.guestName, 'Alice Henderson', 'Active occupancy lists guest name');
  pass('Active occupancy query includes currently checked-in guest');

  // Search filter on active occupancy
  const activeSearch = receptionService.listActive(adminUser, { search: 'Henderson' });
  assert(activeSearch.activeVisits.some((v) => v.accessPassId === eventPass.id), 'Active search by name works');
  const activeSearchNone = receptionService.listActive(adminUser, { search: 'NonExistentPersonXYZ' });
  assert(!activeSearchNone.activeVisits.some((v) => v.accessPassId === eventPass.id), 'Active search filters out non-matching');
  pass('Active occupancy search filtering works');

  // 8. Explicit Check-Out
  const checkOutRes = receptionService.checkOut(adminUser, { accessPassId: eventPass.id });
  assert(checkOutRes.success, 'Explicit check-out must succeed');
  assert.strictEqual(checkOutRes.visit?.status, AccessVisitStatus.CHECKED_OUT, 'Visit status is CHECKED_OUT');
  assert(checkOutRes.visit?.checkedOutAt, 'checkedOutAt is populated');
  assert.strictEqual(checkOutRes.visit?.checkedOutBy, adminUser.id, 'checkedOutBy recorded');
  pass('Explicit check-out transitions visit to CHECKED_OUT');

  // Verify invitee lifecycle update to CHECKED_OUT
  const inviteeCheck2 = db.prepare('SELECT status FROM event_invitees WHERE id = ?').get(invitee.id) as any;
  assert.strictEqual(inviteeCheck2.status, InviteeStatus.CHECKED_OUT, 'Invitee status transitioned to CHECKED_OUT');
  pass('Event invitee status transitioned to CHECKED_OUT');

  // Verify active occupancy no longer includes checked-out guest
  const activeList2 = receptionService.listActive(adminUser);
  const foundActiveAfter = activeList2.activeVisits.find((v) => v.accessPassId === eventPass.id);
  assert(!foundActiveAfter, 'Checked-out guest must no longer appear in active occupancy list');
  pass('Checked-out guest is removed from active occupancy list');

  // 9. Duplicate Check-Out Protection
  const dupCheckOut = receptionService.checkOut(adminUser, { accessPassId: eventPass.id });
  assert(!dupCheckOut.success, 'Cannot check out twice');
  assert.strictEqual(dupCheckOut.status, 400, 'Duplicate check-out returns 400');
  pass('Duplicate check-out is rejected');

  // 10. Check-in after check-out with exhausted single-use pass
  const postCheckIn = receptionService.checkIn(adminUser, { accessPassId: eventPass.id });
  assert(!postCheckIn.success, 'Cannot check in again with single-use exhausted pass');
  pass('Re-check-in with exhausted single-use pass is rejected');

  // 11. Verification after check-out
  const postVerify = receptionService.verifyCredential(adminUser, { accessCode: eventPass.displayCode });
  assert(!postVerify.success || !postVerify.verification?.valid, 'Verification after checkout reflects invalid/exhausted');
  assert.strictEqual(postVerify.verification?.isCheckedOut, true, 'Verification reflects isCheckedOut = true');
  assert.strictEqual(postVerify.verification?.canCheckIn, false, 'Cannot check in after checkout');
  pass('Verification after checkout correctly reflects completed visit');

  // =========================================================================
  // SECTION 4: VISITOR (STAFF VISITOR) WORKFLOW
  // =========================================================================
  console.log('\n--- Section 4: Staff Visitor Lifecycle Workflow ---');

  // 1. Create a visitor invitation
  const visitStart = new Date(now.getTime() - 15 * 60 * 1000).toISOString();
  const visitEnd = new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString();
  const visitorVisitId = 'rec-visitor-' + Date.now();

  db.prepare(`
    INSERT INTO visitor_visits (
      id, host_staff_id, visitor_full_name, visitor_email, visitor_phone,
      purpose, notes, valid_from, valid_until, status, access_pass_id,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', NULL, ?, ?)
  `).run(
    visitorVisitId,
    staffUser.id,
    'Marcus Vance',
    'rec.visitor@example.com',
    '+2348099887766',
    'Technical Architecture Review',
    'Meeting at Conference Room B',
    visitStart,
    visitEnd,
    now.toISOString(),
    now.toISOString()
  );

  // Issue visitor access pass
  const visitorPassRes = visitorService.generateVisitorAccessPass(visitorVisitId, staffUser);
  assert(visitorPassRes.success && visitorPassRes.pass, 'Visitor access pass issuance must succeed');
  const visitorPass = visitorPassRes.pass;
  pass('Visitor invitation created and access pass issued');

  // 2. Verify visitor credential
  const visitorVerify = receptionService.verifyCredential(adminUser, { accessCode: visitorPass.displayCode });
  assert(visitorVerify.success && visitorVerify.verification?.valid, 'Visitor verification succeeds');
  assert.strictEqual(visitorVerify.verification?.guestName, 'Marcus Vance', 'Visitor guestName matches');
  assert.strictEqual(visitorVerify.verification?.hostStaffName, `${staffUser.firstName} ${staffUser.lastName}`.trim(), 'Host staff name matches');
  assert.strictEqual(visitorVerify.verification?.passType, PassType.VISITOR, 'Pass type is VISITOR');
  assert.strictEqual(visitorVerify.verification?.canCheckIn, true, 'Can check in');
  pass('Visitor verification returns valid status without consuming pass');

  // 3. Confirm Check-In
  const visitorCheckIn = receptionService.checkIn(adminUser, { accessPassId: visitorPass.id });
  assert(visitorCheckIn.success && visitorCheckIn.visit, 'Visitor check-in succeeds');
  assert.strictEqual(visitorCheckIn.visit?.passType, PassType.VISITOR, 'Visit record has passType VISITOR');
  assert.strictEqual(visitorCheckIn.visit?.visitorVisitId, visitorVisitId, 'Visit links to visitor_visits id');

  // Verify visitor_visits table status updated
  const visitorTableCheck = db.prepare('SELECT status FROM visitor_visits WHERE id = ?').get(visitorVisitId) as any;
  assert.strictEqual(visitorTableCheck.status, VisitorVisitStatus.CHECKED_IN, 'visitor_visits status updated to CHECKED_IN');
  pass('Visitor check-in updates visitor_visits table status to CHECKED_IN');

  // 4. Confirm Check-Out
  const visitorCheckOut = receptionService.checkOut(adminUser, { accessVisitId: visitorCheckIn.visit.id });
  assert(visitorCheckOut.success && visitorCheckOut.visit, 'Visitor check-out succeeds');
  assert.strictEqual(visitorCheckOut.visit?.status, AccessVisitStatus.CHECKED_OUT, 'Visit status is CHECKED_OUT');

  // Verify visitor_visits table status updated to CHECKED_OUT
  const visitorTableCheck2 = db.prepare('SELECT status FROM visitor_visits WHERE id = ?').get(visitorVisitId) as any;
  assert.strictEqual(visitorTableCheck2.status, VisitorVisitStatus.CHECKED_OUT, 'visitor_visits status updated to CHECKED_OUT');
  pass('Visitor check-out updates visitor_visits table status to CHECKED_OUT');

  // =========================================================================
  // SECTION 5: CANCELLATION PROTECTIONS
  // =========================================================================
  console.log('\n--- Section 5: Cancelled Invitee & Visitor Protections ---');

  // 1. Cancelled Invitee
  const cancelledInviteeRes = inviteeService.createInvitee(
    event.id,
    adminUser,
    {
      fullName: 'Cancelled Invitee',
      email: 'rec.cancelled@example.com',
    }
  );
  assert(cancelledInviteeRes.success && cancelledInviteeRes.invitee, 'Created invitee for cancellation test');
  const cancelledPassRes = inviteeService.generateInviteeAccessPass(event.id, cancelledInviteeRes.invitee.id, adminUser);
  assert(cancelledPassRes.success && cancelledPassRes.pass, 'Issued pass for invitee');

  // Cancel the invitee
  inviteeService.cancelInvitee(event.id, cancelledInviteeRes.invitee.id, adminUser, 'No longer attending');

  const cancelVerify = receptionService.verifyCredential(adminUser, { accessCode: cancelledPassRes.pass.displayCode });
  assert(!cancelVerify.success, 'Cancelled invitee must fail verification');
  assert(cancelVerify.verification?.code === 'INVITEE_CANCELLED' || cancelVerify.verification?.code === 'ACCESS_REVOKED', 'Verification code reflects cancellation/revocation');

  const cancelCheckIn = receptionService.checkIn(adminUser, { accessPassId: cancelledPassRes.pass.id });
  assert(!cancelCheckIn.success, 'Cancelled invitee cannot check in');
  pass('Cancelled event invitee cannot verify or check in');

  // 2. Cancelled Visitor
  const cancelledVisitId = 'rec-cancelled-visitor-' + Date.now();
  db.prepare(`
    INSERT INTO visitor_visits (
      id, host_staff_id, visitor_full_name, visitor_email, visitor_phone,
      purpose, notes, valid_from, valid_until, status, access_pass_id,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', NULL, ?, ?)
  `).run(
    cancelledVisitId,
    staffUser.id,
    'Cancelled Visitor',
    'rec.cancelled.visitor@example.com',
    '+2348099887766',
    'Meeting',
    null,
    visitStart,
    visitEnd,
    now.toISOString(),
    now.toISOString()
  );

  const cancelledVisitorPassRes = visitorService.generateVisitorAccessPass(cancelledVisitId, staffUser);
  assert(cancelledVisitorPassRes.success && cancelledVisitorPassRes.pass, 'Issued visitor pass');

  // Cancel visitor visit
  visitorService.cancelVisit(cancelledVisitId, staffUser, 'Meeting called off');

  const cancelVisitorVerify = receptionService.verifyCredential(adminUser, { accessCode: cancelledVisitorPassRes.pass.displayCode });
  assert(!cancelVisitorVerify.success, 'Cancelled visitor must fail verification');

  const cancelVisitorCheckIn = receptionService.checkIn(adminUser, { accessPassId: cancelledVisitorPassRes.pass.id });
  assert(!cancelVisitorCheckIn.success, 'Cancelled visitor cannot check in');
  pass('Cancelled visitor cannot verify or check in');

  // =========================================================================
  // SECTION 6: NON-EXISTENT & INVALID CREDENTIAL PROTECTIONS
  // =========================================================================
  console.log('\n--- Section 6: Security & Invalid Credential Validation ---');

  const invalidVerify = receptionService.verifyCredential(adminUser, { accessCode: 'NON-EXISTENT-CODE' });
  assert(!invalidVerify.success, 'Non-existent code fails verification');
  assert.strictEqual(invalidVerify.status, 404, 'Non-existent credential returns 404');
  pass('Non-existent credential safely rejected with 404');

  const emptyVerify = receptionService.verifyCredential(adminUser, {});
  assert(!emptyVerify.success, 'Empty credential fails verification');
  assert.strictEqual(emptyVerify.status, 400, 'Empty credential returns 400');
  pass('Empty verification input safely rejected with 400');

  const nonExistentCheckOut = receptionService.checkOut(adminUser, { accessVisitId: 'non-existent-visit-id' });
  assert(!nonExistentCheckOut.success, 'Non-existent visit checkout rejected');
  assert.strictEqual(nonExistentCheckOut.status, 404, 'Returns 404');
  pass('Non-existent visit checkout rejected with 404');

  // =========================================================================
  // SECTION 7: AUDIT LOGGING COMPLETENESS
  // =========================================================================
  console.log('\n--- Section 7: Audit Logging Completeness ---');

  const recentLogs = db.prepare(`
    SELECT action, metadata FROM audit_logs 
    WHERE actor_id = ?
    ORDER BY created_at DESC 
    LIMIT 20
  `).all(adminUser.id) as { action: string; metadata: string }[];

  const actions = recentLogs.map((l) => l.action);
  assert(actions.includes('ACCESS_VERIFIED'), 'Audit log must record ACCESS_VERIFIED');
  assert(actions.includes('ACCESS_CHECKED_IN'), 'Audit log must record ACCESS_CHECKED_IN');
  assert(actions.includes('ACCESS_CHECKED_OUT'), 'Audit log must record ACCESS_CHECKED_OUT');
  assert(actions.includes('ACCESS_DENIED'), 'Audit log must record ACCESS_DENIED');
  pass('Complete audit logging verified (ACCESS_VERIFIED, ACCESS_CHECKED_IN, ACCESS_CHECKED_OUT, ACCESS_DENIED)');

  // =========================================================================
  // SECTION 8: ACCESS HISTORY & SUMMARY METRICS
  // =========================================================================
  console.log('\n--- Section 8: History & Summary Metrics ---');

  const historyRes = receptionService.listHistory(adminUser, { limit: 10 });
  assert(historyRes.success, 'listHistory succeeds');
  assert(historyRes.total >= 2, 'History total includes our test visits');
  assert(Array.isArray(historyRes.visits), 'History returns visits array');
  pass('listHistory returns paginated historical records');

  // Filter by status
  const checkedOutHistory = receptionService.listHistory(adminUser, { status: 'CHECKED_OUT' });
  assert(checkedOutHistory.visits.every((v) => v.status === 'CHECKED_OUT'), 'Status filter works correctly');
  pass('listHistory status filter functions accurately');

  // Summary Metrics
  const summaryRes = receptionService.getSummary(adminUser);
  assert(summaryRes.success, 'getSummary succeeds');
  assert(typeof summaryRes.summary.currentlyCheckedIn === 'number', 'currentlyCheckedIn is numeric');
  assert(typeof summaryRes.summary.todayVisitors === 'number', 'todayVisitors is numeric');
  assert(typeof summaryRes.summary.todayEventGuests === 'number', 'todayEventGuests is numeric');
  assert(typeof summaryRes.summary.checkedOutToday === 'number', 'checkedOutToday is numeric');
  assert(typeof summaryRes.summary.accessDeniedToday === 'number', 'accessDeniedToday is numeric');
  assert(summaryRes.summary.checkedOutToday >= 2, 'Checked out today reflects test check-outs');
  pass('getSummary calculates authoritative reception metrics');

  // =========================================================================
  // SECTION 9: QR TOKEN CREDENTIAL VERIFICATION & CHECK-IN
  // =========================================================================
  console.log('\n--- Section 9: QR Token Verification & Check-In ---');

  // Create an active visitor with QR token
  const qrVisitId = 'rec-qr-visit-' + Date.now();
  db.prepare(`
    INSERT INTO visitor_visits (
      id, host_staff_id, visitor_full_name, visitor_email, visitor_phone,
      purpose, notes, valid_from, valid_until, status, access_pass_id,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', NULL, ?, ?)
  `).run(
    qrVisitId,
    staffUser.id,
    'Claire Underwood',
    'claire.qr@example.com',
    '+2348077665544',
    'Executive Consultation',
    null,
    visitStart,
    visitEnd,
    now.toISOString(),
    now.toISOString()
  );

  const qrPassRes = visitorService.generateVisitorAccessPass(qrVisitId, staffUser);
  assert(qrPassRes.success && qrPassRes.pass && qrPassRes.pass.rawToken, 'QR pass generated with rawToken');
  const rawQrToken = qrPassRes.pass.rawToken;

  // Verify using rawToken instead of code
  const tokenVerify = receptionService.verifyCredential(adminUser, { token: rawQrToken });
  assert(tokenVerify.success && tokenVerify.verification?.valid, 'Verification by QR token succeeds');
  assert.strictEqual(tokenVerify.verification?.guestName, 'Claire Underwood', 'Guest name matches from token query');
  assert.strictEqual(tokenVerify.verification?.canCheckIn, true, 'canCheckIn is true for token verification');
  pass('QR token verification succeeds and extracts correct guest');

  // Check in using token
  const tokenCheckIn = receptionService.checkIn(adminUser, { token: rawQrToken });
  assert(tokenCheckIn.success && tokenCheckIn.visit, 'Check-in using raw QR token succeeds');
  assert.strictEqual(tokenCheckIn.visit?.guestName, 'Claire Underwood', 'Visit records guest name');
  pass('Check-in via raw QR token succeeds');

  // Check out using accessCode
  const codeCheckOut = receptionService.checkOut(adminUser, { accessCode: qrPassRes.pass.displayCode });
  assert(codeCheckOut.success && codeCheckOut.visit, 'Check-out using accessCode succeeds');
  assert.strictEqual(codeCheckOut.visit?.status, AccessVisitStatus.CHECKED_OUT, 'Check-out by code transitions status to CHECKED_OUT');
  pass('Check-out via human-readable accessCode succeeds');

  // =========================================================================
  // SECTION 10: SUPER_ADMIN OPERATIONS & CONCURRENCY
  // =========================================================================
  console.log('\n--- Section 10: SuperAdmin Reception & Concurrency ---');

  // Create another active visit for superadmin check-in
  const saVisitId = 'rec-sa-visit-' + Date.now();
  db.prepare(`
    INSERT INTO visitor_visits (
      id, host_staff_id, visitor_full_name, visitor_email, visitor_phone,
      purpose, notes, valid_from, valid_until, status, access_pass_id,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', NULL, ?, ?)
  `).run(
    saVisitId,
    staffUser.id,
    'Senator Thomas',
    'senator@example.com',
    null,
    'Official Visit',
    null,
    visitStart,
    visitEnd,
    now.toISOString(),
    now.toISOString()
  );

  const saPassRes = visitorService.generateVisitorAccessPass(saVisitId, staffUser);
  assert(saPassRes.success && saPassRes.pass, 'Issued pass for SuperAdmin test');

  // SuperAdmin checks in
  const saCheckIn = receptionService.checkIn(superAdminUser, { accessPassId: saPassRes.pass.id });
  assert(saCheckIn.success && saCheckIn.visit, 'SUPER_ADMIN can execute reception check-in');
  assert.strictEqual(saCheckIn.visit?.checkedInBy, superAdminUser.id, 'checkedInBy accurately records superadmin ID');
  pass('SUPER_ADMIN successfully performs reception check-in');

  // SuperAdmin lists active
  const saActive = receptionService.listActive(superAdminUser);
  assert(saActive.success && saActive.activeVisits.some((v) => v.accessPassId === saPassRes.pass.id), 'SUPER_ADMIN lists active occupancy');
  pass('SUPER_ADMIN successfully queries active occupancy');

  // SuperAdmin checks out
  const saCheckOut = receptionService.checkOut(superAdminUser, { accessPassId: saPassRes.pass.id });
  assert(saCheckOut.success && saCheckOut.visit, 'SUPER_ADMIN can execute reception check-out');
  assert.strictEqual(saCheckOut.visit?.checkedOutBy, superAdminUser.id, 'checkedOutBy accurately records superadmin ID');
  pass('SUPER_ADMIN successfully performs reception check-out');

  // =========================================================================
  // SECTION 11: ADVANCED HISTORY FILTERING & PAGINATION
  // =========================================================================
  console.log('\n--- Section 11: Advanced History Filters & Pagination ---');

  // Pass type filter: EVENT
  const eventHistory = receptionService.listHistory(adminUser, { passType: 'EVENT' });
  assert(eventHistory.success, 'History with passType=EVENT succeeds');
  assert(eventHistory.visits.every((v) => v.passType === PassType.EVENT), 'All returned visits have passType EVENT');
  pass('listHistory passType=EVENT filter works accurately');

  // Pass type filter: VISITOR
  const visitorHistory = receptionService.listHistory(adminUser, { passType: 'VISITOR' });
  assert(visitorHistory.success, 'History with passType=VISITOR succeeds');
  assert(visitorHistory.visits.every((v) => v.passType === PassType.VISITOR), 'All returned visits have passType VISITOR');
  pass('listHistory passType=VISITOR filter works accurately');

  // Pagination limit & page
  const page1 = receptionService.listHistory(adminUser, { limit: 2, page: 1 });
  assert(page1.success && page1.visits.length <= 2, 'Page 1 respects limit 2');
  assert.strictEqual(page1.page, 1, 'Page number is 1');
  assert.strictEqual(page1.limit, 2, 'Limit is 2');
  pass('listHistory pagination parameters (page, limit) work correctly');

  // Search filter in history
  const searchHistory = receptionService.listHistory(adminUser, { search: 'Underwood' });
  assert(searchHistory.success && searchHistory.visits.some((v) => v.guestName?.includes('Underwood')), 'Search by guest name in history works');
  pass('listHistory search filter accurately locates historical guest records');

  // =========================================================================
  // SECTION 12: IDEMPOTENCY, NORMALIZATION & EDGE CASES
  // =========================================================================
  console.log('\n--- Section 12: Idempotency & Normalization ---');

  // Case insensitivity: verify with lower-case code
  const lowerVerify = receptionService.verifyCredential(adminUser, { accessCode: eventPass.displayCode.toLowerCase() });
  assert(lowerVerify.verification?.valid === false, 'Exhausted event pass is correctly recognized even with lowercase input');
  assert(lowerVerify.verification?.isCheckedOut === true, 'Underlying pass state resolved via case-insensitive query');
  pass('Credential normalization handles lowercase/mixed-case display code input');

  // Active visit count matches sum
  const activeNow = receptionService.listActive(adminUser);
  const summaryNow = receptionService.getSummary(adminUser);
  assert.strictEqual(activeNow.total, summaryNow.summary.currentlyCheckedIn, 'Active list total exactly matches summary currentlyCheckedIn metric');
  pass('Active occupancy count and summary metrics are strictly in sync');

  // Denied access increments accessDeniedToday
  const prevDenied = summaryNow.summary.accessDeniedToday;
  receptionService.verifyCredential(adminUser, { accessCode: 'INVALID-CODE-XYZ' });
  const afterDeniedSummary = receptionService.getSummary(adminUser);
  assert.strictEqual(afterDeniedSummary.summary.accessDeniedToday, prevDenied + 1, 'accessDeniedToday increments on ACCESS_DENIED');
  pass('Summary accessDeniedToday metric increments dynamically upon access denial');

  console.log(`\n======================================================`);
  console.log(`PHASE 6F TESTS COMPLETE: ALL ${testCount} TESTS PASSED!`);
  console.log(`======================================================\n`);
}

runPhase6FTests().catch((err) => {
  console.error('Phase 6F Test Run Failed:', err);
  process.exit(1);
});
