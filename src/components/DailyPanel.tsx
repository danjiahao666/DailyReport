"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import { weekdayName } from "@/lib/dates";
import type { DailyEntry, DailyVersion, JobView } from "@/lib/types";
import { Icon } from "./pixel";
import { Button, ErrorNotice, JobFailed, Modal, Notice, Spinner } from "./ui";

interface Props {
  date: string;
  /** 该日期日报优化任务的最新状态（由服务端持久化，切换页面后回来仍可见） */
  job: JobView | null;
  onJob: (job: JobView | null) => void;
  onChanged: () => void;
  /** 设置中心里「提交日报时默认勾选大模型优化」 */
  defaultOptimize?: boolean;
}

export function DailyPanel({ date, job, onJob, onChanged, defaultOptimize = false }: Props) {
  const [entry, setEntry] = useState<DailyEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ApiError | null>(null);

  const [text, setText] = useState("");
  const [wantOptimize, setWantOptimize] = useState(defaultOptimize);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<ApiError | null>(null);
  const [conflict, setConflict] = useState<DailyEntry | null>(null);

  const [optimizeError, setOptimizeError] = useState<ApiError | null>(null);
  const [doneNote, setDoneNote] = useState(false);

  const [editing, setEditing] = useState<DailyVersion | null>(null);
  const [draft, setDraft] = useState("");
  const [editError, setEditError] = useState<ApiError | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const current = useRef(date);
  const lastStatus = useRef(job?.status);
  const optimizing = job?.status === "running";

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
    setDoneNote(false);
    lastStatus.current = job?.status;
    setEditing(null);
    setConfirmDelete(false);
    setActionError(null);
    setConflict(null);
    void load();
  }, [date, load]);

  // 日历数据晚于面板到达，或用户在设置中心改了默认值：同步一次勾选状态
  useEffect(() => {
    setWantOptimize(defaultOptimize);
  }, [defaultOptimize]);

  // 后台优化结束（成功或失败）后重新加载日报，展示优化稿
  useEffect(() => {
    if (lastStatus.current === "running" && job?.status !== "running") {
      void load();
      if (job?.status === "succeeded") setDoneNote(true);
    }
    lastStatus.current = job?.status;
  }, [job?.status, load]);

  /** 启动后台优化：立即返回，期间可以切换到其他日期或页面 */
  async function optimize() {
    setOptimizeError(null);
    setDoneNote(false);
    try {
      const res = await api<{ job: JobView }>("POST", `/api/daily/${date}/optimize`);
      onJob(res.job);
    } catch (e) {
      setOptimizeError(e as ApiError);
    }
  }

  async function dismissJob() {
    try {
      await api("DELETE", `/api/jobs?kind=optimize&target=${date}`);
      onJob(null);
    } catch (e) {
      setActionError(e as ApiError);
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
      // 日报已保存；优化是独立的第二步（后台执行），失败不影响已保存的内容
      if (wantOptimize) await optimize();
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
      <div className="pixel-card min-w-0 p-3" data-active={isActive}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <span className="font-pixel text-base">{which === "original" ? "原文" : "优化稿"}</span>
            {isActive && <span className="pixel-tag">当前采用</span>}
            {which === "optimized" && entry.optimizedStale && <span className="pixel-tag pixel-tag--amber">已过期</span>}
          </div>
          <div className="flex gap-1.5">
            {!isActive && (
              <Button size="sm" onClick={() => setActive(which)}>
                {which === "original" ? "回退到原文" : "采用此版本"}
              </Button>
            )}
            {!isEditing && (
              <Button size="sm" variant="ghost" onClick={() => startEdit(which)}>
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
              className="pixel-field"
              aria-label={`编辑${which === "original" ? "原文" : "优化稿"}`}
            />
            {editError && <ErrorNotice error={editError} />}
            {which === "original" && entry.optimized !== null && (
              <p className="text-xs text-amber-deep">修改原文后，已有优化稿会标记为过期，并自动回退采用原文。</p>
            )}
            <div className="flex gap-2">
              <Button variant="primary" onClick={saveEdit} disabled={draft.trim() === ""}>
                保存
              </Button>
              <Button onClick={() => setEditing(null)}>取消</Button>
            </div>
          </div>
        ) : (
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{content}</p>
        )}
        {which === "optimized" && entry.optimizedModel && !isEditing && (
          <p className="mt-2 text-xs text-muted">由 {entry.optimizedModel} 优化</p>
        )}
      </div>
    );
  };

  return (
    <section aria-label="日报" className="pixel-panel">
      <header className="pixel-titlebar">
        <h2 className="flex items-center gap-2 font-pixel text-lg">
          <Icon.Star scale={3} />
          {date} <span className="text-sm text-parchment">{weekdayName(date)} · 日报</span>
        </h2>
        {entry && (
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={optimize} disabled={optimizing}>
              {entry.optimized === null ? "用大模型优化" : "重新优化"}
            </Button>
            {confirmDelete ? (
              <span className="flex items-center gap-1.5 text-sm text-parchment">
                确认删除？
                <Button size="sm" variant="danger" onClick={remove}>
                  删除
                </Button>
                <Button size="sm" onClick={() => setConfirmDelete(false)}>
                  取消
                </Button>
              </span>
            ) : (
              <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>
                删除
              </Button>
            )}
          </div>
        )}
      </header>

      <div className="space-y-4 p-4">
        {loading && <Spinner label="加载中…" />}
        {loadError && <ErrorNotice error={loadError} onRetry={load} />}
        {actionError && <ErrorNotice error={actionError} />}

        {optimizing && <Spinner label="大模型正在后台优化，可以切换到其他日期或页面，完成后回来查看…" />}
        {optimizeError && <ErrorNotice error={optimizeError} onRetry={optimize} busy={optimizing} />}
        {job?.status === "failed" && (
          <JobFailed job={job} note="日报原文已保存，不受影响；可直接重试。" onRetry={optimize} onDismiss={dismissJob} busy={optimizing} />
        )}
        {doneNote && !optimizing && <Notice tone="info">优化完成。请对照原文，决定“采用此版本”或继续使用原文。</Notice>}
        {(entry?.warnings ?? []).map((w) => (
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
          <div className={`grid grid-cols-1 gap-3 ${entry.optimized !== null ? "md:grid-cols-2" : ""}`}>
            {versionCard("original")}
            {versionCard("optimized")}
          </div>
        )}

        <form
          className="space-y-2 border-t-2 border-dashed border-ink/25 pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label htmlFor="daily-text" className="font-pixel text-base">
            {entry ? "再次提交（将提示覆盖或追加）" : "提交日报"}
          </label>
          <textarea
            id="daily-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={entry ? 3 : 7}
            maxLength={20000}
            placeholder="今天做了什么？简短记录即可，如：联调登录接口；修复报表导出缺陷"
            className="pixel-field"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-sm text-ink-soft">
              <input type="checkbox" className="pixel-check" checked={wantOptimize} onChange={(e) => setWantOptimize(e.target.checked)} />
              提交后用大模型优化（保留原文，由你决定采用哪一版）
            </label>
            <Button type="submit" variant="primary" disabled={saving || optimizing || text.trim() === ""}>
              {saving ? "保存中…" : "提交"}
            </Button>
          </div>
          {saveError && <ErrorNotice error={saveError} />}
        </form>
      </div>

      {conflict && (
        <Modal title="该日期已有日报" onClose={() => setConflict(null)}>
          <p className="mb-2 text-sm text-ink-soft">一天只保留一条日报。已有内容：</p>
          <pre className="pixel-well mb-3 max-h-40 overflow-auto whitespace-pre-wrap p-2 font-ui text-sm">{conflict.original}</pre>
          <p className="mb-3 text-sm text-ink-soft">请选择如何处理新提交的内容：</p>
          <ul className="mb-4 space-y-1 text-xs text-muted">
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
