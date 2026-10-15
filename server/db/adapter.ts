import { getDatabaseEngine, getDatabase } from './index.ts';
import { getPostgresPool, withTransaction, isProductionEnvironment } from './postgres.ts';

/**
 * Maps PostgreSQL parameterized query placeholders ($1, $2, ...) to SQLite positional parameters (?)
 * preserving parameter positions even if index is referenced multiple times.
 */
export function mapPostgresToSqlite(sql: string, params: any[] = []): { sql: string; params: any[] } {
  const newParams: any[] = [];
  const convertedSql = sql.replace(/\$(\d+)/g, (_, idxStr) => {
    const idx = parseInt(idxStr, 10) - 1;
    newParams.push(params[idx]);
    return '?';
  });
  return { sql: convertedSql, params: newParams };
}

/**
 * Wraps a synchronous value into a dual-mode object that behaves as:
 * 1. Synchronous value for immediate local access (e.g. res.id, arr.length)
 * 2. Asynchronous Promise (Thenable) for await callers in async pipelines
 */
function makeDualResult<T>(val: T): Promise<T> & T {
  if (Array.isArray(val)) {
    const p = Promise.resolve(val) as any;
    // Attach array behaviors and indexed elements onto the promise object
    p.length = val.length;
    p[Symbol.iterator] = val[Symbol.iterator].bind(val);
    p.map = val.map.bind(val);
    p.forEach = val.forEach.bind(val);
    p.filter = val.filter.bind(val);
    p.find = val.find.bind(val);
    p.some = val.some.bind(val);
    p.every = val.every.bind(val);
    p.reduce = val.reduce.bind(val);
    p.slice = val.slice.bind(val);
    for (let i = 0; i < val.length; i++) {
      p[i] = val[i];
    }
    return p;
  }

  if (typeof val === 'object' && val !== null) {
    return Object.assign(Promise.resolve(val), val) as any;
  }

  return Promise.resolve(val) as any;
}

import { AsyncLocalStorage } from 'node:async_hooks';

export interface DbAdapter {
  query<T = any>(sql: string, params?: any[]): Promise<T[]> & T[];
  queryOne<T = any>(sql: string, params?: any[]): Promise<T | null> & (T | null);
  execute(sql: string, params?: any[]): Promise<{ rowCount: number }> & { rowCount: number };
  transaction<T>(fn: (tx: DbAdapter) => Promise<T> | T): Promise<T>;
  isPostgres(): boolean;
}

interface TxScope {
  id: number;
  isOpen: () => boolean;
  adapter: DbAdapter;
}

const txStorage = new AsyncLocalStorage<TxScope>();

/**
 * Asynchronous FIFO Mutex for serializing SQLite transactions and coordinating
 * root-level database operations on the single shared connection.
 * Guarantees that:
 * 1. Only one top-level transaction is executing on the shared connection at a time.
 * 2. Unrelated root operations cannot interleave into an active transaction.
 * 3. Unhandled rejections or thrown errors in one operation do not poison the queue.
 * 4. Locks are released in a finally block on both success and failure.
 */
class AsyncMutex {
  private queue: Promise<void> = Promise.resolve();
  private pendingCount = 0;

  public isBusy(): boolean {
    return this.pendingCount > 0;
  }

  public async acquire(): Promise<() => void> {
    this.pendingCount++;
    let releaseLock: () => void = () => {};
    const waitPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    const previousQueue = this.queue;
    this.queue = (async () => {
      try {
        await previousQueue;
      } catch {
        // Prevent queue poisoning from prior rejections
      }
      await waitPromise;
    })();

    try {
      await previousQueue;
    } catch {
      // Prior transaction error does not block current acquisition
    }

    return () => {
      this.pendingCount--;
      releaseLock();
    };
  }
}

const sqliteTxMutex = new AsyncMutex();
let isTxActive = false;
let txCounter = 0;

class DatabaseAdapter implements DbAdapter {
  public isPostgres(): boolean {
    return isProductionEnvironment() || getDatabaseEngine() === 'postgres';
  }

  private rawQuery<T = any>(sql: string, params: any[] = []): Promise<T[]> & T[] {
    const db = getDatabase();
    const { sql: sqliteSql, params: sqliteParams } = mapPostgresToSqlite(sql, params);
    const rows = db.prepare(sqliteSql).all(...sqliteParams) as T[];
    return makeDualResult(rows);
  }

  private rawQueryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> & (T | null) {
    const db = getDatabase();
    const { sql: sqliteSql, params: sqliteParams } = mapPostgresToSqlite(sql, params);
    const row = (db.prepare(sqliteSql).get(...sqliteParams) as T) || null;
    return makeDualResult(row);
  }

  private rawExecute(sql: string, params: any[] = []): Promise<{ rowCount: number }> & { rowCount: number } {
    const db = getDatabase();
    const { sql: sqliteSql, params: sqliteParams } = mapPostgresToSqlite(sql, params);
    const result = db.prepare(sqliteSql).run(...sqliteParams);
    return makeDualResult({ rowCount: Number(result.changes || 0) });
  }

  public query<T = any>(sql: string, params: any[] = []): Promise<T[]> & T[] {
    if (this.isPostgres()) {
      const pool = getPostgresPool();
      const promise = pool.query<any>(sql, params).then((res) => res.rows as T[]);
      return promise as any;
    }

    const currentScope = txStorage.getStore();
    // When called from within an active, open transaction's execution tree:
    // execute directly on the connection within that transaction without re-queuing
    if (currentScope && currentScope.isOpen()) {
      return this.rawQuery<T>(sql, params);
    }

    // Root execution on SQLite (including any stale descendant tasks after their transaction closed):
    // If a transaction is active or other operations are queued, serialize via mutex
    if (isTxActive || sqliteTxMutex.isBusy()) {
      const acquirePromise = sqliteTxMutex.acquire();
      const promise = acquirePromise.then((release) => {
        try {
          return this.rawQuery<T>(sql, params);
        } finally {
          release();
        }
      });
      return promise as any;
    }

    // No active transaction and mutex is idle: execute synchronously with zero latency
    return this.rawQuery<T>(sql, params);
  }

  public queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> & (T | null) {
    if (this.isPostgres()) {
      const pool = getPostgresPool();
      const promise = pool.query<any>(sql, params).then((res) => (res.rows[0] ? (res.rows[0] as T) : null));
      return promise as any;
    }

    const currentScope = txStorage.getStore();
    if (currentScope && currentScope.isOpen()) {
      return this.rawQueryOne<T>(sql, params);
    }

    if (isTxActive || sqliteTxMutex.isBusy()) {
      const acquirePromise = sqliteTxMutex.acquire();
      const promise = acquirePromise.then((release) => {
        try {
          return this.rawQueryOne<T>(sql, params);
        } finally {
          release();
        }
      });
      return promise as any;
    }

    return this.rawQueryOne<T>(sql, params);
  }

  public execute(sql: string, params: any[] = []): Promise<{ rowCount: number }> & { rowCount: number } {
    if (this.isPostgres()) {
      const pool = getPostgresPool();
      const promise = pool.query(sql, params).then((res) => ({ rowCount: res.rowCount || 0 }));
      return promise as any;
    }

    const currentScope = txStorage.getStore();
    if (currentScope && currentScope.isOpen()) {
      return this.rawExecute(sql, params);
    }

    if (isTxActive || sqliteTxMutex.isBusy()) {
      const acquirePromise = sqliteTxMutex.acquire();
      const promise = acquirePromise.then((release) => {
        try {
          return this.rawExecute(sql, params);
        } finally {
          release();
        }
      });
      return promise as any;
    }

    return this.rawExecute(sql, params);
  }

  public async transaction<T>(fn: (tx: DbAdapter) => Promise<T> | T): Promise<T> {
    if (this.isPostgres()) {
      return withTransaction(async (client) => {
        const clientAdapter: DbAdapter = {
          isPostgres: () => true,
          query: <R = any>(sql: string, params: any[] = []) => {
            return client.query<any>(sql, params).then((r) => r.rows as R[]) as any;
          },
          queryOne: <R = any>(sql: string, params: any[] = []) => {
            return client.query<any>(sql, params).then((r) => (r.rows[0] ? (r.rows[0] as R) : null)) as any;
          },
          execute: (sql: string, params: any[] = []) => {
            return client.query(sql, params).then((r) => ({ rowCount: r.rowCount || 0 })) as any;
          },
          transaction: (subFn) => subFn(clientAdapter) as any,
        };
        return fn(clientAdapter);
      });
    }

    // Local Development / Test SQLite Transaction
    // Serialized across independent top-level transactions and root operations using AsyncMutex
    const release = await sqliteTxMutex.acquire();
    isTxActive = true;
    const db = getDatabase();
    let txOpen = true;
    const txId = ++txCounter;

    try {
      db.exec('BEGIN IMMEDIATE;');

      const scopedAdapter: DbAdapter = {
        isPostgres: () => false,
        query: (sql, params) => {
          if (!txOpen) {
            throw new Error(`[DbAdapter Error] Cannot execute query: transaction #${txId} has already completed (committed or rolled back).`);
          }
          return this.query(sql, params);
        },
        queryOne: (sql, params) => {
          if (!txOpen) {
            throw new Error(`[DbAdapter Error] Cannot execute queryOne: transaction #${txId} has already completed (committed or rolled back).`);
          }
          return this.queryOne(sql, params);
        },
        execute: (sql, params) => {
          if (!txOpen) {
            throw new Error(`[DbAdapter Error] Cannot execute: transaction #${txId} has already completed (committed or rolled back).`);
          }
          // Delegate to this.execute in case dbAdapter.execute is spied on or mocked in tests
          return this.execute(sql, params);
        },
        transaction: async <SubT>(subFn: (nestedTx: DbAdapter) => Promise<SubT> | SubT): Promise<SubT> => {
          if (!txOpen) {
            throw new Error(`[DbAdapter Error] Cannot start nested transaction: transaction #${txId} has already completed.`);
          }
          // Explicit nested transaction: reuses this transaction scope without re-acquiring mutex or calling BEGIN/COMMIT
          return subFn(scopedAdapter);
        },
      };

      const scope: TxScope = {
        id: txId,
        isOpen: () => txOpen,
        adapter: scopedAdapter,
      };

      const result = await txStorage.run(scope, async () => {
        return await fn(scopedAdapter);
      });
      db.exec('COMMIT;');
      return result;
    } catch (err) {
      try {
        db.exec('ROLLBACK;');
      } catch (rollbackErr) {
        console.error('[SQLite Transaction Rollback Error]:', rollbackErr);
      }
      throw err;
    } finally {
      txOpen = false;
      isTxActive = false;
      release();
    }
  }
}

export const dbAdapter: DbAdapter = new DatabaseAdapter();
