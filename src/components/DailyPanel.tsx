"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import { weekdayName } from "@/lib/dates";
import type { DailyEntry, DailyVersion } from "@/lib/types";
import { Button, ErrorNotice, Modal, Notice, Spinner } from "./ui";

interface Props {
  date: string;
  onChanged: () => void;
}

type OptimizeResponse = { entry: DailyEntry; warnings: string[] };

export function DailyPanel({ date, onChanged }: Props) {
  const [entry, setEntry] = useState<DailyEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ApiError | null>(null);

  const [text, setText] = useState("");
  const [wantOptimize, setWantOptimize] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<ApiError | null>(null);
  const [conflict, setConflict] = useState<DailyEntry | null>(null);

  const [optimizing, setOptimizing] = useState(false);
  const [optimizeError, setOptimizeError] = useState<ApiError | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const [editing, setEditing] = useState<DailyVersion | null>(null);
  const [draft, setDraft] = useState("");
  const [editError, setEditError] = useState<ApiError | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const current = useRef(date);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api<{ entry: DailyEntry | null }>("GET", `/api/daily/${date}`);
      if (current.current === date) setEntry(res.entry);
    } catch (e) {
      if (current.current === date) setLoadError(e as ApiError);
    } finally {
      if (current.current === date) setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    current.current = date;
    setEntry(null);
    setText("");
    setSaveError(null);
    setOptimizeError(null);
    setWarnings([]);
    setEditing(null);
    setConfirmDelete(false);
    setActionError(null);
    setConflict(null);
    void load();
  }, [date, load]);

  async function optimize() {
    setOptimizing(true);
    setOptimizeError(null);
    try {
      const res = await api<OptimizeResponse>("POST", `/api/daily/${date}/optimize`);
      setEntry(res.entry);
      setWarnings(res.warnings);
      onChanged();
    } catch (e) {
      setOptimizeError(e as ApiError);
    } finally {
      setOptimizing(false);
    }
  }

  async function submit(mode?: "overwrite" | "append") {
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await api<DailyEntry>("POST", "/api/daily", { date, content: text, mode });
      setEntry(saved);
      setConflict(null);
      setText("");
      onChanged();
      // 日报已保存；优化是独立的第二步，失败不影响已保存的内容
      if (wantOptimize) {
        setSaving(false);
        await optimize();
      }
    } catch (e) {
      const err = e as ApiError;
      if (err.code === "DAILY_EXISTS") setConflict(err.data.existing as DailyEntry);
      else setSaveError(err);
    } finally {
      setSaving(false);
    }
  }

  async function setActive(active: DailyVersion) {
    setActionError(null);
    try {
      setEntry(await api<DailyEntry>("PUT", `/api/daily/${date}/active`, { active }));
      onChanged();
    } catch (e) {
      setActionError(e as ApiError);
    }
  }

  async function saveEdit() {
    if (!editing) return;
    setEditError(null);
    try {
      setEntry(await api<DailyEntry>("PUT", `/api/daily/${date}`, { target: editing, content: draft }));
      setEditing(null);
      onChanged();
    } catch (e) {
      setEditError(e as ApiError);
    }
  }

  async function remove() {
    setActionError(null);
    try {
      await api("DELETE", `/api/daily/${date}`);
      setEntry(null);
      setConfirmDelete(false);
      onChanged();
    } catch (e) {
      setActionError(e as ApiError);
      setConfirmDelete(false);
    }
  }

  function startEdit(which: DailyVersion) {
    if (!entry) return;
    setEditing(which);
    setDraft(which === "original" ? entry.original : (entry.optimized ?? ""));
    setEditError(null);
  }

  const versionCard = (which: DailyVersion) => {
    if (!entry) return null;
    const content = which === "original" ? entry.original : entry.optimized;
    if (content === null) return null;
    const isActive = entry.active === which;
    const isEditing = editing === which;
    return (
      <div className={`rounded-md border p-3 ${isActive ? "border-blue-500 bg-blue-50/40" : "border-slate-200 bg-white"}`}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            {which === "original" ? "原文" : "优化稿"}
            {isActive && <span className="rounded bg-blue-600 px-1.5 py-0.5 text-xs font-normal text-white">当前采用</span>}
            {which === "optimized" && entry.optimizedStale && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-normal text-amber-800">已过期</span>
            )}
          </div>
          <div className="flex gap-1">
            {!isActive && (
              <Button onClick={() => setActive(which)} className="px-2 py-1 text-xs">
                {which === "original" ? "回退到原文" : "采用此版本"}
              </Button>
            )}
            {!isEditing && (
              <Button variant="ghost" onClick={() => startEdit(which)} className="px-2 py-1 text-xs">
                编辑
              </Button>
            )}
          </div>
        </div>
        {isEditing ? (
          <div className="space-y-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={7}
              maxLength={20000}
              className="w-full rounded-md border border-slate-300 p-2 text-sm"
              aria-label={`编辑${which === "original" ? "原文" : "优化稿"}`}
            />
            {editError && <ErrorNotice error={editError} />}
            {which === "original" && entry.optimized !== null && (
              <p className="text-xs text-amber-700">修改原文后，已有优化稿会标记为过期，并自动回退采用原文。</p>
            )}
            <div className="flex gap-2">
              <Button variant="primary" onClick={saveEdit} disabled={draft.trim() === ""}>
                保存
              </Button>
              <Button onClick={() => setEditing(null)}>取消</Button>
            </div>
          </div>
        ) : (
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-800">{content}</p>
        )}
        {which === "optimized" && entry.optimizedModel && !isEditing && (
          <p className="mt-2 text-xs text-slate-400">由 {entry.optimizedModel} 优化</p>
        )}
      </div>
    );
  };

  return (
    <section aria-label="日报" className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <header className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          {date} <span className="text-sm font-normal text-slate-500">{weekdayName(date)} · 日报</span>
        </h2>
        {entry && (
          <div className="flex items-center gap-2">
            <Button onClick={optimize} disabled={optimizing}>
              {entry.optimized === null ? "用大模型优化" : "重新优化"}
            </Button>
            {confirmDelete ? (
              <span className="flex items-center gap-1 text-sm">
                确认删除？
                <Button variant="danger" onClick={remove} className="px-2 py-1 text-xs">
                  删除
                </Button>
                <Button onClick={() => setConfirmDelete(false)} className="px-2 py-1 text-xs">
                  取消
                </Button>
              </span>
            ) : (
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                删除
              </Button>
            )}
          </div>
        )}
      </header>

      {loading && <Spinner label="加载中…" />}
      {loadError && <ErrorNotice error={loadError} onRetry={load} />}
      {actionError && <ErrorNotice error={actionError} />}

      {optimizing && <Spinner label="大模型优化中，请稍候…" />}
      {optimizeError && (
        <div className="space-y-1">
          <ErrorNotice error={optimizeError} onRetry={optimize} busy={optimizing} />
          <p className="text-xs text-slate-500">日报原文已保存，不受影响；可直接重试。</p>
        </div>
      )}
      {warnings.map((w) => (
        <Notice key={w} tone="warn">
          {w}
        </Notice>
      ))}
      {entry?.optimizedStale && entry.optimized !== null && (
        <Notice tone="warn" onRetry={optimize} retryLabel="重新优化" busy={optimizing}>
          原文已修改，现有优化稿对应的是旧内容（周报、月报当前使用原文）。
        </Notice>
      )}

      {entry && (
        <div className={`grid gap-3 ${entry.optimized !== null ? "md:grid-cols-2" : ""}`}>
          {versionCard("original")}
          {versionCard("optimized")}
        </div>
      )}

      <form
        className="space-y-2 border-t border-slate-100 pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label htmlFor="daily-text" className="text-sm font-medium">
          {entry ? "再次提交（将提示覆盖或追加）" : "提交日报"}
        </label>
        <textarea
          id="daily-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={entry ? 3 : 7}
          maxLength={20000}
          placeholder="今天做了什么？简短记录即可，如：联调登录接口；修复报表导出缺陷"
          className="w-full rounded-md border border-slate-300 p-2 text-sm"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={wantOptimize} onChange={(e) => setWantOptimize(e.target.checked)} />
            提交后用大模型优化（保留原文，由你决定采用哪一版）
          </label>
          <Button type="submit" variant="primary" disabled={saving || optimizing || text.trim() === ""}>
            {saving ? "保存中…" : "提交"}
          </Button>
        </div>
        {saveError && <ErrorNotice error={saveError} />}
      </form>

      {conflict && (
        <Modal title="该日期已有日报" onClose={() => setConflict(null)}>
          <p className="mb-2 text-sm text-slate-600">一天只保留一条日报。已有内容：</p>
          <pre className="mb-3 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-sm">{conflict.original}</pre>
          <p className="mb-3 text-sm text-slate-600">请选择如何处理新提交的内容：</p>
          <ul className="mb-4 space-y-1 text-xs text-slate-500">
            <li>覆盖：用新内容替换原文，已有的优化稿一并清除。</li>
            <li>追加：把新内容接在原文末尾，已有的优化稿会标记为过期。</li>
          </ul>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setConflict(null)}>取消</Button>
            <Button variant="danger" onClick={() => submit("overwrite")} disabled={saving}>
              覆盖
            </Button>
            <Button variant="primary" onClick={() => submit("append")} disabled={saving}>
              追加
            </Button>
          </div>
        </Modal>
      )}
    </section>
  );
}
