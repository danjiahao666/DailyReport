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

export type TodoFilter = "all" | "open" | "long" | "blocked" | "overdue" | "done";

export const FILTER_LABEL: Record<TodoFilter, string> = {
  all: "全部",
  open: "未完成",
  long: "长期事项",
  blocked: "已卡住",
  overdue: "已逾期",
  done: "已完成",
};

export const FILTERS: TodoFilter[] = ["all", "open", "long", "blocked", "overdue", "done"];

/** 需要推进的待办：未完成的普通事项（长期事项没有“完成”，不算在内） */
function isActionable(todo: Pick<TodoItem, "status">): boolean {
  return todo.status === "todo" || todo.status === "doing";
}

/**
 * 进入「明日计划」的待办：未完成的普通事项，加上长期事项。
 * 长期事项没有进度也没有完成状态，但一直在推进，标题同样要出现在明日计划里。
 */
function isPendingPlan(todo: Pick<TodoItem, "status">): boolean {
  return isActionable(todo) || todo.status === "ongoing";
}

export function matchesFilter(todo: TodoItem, filter: TodoFilter, today: string): boolean {
  switch (filter) {
    case "all":
      return true;
    case "open":
      return isActionable(todo);
    case "long":
      return todo.longTerm;
    case "blocked":
      return todo.blocked;
    case "overdue":
      return dueInfo(todo, today).state === "overdue";
    case "done":
      return todo.status === "done";
  }
}

export function countByFilter(todos: TodoItem[], today: string): Record<TodoFilter, number> {
  const counts = { all: 0, open: 0, long: 0, blocked: 0, overdue: 0, done: 0 } satisfies Record<TodoFilter, number>;
  for (const t of todos) for (const f of FILTERS) if (matchesFilter(t, f, today)) counts[f]++;
  return counts;
}

/**
 * 展示顺序：未完成的普通事项在前，按期望完成日期从近到远（没设日期的排后面），再按优先级、新建先后；
 * 其次是长期事项（按优先级、新建先后）；已完成的在最后，最近完成的靠前。
 */
export function sortTodos(todos: TodoItem[]): TodoItem[] {
  const group = (t: TodoItem) => (t.status === "done" ? 2 : t.longTerm ? 1 : 0);
  return [...todos].sort((a, b) => {
    if (group(a) !== group(b)) return group(a) - group(b);
    if (a.status === "done") return (b.completedAt ?? "").localeCompare(a.completedAt ?? "") || b.id - a.id;
    if (a.longTerm) return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.id - a.id;
    if (a.dueDate !== b.dueDate) {
      if (a.dueDate === null) return 1;
      if (b.dueDate === null) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    }
    return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.id - a.id;
  });
}

export interface OpenTodoSummary {
  /** 需要提醒的待办数：未完成的普通事项，加上有未解决卡点的长期事项 */
  total: number;
  overdue: number;
  dueToday: number;
  blocked: number;
  /** 最该先看的几条：按展示顺序（期限最近的在前） */
  top: TodoItem[];
}

/**
 * 首页提醒用：统计逾期、今天到期、已卡住数量，并取出最靠前的几条。
 * 长期事项没有期限，平时不提醒；只有存在未解决卡点时才纳入，避免一直挂着的事项反复打扰。
 */
export function summarizeOpen(todos: TodoItem[], today: string, topN = 3): OpenTodoSummary {
  const open = sortTodos(todos.filter((t) => isActionable(t) || (t.longTerm && t.blocked)));
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

/** 喂给大模型的待办条数上限（计划、问题各自计数），避免清单很长时撑爆提示词 */
export const PROMPT_MAX_ITEMS = 15;

export interface TodoPromptContext {
  /** 明日计划候选：未完成的普通待办与长期事项，期限近的在前 */
  plans: string[];
  /** 遇到问题候选：所有未解决的卡点，格式“待办标题：卡点内容” */
  problems: string[];
  /** 超出条数上限、没有列出的数量 */
  morePlans: number;
  moreProblems: number;
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * 日报优化时给大模型的待办素材：只给标题和卡点原文，不带进度与日期，
 * 避免模型把精确数字写进日报（也就不会被“新增数字”核对误伤）。
 */
export function todoPromptContext(todos: TodoItem[]): TodoPromptContext {
  const sorted = sortTodos(todos);
  const plans = sorted.filter(isPendingPlan).map((t) => oneLine(t.title));
  const problems = sorted
    .filter((t) => t.blocked)
    .flatMap((t) => t.blockers.filter((b) => b.resolvedAt === null).map((b) => `${oneLine(t.title)}：${oneLine(b.content)}`));
  return {
    plans: plans.slice(0, PROMPT_MAX_ITEMS),
    problems: problems.slice(0, PROMPT_MAX_ITEMS),
    morePlans: Math.max(0, plans.length - PROMPT_MAX_ITEMS),
    moreProblems: Math.max(0, problems.length - PROMPT_MAX_ITEMS),
  };
}
