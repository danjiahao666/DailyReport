"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, todayLocal } from "@/lib/api-client";
import { fmtTime } from "@/lib/format";
import {
  countByFilter,
  dueInfo,
  FILTER_LABEL,
  FILTERS,
  matchesFilter,
  PRIORITY_LABEL,
  REOPEN_PROGRESS,
  sortTodos,
  type TodoFilter,
} from "@/lib/todo-view";
import type { TodoItem, TodoPriority } from "@/lib/types";
import { SiteHeader } from "./pixel";
import { Button, ErrorNotice, Spinner } from "./ui";

// 与服务端 server/todos.ts 的长度上限保持一致
const TITLE_MAX = 200;
const NOTE_MAX = 2000;
const BLOCKER_MAX = 500;

const PRIORITY_TAG: Record<TodoPriority, string> = { high: "pixel-tag--red", medium: "pixel-tag--amber", low: "pixel-tag--plain" };

interface FormValues {
  title: string;
  note: string;
  priority: TodoPriority;
  startDate: string;
  dueDate: string;
  /** 长期事项：不设进度条和日期 */
  longTerm: boolean;
}

const EMPTY_FORM: FormValues = { title: "", note: "", priority: "medium", startDate: "", dueDate: "", longTerm: false };

/** 把表单值转成接口请求体：空日期传 null（编辑时用于清除）；长期事项一律不带日期 */
function toPayload(v: FormValues) {
  return {
    title: v.title,
    note: v.note,
    priority: v.priority,
    longTerm: v.longTerm,
    startDate: v.longTerm ? null : v.startDate || null,
    dueDate: v.longTerm ? null : v.dueDate || null,
  };
}

/** 新建与编辑共用的表单 */
function TodoForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: FormValues;
  submitLabel: string;
  onSubmit: (values: FormValues) => Promise<void>;
  onCancel?: () => void;
}) {
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => setValues((v) => ({ ...v, [key]: value }));
  const dateOrderBad = !values.longTerm && values.startDate !== "" && values.dueDate !== "" && values.dueDate < values.startDate;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(values);
      // 新建成功后清空；编辑成功后表单会被卸载
      setValues(initial);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block space-y-1">
        <span className="text-sm font-semibold">待办内容</span>
        <input
          value={values.title}
          onChange={(e) => set("title", e.target.value)}
          maxLength={TITLE_MAX}
          placeholder="例如：完成接口联调"
          className="pixel-field"
          required
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={values.longTerm} onChange={(e) => set("longTerm", e.target.checked)} className="pixel-check" />
        <span className="font-semibold">长期事项</span>
        <span className="text-xs text-ink-soft">不设进度条和日期，一直挂着跟踪，也可以记卡点</span>
      </label>
      <div className="flex flex-wrap gap-3">
        {!values.longTerm && (
          <>
            <label className="space-y-1">
              <span className="block text-sm font-semibold">开始日期</span>
              <input type="date" value={values.startDate} onChange={(e) => set("startDate", e.target.value)} className="pixel-field" />
            </label>
            <label className="space-y-1">
              <span className="block text-sm font-semibold">期望完成日期</span>
              <input
                type="date"
                value={values.dueDate}
                min={values.startDate || undefined}
                onChange={(e) => set("dueDate", e.target.value)}
                className="pixel-field"
              />
            </label>
          </>
        )}
        <label className="space-y-1">
          <span className="block text-sm font-semibold">优先级</span>
          <select value={values.priority} onChange={(e) => set("priority", e.target.value as TodoPriority)} className="pixel-field">
            {(["high", "medium", "low"] as const).map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block space-y-1">
        <span className="text-sm font-semibold">备注（可选）</span>
        <textarea value={values.note} onChange={(e) => set("note", e.target.value)} maxLength={NOTE_MAX} rows={2} className="pixel-field" />
      </label>
      {dateOrderBad && <p className="text-xs text-coral-deep">期望完成日期不能早于开始日期。</p>}
      {error && <ErrorNotice error={error} />}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={busy || values.title.trim() === "" || dateOrderBad}>
          {submitLabel}
        </Button>
        {onCancel && <Button onClick={onCancel}>取消</Button>}
      </div>
    </form>
  );
}

/**
 * 进度滑块。拖动时只改本地草稿，松手（鼠标、触摸、键盘）才提交，避免每动一格就请求一次。
 * 滑块在请求期间保持可用（禁用会让键盘焦点丢失），提交串行进行：上一次未结束时只记下最新值，
 * 结束后再补提交；提交失败时滑块回到服务端保存的进度。
 */
function ProgressControl({ progress, onCommit }: { progress: number; onCommit: (value: number) => Promise<boolean> }) {
  const [draft, setDraft] = useState(progress);
  const draftRef = useRef(progress);
  const savedRef = useRef(progress);
  const inflight = useRef(false);

  useEffect(() => {
    savedRef.current = progress;
    // 提交过程中不要用旧的服务端值覆盖用户正在调整的草稿
    if (!inflight.current) {
      draftRef.current = progress;
      setDraft(progress);
    }
  }, [progress]);

  const commit = async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      while (draftRef.current !== savedRef.current) {
        const target = draftRef.current;
        if (!(await onCommit(target))) {
          draftRef.current = savedRef.current;
          setDraft(savedRef.current);
          break;
        }
        savedRef.current = target;
      }
    } finally {
      inflight.current = false;
    }
  };

  return (
    <input
      type="range"
      min={0}
      max={100}
      step={5}
      value={draft}
      onChange={(e) => {
        draftRef.current = Number(e.target.value);
        setDraft(draftRef.current);
      }}
      onPointerUp={() => void commit()}
      onKeyUp={() => void commit()}
      aria-label="调整进度"
      className="pixel-range"
    />
  );
}

/** 进度条的颜色随进度渐变（红 → 黄 → 绿）：渐变铺在整条轨道上，填充只是露出其中一段，所以填充末端的颜色就是当前进度对应的颜色 */
function ProgressBar({ value }: { value: number }) {
  return (
    <div className="pixel-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-label="完成进度">
      <div className="pixel-progress__bar" data-empty={value === 0} style={{ width: `${value}%`, backgroundSize: `${10000 / Math.max(value, 1)}% 100%` }} />
    </div>
  );
}

function BlockerSection({ todo, run, busy }: { todo: TodoItem; run: (fn: () => Promise<TodoItem>) => Promise<boolean>; busy: boolean }) {
  const [text, setText] = useState("");
  const open = todo.blockers.filter((b) => b.resolvedAt === null).length;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (text.trim() === "") return;
    const ok = await run(() => api<TodoItem>("POST", `/api/todos/${todo.id}/blockers`, { content: text }));
    if (ok) setText("");
  }

  return (
    <div className="pixel-well space-y-2 p-2">
      <p className="text-sm font-semibold">
        卡点 {todo.blockers.length > 0 && <span className="font-normal text-muted">（{open} 个未解决）</span>}
      </p>
      {todo.blockers.length > 0 && (
        <ul className="space-y-1.5 text-sm">
          {todo.blockers.map((b) => {
            const resolved = b.resolvedAt !== null;
            return (
              <li key={b.id} className="flex flex-wrap items-start justify-between gap-2">
                <span className="min-w-0 flex-1 break-words">
                  <span className={`pixel-tag mr-1.5 ${resolved ? "pixel-tag--green" : "pixel-tag--red"}`}>{resolved ? "已解决" : "卡住"}</span>
                  <span className={resolved ? "text-muted line-through" : ""}>{b.content}</span>
                  <span className="text-xs text-muted">
                    {" "}
                    · {fmtTime(b.createdAt)}
                    {resolved && b.resolvedAt ? ` → ${fmtTime(b.resolvedAt)} 解决` : ""}
                  </span>
                </span>
                <span className="flex shrink-0 gap-1">
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => run(() => api<TodoItem>("PATCH", `/api/todos/${todo.id}/blockers/${b.id}`, { resolved: !resolved }))}
                  >
                    {resolved ? "重新卡住" : "已解决"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => run(() => api<TodoItem>("DELETE", `/api/todos/${todo.id}/blockers/${b.id}`))}
                  >
                    删除
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <form onSubmit={add} className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={BLOCKER_MAX}
          placeholder="记录一个卡点，例如：等待对方提供测试账号"
          aria-label="新增卡点"
          className="pixel-field"
        />
        <Button type="submit" size="sm" disabled={busy || text.trim() === ""} className="shrink-0">
          添加卡点
        </Button>
      </form>
    </div>
  );
}

function TodoCard({
  todo,
  today,
  onChanged,
  onDeleted,
}: {
  todo: TodoItem;
  today: string;
  onChanged: (todo: TodoItem) => void;
  onDeleted: (id: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const done = todo.status === "done";
  const due = dueInfo(todo, today);

  /** 执行一次修改并用返回的最新待办替换本地数据；失败时显示在卡片内，返回是否成功 */
  const run = useCallback(
    async (fn: () => Promise<TodoItem>): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        onChanged(await fn());
        return true;
      } catch (e) {
        setError(e as ApiError);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [onChanged],
  );

  const patch = (body: Record<string, unknown>) => run(() => api<TodoItem>("PATCH", `/api/todos/${todo.id}`, body));

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api("DELETE", `/api/todos/${todo.id}`);
      onDeleted(todo.id);
    } catch (e) {
      setError(e as ApiError);
      setBusy(false);
    }
  }

  const dueTagClass =
    due.state === "overdue" ? "pixel-tag--red" : due.state === "today" || due.state === "soon" ? "pixel-tag--amber" : "pixel-tag--plain";

  if (editing) {
    return (
      <li className="pixel-card p-3">
        <TodoForm
          initial={{ title: todo.title, note: todo.note, priority: todo.priority, startDate: todo.startDate ?? "", dueDate: todo.dueDate ?? "", longTerm: todo.longTerm }}
          submitLabel="保存"
          onSubmit={async (v) => {
            onChanged(await api<TodoItem>("PATCH", `/api/todos/${todo.id}`, toPayload(v)));
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li className="pixel-card space-y-2.5 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className={`break-words text-base font-semibold ${done ? "text-muted line-through" : ""}`}>{todo.title}</h3>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`pixel-tag ${PRIORITY_TAG[todo.priority]}`}>优先级 {PRIORITY_LABEL[todo.priority]}</span>
            {todo.longTerm ? (
              <span className="pixel-tag pixel-tag--violet">长期事项</span>
            ) : done ? (
              <span className="pixel-tag pixel-tag--green">已完成</span>
            ) : (
              <span className={`pixel-tag ${todo.status === "doing" ? "pixel-tag--blue" : "pixel-tag--plain"}`}>
                {todo.status === "doing" ? "进行中" : "未开始"}
              </span>
            )}
            {todo.blocked && <span className="pixel-tag pixel-tag--red">已卡住</span>}
            {(due.state === "overdue" || due.state === "today" || due.state === "soon" || due.state === "later") && (
              <span className={`pixel-tag ${dueTagClass}`}>{due.label}</span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          {todo.longTerm ? null : done ? (
            <Button size="sm" disabled={busy} onClick={() => patch({ progress: REOPEN_PROGRESS })}>
              重新打开
            </Button>
          ) : (
            <Button size="sm" variant="primary" disabled={busy} onClick={() => patch({ progress: 100 })}>
              标记完成
            </Button>
          )}
          <Button size="sm" disabled={busy} onClick={() => setEditing(true)}>
            编辑
          </Button>
          {confirmDelete ? (
            <>
              <Button size="sm" variant="danger" disabled={busy} onClick={remove}>
                确认删除
              </Button>
              <Button size="sm" onClick={() => setConfirmDelete(false)}>
                取消
              </Button>
            </>
          ) : (
            <Button size="sm" variant="danger" disabled={busy} onClick={() => setConfirmDelete(true)}>
              删除
            </Button>
          )}
        </div>
      </div>

      {/* 长期事项不设日期和进度条 */}
      {!todo.longTerm && (
        <>
          <p className="text-xs text-ink-soft">
            开始：{todo.startDate ?? "未设置"} · 期望完成：{todo.dueDate ?? "未设置"}
            {done && todo.completedAt ? ` · 完成于：${fmtTime(todo.completedAt)}` : ""}
          </p>

          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <ProgressBar value={todo.progress} />
              </div>
              <span className="w-10 shrink-0 text-right font-pixel text-sm">{todo.progress}%</span>
            </div>
            <ProgressControl progress={todo.progress} onCommit={(value) => patch({ progress: value })} />
          </div>
        </>
      )}

      {todo.note && <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{todo.note}</p>}

      <BlockerSection todo={todo} run={run} busy={busy} />

      {error && <ErrorNotice error={error} />}
    </li>
  );
}

export function Todos() {
  const [today] = useState(todayLocal);
  const [todos, setTodos] = useState<TodoItem[] | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<TodoFilter>("open");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setTodos((await api<{ todos: TodoItem[] }>("GET", "/api/todos")).todos);
    } catch (e) {
      setLoadError(e as ApiError);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const replace = useCallback((next: TodoItem) => setTodos((list) => (list ? list.map((t) => (t.id === next.id ? next : t)) : list)), []);
  const remove = useCallback((id: number) => setTodos((list) => (list ? list.filter((t) => t.id !== id) : list)), []);

  const counts = useMemo(() => countByFilter(todos ?? [], today), [todos, today]);
  const visible = useMemo(() => sortTodos((todos ?? []).filter((t) => matchesFilter(t, filter, today))), [todos, filter, today]);

  return (
    <>
      <SiteHeader
        title="待办事项"
        tagline="记录要做的事，跟踪进度、期限与卡点"
        narrow
        actions={
          <a href="/" className="pixel-button">
            ← 返回日报
          </a>
        }
      />
      <main className="page-shell !max-w-4xl space-y-5 py-6">
        <section aria-label="新增待办" className="pixel-panel">
          <header className="pixel-titlebar">
            <h2 className="font-pixel text-lg">新增待办</h2>
          </header>
          <div className="p-4">
            <TodoForm
              initial={EMPTY_FORM}
              submitLabel="添加待办"
              onSubmit={async (v) => {
                const created = await api<TodoItem>("POST", "/api/todos", toPayload(v));
                setTodos((list) => [created, ...(list ?? [])]);
                // 当前筛选看不到新待办时，切到它所在的分类，避免用户以为没加上
                if (!matchesFilter(created, filter, today)) setFilter(created.longTerm ? "long" : "open");
              }}
            />
          </div>
        </section>

        <section aria-label="待办列表" className="pixel-panel">
          <header className="pixel-titlebar">
            <h2 className="font-pixel text-lg">我的待办</h2>
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className="pixel-button pixel-button--sm">
                  {FILTER_LABEL[f]} {counts[f]}
                </button>
              ))}
            </div>
          </header>
          <div className="space-y-3 p-4">
            {loading && <Spinner label="加载中…" />}
            {loadError && <ErrorNotice error={loadError} onRetry={load} busy={loading} />}
            {todos && visible.length === 0 && (
              <p className="text-sm text-ink-soft">
                {todos.length === 0 ? "还没有待办，先在上面添加一条吧。" : `没有“${FILTER_LABEL[filter]}”的待办。`}
              </p>
            )}
            {visible.length > 0 && (
              <ul className="space-y-3">
                {visible.map((t) => (
                  <TodoCard key={t.id} todo={t} today={today} onChanged={replace} onDeleted={remove} />
                ))}
              </ul>
            )}
          </div>
        </section>
      </main>
    </>
  );
}
