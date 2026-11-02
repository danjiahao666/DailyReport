import { isValidDate } from "@/lib/dates";
import type { TodoBlocker, TodoItem, TodoPriority, TodoStatus } from "@/lib/types";
import { getDb, nowIso, transaction } from "./db";
import { AppError } from "./errors";

export const MAX_TODOS = 1000;
export const MAX_TITLE_CHARS = 200;
export const MAX_NOTE_CHARS = 2000;
export const MAX_BLOCKER_CHARS = 500;
/** 单个待办最多同时保留的卡点数 */
export const MAX_BLOCKERS_PER_TODO = 50;

const PRIORITIES: readonly TodoPriority[] = ["low", "medium", "high"];

interface TodoRow {
  id: number;
  title: string;
  note: string;
  priority: TodoPriority;
  is_long_term: number;
  progress: number;
  start_date: string | null;
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface BlockerRow {
  id: number;
  todo_id: number;
  content: string;
  created_at: string;
  resolved_at: string | null;
}

/** 状态由进度推导，避免“进度 100% 却显示进行中”这类不一致；长期事项没有进度，固定为 ongoing */
export function statusOf(progress: number, longTerm = false): TodoStatus {
  if (longTerm) return "ongoing";
  if (progress >= 100) return "done";
  return progress > 0 ? "doing" : "todo";
}

function toBlocker(r: BlockerRow): TodoBlocker {
  return { id: r.id, content: r.content, createdAt: r.created_at, resolvedAt: r.resolved_at };
}

function toItem(row: TodoRow, blockers: BlockerRow[]): TodoItem {
  const longTerm = row.is_long_term === 1;
  const status = statusOf(row.progress, longTerm);
  // 未解决的卡点排在前面，其余按创建先后
  const sorted = [...blockers].sort((a, b) => Number(a.resolved_at !== null) - Number(b.resolved_at !== null) || a.id - b.id);
  return {
    id: row.id,
    title: row.title,
    note: row.note,
    priority: row.priority,
    longTerm,
    status,
    progress: row.progress,
    startDate: row.start_date,
    dueDate: row.due_date,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    blockers: sorted.map(toBlocker),
    blocked: status !== "done" && blockers.some((b) => b.resolved_at === null),
  };
}

// ---------- 校验 ----------

function validateTitle(value: unknown): string {
  if (typeof value !== "string") throw new AppError(400, "INVALID_TITLE", "待办标题必须是文本");
  const text = value.trim();
  if (text === "") throw new AppError(400, "EMPTY_TITLE", "待办标题不能为空");
  if (text.length > MAX_TITLE_CHARS) throw new AppError(400, "TITLE_TOO_LONG", `待办标题过长，最多 ${MAX_TITLE_CHARS} 个字符`);
  return text;
}

function validateNote(value: unknown): string {
  if (typeof value !== "string") throw new AppError(400, "INVALID_NOTE", "备注必须是文本");
  const text = value.replace(/\r\n/g, "\n").trim();
  if (text.length > MAX_NOTE_CHARS) throw new AppError(400, "NOTE_TOO_LONG", `备注过长，最多 ${MAX_NOTE_CHARS} 个字符`);
  return text;
}

function validatePriority(value: unknown): TodoPriority {
  if (typeof value !== "string" || !PRIORITIES.includes(value as TodoPriority)) {
    throw new AppError(400, "INVALID_PRIORITY", "优先级只能是 low、medium 或 high");
  }
  return value as TodoPriority;
}

function validateProgress(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100) {
    throw new AppError(400, "INVALID_PROGRESS", "进度必须是 0 到 100 的整数");
  }
  return value;
}

/** 日期允许 null（清除）；字段名用于错误提示 */
function validateOptionalDate(value: unknown, label: string): string | null {
  if (value === null || value === "") return null;
  if (!isValidDate(value)) throw new AppError(400, "INVALID_DATE", `${label}格式必须为 YYYY-MM-DD 且为有效日期`);
  return value;
}

function assertDateOrder(start: string | null, due: string | null): void {
  if (start && due && due < start) throw new AppError(400, "INVALID_DATE_RANGE", "期望完成日期不能早于开始日期");
}

function validateLongTerm(value: unknown): boolean {
  if (typeof value !== "boolean") throw new AppError(400, "INVALID_LONG_TERM", "longTerm 必须是布尔值");
  return value;
}

/** 长期事项不设进度和日期：请求里显式带了非空值就拒绝，而不是静默丢弃 */
function assertNoScheduleFields(input: Record<string, unknown>): void {
  if (input.progress !== undefined && input.progress !== 0) throw new AppError(400, "LONG_TERM_NO_PROGRESS", "长期事项不设置进度");
  for (const key of ["startDate", "dueDate"] as const) {
    if (input[key] !== undefined && input[key] !== null && input[key] !== "") {
      throw new AppError(400, "LONG_TERM_NO_DATES", "长期事项不设置开始和期望完成日期");
    }
  }
}

function validateBlocker(value: unknown): string {
  if (typeof value !== "string") throw new AppError(400, "INVALID_BLOCKER", "卡点必须是文本");
  const text = value.trim();
  if (text === "") throw new AppError(400, "EMPTY_BLOCKER", "卡点内容不能为空");
  if (text.length > MAX_BLOCKER_CHARS) throw new AppError(400, "BLOCKER_TOO_LONG", `卡点过长，最多 ${MAX_BLOCKER_CHARS} 个字符`);
  return text;
}

// ---------- 查询 ----------

function blockersOf(todoId: number): BlockerRow[] {
  return getDb().prepare("SELECT * FROM todo_blockers WHERE todo_id = ?").all(todoId) as unknown as BlockerRow[];
}

export function getTodo(id: number): TodoItem | null {
  const row = getDb().prepare("SELECT * FROM todos WHERE id = ?").get(id) as TodoRow | undefined;
  return row ? toItem(row, blockersOf(id)) : null;
}

function requireTodo(id: number): TodoItem {
  const todo = getTodo(id);
  if (!todo) throw new AppError(404, "NOT_FOUND", "待办事项不存在");
  return todo;
}

/** 待办（数量受 MAX_TODOS 限制，排序与筛选交给前端）；openOnly 只返回未完成的，供首页提醒使用 */
export function listTodos(openOnly = false): TodoItem[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM todos ${openOnly ? "WHERE progress < 100" : ""} ORDER BY id DESC LIMIT ?`)
    .all(MAX_TODOS) as unknown as TodoRow[];
  const blockers = db.prepare("SELECT * FROM todo_blockers").all() as unknown as BlockerRow[];
  const byTodo = new Map<number, BlockerRow[]>();
  for (const b of blockers) {
    const list = byTodo.get(b.todo_id);
    if (list) list.push(b);
    else byTodo.set(b.todo_id, [b]);
  }
  return rows.map((r) => toItem(r, byTodo.get(r.id) ?? []));
}

// ---------- 写入 ----------

export function createTodo(input: Record<string, unknown>): TodoItem {
  const title = validateTitle(input.title);
  const note = input.note === undefined ? "" : validateNote(input.note);
  const priority = input.priority === undefined ? "medium" : validatePriority(input.priority);
  const longTerm = input.longTerm === undefined ? false : validateLongTerm(input.longTerm);
  let startDate: string | null = null;
  let dueDate: string | null = null;
  let progress = 0;
  if (longTerm) {
    assertNoScheduleFields(input);
  } else {
    startDate = validateOptionalDate(input.startDate ?? null, "开始日期");
    dueDate = validateOptionalDate(input.dueDate ?? null, "期望完成日期");
    assertDateOrder(startDate, dueDate);
    progress = input.progress === undefined ? 0 : validateProgress(input.progress);
  }

  return transaction((db) => {
    const count = db.prepare("SELECT COUNT(*) AS n FROM todos").get() as { n: number };
    if (count.n >= MAX_TODOS) throw new AppError(409, "TOO_MANY_TODOS", `待办数量已达上限 ${MAX_TODOS}，请先删除不需要的待办`);
    const now = nowIso();
    const result = db
      .prepare(
        "INSERT INTO todos (title, note, priority, is_long_term, progress, start_date, due_date, completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(title, note, priority, longTerm ? 1 : 0, progress, startDate, dueDate, progress === 100 ? now : null, now, now);
    return requireTodo(Number(result.lastInsertRowid));
  });
}

/**
 * 局部更新：只修改请求里出现的字段，date 传 null 表示清除。
 * 进度跨过 100% 时同步维护完成时间：达到 100% 记录完成时刻，回落则清除。
 * 设为长期事项时会清空已有的进度和日期；改回普通事项后从进度 0、无日期重新开始。
 */
export function updateTodo(id: number, patch: Record<string, unknown>): TodoItem {
  return transaction((db) => {
    const row = db.prepare("SELECT * FROM todos WHERE id = ?").get(id) as TodoRow | undefined;
    if (!row) throw new AppError(404, "NOT_FOUND", "待办事项不存在");

    const title = patch.title === undefined ? row.title : validateTitle(patch.title);
    const note = patch.note === undefined ? row.note : validateNote(patch.note);
    const priority = patch.priority === undefined ? row.priority : validatePriority(patch.priority);
    const longTerm = patch.longTerm === undefined ? row.is_long_term === 1 : validateLongTerm(patch.longTerm);

    let progress = 0;
    let startDate: string | null = null;
    let dueDate: string | null = null;
    if (longTerm) {
      assertNoScheduleFields(patch);
    } else {
      progress = patch.progress === undefined ? row.progress : validateProgress(patch.progress);
      startDate = patch.startDate === undefined ? row.start_date : validateOptionalDate(patch.startDate, "开始日期");
      dueDate = patch.dueDate === undefined ? row.due_date : validateOptionalDate(patch.dueDate, "期望完成日期");
      assertDateOrder(startDate, dueDate);
    }

    const now = nowIso();
    const completedAt = progress === 100 ? (row.completed_at ?? now) : null;

    db.prepare(
      "UPDATE todos SET title = ?, note = ?, priority = ?, is_long_term = ?, progress = ?, start_date = ?, due_date = ?, completed_at = ?, updated_at = ? WHERE id = ?",
    ).run(title, note, priority, longTerm ? 1 : 0, progress, startDate, dueDate, completedAt, now, id);
    return requireTodo(id);
  });
}

export function deleteTodo(id: number): void {
  const result = getDb().prepare("DELETE FROM todos WHERE id = ?").run(id);
  if (Number(result.changes) === 0) throw new AppError(404, "NOT_FOUND", "待办事项不存在");
}

// ---------- 卡点 ----------

export function addBlocker(todoId: number, contentInput: unknown): TodoItem {
  const content = validateBlocker(contentInput);
  return transaction((db) => {
    if (!db.prepare("SELECT 1 FROM todos WHERE id = ?").get(todoId)) throw new AppError(404, "NOT_FOUND", "待办事项不存在");
    const count = db.prepare("SELECT COUNT(*) AS n FROM todo_blockers WHERE todo_id = ?").get(todoId) as { n: number };
    if (count.n >= MAX_BLOCKERS_PER_TODO) {
      throw new AppError(409, "TOO_MANY_BLOCKERS", `单个待办最多记录 ${MAX_BLOCKERS_PER_TODO} 条卡点，请先删除已解决的卡点`);
    }
    const now = nowIso();
    db.prepare("INSERT INTO todo_blockers (todo_id, content, created_at) VALUES (?, ?, ?)").run(todoId, content, now);
    db.prepare("UPDATE todos SET updated_at = ? WHERE id = ?").run(now, todoId);
    return requireTodo(todoId);
  });
}

/** 标记卡点已解决 / 重新卡住；按待办 ID 限定，防止用别的待办的卡点 ID 越权修改 */
export function setBlockerResolved(todoId: number, blockerId: number, resolved: unknown): TodoItem {
  if (typeof resolved !== "boolean") throw new AppError(400, "INVALID_RESOLVED", "resolved 必须是布尔值");
  return transaction((db) => {
    const now = nowIso();
    const result = db
      .prepare("UPDATE todo_blockers SET resolved_at = ? WHERE id = ? AND todo_id = ?")
      .run(resolved ? now : null, blockerId, todoId);
    if (Number(result.changes) === 0) throw new AppError(404, "NOT_FOUND", "卡点不存在");
    db.prepare("UPDATE todos SET updated_at = ? WHERE id = ?").run(now, todoId);
    return requireTodo(todoId);
  });
}

export function deleteBlocker(todoId: number, blockerId: number): TodoItem {
  return transaction((db) => {
    const result = db.prepare("DELETE FROM todo_blockers WHERE id = ? AND todo_id = ?").run(blockerId, todoId);
    if (Number(result.changes) === 0) throw new AppError(404, "NOT_FOUND", "卡点不存在");
    db.prepare("UPDATE todos SET updated_at = ? WHERE id = ?").run(nowIso(), todoId);
    return requireTodo(todoId);
  });
}
