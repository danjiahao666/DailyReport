import { diffDays } from "./dates";
import type { TodoItem, TodoPriority } from "./types";

/** 即将到期的提醒窗口（天） */
export const DUE_SOON_DAYS = 3;
/** 「重新打开」已完成待办时回到的进度，用户随后可自行调整 */
export const REOPEN_PROGRESS = 90;

export const PRIORITY_LABEL: Record<TodoPriority, string> = { high: "高", medium: "中", low: "低" };
const PRIORITY_RANK: Record<TodoPriority, number> = { high: 0, medium: 1, low: 2 };

export type DueState = "none" | "done" | "overdue" | "today" | "soon" | "later";

export interface DueInfo {
  state: DueState;
  /** overdue 为已逾期天数，其余为距离到期的剩余天数 */
  days: number;
  label: string;
}

/** 期望完成日期相对今天的状态；已完成的待办不再提示逾期 */
export function dueInfo(todo: Pick<TodoItem, "dueDate" | "status">, today: string): DueInfo {
  if (todo.status === "done") return { state: "done", days: 0, label: "" };
  if (!todo.dueDate) return { state: "none", days: 0, label: "未设置期望完成日期" };
  const left = diffDays(today, todo.dueDate);
  if (left < 0) return { state: "overdue", days: -left, label: `已逾期 ${-left} 天` };
  if (left === 0) return { state: "today", days: 0, label: "今天到期" };
  return { state: left <= DUE_SOON_DAYS ? "soon" : "later", days: left, label: `还剩 ${left} 天` };
}

export type TodoFilter = "all" | "open" | "blocked" | "overdue" | "done";

export const FILTER_LABEL: Record<TodoFilter, string> = {
  all: "全部",
  open: "未完成",
  blocked: "已卡住",
  overdue: "已逾期",
  done: "已完成",
};

export const FILTERS: TodoFilter[] = ["all", "open", "blocked", "overdue", "done"];

export function matchesFilter(todo: TodoItem, filter: TodoFilter, today: string): boolean {
  switch (filter) {
    case "all":
      return true;
    case "open":
      return todo.status !== "done";
    case "blocked":
      return todo.blocked;
    case "overdue":
      return dueInfo(todo, today).state === "overdue";
    case "done":
      return todo.status === "done";
  }
}

export function countByFilter(todos: TodoItem[], today: string): Record<TodoFilter, number> {
  const counts = { all: 0, open: 0, blocked: 0, overdue: 0, done: 0 } satisfies Record<TodoFilter, number>;
  for (const t of todos) for (const f of FILTERS) if (matchesFilter(t, f, today)) counts[f]++;
  return counts;
}

/**
 * 展示顺序：未完成的在前，按期望完成日期从近到远（没设日期的排后面），再按优先级、新建先后；
 * 已完成的在最后，最近完成的靠前。
 */
export function sortTodos(todos: TodoItem[]): TodoItem[] {
  return [...todos].sort((a, b) => {
    const aDone = a.status === "done";
    const bDone = b.status === "done";
    if (aDone !== bDone) return aDone ? 1 : -1;
    if (aDone) return (b.completedAt ?? "").localeCompare(a.completedAt ?? "") || b.id - a.id;
    if (a.dueDate !== b.dueDate) {
      if (a.dueDate === null) return 1;
      if (b.dueDate === null) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    }
    return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.id - a.id;
  });
}

export interface OpenTodoSummary {
  /** 未完成的待办数 */
  total: number;
  overdue: number;
  dueToday: number;
  blocked: number;
  /** 最该先看的几条：按展示顺序（期限最近的在前） */
  top: TodoItem[];
}

/** 首页提醒用：统计未完成待办的逾期、今天到期、已卡住数量，并取出最靠前的几条 */
export function summarizeOpen(todos: TodoItem[], today: string, topN = 3): OpenTodoSummary {
  const open = sortTodos(todos.filter((t) => t.status !== "done"));
  let overdue = 0;
  let dueToday = 0;
  let blocked = 0;
  for (const t of open) {
    const state = dueInfo(t, today).state;
    if (state === "overdue") overdue++;
    else if (state === "today") dueToday++;
    if (t.blocked) blocked++;
  }
  return { total: open.length, overdue, dueToday, blocked, top: open.slice(0, topN) };
}
