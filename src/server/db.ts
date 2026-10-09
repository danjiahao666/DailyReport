import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

/**
 * SQLite 单例（Node 内置 node:sqlite，无需编译原生模块）。
 * 挂在 globalThis 上，避免开发模式热更新时重复打开。
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS daily_entries (
  date TEXT PRIMARY KEY,
  original TEXT NOT NULL,
  optimized TEXT,
  active TEXT NOT NULL DEFAULT 'original' CHECK (active IN ('original','optimized')),
  optimized_stale INTEGER NOT NULL DEFAULT 0,
  optimized_model TEXT,
  optimized_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('weekly','monthly')),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  current_version_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (kind, period_start)
);

CREATE TABLE IF NOT EXISTS report_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  version_no INTEGER NOT NULL,
  content TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('generated','edited','restored')),
  model TEXT,
  meta TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (report_id, version_no)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

interface DbHolder {
  db?: DatabaseSync;
  file?: string;
}

const holder: DbHolder = ((globalThis as { __dailyReportDb?: DbHolder }).__dailyReportDb ??= {});

export function dataDir(): string {
  return path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIR || "./data");
}

export function getDb(): DatabaseSync {
  const file = path.join(dataDir(), "daily-report.db");
  if (holder.db && holder.file === file) return holder.db;
  closeDb();
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(SCHEMA);
  holder.db = db;
  holder.file = file;
  return db;
}

export function closeDb(): void {
  if (holder.db) {
    holder.db.close();
    holder.db = undefined;
    holder.file = undefined;
  }
}

/** 在 IMMEDIATE 事务内执行同步函数，异常时回滚 */
export function transaction<T>(fn: (db: DatabaseSync) => T): T {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn(db);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
