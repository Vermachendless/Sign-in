/**
 * Focused Transaction Concurrency & Ownership Test Suite (Phase 7 Batch 1B)
 *
 * Verifies:
 * Test A: Independent transactions are serialized (controlled async gates)
 * Test B: Nested calls reuse owner's transaction without independent commit
 * Test C: One transaction failure does not roll back another (queue isolation)
 * Test D: Nested failure propagates and rolls back owning root transaction
 * Test E: Lock recovery after forced rejection (no queue poisoning)
 * Test F: Invitee pass generation, revocation, and cancellation rollback regressions
 */

import { getDatabase } from './server/db/index.ts';
import { dbAdapter, DbAdapter } from './server/db/adapter.ts';
import { inviteeService } from './server/services/invitee.service.ts';
import { eventService } from './server/services/event.service.ts';
import {
  InviteeStatus,
  SafeUser,
  UserRole,
  AccessPassStatus,
} from './src/types/index.ts';

let passed = 0;
let failed = 0;
let unhandledRejections = 0;

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection detected:', reason);
  unhandledRejections++;
});

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`✅ [PASS] ${message}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${message}`);
    failed++;
  }
}

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function runConcurrencyTests() {
  console.log('================================================================');
  console.log('   PHASE 7 BATCH 1B — TRANSACTION CONCURRENCY & OWNERSHIP TESTS ');
  console.log('================================================================');

  const db = getDatabase();
  (globalThis as any).db = db;

  // Initialize test table for deterministic concurrency assertions
  db.exec(`
    CREATE TABLE IF NOT EXISTS _test_tx_concurrency (
      id TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      step INTEGER NOT NULL
    );
  `);
  db.exec('DELETE FROM _test_tx_concurrency;');

  // --- Test A: Independent transactions are serialized ---
  console.log('\n--- Test A: Independent Transactions Serialized via AsyncMutex ---');
  const gateA_started = createDeferred<void>();
  const gateA_allowFinish = createDeferred<void>();
  let bStartedWhileAPaused = false;

  const promiseA = dbAdapter.transaction(async (txA) => {
    await txA.execute(
      'INSERT INTO _test_tx_concurrency (id, value, step) VALUES ($1, $2, $3)',
      ['tx_a', 'started_a', 1]
    );
    gateA_started.resolve();
    // Pause A at controlled gate
    await gateA_allowFinish.promise;
    await txA.execute(
      'UPDATE _test_tx_concurrency SET value = $1, step = $2 WHERE id = $3',
      ['finished_a', 2, 'tx_a']
    );
    return 'result_a';
  });

  // Wait until Transaction A is actively inside its transaction block
  await gateA_started.promise;

  // Launch Transaction B on root dbAdapter while A is paused
  const promiseB = dbAdapter.transaction(async (txB) => {
    bStartedWhileAPaused = true;
    await txB.execute(
      'INSERT INTO _test_tx_concurrency (id, value, step) VALUES ($1, $2, $3)',
      ['tx_b', 'finished_b', 3]
    );
    return 'result_b';
  });

  // Yield to event loop multiple times to allow B to attempt execution
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setTimeout(r, 10));

  assert(
    bStartedWhileAPaused === false,
    'Transaction B is blocked and cannot execute while Transaction A holds the lock'
  );

  // Release Transaction A
  gateA_allowFinish.resolve();

  // Await both transactions
  const [resA, resB] = await Promise.all([promiseA, promiseB]);
  assert(resA === 'result_a', 'Transaction A committed successfully');
  assert(resB === 'result_b', 'Transaction B committed successfully');

  // Verify database state: both executed and persisted in correct serialized order
  const rowA = db.prepare('SELECT * FROM _test_tx_concurrency WHERE id = ?').get('tx_a') as any;
  const rowB = db.prepare('SELECT * FROM _test_tx_concurrency WHERE id = ?').get('tx_b') as any;
  assert(rowA && rowA.value === 'finished_a' && rowA.step === 2, 'Row A persisted correctly');
  assert(rowB && rowB.value === 'finished_b' && rowB.step === 3, 'Row B persisted correctly after A');

  // --- Test B: Nested calls reuse owner's transaction ---
  console.log('\n--- Test B: Nested Calls Reuse Owner Transaction Scope ---');
  let nestedRan = false;
  await dbAdapter.transaction(async (rootTx) => {
    await rootTx.execute(
      'INSERT INTO _test_tx_concurrency (id, value, step) VALUES ($1, $2, $3)',
      ['nested_root', 'root_val', 10]
    );

    const nestedResult = await rootTx.transaction(async (nestedTx) => {
      nestedRan = true;
      await nestedTx.execute(
        'INSERT INTO _test_tx_concurrency (id, value, step) VALUES ($1, $2, $3)',
        ['nested_child', 'child_val', 11]
      );
      return 'nested_ok';
    });

    assert(nestedResult === 'nested_ok', 'Nested transaction returned expected result');
  });

  assert(nestedRan, 'Nested transaction callback was executed');
  const rootRow = db.prepare('SELECT * FROM _test_tx_concurrency WHERE id = ?').get('nested_root') as any;
  const childRow = db.prepare('SELECT * FROM _test_tx_concurrency WHERE id = ?').get('nested_child') as any;
  assert(rootRow && rootRow.value === 'root_val', 'Root transaction write committed');
  assert(childRow && childRow.value === 'child_val', 'Nested transaction write committed with parent');

  // --- Test C: One transaction failure does not roll back another ---
  console.log('\n--- Test C: Independent Transaction Failure Does Not Poison or Roll Back Others ---');
  const failPromise = dbAdapter.transaction(async (txFail) => {
    await txFail.execute(
      'INSERT INTO _test_tx_concurrency (id, value, step) VALUES ($1, $2, $3)',
      ['tx_failing', 'will_fail', 20]
    );
    throw new Error('INTENTIONAL_TX_FAILURE');
  });

  const successPromise = dbAdapter.transaction(async (txSuccess) => {
    await txSuccess.execute(
      'INSERT INTO _test_tx_concurrency (id, value, step) VALUES ($1, $2, $3)',
      ['tx_surviving', 'will_survive', 21]
    );
    return 'survived';
  });

  let failError: any = null;
  try {
    await failPromise;
  } catch (err) {
    failError = err;
  }
  const successRes = await successPromise;

  assert(failError && failError.message === 'INTENTIONAL_TX_FAILURE', 'Failing transaction threw as expected');
  assert(successRes === 'survived', 'Subsequent queued transaction executed and committed');

  const failRow = db.prepare('SELECT * FROM _test_tx_concurrency WHERE id = ?').get('tx_failing');
  const surviveRow = db.prepare('SELECT * FROM _test_tx_concurrency WHERE id = ?').get('tx_surviving') as any;
  assert(!failRow, 'Failing transaction writes were rolled back');
  assert(surviveRow && surviveRow.value === 'will_survive', 'Surviving transaction writes were committed');

  // --- Test D: Nested failure propagates and rolls back owning root transaction ---
  console.log('\n--- Test D: Nested Failure Propagates and Rolls Back Entire Transaction ---');
  let nestedErrorCaught = false;
  try {
    await dbAdapter.transaction(async (rootTx) => {
      await rootTx.execute(
        'INSERT INTO _test_tx_concurrency (id, value, step) VALUES ($1, $2, $3)',
        ['nested_fail_root', 'should_rollback', 30]
      );

      await rootTx.transaction(async (nestedTx) => {
        await nestedTx.execute(
          'INSERT INTO _test_tx_concurrency (id, value, step) VALUES ($1, $2, $3)',
          ['nested_fail_child', 'should_rollback', 31]
        );
        throw new Error('INTENTIONAL_NESTED_ERROR');
      });
    });
  } catch (err: any) {
    if (err.message === 'INTENTIONAL_NESTED_ERROR') {
      nestedErrorCaught = true;
    }
  }

  assert(nestedErrorCaught, 'Nested error propagated up out of root transaction');
  const dRootRow = db.prepare('SELECT * FROM _test_tx_concurrency WHERE id = ?').get('nested_fail_root');
  const dChildRow = db.prepare('SELECT * FROM _test_tx_concurrency WHERE id = ?').get('nested_fail_child');
  assert(!dRootRow, 'Root write was rolled back upon nested failure');
  assert(!dChildRow, 'Nested write was rolled back upon nested failure');

  // --- Test E: Lock recovery after forced rejection ---
  console.log('\n--- Test E: Mutex Lock Recovery After Rejection ---');
  await dbAdapter.transaction(async () => {
    throw new Error('FORCE_REJECT');
  }).catch(() => {});

  const recoveryRes = await dbAdapter.transaction(async (tx) => {
    await tx.execute(
      'INSERT INTO _test_tx_concurrency (id, value, step) VALUES ($1, $2, $3)',
      ['recovery_row', 'recovered_ok', 40]
    );
    return 'mutex_healthy';
  });

  assert(recoveryRes === 'mutex_healthy', 'Mutex lock released and healthy after rejection');
  const recRow = db.prepare('SELECT * FROM _test_tx_concurrency WHERE id = ?').get('recovery_row') as any;
  assert(recRow && recRow.value === 'recovered_ok', 'Recovery transaction successfully committed');

  // --- Test F: Invitee regression with explicit scoped transaction adapters ---
  console.log('\n--- Test F: Invitee Pass Generation, Revocation & Cancellation Rollbacks ---');
  const adminRow = db.prepare("SELECT * FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE' LIMIT 1").get() as any;
  const superAdminRow = db.prepare("SELECT * FROM users WHERE role = 'SUPER_ADMIN' AND status = 'ACTIVE' LIMIT 1").get() as any;

  const adminUser: SafeUser = {
    id: adminRow.id,
    email: adminRow.email,
    firstName: adminRow.first_name,
    lastName: adminRow.last_name,
    department: adminRow.department,
    role: UserRole.ADMIN,
    status: adminRow.status,
  };

  const superAdminUser: SafeUser = {
    id: superAdminRow.id,
    email: superAdminRow.email,
    firstName: superAdminRow.first_name,
    lastName: superAdminRow.last_name,
    department: superAdminRow.department,
    role: UserRole.SUPER_ADMIN,
    status: superAdminRow.status,
  };

  const now = new Date();
  const startAt = new Date(now.getTime() - 1000 * 3600).toISOString();
  const endAt = new Date(now.getTime() + 1000 * 7200).toISOString();

  // Create and approve event
  const eventRes = await eventService.createEvent(adminUser, {
    title: 'Batch 1B Concurrency Gala',
    location: 'Hall B1',
    startAt,
    endAt,
  });
  const event = eventRes.event!;
  await eventService.submitEvent(event.id, adminUser);
  await eventService.approveEvent(event.id, superAdminUser);

  // Create invitee
  const invRes = await inviteeService.createInvitee(event.id, adminUser, {
    fullName: 'Professor Eleanor Shellstrop',
    email: 'eleanor@b1b.org',
  });
  const invitee = invRes.invitee!;

  // 1. Rollback on pass generation failure
  const prePassCount = Number((db.prepare('SELECT count(*) as count FROM access_passes').get() as any).count);
  const origExec = dbAdapter.execute.bind(dbAdapter);
  let failGenLink = true;

  dbAdapter.execute = (async (sql: string, params: any[] = []) => {
    if (failGenLink && sql.includes('UPDATE event_invitees') && sql.includes('access_pass_id = $1')) {
      throw new Error('SIMULATED_LINK_FAILURE');
    }
    return origExec(sql, params);
  }) as any;

  const failedGen = await inviteeService.generateInviteeAccessPass(event.id, invitee.id, adminUser);
  failGenLink = false;
  dbAdapter.execute = origExec;

  assert(!failedGen.success && failedGen.status === 500, 'Pass generation reported failure on injected error');
  const postPassCount = Number((db.prepare('SELECT count(*) as count FROM access_passes').get() as any).count);
  assert(postPassCount === prePassCount, 'No orphaned pass in database after rollback');

  // 2. Successful generation
  const successGen = await inviteeService.generateInviteeAccessPass(event.id, invitee.id, adminUser);
  assert(successGen.success && !!successGen.pass, 'Pass successfully generated and linked');
  const passId = successGen.pass!.id;

  // 3. Rollback on revocation failure
  let failRevoke = true;
  dbAdapter.execute = (async (sql: string, params: any[] = []) => {
    if (failRevoke && sql.includes('UPDATE event_invitees') && sql.includes('status = $1') && params[0] === InviteeStatus.INVITED) {
      throw new Error('SIMULATED_REVOKE_FAILURE');
    }
    return origExec(sql, params);
  }) as any;

  const failedRevoke = await inviteeService.revokeInviteeAccess(event.id, invitee.id, adminUser, 'Testing revocation rollback');
  failRevoke = false;
  dbAdapter.execute = origExec;

  assert(!failedRevoke.success && failedRevoke.status === 500, 'Revocation reported failure on injected error');
  const passDbAfterFailedRevoke = db.prepare('SELECT status FROM access_passes WHERE id = ?').get(passId) as any;
  assert(passDbAfterFailedRevoke.status === AccessPassStatus.ACTIVE, 'Pass status rolled back to ACTIVE');

  // 4. Successful revocation
  const successRevoke = await inviteeService.revokeInviteeAccess(event.id, invitee.id, adminUser, 'Legitimate revoke');
  assert(successRevoke.success, 'Revocation succeeded');

  // 5. Rollback on cancellation failure
  const pass2Res = await inviteeService.generateInviteeAccessPass(event.id, invitee.id, adminUser);
  const pass2Id = pass2Res.pass!.id;

  let failCancel = true;
  dbAdapter.execute = (async (sql: string, params: any[] = []) => {
    if (failCancel && sql.includes('UPDATE event_invitees') && sql.includes('status = $1') && params[0] === InviteeStatus.CANCELLED) {
      throw new Error('SIMULATED_CANCEL_FAILURE');
    }
    return origExec(sql, params);
  }) as any;

  const failedCancel = await inviteeService.cancelInvitee(event.id, invitee.id, adminUser, 'Testing cancellation rollback');
  failCancel = false;
  dbAdapter.execute = origExec;

  assert(!failedCancel.success && failedCancel.status === 500, 'Cancellation reported failure on injected error');
  const pass2DbAfterFailedCancel = db.prepare('SELECT status FROM access_passes WHERE id = ?').get(pass2Id) as any;
  assert(pass2DbAfterFailedCancel.status === AccessPassStatus.ACTIVE, 'Pass 2 rolled back to ACTIVE upon cancel failure');

  // 6. Successful cancellation
  const successCancel = await inviteeService.cancelInvitee(event.id, invitee.id, adminUser, 'Final cancel');
  assert(successCancel.success, 'Cancellation succeeded');
  const pass2DbFinal = db.prepare('SELECT status FROM access_passes WHERE id = ?').get(pass2Id) as any;
  assert(pass2DbFinal.status === AccessPassStatus.REVOKED, 'Pass 2 revoked upon cancellation');

  // --- Test G: Root dbAdapter.execute is blocked while transaction is active ---
  console.log('\n--- Test G: Root dbAdapter.execute Blocked During Active Transaction ---');
  db.exec('DELETE FROM _test_tx_concurrency;');
  const gateG_inTx = createDeferred<void>();
  const gateG_finishTx = createDeferred<void>();
  let rootExecExecutedWhileTxActive = false;

  const txG = dbAdapter.transaction(async (tx) => {
    await tx.execute(
      'INSERT INTO _test_tx_concurrency (id, value, step) VALUES ($1, $2, $3)',
      ['tx_g', 'tx_g_val', 1]
    );
    gateG_inTx.resolve();
    await gateG_finishTx.promise;
    return 'tx_g_done';
  });

  await gateG_inTx.promise;

  // Launch unrelated root dbAdapter.execute while tx is holding the connection
  const rootG = (async () => {
    const res = await dbAdapter.execute(
      'INSERT INTO _test_tx_concurrency (id, value, step) VALUES ($1, $2, $3)',
      ['root_g', 'root_g_val', 2]
    );
    // If it ran while tx was active, this would be true
    return res;
  })();

  // Yield to event loop multiple times
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setTimeout(r, 15));

  // Verify that root execute has NOT completed while tx is holding the gate
  const checkRowWhilePaused = db.prepare('SELECT * FROM _test_tx_concurrency WHERE id = ?').get('root_g');
  assert(
    !checkRowWhilePaused,
    'Root dbAdapter.execute was blocked and did NOT execute on SQLite connection while transaction was active'
  );

  // Unblock and complete transaction
  gateG_finishTx.resolve();
  const [resTxG, resRootG] = await Promise.all([txG, rootG]);
  assert(resTxG === 'tx_g_done', 'Transaction G committed successfully');
  assert(resRootG.rowCount === 1, 'Root execute completed successfully after transaction released lock');

  const rowG_tx = db.prepare('SELECT * FROM _test_tx_concurrency WHERE id = ?').get('tx_g') as any;
  const rowG_root = db.prepare('SELECT * FROM _test_tx_concurrency WHERE id = ?').get('root_g') as any;
  assert(rowG_tx && rowG_tx.value === 'tx_g_val', 'Transaction G row persisted');
  assert(rowG_root && rowG_root.value === 'root_g_val', 'Root row persisted safely');

  // --- Test H: Root execute write survives transaction failure and rollback ---
  console.log('\n--- Test H: Root dbAdapter.execute Survives Concurrent Transaction Rollback ---');
  const gateH_inTx = createDeferred<void>();
  const gateH_failTx = createDeferred<void>();

  const txH = dbAdapter.transaction(async (tx) => {
    await tx.execute(
      'INSERT INTO _test_tx_concurrency (id, value, step) VALUES ($1, $2, $3)',
      ['tx_h_doomed', 'will_rollback', 10]
    );
    gateH_inTx.resolve();
    await gateH_failTx.promise;
    throw new Error('INTENTIONAL_TX_H_ROLLBACK');
  });

  await gateH_inTx.promise;

  // Unrelated root write initiated while transaction is open
  const rootH = dbAdapter.execute(
    'INSERT INTO _test_tx_concurrency (id, value, step) VALUES ($1, $2, $3)',
    ['root_h_survivor', 'must_persist', 11]
  );

  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setTimeout(r, 10));

  // Trigger transaction failure
  gateH_failTx.resolve();
  let txHError: any = null;
  try {
    await txH;
  } catch (err) {
    txHError = err;
  }

  const rootHRes = await rootH;
  assert(txHError && txHError.message === 'INTENTIONAL_TX_H_ROLLBACK', 'Transaction H failed as expected');
  assert(rootHRes.rowCount === 1, 'Root execute completed with rowCount 1');

  const rowH_doomed = db.prepare('SELECT * FROM _test_tx_concurrency WHERE id = ?').get('tx_h_doomed');
  const rowH_survivor = db.prepare('SELECT * FROM _test_tx_concurrency WHERE id = ?').get('root_h_survivor') as any;
  assert(!rowH_doomed, 'Transaction H doomed row was completely rolled back');
  assert(rowH_survivor && rowH_survivor.value === 'must_persist', 'Root execute row survived independently');

  // --- Test I: Root queryOne does not read uncommitted dirty data from aborted transaction ---
  console.log('\n--- Test I: Root queryOne Isolated from Dirty Uncommitted Data ---');
  const gateI_inTx = createDeferred<void>();
  const gateI_abortTx = createDeferred<void>();

  const txI = dbAdapter.transaction(async (tx) => {
    await tx.execute(
      'INSERT INTO _test_tx_concurrency (id, value, step) VALUES ($1, $2, $3)',
      ['dirty_row', 'uncommitted_secret', 20]
    );
    gateI_inTx.resolve();
    await gateI_abortTx.promise;
    throw new Error('INTENTIONAL_DIRTY_ABORT');
  });

  await gateI_inTx.promise;

  // Unrelated root queryOne for the uncommitted row
  const rootIQuery = dbAdapter.queryOne(
    'SELECT * FROM _test_tx_concurrency WHERE id = $1',
    ['dirty_row']
  );

  // Trigger abort
  gateI_abortTx.resolve();
  try {
    await txI;
  } catch {}

  const observedRow = await rootIQuery;
  assert(observedRow === null, 'Root queryOne waited for tx resolution and did not read dirty data (returned null)');

  // --- Test J: Mixed serialization sequence (Tx1 -> RootExec -> Tx2) ---
  console.log('\n--- Test J: Mixed FIFO Serialization (Tx1 -> Root -> Tx2) ---');
  const sequence: string[] = [];

  const gateJ1_start = createDeferred<void>();
  const gateJ1_finish = createDeferred<void>();

  const pJ1 = dbAdapter.transaction(async (tx) => {
    sequence.push('tx1_start');
    gateJ1_start.resolve();
    await gateJ1_finish.promise;
    sequence.push('tx1_finish');
    return 'tx1_res';
  });

  await gateJ1_start.promise;

  let rootCompletedBeforeTx2 = false;

  const pRootJ = (async () => {
    const res = await dbAdapter.execute(
      'INSERT INTO _test_tx_concurrency (id, value, step) VALUES ($1, $2, $3)',
      ['mixed_root', 'val', 30]
    );
    sequence.push('root_exec');
    return res;
  })();

  const pJ2 = dbAdapter.transaction(async (tx) => {
    // Verify that root execute write is already present in DB before tx2 executes
    const row = await tx.queryOne('SELECT * FROM _test_tx_concurrency WHERE id = $1', ['mixed_root']);
    rootCompletedBeforeTx2 = !!row;
    sequence.push('tx2_run');
    return 'tx2_res';
  });

  gateJ1_finish.resolve();

  await Promise.all([pJ1, pRootJ, pJ2]);

  assert(rootCompletedBeforeTx2, 'Root execute was committed in database before Transaction 2 executed');
  assert(
    sequence.includes('tx1_start') && sequence.includes('tx1_finish') && sequence.includes('tx2_run'),
    `Operations executed: ${sequence.join(' -> ')}`
  );

  // --- Test K: Synchronous zero-latency query execution when idle ---
  console.log('\n--- Test K: Synchronous Dual-Mode Execution When Idle ---');
  const syncRow = dbAdapter.queryOne<{ id: string; value: string }>(
    'SELECT id, value FROM _test_tx_concurrency WHERE id = $1',
    ['mixed_root']
  );
  assert(syncRow !== null && syncRow.id === 'mixed_root', 'Idle queryOne returned result synchronously');

  const syncList = dbAdapter.query<{ id: string }>(
    'SELECT id FROM _test_tx_concurrency'
  );
  assert(syncList.length > 0 && typeof syncList.map === 'function', 'Idle query returned dual-mode list synchronously');

  // --- Test L: Deterministic multi-row dbAdapter.query isolation during active transaction ---
  console.log('\n--- Test L: Deterministic Multi-Row dbAdapter.query Isolation ---');
  db.exec('DELETE FROM _test_tx_concurrency;');
  // Seed baseline committed rows
  db.exec("INSERT INTO _test_tx_concurrency (id, value, step) VALUES ('baseline_1', 'val_1', 100);");
  db.exec("INSERT INTO _test_tx_concurrency (id, value, step) VALUES ('baseline_2', 'val_2', 101);");

  const gateL_inTx = createDeferred<void>();
  const gateL_abortTx = createDeferred<void>();

  let txLOpen = true;
  const txL = dbAdapter.transaction(async (tx) => {
    // Insert 2 uncommitted rows inside Tx L
    await tx.execute(
      'INSERT INTO _test_tx_concurrency (id, value, step) VALUES ($1, $2, $3)',
      ['uncommitted_l1', 'dirty_1', 200]
    );
    await tx.execute(
      'INSERT INTO _test_tx_concurrency (id, value, step) VALUES ($1, $2, $3)',
      ['uncommitted_l2', 'dirty_2', 201]
    );
    gateL_inTx.resolve();
    await gateL_abortTx.promise;
    throw new Error('INTENTIONAL_TX_L_ROLLBACK');
  }).finally(() => {
    txLOpen = false;
  });

  await gateL_inTx.promise;

  // Unrelated Request B initiates multi-row query while Tx L holds uncommitted rows
  let queryBFinishedWhileTxActive = false;
  const pQueryB = dbAdapter.query<{ id: string; value: string }>(
    'SELECT id, value FROM _test_tx_concurrency ORDER BY step ASC'
  ).then((rows) => {
    queryBFinishedWhileTxActive = txLOpen;
    return rows;
  });

  // Verify that B has not resolved while Tx L holds gate
  await new Promise((r) => setImmediate(r));
  assert(queryBFinishedWhileTxActive === false, 'Multi-row query B was blocked while Transaction L was open');

  // Trigger rollback on Tx L
  gateL_abortTx.resolve();
  try {
    await txL;
  } catch {}

  const finalRows = await pQueryB;
  assert(finalRows.length === 2, `Multi-row query returned exactly 2 baseline rows (got ${finalRows.length})`);
  assert(
    finalRows.every((r) => r.id === 'baseline_1' || r.id === 'baseline_2'),
    'Multi-row query observed only committed state and zero uncommitted dirty rows'
  );

  // --- Test M: Stale AsyncLocalStorage context cannot bypass mutex or write to later transaction ---
  console.log('\n--- Test M: Stale Context Invalidation & Later-Transaction Protection ---');
  let capturedScopedTx: DbAdapter | null = null;
  const gateM_startLingering = createDeferred<void>();
  const gateM_lingeringDone = createDeferred<string>();

  // 1. Transaction 1 captures scoped adapter and spawns an unawaited descendant task
  await dbAdapter.transaction(async (tx1) => {
    capturedScopedTx = tx1;
    await tx1.execute(
      'INSERT INTO _test_tx_concurrency (id, value, step) VALUES ($1, $2, $3)',
      ['tx1_row', 'tx1_committed', 300]
    );

    // Spawn descendant asynchronous task inheriting ALS context that runs AFTER tx1 completes
    (async () => {
      await gateM_startLingering.promise;
      // At this point, Transaction 1 has committed and closed.
      // Attempt 1: Scoped adapter must throw error because it is closed
      let scopedThrew = false;
      try {
        await capturedScopedTx!.execute(
          'INSERT INTO _test_tx_concurrency (id, value, step) VALUES ($1, $2, $3)',
          ['illegal_stale_scoped', 'should_fail', 301]
        );
      } catch (err: any) {
        scopedThrew = err.message.includes('has already completed');
      }

      // Attempt 2: Calling root dbAdapter.execute with stale ALS context while Transaction 2 is active
      // Must NOT write directly into Transaction 2; must safely wait in mutex queue
      const res = await dbAdapter.execute(
        'INSERT INTO _test_tx_concurrency (id, value, step) VALUES ($1, $2, $3)',
        ['stale_root_routed_safely', 'persisted_via_queue', 302]
      );

      gateM_lingeringDone.resolve(scopedThrew ? 'scoped_properly_rejected' : 'scoped_failed_to_reject');
    })();
  });

  // Verify Transaction 1 is closed
  // Now launch Transaction 2 and hold it open
  const gateTx2_in = createDeferred<void>();
  const gateTx2_finish = createDeferred<void>();

  const pTx2 = dbAdapter.transaction(async (tx2) => {
    await tx2.execute(
      'INSERT INTO _test_tx_concurrency (id, value, step) VALUES ($1, $2, $3)',
      ['tx2_row', 'tx2_committed', 400]
    );
    gateTx2_in.resolve();
    await gateTx2_finish.promise;
    return 'tx2_done';
  });

  await gateTx2_in.promise;

  // Now wake the lingering task from Transaction 1 while Transaction 2 is actively open
  gateM_startLingering.resolve();

  // Allow event loop to process
  await new Promise((r) => setImmediate(r));

  // The lingering task's root call must NOT execute while Tx 2 holds the connection
  const staleRowDuringTx2 = db.prepare('SELECT * FROM _test_tx_concurrency WHERE id = ?').get('stale_root_routed_safely');
  assert(!staleRowDuringTx2, 'Lingering stale-context root execute did NOT write into active Transaction 2');

  // Complete Transaction 2
  gateTx2_finish.resolve();
  await pTx2;

  // Await lingering task result
  const lingeringResult = await gateM_lingeringDone.promise;
  assert(lingeringResult === 'scoped_properly_rejected', 'Closed scoped adapter properly threw on stale execution');

  // Verify lingering root execute completed safely outside Tx 2 after Tx 2 released lock
  const staleRowAfter = db.prepare('SELECT * FROM _test_tx_concurrency WHERE id = ?').get('stale_root_routed_safely') as any;
  assert(staleRowAfter && staleRowAfter.value === 'persisted_via_queue', 'Stale-context root execute safely executed after Tx 2 released');

  // Cleanup test table
  db.exec('DROP TABLE IF EXISTS _test_tx_concurrency;');

  // Unhandled rejections audit
  console.log('\n--- Unhandled Promise Rejection Audit ---');
  assert(unhandledRejections === 0, `Zero unhandled promise rejections detected (count: ${unhandledRejections})`);

  console.log('\n================================================================');
  console.log(`   TRANSACTION CONCURRENCY RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0 || unhandledRejections > 0) {
    process.exit(1);
  }
}

runConcurrencyTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
