"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import { dueInfo, summarizeOpen } from "@/lib/todo-view";
import type { TodoItem } from "@/lib/types";
import { ErrorNotice, Notice } from "./ui";

/**
 * 首页的待办提醒：有未完成的待办或长期事项时显示数量、逾期 / 今天到期 / 已卡住的统计和最靠前的几条，
 * 没有未完成待办时不占位。超过三条时先折叠，点“展开全部”可以看到所有待提醒的待办。
 * 逾期、今天到期或已卡住时用黄色提示，否则用蓝色。
 */
export function TodoReminder({ today }: { today: string }) {
  const [todos, setTodos] = useState<TodoItem[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    try {
      setTodos((await api<{ todos: TodoItem[] }>("GET", "/api/todos?open=1")).todos);
      setError(null);
    } catch (e) {
      setError(e as ApiError);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 在待办页改完再切回这个页签时，提醒要跟着更新
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  const summary = useMemo(() => (todos ? summarizeOpen(todos, today) : null), [todos, today]);

  if (error) return <ErrorNotice error={error} onRetry={() => void load()} />;
  if (!summary || summary.total === 0) return null;

  const urgent = summary.overdue + summary.dueToday + summary.blocked > 0;
  const collapsible = summary.items.length > summary.top.length;
  const visible = expanded ? summary.items : summary.top;

  return (
    <Notice tone={urgent ? "warn" : "info"}>
      <div className="space-y-1.5">
        <p className="flex flex-wrap items-center gap-1.5">
          <strong>待办提醒：还有 {summary.total} 条未完成的待办</strong>
          {summary.overdue > 0 && <span className="pixel-tag pixel-tag--red">已逾期 {summary.overdue}</span>}
          {summary.dueToday > 0 && <span className="pixel-tag pixel-tag--amber">今天到期 {summary.dueToday}</span>}
          {summary.blocked > 0 && <span className="pixel-tag pixel-tag--red">已卡住 {summary.blocked}</span>}
          <a href="/todos" className="underline">
            去处理 →
          </a>
        </p>
        <ul className="space-y-0.5">
          {visible.map((t) => {
            const due = dueInfo(t, today);
            return (
              <li key={t.id} className="flex flex-wrap items-center gap-1.5">
                <span className="min-w-0 break-words">· {t.title}</span>
                {t.longTerm ? (
                  <span className="pixel-tag pixel-tag--violet">长期</span>
                ) : (
                  <span className="text-xs text-ink-soft">{t.progress}%</span>
                )}
                {due.state !== "none" && due.state !== "done" && <span className="text-xs text-ink-soft">{due.label}</span>}
                {t.blocked && <span className="pixel-tag pixel-tag--red">卡住</span>}
              </li>
            );
          })}
        </ul>
        {collapsible && (
          <p className="text-xs">
            <button type="button" onClick={() => setExpanded((v) => !v)} className="underline">
              {expanded ? "收起 ▲" : `展开全部 ${summary.items.length} 条 ▼`}
            </button>
          </p>
        )}
      </div>
    </Notice>
  );
}
