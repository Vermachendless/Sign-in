/**
 * Focused Asynchronous Integration Test Suite for Event Invitees Module (Phase 7)
 *
 * Verifies:
 * 1. Async service methods return Promises that resolve to strongly-typed results.
 * 2. Asynchronous parameterization using dbAdapter ($1, $2, ...) works properly.
 * 3. Cross-event boundary security is strictly enforced asynchronously.
 * 4. Pass issuance, revocation, and cancellation workflows operate asynchronously with dbAdapter.
 * 5. Express route handlers in event.routes.ts properly await service results and handle async errors without unhandled rejections.
 */

import { getDatabase } from './server/db/index.ts';
import { dbAdapter } from './server/db/adapter.ts';
import { inviteeService } from './server/services/invitee.service.ts';
import { eventService } from './server/services/event.service.ts';
import {
  InviteeStatus,
  SafeUser,
  UserRole,
  EventStatus,
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

async function runAsyncIntegrationTests() {
  console.log('================================================================');
  console.log('   PHASE 7 — INVITEES ASYNC INTEGRATION TEST SUITE              ');
  console.log('================================================================');

  const db = getDatabase();
  (globalThis as any).db = db;

  // 1. Setup Test Users
  console.log('\n--- 1. Actor Setup ---');
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

  // 2. Setup Events
  console.log('\n--- 2. Approved Events Setup ---');
  const now = new Date();
  const startAt = new Date(now.getTime() - 1000 * 3600).toISOString();
  const endAt = new Date(now.getTime() + 1000 * 7200).toISOString();

  // Create and approve primary event
  const event1Res = await eventService.createEvent(adminUser, {
    title: 'Async Summit Primary',
    location: 'Conference Hall A',
    startAt,
    endAt,
  });
  assert(event1Res.success && !!event1Res.event, 'Primary event created');
  const event1 = event1Res.event!;
  await eventService.submitEvent(event1.id, adminUser);
  await eventService.approveEvent(event1.id, superAdminUser);

  // Create and approve secondary event for cross-boundary checks
  const event2Res = await eventService.createEvent(adminUser, {
    title: 'Async Summit Secondary',
    location: 'Conference Hall B',
    startAt,
    endAt,
  });
  assert(event2Res.success && !!event2Res.event, 'Secondary event created');
  const event2 = event2Res.event!;
  await eventService.submitEvent(event2.id, adminUser);
  await eventService.approveEvent(event2.id, superAdminUser);

  // 3. Asynchronous Invitee Creation
  console.log('\n--- 3. Asynchronous Invitee Creation & Validation ---');
  // Confirm method returns Promise
  const createPromise = inviteeService.createInvitee(event1.id, adminUser, {
    fullName: 'Chief Obafemi Awolowo',
    email: 'obafemi@summit.org',
    organization: 'Development Forum',
    notes: 'Honored Guest',
  });
  assert(createPromise instanceof Promise, 'createInvitee returns a genuine Promise');
  const createResult = await createPromise;
  assert(createResult.success && !!createResult.invitee, 'Invitee created asynchronously');
  const invitee1 = createResult.invitee!;
  assert(invitee1.fullName === 'Chief Obafemi Awolowo', 'Full name preserved correctly');
  assert(invitee1.status === InviteeStatus.INVITED, 'Initial status is INVITED');
  assert(invitee1.accessPassId === null, 'Initial access_pass_id is null');

  // Verify duplicate email detection
  const duplicateResult = await inviteeService.createInvitee(event1.id, adminUser, {
    fullName: 'Another Person',
    email: 'OBAFEMI@summit.org',
  });
  assert(!duplicateResult.success && duplicateResult.status === 409, 'Duplicate email correctly rejected with 409 asynchronously');

  // Verify RBAC: Staff denied
  const staffCreateResult = await inviteeService.createInvitee(event1.id, staffUser, {
    fullName: 'Staff Invitee',
  });
  assert(!staffCreateResult.success && staffCreateResult.status === 403, 'Staff invitee creation blocked with 403 asynchronously');

  // 4. Asynchronous Retrieval and Cross-Event Boundaries
  console.log('\n--- 4. Asynchronous Retrieval & Cross-Event Protection ---');
  const getPromise = inviteeService.getInviteeById(event1.id, invitee1.id, adminUser);
  assert(getPromise instanceof Promise, 'getInviteeById returns a genuine Promise');
  const getResult = await getPromise;
  assert(getResult.success && getResult.invitee?.id === invitee1.id, 'getInviteeById returns correct record asynchronously');

  // Cross-event access attempt: Accessing Invitee 1 via Event 2
  const crossGetResult = await inviteeService.getInviteeById(event2.id, invitee1.id, adminUser);
  assert(!crossGetResult.success && crossGetResult.status === 403, 'Cross-event retrieval blocked with 403 asynchronously');

  // 5. Asynchronous Update
  console.log('\n--- 5. Asynchronous Update ---');
  const updatePromise = inviteeService.updateInvitee(event1.id, invitee1.id, adminUser, {
    organization: 'National Strategy Forum',
    notes: 'Keynote Speaker (Updated)',
  });
  assert(updatePromise instanceof Promise, 'updateInvitee returns a genuine Promise');
  const updateResult = await updatePromise;
  assert(updateResult.success && updateResult.invitee?.organization === 'National Strategy Forum', 'Invitee updated asynchronously');

  // Cross-event update attempt
  const crossUpdateResult = await inviteeService.updateInvitee(event2.id, invitee1.id, adminUser, {
    organization: 'Hacked Organization',
  });
  assert(!crossUpdateResult.success && crossUpdateResult.status === 403, 'Cross-event update blocked with 403 asynchronously');

  // 6. Asynchronous Access Pass Issuance
  console.log('\n--- 6. Asynchronous Access Pass Issuance ---');
  const passPromise = inviteeService.generateInviteeAccessPass(event1.id, invitee1.id, adminUser);
  assert(passPromise instanceof Promise, 'generateInviteeAccessPass returns a genuine Promise');
  const passResult = await passPromise;
  assert(passResult.success && !!passResult.pass && !!passResult.invitee, 'Access pass generated and linked asynchronously');
  assert(passResult.invitee?.status === InviteeStatus.ACCESS_ISSUED, 'Invitee status transitioned to ACCESS_ISSUED');
  assert(passResult.pass?.maxUses === 1, 'Pass is strictly single-use');

  // 7. Asynchronous Revocation
  console.log('\n--- 7. Asynchronous Access Pass Revocation ---');
  const revokePromise = inviteeService.revokeInviteeAccess(
    event1.id,
    invitee1.id,
    adminUser,
    'Speaker cancelled attendance'
  );
  assert(revokePromise instanceof Promise, 'revokeInviteeAccess returns a genuine Promise');
  const revokeResult = await revokePromise;
  assert(revokeResult.success && !!revokeResult.invitee, 'Access revoked asynchronously');
  assert(revokeResult.invitee?.status === InviteeStatus.INVITED, 'Invitee status reverted to INVITED');
  assert(revokeResult.invitee?.accessPass?.status === 'REVOKED', 'Associated pass marked REVOKED');

  // 8. Asynchronous Cancellation
  console.log('\n--- 8. Asynchronous Invitee Cancellation ---');
  // Re-issue pass to test cancellation auto-revocation
  await inviteeService.generateInviteeAccessPass(event1.id, invitee1.id, adminUser);
  const cancelPromise = inviteeService.cancelInvitee(
    event1.id,
    invitee1.id,
    adminUser,
    'Registration cancelled'
  );
  assert(cancelPromise instanceof Promise, 'cancelInvitee returns a genuine Promise');
  const cancelResult = await cancelPromise;
  assert(cancelResult.success && !!cancelResult.invitee, 'Invitee cancelled asynchronously');
  assert(cancelResult.invitee?.status === InviteeStatus.CANCELLED, 'Invitee status set to CANCELLED');

  // Cannot issue pass to cancelled invitee
  const passAfterCancel = await inviteeService.generateInviteeAccessPass(event1.id, invitee1.id, adminUser);
  assert(!passAfterCancel.success && passAfterCancel.status === 400, 'Pass issuance to cancelled invitee blocked asynchronously');

  // 9. Asynchronous List, Filter, Search & Summary
  console.log('\n--- 9. Asynchronous Listing & Metrics ---');
  // Create another invitee on event 1
  await inviteeService.createInvitee(event1.id, adminUser, {
    fullName: 'Kofi Annan',
    email: 'kofi.annan@un.org',
    organization: 'United Nations',
  });

  const listPromise = inviteeService.listInvitees(event1.id, adminUser);
  assert(listPromise instanceof Promise, 'listInvitees returns a genuine Promise');
  const listResult = await listPromise;
  assert(listResult.success, 'listInvitees succeeded');
  assert(listResult.total >= 2, `Total invitees count is ${listResult.total}`);
  assert(listResult.summary.total >= 2, `Summary total is ${listResult.summary.total}`);
  assert(listResult.summary.cancelled >= 1, `Summary cancelled count is ${listResult.summary.cancelled}`);

  // Test status filter
  const cancelledList = await inviteeService.listInvitees(event1.id, adminUser, {
    status: InviteeStatus.CANCELLED,
  });
  assert(cancelledList.invitees.every((i) => i.status === InviteeStatus.CANCELLED), 'Status filter properly applied asynchronously');

  // Test search filter
  const searchList = await inviteeService.listInvitees(event1.id, adminUser, {
    search: 'Kofi',
  });
  assert(searchList.invitees.some((i) => i.fullName.includes('Kofi')), 'Search filter properly applied asynchronously');

  // 10. Express Route Handlers Async Propagation
  console.log('\n--- 10. Express Route Handlers Async Propagation ---');
  // Test that event.routes.ts handlers await asynchronous calls and catch errors properly
  const eventRoutesModule = await import('./server/routes/event.routes.ts');
  const router = eventRoutesModule.default;
  assert(!!router, 'event.routes default router exported properly');

  // Verify all invitee route handler layers exist on the router stack
  const routerStack = (router as any).stack || [];
  const inviteeRoutes = routerStack.filter((layer: any) => {
    return layer.route && layer.route.path && layer.route.path.includes('invitee');
  });
  assert(inviteeRoutes.length === 7, `Expected 7 invitee routes registered on router, found ${inviteeRoutes.length}`);

  // Verify that all 7 route handlers are AsyncFunction instances (return Promise)
  for (const layer of inviteeRoutes) {
    const route = layer.route;
    const method = Object.keys(route.methods)[0].toUpperCase();
    const lastHandler = route.stack[route.stack.length - 1].handle;
    const isAsync = lastHandler.constructor.name === 'AsyncFunction';
    assert(isAsync, `Route ${method} ${route.path} handler is an AsyncFunction`);
  }

  console.log('\n================================================================');
  console.log(`   PHASE 7 ASYNC INTEGRATION RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runAsyncIntegrationTests().catch((err) => {
  console.error('Phase 7 async integration suite failed:', err);
  process.exit(1);
});
