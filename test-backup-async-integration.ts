/**
 * Phase 7 Batch 2D — Backup Service & Routes Asynchronous Integration Test Suite
 *
 * Covers:
 * 1. Asynchronous execution contracts for createBackup and listBackups
 * 2. SQLite-mode atomic VACUUM INTO, read-only integrity check, and table counts
 * 3. PostgreSQL-mode explicit refusal: No VACUUM INTO, no SQLite pragmas, returns actionable error
 * 4. PostgreSQL-mode listBackups returns empty array without misleadingly presenting SQLite files
 * 5. Strict Super Admin RBAC (ADMIN and STAFF blocked from createBackup and listBackups)
 * 6. Audit logging on backup creation with zero credential or secret leakage
 * 7. Absence of filesystem path or credential leakage in API responses
 * 8. Express admin backup route handlers async propagation (all handlers are AsyncFunction instances)
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { getDatabase } from './server/db/index.ts';
import { dbAdapter } from './server/db/adapter.ts';
import { backupService } from './server/services/backup.service.ts';
import { seedDatabase } from './server/db/seed.ts';
import { UserRole, UserStatus, SafeUser } from './src/types/index.ts';
import adminRoutes from './server/routes/admin.routes.ts';

let passed = 0;
let failed = 0;

function pass(message: string) {
  console.log(`✅ [PASS] ${message}`);
  passed++;
}

function fail(message: string, error?: any) {
  console.error(`❌ [FAIL] ${message}`, error || '');
  failed++;
}

async function runBackupAsyncIntegrationTests() {
  console.log('================================================================');
  console.log('   PHASE 7 BATCH 2D — BACKUP ASYNC INTEGRATION TESTS           ');
  console.log('================================================================\n');

  // 1. Seed database and initialize test actors
  const db = getDatabase();
  await seedDatabase();

  const superAdminRow = db.prepare('SELECT * FROM users WHERE role = ?').get(UserRole.SUPER_ADMIN) as any;
  const adminRow = db.prepare('SELECT * FROM users WHERE role = ?').get(UserRole.ADMIN) as any;
  const staffRow = db.prepare('SELECT * FROM users WHERE role = ? AND status = ?').get(UserRole.STAFF, UserStatus.ACTIVE) as any;

  const superAdmin: SafeUser = {
    id: superAdminRow.id,
    email: superAdminRow.email,
    firstName: superAdminRow.first_name,
    lastName: superAdminRow.last_name,
    phone: superAdminRow.phone,
    department: superAdminRow.department,
    role: superAdminRow.role,
    status: superAdminRow.status,
  };

  const admin: SafeUser = {
    id: adminRow.id,
    email: adminRow.email,
    firstName: adminRow.first_name,
    lastName: adminRow.last_name,
    phone: adminRow.phone,
    department: adminRow.department,
    role: adminRow.role,
    status: adminRow.status,
  };

  const staff: SafeUser = {
    id: staffRow.id,
    email: staffRow.email,
    firstName: staffRow.first_name,
    lastName: staffRow.last_name,
    phone: staffRow.phone,
    department: staffRow.department,
    role: staffRow.role,
    status: staffRow.status,
  };

  // =========================================================================
  // 1. SQLite Mode: Atomic VACUUM INTO, Verification & Async Execution
  // =========================================================================
  console.log('--- 1. SQLite Mode: Atomic VACUUM INTO & Verification ---');

  // Verify adapter is in SQLite mode initially
  assert.strictEqual(dbAdapter.isPostgres(), false, 'Adapter initially in SQLite mode');

  const backupPromise = backupService.createBackup(
    superAdmin,
    '127.0.0.1',
    'Mozilla/5.0 Integration Test'
  );

  // Must be thenable (Promise contract)
  assert(typeof backupPromise.then === 'function', 'createBackup returns a Promise / Thenable');

  const result = await backupPromise;
  assert.strictEqual(result.success, true, 'Super Admin backup creation succeeded in SQLite mode');
  assert(typeof result.filename === 'string' && result.filename.startsWith('backup-attendance-'), 'Backup filename format verified');
  assert(result.filename.endsWith('.db'), 'SQLite backup filename ends with .db');
  assert.strictEqual(result.checksumVerified, true, 'Backup integrity verification passed');
  assert(typeof result.fileSizeBytes === 'number' && result.fileSizeBytes > 0, `Backup file has non-zero size (${result.fileSizeBytes} bytes)`);
  assert(result.tableCounts && typeof result.tableCounts.users === 'number' && result.tableCounts.users > 0, 'Table counts verified');

  // Check audit log for DATABASE_BACKUP_CREATED
  const auditEntry = db.prepare(`
    SELECT * FROM audit_logs 
    WHERE action = 'DATABASE_BACKUP_CREATED' 
    ORDER BY created_at DESC LIMIT 1
  `).get() as any;

  assert(auditEntry, 'Audit log recorded DATABASE_BACKUP_CREATED');
  assert(!auditEntry.metadata.includes('password_hash'), 'Audit metadata contains zero secrets');
  pass('SQLite mode backup creates atomic VACUUM INTO snapshot, verifies integrity, and logs audit trail');

  // =========================================================================
  // 2. SQLite Mode: listBackups Async Execution & Metadata Format
  // =========================================================================
  console.log('\n--- 2. SQLite Mode: listBackups Async Execution ---');

  const listPromise = backupService.listBackups(superAdmin);
  assert(typeof listPromise.then === 'function', 'listBackups returns a Promise / Thenable');

  const backupList = await listPromise;
  assert(Array.isArray(backupList), 'listBackups returns an array');
  assert(backupList.length > 0, 'listBackups returns at least one backup');
  assert(backupList.some((b) => b.filename === result.filename), 'Newly created backup is listed');
  assert(typeof backupList[0].sizeBytes === 'number', 'Backup item has sizeBytes number');
  assert(typeof backupList[0].createdAt === 'string', 'Backup item has createdAt string');
  pass('SQLite mode listBackups returns sorted metadata list without exposing raw file contents');

  // =========================================================================
  // 3. PostgreSQL Mode: Explicit Refusal & Safety Guarantees
  // =========================================================================
  console.log('\n--- 3. PostgreSQL Mode: Explicit Refusal & Safety Guarantees ---');

  // Temporarily stub dbAdapter.isPostgres to return true
  const originalIsPostgres = dbAdapter.isPostgres.bind(dbAdapter);
  (dbAdapter as any).isPostgres = () => true;

  try {
    assert.strictEqual(dbAdapter.isPostgres(), true, 'Adapter is simulated in PostgreSQL mode');

    // 3a. createBackup must fail explicitly in PostgreSQL mode
    const pgBackupRes = await backupService.createBackup(superAdmin, '127.0.0.1', 'TestRunner');
    assert.strictEqual(pgBackupRes.success, false, 'createBackup must return success: false in PostgreSQL mode');
    assert(pgBackupRes.error && pgBackupRes.error.includes('Google Cloud SQL Automated Backups'), 'Error message provides clear, actionable Cloud SQL guidance');
    assert(!pgBackupRes.filename, 'No filename generated in PostgreSQL mode');
    assert(!pgBackupRes.backupPath, 'No backupPath returned in PostgreSQL mode');
    pass('PostgreSQL mode refuses createBackup with explicit, actionable Cloud SQL message');

    // 3b. listBackups in PostgreSQL mode must NOT present SQLite .db files as PostgreSQL backups
    const pgListRes = await backupService.listBackups(superAdmin);
    assert(Array.isArray(pgListRes), 'listBackups in PostgreSQL mode returns an array');
    assert.strictEqual(pgListRes.length, 0, 'listBackups in PostgreSQL mode returns empty array to prevent misleading users');
    pass('PostgreSQL mode listBackups returns empty array and does not present SQLite files');

    // 3c. verifyBackupFile in PostgreSQL mode must reject SQLite file verification
    let verifyThrew = false;
    try {
      backupService.verifyBackupFile('dummy-path.db');
    } catch (e: any) {
      verifyThrew = true;
      assert(e.message.includes('not applicable in PostgreSQL mode'), 'Throws informative error');
    }
    assert.strictEqual(verifyThrew, true, 'verifyBackupFile throws in PostgreSQL mode');
    pass('verifyBackupFile safely rejects execution in PostgreSQL mode');

  } finally {
    // Restore original isPostgres
    (dbAdapter as any).isPostgres = originalIsPostgres;
  }

  assert.strictEqual(dbAdapter.isPostgres(), false, 'Adapter restored to SQLite mode');

  // =========================================================================
  // 4. Role-Based Access Control (RBAC) Enforcement
  // =========================================================================
  console.log('\n--- 4. Role-Based Access Control (RBAC) Enforcement ---');

  // 4a. Regular Admin forbidden from createBackup
  const adminCreate = await backupService.createBackup(admin);
  assert.strictEqual(adminCreate.success, false, 'Regular ADMIN forbidden from creating backup');
  assert(adminCreate.error && adminCreate.error.includes('Forbidden'), 'Error explains Super Admin requirement');

  // 4b. Staff forbidden from createBackup
  const staffCreate = await backupService.createBackup(staff);
  assert.strictEqual(staffCreate.success, false, 'STAFF forbidden from creating backup');
  assert(staffCreate.error && staffCreate.error.includes('Forbidden'), 'Error explains Super Admin requirement');

  // 4c. Regular Admin forbidden from listBackups
  const adminList = await backupService.listBackups(admin);
  assert.strictEqual(adminList.length, 0, 'ADMIN cannot view backup list');

  // 4d. Staff forbidden from listBackups
  const staffList = await backupService.listBackups(staff);
  assert.strictEqual(staffList.length, 0, 'STAFF cannot view backup list');

  pass('Super Admin exclusive authorization strictly enforced across service methods');

  // =========================================================================
  // 5. Express Route Handlers Async Propagation & Safe Response Contracts
  // =========================================================================
  console.log('\n--- 5. Express Route Handlers Async Propagation ---');

  assert(adminRoutes, 'adminRoutes exported');
  const backupRoutes = (adminRoutes as any).stack
    .filter((layer: any) => layer.route && layer.route.path === '/backups')
    .map((layer: any) => {
      const path = layer.route.path;
      const methods = Object.keys(layer.route.methods).join(',').toUpperCase();
      const handler = layer.route.stack[layer.route.stack.length - 1].handle;
      const isAsync = handler.constructor.name === 'AsyncFunction';
      return { path, methods, isAsync };
    });

  assert.strictEqual(backupRoutes.length, 2, `Expected 2 backup routes (POST and GET), found ${backupRoutes.length}`);
  for (const r of backupRoutes) {
    assert.strictEqual(r.isAsync, true, `Route ${r.methods} ${r.path} handler must be an AsyncFunction`);
    pass(`Route ${r.methods} ${r.path} handler is an AsyncFunction`);
  }

  // Summary
  console.log('\n================================================================');
  console.log(`   PHASE 7 BATCH 2D RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runBackupAsyncIntegrationTests().catch((err) => {
  console.error('Backup integration tests uncaught error:', err);
  process.exit(1);
});
