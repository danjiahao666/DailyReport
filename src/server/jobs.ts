import type { JobKind, JobStatus, JobView } from "@/lib/types";
import { isValidDate, isValidMonth } from "@/lib/dates";
import { BOOT_ID, getDb, nowIso } from "./db";
import { AppError } from "./errors";

/**
 * 大模型异步任务。
 *  - 接口只负责校验并“启动”任务，立即返回；模型调用在本进程后台执行；
 *  - 每个对象（日报优化 / 周报 / 月报）只保留最近一次任务的状态，持久化在 SQLite，
 *    所以刷新页面、切换页面后回来都能看到正确的状态；
 *  - 同一对象已有任务在执行时，重复启动直接返回正在执行的任务（幂等，不会重复调用模型）；
 *  - 进程重启会中断后台任务，下次打开数据库时把遗留的“进行中”标记为失败（见 db.ts）。
 */

interface JobRow {
  kind: JobKind;
  target: string;
  status: JobStatus;
  error_code: string | null;
  error_message: string | null;
  retryable: number;
  started_at: string;
  finished_at: string | null;
}

// 挂在 globalThis 上，避免 Next 把不同路由打成多份模块实例后各自持有一份集合
const g = globalThis as { __dailyReportActiveJobs?: Set<string> };
const active = (g.__dailyReportActiveJobs ??= new Set<string>());

function toView(row: JobRow): JobView {
  return {
    kind: row.kind,
    target: row.target,
    status: row.status,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    retryable: row.retryable === 1,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export function getJob(kind: JobKind, target: string): JobView | null {
  const row = getDb().prepare("SELECT * FROM llm_jobs WHERE kind = ? AND target = ?").get(kind, target) as JobRow | undefined;
  return row ? toView(row) : null;
}

/** 闭区间内的任务（target 为日期或月份字符串，按字典序比较即按时间序） */
export function listJobs(kind: JobKind, from: string, to: string): JobView[] {
  const rows = getDb()
    .prepare("SELECT * FROM llm_jobs WHERE kind = ? AND target >= ? AND target <= ? ORDER BY target")
    .all(kind, from, to) as unknown as JobRow[];
  return rows.map(toView);
}

function describeError(error: unknown): { code: string; message: string } {
  if (error instanceof AppError) return { code: error.code, message: error.message };
  console.error(JSON.stringify({ evt: "job.error", error: error instanceof Error ? `${error.name}: ${error.message}` : "unknown" }));
  return { code: "INTERNAL", message: "任务执行失败，请稍后重试。" };
}

function finish(kind: JobKind, target: string, status: JobStatus, error?: { code: string; message: string }): void {
  try {
    // 只更新“本进程仍在执行的这条任务”：期间若被删除或被新任务替换，不会误改
    getDb()
      .prepare(
        "UPDATE llm_jobs SET status = ?, error_code = ?, error_message = ?, retryable = ?, finished_at = ? WHERE kind = ? AND target = ? AND status = 'running' AND boot_id = ?",
      )
      .run(status, error?.code ?? null, error?.message ?? null, error ? 1 : 0, nowIso(), kind, target, BOOT_ID);
  } catch (e) {
    console.error(JSON.stringify({ evt: "job.finish_error", kind, error: e instanceof Error ? e.message : "unknown" }));
  }
}

async function execute(kind: JobKind, target: string, run: () => Promise<void>): Promise<void> {
  const started = Date.now();
  const key = `${kind}:${target}`;
  try {
    await run();
    finish(kind, target, "succeeded");
    console.info(JSON.stringify({ evt: "job", kind, target, status: "succeeded", ms: Date.now() - started }));
  } catch (error) {
    const d = describeError(error);
    finish(kind, target, "failed", d);
    console.warn(JSON.stringify({ evt: "job", kind, target, status: "failed", code: d.code, ms: Date.now() - started }));
  } finally {
    active.delete(key);
  }
}

/**
 * 启动后台任务并立即返回“进行中”的任务状态。
 * run 内的异常会被记录为任务失败（带中文提示），不会成为未处理的 Promise 拒绝。
 */
export function startJob(kind: JobKind, target: string, run: () => Promise<void>): JobView {
  const key = `${kind}:${target}`;
  if (active.has(key)) {
    const current = getJob(kind, target);
    if (current) return current;
    throw new AppError(409, "BUSY", "上一次任务仍在结束中，请稍后再试。");
  }
  active.add(key);
  try {
    getDb()
      .prepare(
        `INSERT INTO llm_jobs (kind, target, status, error_code, error_message, retryable, boot_id, started_at, finished_at)
         VALUES (?, ?, 'running', NULL, NULL, 0, ?, ?, NULL)
         ON CONFLICT(kind, target) DO UPDATE SET status = 'running', error_code = NULL, error_message = NULL,
           retryable = 0, boot_id = excluded.boot_id, started_at = excluded.started_at, finished_at = NULL`,
      )
      .run(kind, target, BOOT_ID, nowIso());
  } catch (error) {
    active.delete(key);
    throw error;
  }
  void execute(kind, target, run);
  return getJob(kind, target) as JobView;
}

/** 对象被删除时清掉它的任务记录 */
export function clearJob(kind: JobKind, target: string): void {
  getDb().prepare("DELETE FROM llm_jobs WHERE kind = ? AND target = ?").run(kind, target);
}

/** 忽略（清除）已结束的任务状态，例如不想再看到失败标记；进行中的任务不能忽略 */
export function dismissJob(kind: JobKind, target: string): void {
  if (active.has(`${kind}:${target}`)) throw new AppError(409, "JOB_RUNNING", "任务正在进行中，无法忽略。");
  getDb().prepare("DELETE FROM llm_jobs WHERE kind = ? AND target = ? AND status <> 'running'").run(kind, target);
}

export function parseJobKey(kind: unknown, target: unknown): { kind: JobKind; target: string } {
  if (kind !== "optimize" && kind !== "weekly" && kind !== "monthly") {
    throw new AppError(400, "INVALID_KIND", "kind 只能是 optimize、weekly 或 monthly");
  }
  const ok = kind === "monthly" ? isValidMonth(target) : isValidDate(target);
  if (!ok || typeof target !== "string") {
    throw new AppError(400, "INVALID_TARGET", kind === "monthly" ? "target 必须是 YYYY-MM" : "target 必须是 YYYY-MM-DD");
  }
  return { kind, target };
}
