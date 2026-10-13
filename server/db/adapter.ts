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

export interface DbAdapter {
  query<T = any>(sql: string, params?: any[]): Promise<T[]> & T[];
  queryOne<T = any>(sql: string, params?: any[]): Promise<T | null> & (T | null);
  execute(sql: string, params?: any[]): Promise<{ rowCount: number }> & { rowCount: number };
  transaction<T>(fn: (tx: DbAdapter) => Promise<T> | T): Promise<T>;
  isPostgres(): boolean;
}

class DatabaseAdapter implements DbAdapter {
  public isPostgres(): boolean {
    return isProductionEnvironment() || getDatabaseEngine() === 'postgres';
  }

  public query<T = any>(sql: string, params: any[] = []): Promise<T[]> & T[] {
    if (this.isPostgres()) {
      const pool = getPostgresPool();
      const promise = pool.query<any>(sql, params).then((res) => res.rows as T[]);
      return promise as any;
    }

    // Local Development / Test SQLite mode
    const db = getDatabase();
    const { sql: sqliteSql, params: sqliteParams } = mapPostgresToSqlite(sql, params);
    const rows = db.prepare(sqliteSql).all(...sqliteParams) as T[];
    return makeDualResult(rows);
  }

  public queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> & (T | null) {
    if (this.isPostgres()) {
      const pool = getPostgresPool();
      const promise = pool.query<any>(sql, params).then((res) => (res.rows[0] ? (res.rows[0] as T) : null));
      return promise as any;
    }

    // Local Development / Test SQLite mode
    const db = getDatabase();
    const { sql: sqliteSql, params: sqliteParams } = mapPostgresToSqlite(sql, params);
    const row = (db.prepare(sqliteSql).get(...sqliteParams) as T) || null;
    return makeDualResult(row);
  }

  public execute(sql: string, params: any[] = []): Promise<{ rowCount: number }> & { rowCount: number } {
    if (this.isPostgres()) {
      const pool = getPostgresPool();
      const promise = pool.query(sql, params).then((res) => ({ rowCount: res.rowCount || 0 }));
      return promise as any;
    }

    // Local Development / Test SQLite mode
    const db = getDatabase();
    const { sql: sqliteSql, params: sqliteParams } = mapPostgresToSqlite(sql, params);
    const result = db.prepare(sqliteSql).run(...sqliteParams);
    return makeDualResult({ rowCount: Number(result.changes || 0) });
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
    const db = getDatabase();
    db.exec('BEGIN IMMEDIATE;');
    try {
      const result = await fn(this);
      db.exec('COMMIT;');
      return result;
    } catch (err) {
      try {
        db.exec('ROLLBACK;');
      } catch (rollbackErr) {
        console.error('[SQLite Transaction Rollback Error]:', rollbackErr);
      }
      throw err;
    }
  }
}

export const dbAdapter: DbAdapter = new DatabaseAdapter();
