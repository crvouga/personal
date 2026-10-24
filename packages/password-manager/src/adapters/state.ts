import { DatabaseSync } from 'node:sqlite';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import type { StateStore } from '../domain/ports.ts';
import { validateRecord } from '../domain/state-schema.ts';
import type { Tables } from '../domain/model.ts';
import { ManagerError } from '../domain/errors.ts';
import {
  checkPrivateDirectory,
  checkPrivateFile,
  ensurePrivateDirectory,
} from './paths.ts';

interface StoredRow {
  value: string;
}
interface LockRow {
  owner: string;
  pid: number;
  host: string;
}
function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}
/** No timeout stealing: a slow live owner can still perform a remote mutation. */
export class SqliteState implements StateStore {
  readonly db: DatabaseSync;
  private readonly owner = randomUUID();
  private readonly held = new Set<string>();
  private transactionDepth = 0;

  constructor(
    readonly directory: string,
    readOnly = false
  ) {
    if (readOnly) checkPrivateDirectory(directory);
    else ensurePrivateDirectory(directory);
    const path = join(directory, 'workflow.sqlite');
    if (!readOnly && !existsSync(path))
      writeFileSync(path, '', { mode: 0o600, flag: 'wx' });
    checkPrivateFile(path);
    this.db = new DatabaseSync(path, { readOnly });
    this.db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
    try {
      if (readOnly) this.checkVersion();
      else this.migrate();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  private checkVersion(): void {
    const row = this.db.prepare('PRAGMA user_version').get() as {
      user_version: number;
    };
    if (row.user_version > 1) throw new ManagerError('wrong-version');
  }
  private migrate(): void {
    this.checkVersion();
    this.transaction(() => {
      this.db.exec(`CREATE TABLE IF NOT EXISTS records (
        kind TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL,
        PRIMARY KEY (kind, id));
        CREATE TABLE IF NOT EXISTS locks (
        key TEXT PRIMARY KEY, owner TEXT NOT NULL, pid INTEGER NOT NULL,
        host TEXT NOT NULL, acquired_at TEXT NOT NULL);
        PRAGMA user_version=1;`);
    });
  }
  get<K extends keyof Tables>(table: K, id: string): Tables[K] | null {
    const row = this.db
      .prepare('SELECT value FROM records WHERE kind=? AND id=?')
      .get(table, id) as StoredRow | undefined;
    return row ? validateRecord(table, JSON.parse(row.value)) : null;
  }
  list<K extends keyof Tables>(table: K): Tables[K][] {
    const rows = this.db
      .prepare('SELECT value FROM records WHERE kind=? ORDER BY id')
      .all(table) as unknown as StoredRow[];
    return rows.map((row) => validateRecord(table, JSON.parse(row.value)));
  }
  put<K extends keyof Tables>(table: K, value: Tables[K]): void {
    validateRecord(table, value);
    this.db
      .prepare(
        'INSERT INTO records(kind,id,value) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET value=excluded.value'
      )
      .run(table, value.id, JSON.stringify(value));
  }
  remove<K extends keyof Tables>(table: K, id: string): void {
    this.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(table, id);
  }
  transaction<T>(work: () => T): T {
    const depth = this.transactionDepth++;
    const savepoint = `nested_${depth}`;
    let started = false;
    try {
      this.db.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`);
      started = true;
      const result = work();
      if (result instanceof Promise) throw new ManagerError('invalid-input');
      this.db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${savepoint}`);
      return result;
    } catch (error) {
      if (started) {
        if (depth === 0) this.db.exec('ROLLBACK');
        else this.db.exec(`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
      }
      throw error;
    } finally {
      this.transactionDepth--;
    }
  }

  private acquire(key: string): void {
    this.transaction(() => {
      const lock = this.db
        .prepare('SELECT owner,pid,host FROM locks WHERE key=?')
        .get(key) as LockRow | undefined;
      if (lock && (lock.host !== hostname() || processExists(lock.pid)))
        throw new ManagerError('busy');
      this.db.prepare('DELETE FROM locks WHERE key=?').run(key);
      this.db
        .prepare('INSERT INTO locks VALUES(?,?,?,?,?)')
        .run(
          key,
          this.owner,
          process.pid,
          hostname(),
          new Date().toISOString()
        );
    });
    this.held.add(key);
  }
  async withLock<T>(key: string, work: () => Promise<T>): Promise<T> {
    this.acquire(key);
    try {
      return await work();
    } finally {
      this.db
        .prepare('DELETE FROM locks WHERE key=? AND owner=?')
        .run(key, this.owner);
      this.held.delete(key);
    }
  }
  close(): void {
    for (const key of this.held)
      this.db
        .prepare('DELETE FROM locks WHERE key=? AND owner=?')
        .run(key, this.owner);
    this.db.close();
  }
}
