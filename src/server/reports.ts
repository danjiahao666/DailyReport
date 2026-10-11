import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  JobView,
  MonthlyPlan,
  MonthlySource,
  Report,
  ReportKind,
  ReportMeta,
  ReportSummary,
  ReportVersion,
  VersionOrigin,
} from "@/lib/types";
import {
  addDays,
  eachDay,
  isValidDate,
  isValidMonth,
  monthRange,
  weekRange,
  weeksOfMonth,
} from "@/lib/dates";
import { getDb, nowIso, transaction } from "./db";
import { AppError } from "./errors";
import { listDailies } from "./daily";
import { startJob } from "./jobs";
import { generateText } from "./llm/client";
import { monthlyUser, refineSystem, refineUser, weeklyUser, type MonthlyBlock, type PreviousWeekly, type WeeklyDay } from "./llm/prompts";
import { getLlmTimeoutMs, getMaxInputChars, getMaxTokens, getSystemPrompt, getTemplate } from "./prefs";
import { getWeekStart } from "./settings";

export const MAX_REPORT_CHARS = 50_000;

function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

// ---------- 数据读取 ----------

interface ReportRow {
  id: number;
  kind: ReportKind;
  period_start: string;
  period_end: string;
  current_version_id: number | null;
  created_at: string;
  updated_at: string;
}

interface VersionRow {
  id: number;
  report_id: number;
  version_no: number;
  content: string;
  origin: VersionOrigin;
  model: string | null;
  meta: string | null;
  created_at: string;
}

function toVersion(row: VersionRow): ReportVersion {
  let meta: ReportMeta | null = null;
  if (row.meta) {
    try {
      meta = JSON.parse(row.meta) as ReportMeta;
    } catch {
      meta = null;
    }
  }
  return {
    id: row.id,
    versionNo: row.version_no,
    content: row.content,
    origin: row.origin,
    model: row.model,
    meta,
    createdAt: row.created_at,
  };
}

function findReportRow(kind: ReportKind, periodStart: string): ReportRow | undefined {
  return getDb().prepare("SELECT * FROM reports WHERE kind = ? AND period_start = ?").get(kind, periodStart) as
    | ReportRow
    | undefined;
}

function versionsOf(reportId: number): ReportVersion[] {
  const rows = getDb()
    .prepare("SELECT * FROM report_versions WHERE report_id = ? ORDER BY version_no DESC")
    .all(reportId) as unknown as VersionRow[];
  return rows.map(toVersion);
}

function buildReport(row: ReportRow): Report {
  const versions = versionsOf(row.id);
  const current = versions.find((v) => v.id === row.current_version_id) ?? null;
  return {
    id: row.id,
    kind: row.kind,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    currentVersionId: row.current_version_id,
    current,
    versions,
    currentManual: current ? isManualContent(current, versions) : false,
    outdated: computeOutdated(row, versions),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 版本内容是否出自用户手动编辑：手动编辑的版本，以及沿“恢复自”链追溯到手动编辑版本的恢复版本。
 * 恢复只是复制内容，所以从手动编辑版本恢复出来的版本同样应视为用户的手动内容。
 */
function isManualContent(version: ReportVersion, versions: ReportVersion[]): boolean {
  const seen = new Set<number>();
  let cur: ReportVersion | undefined = version;
  while (cur && !seen.has(cur.id)) {
    if (cur.origin === "edited") return true;
    if (cur.origin !== "restored") return false;
    seen.add(cur.id);
    const from: number | undefined = cur.meta?.restoredFrom;
    cur = versions.find((v) => v.versionNo === from);
  }
  return false;
}

export function getReport(kind: ReportKind, periodStart: string): Report | null {
  const row = findReportRow(kind, periodStart);
  return row ? buildReport(row) : null;
}

export function getReportById(id: number): Report {
  const row = getDb().prepare("SELECT * FROM reports WHERE id = ?").get(id) as ReportRow | undefined;
  if (!row) throw new AppError(404, "NOT_FOUND", "报告不存在");
  return buildReport(row);
}

export function listReportSummaries(kind: ReportKind, from: string, to: string): ReportSummary[] {
  const rows = getDb()
    .prepare(
      `SELECT r.id, r.kind, r.period_start, r.period_end, r.updated_at, v.version_no, v.origin
       FROM reports r JOIN report_versions v ON v.id = r.current_version_id
       WHERE r.kind = ? AND r.period_start <= ? AND r.period_end >= ?
       ORDER BY r.period_start`,
    )
    .all(kind, to, from) as unknown as {
    id: number;
    kind: ReportKind;
    period_start: string;
    period_end: string;
    updated_at: string;
    version_no: number;
    origin: VersionOrigin;
  }[];
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    versionNo: r.version_no,
    origin: r.origin,
    updatedAt: r.updated_at,
  }));
}

// ---------- 版本写入（只增不改） ----------

function appendVersion(
  db: DatabaseSync,
  reportId: number,
  v: { content: string; origin: VersionOrigin; model: string | null; meta: ReportMeta | null },
): void {
  const row = db.prepare("SELECT COALESCE(MAX(version_no), 0) AS n FROM report_versions WHERE report_id = ?").get(reportId) as {
    n: number;
  };
  const now = nowIso();
  const inserted = db
    .prepare(
      "INSERT INTO report_versions (report_id, version_no, content, origin, model, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(reportId, row.n + 1, v.content, v.origin, v.model, v.meta ? JSON.stringify(v.meta) : null, now);
  db.prepare("UPDATE reports SET current_version_id = ?, updated_at = ? WHERE id = ?").run(
    Number(inserted.lastInsertRowid),
    now,
    reportId,
  );
}

function ensureReport(db: DatabaseSync, kind: ReportKind, start: string, end: string): number {
  const now = nowIso();
  db.prepare(
    "INSERT INTO reports (kind, period_start, period_end, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(kind, period_start) DO UPDATE SET period_end = excluded.period_end",
  ).run(kind, start, end, now, now);
  const row = db.prepare("SELECT id FROM reports WHERE kind = ? AND period_start = ?").get(kind, start) as { id: number };
  return row.id;
}

// ---------- 周报输入 ----------

interface WeeklyInput {
  range: { start: string; end: string };
  days: WeeklyDay[];
  missing: string[];
  hash: string;
}

function collectWeekly(range: { start: string; end: string }): WeeklyInput {
  const dailies = listDailies(range.start, range.end);
  const days = dailies.map((d) => ({ date: d.date, text: d.effective }));
  const have = new Set(days.map((d) => d.date));
  const missing = eachDay(range.start, range.end).filter((d) => !have.has(d));
  return { range, days, missing, hash: sha(JSON.stringify(days)) };
}

// ---------- 月报输入与跨月规则 ----------

interface MonthlyInput {
  plan: MonthlyPlan;
  blocks: MonthlyBlock[];
  dailyDates: string[];
  weeklyRefs: { weekStart: string; weekEnd: string; versionNo: number }[];
  hash: string;
}

/**
 * 月报取数规则（跨月周按日期归属拆分，而不是整周归入某月）：
 *  - 来源=日报：取该月内所有日期的日报；
 *  - 来源=周报：整周都在本月内且已有周报的周，使用该周周报；
 *    跨月周（周报无法按日期拆分）以及尚无周报的周，改用其落在本月内日期的日报。
 */
function collectMonthly(month: string, source: MonthlySource): MonthlyInput {
  const weekStart = getWeekStart();
  const mr = monthRange(month);
  const dailies = new Map(listDailies(mr.start, mr.end).map((d) => [d.date, d]));
  const weeklyReports = new Map(
    listReportSummaries("weekly", mr.start, mr.end).map((r) => [r.periodStart, r] as const),
  );

  const plan: MonthlyPlan = { month, source, weeks: [], dailyCount: 0, weeklyCount: 0 };
  const blocks: MonthlyBlock[] = [];
  const dailyDates: string[] = [];
  const weeklyRefs: MonthlyInput["weeklyRefs"] = [];

  for (const w of weeksOfMonth(month, weekStart)) {
    const days = eachDay(w.from, w.to).filter((d) => dailies.has(d));
    const summary = weeklyReports.get(w.weekStart);
    const base = { weekStart: w.weekStart, weekEnd: w.weekEnd, from: w.from, to: w.to, full: w.full };

    if (source === "weekly" && w.full && summary) {
      const row = getDb()
        .prepare("SELECT content FROM report_versions WHERE report_id = ? AND id = (SELECT current_version_id FROM reports WHERE id = ?)")
        .get(summary.id, summary.id) as { content: string } | undefined;
      if (row) {
        blocks.push({ kind: "weekly", label: `${w.weekStart} 至 ${w.weekEnd}`, text: row.content });
        weeklyRefs.push({ weekStart: w.weekStart, weekEnd: w.weekEnd, versionNo: summary.versionNo });
        plan.weeks.push({ ...base, use: "weekly", reason: "整周在本月内，使用该周周报", dailyCount: days.length });
        plan.weeklyCount += 1;
        continue;
      }
    }

    if (days.length === 0) {
      plan.weeks.push({ ...base, use: "none", reason: "本月内该周没有日报", dailyCount: 0 });
      continue;
    }
    let reason = "使用日报";
    if (source === "weekly") {
      reason = w.full ? "该周尚无周报，改用日报" : "跨月周：周报无法按日期拆分，仅取属于本月日期的日报";
    } else if (!w.full) {
      reason = "跨月周：仅取属于本月日期的日报";
    }
    for (const d of days) {
      blocks.push({ kind: "daily", label: d, text: dailies.get(d)!.effective });
      dailyDates.push(d);
    }
    plan.weeks.push({ ...base, use: "daily", reason, dailyCount: days.length });
    plan.dailyCount += days.length;
  }

  return { plan, blocks, dailyDates, weeklyRefs, hash: sha(JSON.stringify({ source, blocks })) };
}

export function getMonthlyPlan(month: unknown, source: unknown): MonthlyPlan {
  if (!isValidMonth(month)) throw new AppError(400, "INVALID_MONTH", "月份格式必须为 YYYY-MM");
  if (source !== "daily" && source !== "weekly") throw new AppError(400, "INVALID_SOURCE", "source 只能是 daily 或 weekly");
  return collectMonthly(month, source).plan;
}

// ---------- 过期检测 ----------

function computeOutdated(row: ReportRow, versions: ReportVersion[]): boolean {
  const basis = versions.find((v) => v.meta?.inputHash);
  if (!basis?.meta?.inputHash) return false;
  try {
    if (row.kind === "weekly") {
      return collectWeekly({ start: row.period_start, end: row.period_end }).hash !== basis.meta.inputHash;
    }
    const month = row.period_start.slice(0, 7);
    return collectMonthly(month, basis.meta.source ?? "daily").hash !== basis.meta.inputHash;
  } catch {
    return false;
  }
}

// ---------- 生成 ----------

type Basis = { kind: "source" } | { kind: "refine"; version: ReportVersion };

/**
 * 决定重新生成的基准：
 *  - 指定 basis="source"：直接从来源日报/周报生成；
 *  - 指定 basis=版本 id：以该手动编辑的版本为基准重新优化；
 *  - 未指定：当前版本是手动编辑的就以当前版本为基准；当前版本是从某个手动版本优化来的，
 *    泿用同一个基准；当前版本由模型从来源生成、但历史中有手动编辑的版本时，
 *    返回 CHOOSE_BASIS 让用户选择；其余情况从来源生成。
 * 重新生成始终只新增版本，不会删除或覆盖任何历史版本。
 */
function resolveBasis(existing: Report | null, basisInput: unknown): Basis {
  if (basisInput === "source") return { kind: "source" };
  if (basisInput !== undefined && basisInput !== null) {
    const picked =
      typeof basisInput === "number" && Number.isInteger(basisInput)
        ? existing?.versions.find((v) => v.id === basisInput)
        : undefined;
    if (!existing || !picked || !isManualContent(picked, existing.versions)) {
      throw new AppError(400, "INVALID_BASIS", "所选基准版本不存在，或不是手动编辑的版本");
    }
    return { kind: "refine", version: picked };
  }
  if (!existing?.current) return { kind: "source" };
  if (existing.currentManual) return { kind: "refine", version: existing.current };
  // 当前版本就是从某个手动版本优化来的：泿用同一个基准再优化一次，不再重复询问
  const refinedFrom = existing.current.origin === "generated" ? existing.current.meta?.refinedFrom : undefined;
  if (refinedFrom !== undefined) {
    const base = existing.versions.find((v) => v.versionNo === refinedFrom);
    if (base && isManualContent(base, existing.versions)) return { kind: "refine", version: base };
  }
  const manual = existing.versions.filter((v) => v.origin === "edited");
  if (manual.length === 0) return { kind: "source" };
  throw new AppError(
    409,
    "CHOOSE_BASIS",
    "当前版本由模型生成，但历史中有手动编辑的版本。是否以手动编辑的版本为基准重新优化？",
    {
      currentVersionNo: existing.current.versionNo,
      manualVersions: manual.map((v) => ({ id: v.id, versionNo: v.versionNo, createdAt: v.createdAt })),
    },
  );
}

function assertInputSize(chars: number, hint = "月报可改用“周报”作为数据来源以缩短输入。"): void {
  const max = getMaxInputChars();
  if (chars > max) {
    throw new AppError(413, "INPUT_TOO_LARGE", `待处理的内容过长（${chars} 字符，上限 ${max}）。${hint}`);
  }
}

/**
 * 以手动编辑的版本为基准让大模型重新优化。只使用该版本的正文，不再读取日报，
 * 因此即使来源日报已经变化或被删除也可以执行。结果记为新的“模型生成”版本。
 * 不写 inputHash，过期检测仍然沿用最近一次从来源生成的版本，不会把“来源已变化”的提示误清除。
 */
function startRefine(
  kind: ReportKind,
  jobTarget: string,
  period: { start: string; end: string },
  periodText: string,
  base: ReportVersion,
): JobView {
  assertInputSize(base.content.length, "请先精简该版本的内容。");
  return startJob(kind, jobTarget, async () => {
    const { text, model } = await generateText({
      task: kind,
      system: refineSystem(getSystemPrompt(kind)),
      user: refineUser(kind, periodText, base.content, getTemplate(kind)),
      maxTokens: getMaxTokens(kind),
      timeoutMs: getLlmTimeoutMs(),
    });
    const meta: ReportMeta = { refinedFrom: base.versionNo };
    transaction((db) => {
      const reportId = ensureReport(db, kind, period.start, period.end);
      appendVersion(db, reportId, { content: text, origin: "generated", model, meta });
    });
  });
}

/**
 * 启动周报生成任务。同步部分（参数、基准选择、无日报提示、长度上限）校验失败时直接返回错误，
 * 此时不会创建任务也不会调用大模型；通过后立即返回任务状态，模型调用在后台执行。
 * basis 见 resolveBasis。
 * includePrevious：上一周已有周报时，是否附上它作对比参考；未指定时返回 CONFIRM_PREVIOUS 让用户选择。
 */
export function startWeekly(dateInput: unknown, basisInput?: unknown, includePreviousInput?: unknown): JobView {
  if (!isValidDate(dateInput)) throw new AppError(400, "INVALID_DATE", "日期格式必须为 YYYY-MM-DD 且为有效日期");
  if (includePreviousInput !== undefined && includePreviousInput !== null && typeof includePreviousInput !== "boolean") {
    throw new AppError(400, "INVALID_PREVIOUS", "includePrevious 必须是布尔值");
  }
  const range = weekRange(dateInput, getWeekStart());
  const basis = resolveBasis(getReport("weekly", range.start), basisInput);
  if (basis.kind === "refine") {
    // 重新优化只依赖基准版本，不涉及上周周报
    return startRefine("weekly", range.start, range, `统计周期：${range.start} 至 ${range.end}`, basis.version);
  }

  const input = collectWeekly(range);
  // 没有日报时直接返回明确提示，不调用大模型
  if (input.days.length === 0) {
    throw new AppError(422, "NO_DAILY", `${range.start} 至 ${range.end} 这一周没有日报，无法生成周报。请先补充日报。`);
  }
  // 上一周已有的周报（当前版本）可作对比参考，是否附上由用户决定；它不参与过期检测
  const prevRange = weekRange(addDays(range.start, -1), getWeekStart());
  const prevCurrent = getReport("weekly", prevRange.start)?.current ?? null;
  if (prevCurrent && typeof includePreviousInput !== "boolean") {
    throw new AppError(
      409,
      "CONFIRM_PREVIOUS",
      "上一周已有周报。是否把它一并发给大模型，用于对比本周与上周的进展？",
      { previousStart: prevRange.start, previousEnd: prevRange.end, previousVersionNo: prevCurrent.versionNo },
    );
  }
  const previous: PreviousWeekly | null =
    prevCurrent && includePreviousInput === true
      ? { start: prevRange.start, end: prevRange.end, content: prevCurrent.content }
      : null;
  assertInputSize(input.days.reduce((n, d) => n + d.text.length, 0) + (previous?.content.length ?? 0));

  return startJob("weekly", range.start, async () => {
    const { text, model } = await generateText({
      task: "weekly",
      system: getSystemPrompt("weekly"),
      user: weeklyUser(range, input.days, input.missing, getTemplate("weekly"), previous),
      maxTokens: getMaxTokens("weekly"),
      timeoutMs: getLlmTimeoutMs(),
    });
    const meta: ReportMeta = { inputHash: input.hash, dailyDates: input.days.map((d) => d.date) };
    transaction((db) => {
      const reportId = ensureReport(db, "weekly", range.start, range.end);
      appendVersion(db, reportId, { content: text, origin: "generated", model, meta });
    });
  });
}

/** 启动月报生成任务，校验与返回方式同 startWeekly */
export function startMonthly(monthInput: unknown, sourceInput: unknown, basisInput?: unknown): JobView {
  if (!isValidMonth(monthInput)) throw new AppError(400, "INVALID_MONTH", "月份格式必须为 YYYY-MM");
  const month = monthInput;
  const mr = monthRange(month);
  const basis = resolveBasis(getReport("monthly", mr.start), basisInput);
  if (basis.kind === "refine") {
    // 重新优化只依赖基准版本，不需要数据来源
    return startRefine("monthly", month, mr, `月份：${month}`, basis.version);
  }

  if (sourceInput !== "daily" && sourceInput !== "weekly") {
    throw new AppError(400, "INVALID_SOURCE", "source 只能是 daily 或 weekly");
  }
  const source: MonthlySource = sourceInput;
  const input = collectMonthly(month, source);

  if (input.blocks.length === 0) {
    throw new AppError(422, "NO_DATA", `${month} 没有可用的日报或周报，无法生成月报。请先补充日报。`);
  }
  assertInputSize(input.blocks.reduce((n, b) => n + b.text.length, 0));

  return startJob("monthly", month, async () => {
    const { text, model } = await generateText({
      task: "monthly",
      system: getSystemPrompt("monthly"),
      user: monthlyUser(month, input.blocks, getTemplate("monthly")),
      maxTokens: getMaxTokens("monthly"),
      timeoutMs: getLlmTimeoutMs(),
    });
    const meta: ReportMeta = {
      source,
      inputHash: input.hash,
      dailyDates: input.dailyDates,
      weeklyRefs: input.weeklyRefs,
    };
    transaction((db) => {
      const reportId = ensureReport(db, "monthly", mr.start, mr.end);
      appendVersion(db, reportId, { content: text, origin: "generated", model, meta });
    });
  });
}

// ---------- 手动编辑与恢复 ----------

export function editReport(reportId: number, contentInput: unknown): Report {
  if (typeof contentInput !== "string" || contentInput.trim() === "") {
    throw new AppError(400, "EMPTY_CONTENT", "报告内容不能为空");
  }
  const content = contentInput.replace(/\r\n/g, "\n").trim();
  if (content.length > MAX_REPORT_CHARS) {
    throw new AppError(400, "CONTENT_TOO_LONG", `报告内容过长，最多 ${MAX_REPORT_CHARS} 个字符`);
  }
  return transaction((db) => {
    const report = getReportById(reportId);
    if (report.current?.content === content) return report;
    appendVersion(db, reportId, { content, origin: "edited", model: null, meta: null });
    return getReportById(reportId);
  });
}

export function restoreVersion(reportId: number, versionId: unknown): Report {
  if (typeof versionId !== "number" || !Number.isInteger(versionId)) {
    throw new AppError(400, "INVALID_VERSION", "versionId 必须是整数");
  }
  return transaction((db) => {
    const report = getReportById(reportId);
    const target = report.versions.find((v) => v.id === versionId);
    if (!target) throw new AppError(404, "NOT_FOUND", "历史版本不存在");
    if (report.currentVersionId === target.id) return report;
    appendVersion(db, reportId, {
      content: target.content,
      origin: "restored",
      model: target.model,
      meta: { ...(target.meta ?? {}), restoredFrom: target.versionNo } as ReportMeta,
    });
    return getReportById(reportId);
  });
}
