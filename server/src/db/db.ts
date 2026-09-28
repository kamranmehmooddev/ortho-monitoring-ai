import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

type Row = Record<string, any>; // rows are untyped at the SQL boundary
let db: DatabaseSync | null = null;

export function openDb(file = config.dbFile): DatabaseSync {
  if (db) return db;
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const schema = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql'), 'utf8');
  db.exec(schema);
  return db;
}

export function closeDb() { db?.close(); db = null; }

const conn = () => db ?? openDb();

const norm = (params: unknown[]): SQLInputValue[] =>
  params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : (p as SQLInputValue)));

export const sql = {
  all<T = any>(q: string, ...params: unknown[]): T[] { return conn().prepare(q).all(...norm(params)) as T[]; },
  get<T = any>(q: string, ...params: unknown[]): T | undefined { return conn().prepare(q).get(...norm(params)) as T | undefined; },
  run(q: string, ...params: unknown[]) { return conn().prepare(q).run(...norm(params)); },
  exec(q: string) { conn().exec(q); },
  insert(table: string, row: Row) {
    const keys = Object.keys(row);
    const q = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
    return conn().prepare(q).run(...norm(keys.map((k) => row[k])));
  },
  update(table: string, id: string, tenantId: string | null, patch: Row) {
    const keys = Object.keys(patch);
    if (!keys.length) return;
    const where = tenantId === null ? 'id = ?' : 'id = ? AND tenant_id = ?';
    const q = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE ${where}`;
    const params = [...keys.map((k) => patch[k]), id];
    if (tenantId !== null) params.push(tenantId);
    return conn().prepare(q).run(...norm(params));
  },
  tx<T>(fn: () => T): T {
    const c = conn();
    c.exec('BEGIN');
    try { const out = fn(); c.exec('COMMIT'); return out; } catch (e) { c.exec('ROLLBACK'); throw e; }
  },
};

export const j = {
  parse<T = any>(s: string | null | undefined, fallback: T): T { if (!s) return fallback; try { return JSON.parse(s) as T; } catch { return fallback; } },
  str: (v: unknown) => JSON.stringify(v ?? null),
};
