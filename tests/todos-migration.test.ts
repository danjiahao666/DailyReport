import { afterAll, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { setupTestEnv } from "./helpers";
import { closeDb, dataDir, getDb } from "@/server/db";
import { getTodo } from "@/server/todos";

const env = setupTestEnv();
afterAll(() => env.cleanup());

describe("待办表升级", () => {
  it("没有 is_long_term 列的旧库：打开时自动补列，旧数据保持为普通事项，重复打开不报错", () => {
    closeDb();
    // 模拟升级前的库：todos 表没有 is_long_term 列
    const old = new DatabaseSync(path.join(dataDir(), "daily-report.db"));
    old.exec(`CREATE TABLE todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
      priority TEXT NOT NULL DEFAULT 'medium', progress INTEGER NOT NULL DEFAULT 0,
      start_date TEXT, due_date TEXT, completed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    // 升级前的优化稿历史表也没有 source_context 列
    old.exec(`CREATE TABLE daily_entries (date TEXT PRIMARY KEY, original TEXT NOT NULL, optimized TEXT,
      active TEXT NOT NULL DEFAULT 'original', optimized_stale INTEGER NOT NULL DEFAULT 0, optimized_model TEXT,
      optimized_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    old.exec(`CREATE TABLE daily_optimized_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, version_no INTEGER NOT NULL,
      content TEXT NOT NULL, origin TEXT NOT NULL, model TEXT, source_hash TEXT, restored_from INTEGER, created_at TEXT NOT NULL)`);
    old.prepare("INSERT INTO daily_entries (date, original, optimized, created_at, updated_at) VALUES ('2026-10-30', '原文', '优化稿', 'a', 'b')").run();
    old.prepare("INSERT INTO todos (title, progress, due_date, created_at, updated_at) VALUES ('旧待办', 40, '2026-11-09', 'a', 'b')").run();
    old.close();

    getDb();
    expect(getTodo(1)).toMatchObject({ title: "旧待办", longTerm: false, status: "doing", progress: 40, dueDate: "2026-11-09" });

    // 长期事项的状态列已补上，旧数据默认是普通事项、进行中
    const todoCols = getDb().prepare("PRAGMA table_info(todos)").all() as unknown as { name: string }[];
    expect(todoCols.map((c) => c.name)).toContain("long_term_status");
    expect(getTodo(1)).toMatchObject({ longTermStatus: "ongoing" });

    // 版本表补了列；旧数据照常读出，且没有待办素材（NULL）
    const cols = getDb().prepare("PRAGMA table_info(daily_optimized_versions)").all() as unknown as { name: string }[];
    expect(cols.map((c) => c.name)).toContain("source_context");
    const v = getDb().prepare("SELECT source_context FROM daily_optimized_versions WHERE date = '2026-10-30'").get() as { source_context: string | null };
    expect(v.source_context).toBeNull();

    closeDb();
    expect(() => getDb()).not.toThrow();
  });
});
