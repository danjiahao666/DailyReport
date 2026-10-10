"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import type { JobView, MonthlyPlan, MonthlySource, Report, ReportVersion, VersionOrigin } from "@/lib/types";
import { Markdown } from "./Markdown";
import { Icon } from "./pixel";
import { Button, CopyButton, ErrorNotice, JobFailed, Modal, Notice, Spinner } from "./ui";

interface Props {
  kind: "weekly" | "monthly";
  /** 周报：该周起始日；月报：YYYY-MM */
  anchor: string;
  /** 该周报/月报生成任务的最新状态（由服务端持久化，切换页面后回来仍可见） */
  job: JobView | null;
  onJob: (job: JobView | null) => void;
  onChanged: () => void;
}

const ORIGIN_LABEL: Record<VersionOrigin, string> = {
  generated: "模型生成",
  edited: "手动编辑",
  restored: "历史恢复",
};

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function ReportPanel({ kind, anchor, job, onJob, onChanged }: Props) {
  const [report, setReport] = useState<Report | null>(null);
  const [range, setRange] = useState<{ start: string; end: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ApiError | null>(null);

  const [source, setSource] = useState<MonthlySource>("daily");
  const [plan, setPlan] = useState<MonthlyPlan | null>(null);
  const [planError, setPlanError] = useState<ApiError | null>(null);

  const [genError, setGenError] = useState<ApiError | null>(null);
  const [doneNote, setDoneNote] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState<{ versionNo: number } | null>(null);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [editError, setEditError] = useState<ApiError | null>(null);

  const [viewing, setViewing] = useState<ReportVersion | null>(null);
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const key = useRef("");
  const lastStatus = useRef(job?.status);
  const generating = job?.status === "running";

  const label = kind === "weekly" ? "周报" : "月报";
  const reportUrl = kind === "weekly" ? `/api/reports/weekly?date=${anchor}` : `/api/reports/monthly?month=${anchor}`;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const k = `${kind}:${anchor}`;
    try {
      const res = await api<{ range: { start: string; end: string }; report: Report | null }>("GET", reportUrl);
      if (key.current !== k) return;
      setRange(res.range);
      setReport(res.report);
      if (kind === "monthly" && res.report?.current?.meta?.source) setSource(res.report.current.meta.source);
    } catch (e) {
      if (key.current === k) setLoadError(e as ApiError);
    } finally {
      if (key.current === k) setLoading(false);
    }
  }, [kind, anchor, reportUrl]);

  useEffect(() => {
    key.current = `${kind}:${anchor}`;
    setReport(null);
    setRange(null);
    setGenError(null);
    setEditing(false);
    setViewing(null);
    setActionError(null);
    setConfirmRegen(null);
    setDoneNote(false);
    lastStatus.current = job?.status;
    void load();
  }, [kind, anchor, load]);

  // 后台生成结束（成功或失败）后重新加载，展示最新版本
  useEffect(() => {
    if (lastStatus.current === "running" && job?.status !== "running") {
      void load();
      if (job?.status === "succeeded") setDoneNote(true);
    }
    lastStatus.current = job?.status;
  }, [job?.status, load]);

  // 月报：预览取数规则（含跨月周的处理方式），不调用大模型
  useEffect(() => {
    if (kind !== "monthly") return;
    let cancelled = false;
    setPlanError(null);
    api<MonthlyPlan>("GET", `/api/reports/monthly/plan?month=${anchor}&source=${source}`)
      .then((p) => !cancelled && setPlan(p))
      .catch((e) => !cancelled && (setPlan(null), setPlanError(e as ApiError)));
    return () => {
      cancelled = true;
    };
  }, [kind, anchor, source, report?.updatedAt]);

  /**
   * 启动后台生成：没有日报、需要确认覆盖等情况会立即返回错误；
   * 通过校验后立即返回任务状态，期间可以切换到其他日期或页面。
   */
  async function generate(confirm = false) {
    setGenError(null);
    setConfirmRegen(null);
    setDoneNote(false);
    try {
      const body = kind === "weekly" ? { date: anchor, confirm } : { month: anchor, source, confirm };
      const res = await api<{ job: JobView }>("POST", `/api/reports/${kind}`, body);
      setViewing(null);
      setEditing(false);
      onJob(res.job);
    } catch (e) {
      const err = e as ApiError;
      if (err.code === "CONFIRM_OVERWRITE_EDITED") setConfirmRegen({ versionNo: Number(err.data.currentVersionNo) });
      else setGenError(err);
    }
  }

  async function dismissJob() {
    if (!job) return;
    try {
      await api("DELETE", `/api/jobs?kind=${job.kind}&target=${job.target}`);
      onJob(null);
    } catch (e) {
      setActionError(e as ApiError);
    }
  }

  async function saveEdit() {
    if (!report) return;
    setEditError(null);
    try {
      setReport(await api<Report>("PUT", `/api/reports/${report.id}`, { content: draft }));
      setEditing(false);
      setViewing(null);
      onChanged();
    } catch (e) {
      setEditError(e as ApiError);
    }
  }

  async function restore(v: ReportVersion) {
    if (!report) return;
    setActionError(null);
    try {
      setReport(await api<Report>("POST", `/api/reports/${report.id}/restore`, { versionId: v.id }));
      setViewing(null);
      onChanged();
    } catch (e) {
      setActionError(e as ApiError);
    }
  }

  const shown = viewing ?? report?.current ?? null;
  const isHistorical = viewing !== null && viewing.id !== report?.currentVersionId;
  const title =
    kind === "weekly" ? `周报 ${range ? `${range.start} 至 ${range.end}` : ""}` : `${anchor.replace("-", " 年 ")} 月月报`;

  return (
    <section aria-label={label} className="pixel-panel">
      <header className="pixel-titlebar">
        <div>
          <h2 className="flex items-center gap-2 font-pixel text-lg">
            {kind === "weekly" ? <Icon.Scroll scale={3} /> : <Icon.Chest scale={3} />}
            {title}
          </h2>
          {report?.current && (
            <p className="text-xs text-parchment/80">
              当前 v{report.current.versionNo} · {ORIGIN_LABEL[report.current.origin]}
              {report.current.model ? ` · ${report.current.model}` : ""} · {fmtTime(report.current.createdAt)}
            </p>
          )}
        </div>
        <Button size="sm" variant="primary" onClick={() => generate(false)} disabled={generating || loading}>
          {generating ? "生成中…" : report ? `重新生成${label}` : `生成${label}`}
        </Button>
      </header>

      <div className="space-y-4 p-4">
        {kind === "monthly" && (
          <fieldset className="pixel-card space-y-2 p-3">
            <legend className="bg-parchment px-1.5 font-pixel text-base">数据来源</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-1.5">
                <input type="radio" className="pixel-check" name="source" checked={source === "daily"} onChange={() => setSource("daily")} />
                本月日报
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" className="pixel-check" name="source" checked={source === "weekly"} onChange={() => setSource("weekly")} />
                已有周报（跨月周与无周报的周自动补用日报）
              </label>
            </div>
            {planError && <ErrorNotice error={planError} />}
            {plan && (
              <details className="text-xs text-ink-soft" open>
                <summary className="cursor-pointer text-ink">
                  取数规则：{plan.weeklyCount} 份周报 + {plan.dailyCount} 天日报（跨月周按日期归属拆分，只取属于本月的日期）
                </summary>
                <ul className="mt-1.5 space-y-1">
                  {plan.weeks.map((w) => (
                    <li key={w.weekStart} className="flex gap-2">
                      <span className="w-44 shrink-0 tabular-nums">
                        {w.from.slice(5)} ~ {w.to.slice(5)}
                        {!w.full && <span className="pixel-tag pixel-tag--amber ml-1 !text-[10px] !leading-4">跨月</span>}
                      </span>
                      <span>
                        {w.use === "weekly" ? "周报" : w.use === "daily" ? `日报 ${w.dailyCount} 天` : "无数据"} · {w.reason}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </fieldset>
        )}

        {loading && <Spinner label="加载中…" />}
        {loadError && <ErrorNotice error={loadError} onRetry={load} />}
        {generating && <Spinner label={`大模型正在后台生成${label}，可以切换到其他日期或页面，完成后回来查看…`} />}
        {genError && <ErrorNotice error={genError} onRetry={() => generate(false)} busy={generating} />}
        {job?.status === "failed" && (
          <JobFailed job={job} note={`已保存的日报和${label}历史版本不受影响；可直接重试。`} onRetry={() => generate(false)} onDismiss={dismissJob} busy={generating} />
        )}
        {doneNote && !generating && <Notice tone="info">{label}已生成，保存为新版本。</Notice>}
        {actionError && <ErrorNotice error={actionError} />}
        {report?.outdated && (
          <Notice tone="warn" onRetry={() => generate(false)} retryLabel="重新生成" busy={generating}>
            自上次生成后，来源日报{kind === "monthly" ? "或周报" : ""}已发生变化，内容可能不是最新的。
          </Notice>
        )}

        {!loading && !loadError && !report && !genError && (
          <p className="pixel-well border-dashed p-4 text-sm text-ink-soft">
            尚未生成{label}。点击右上角“生成{label}”，将汇总{kind === "weekly" ? "该周" : "该月"}的{kind === "weekly" || source === "daily" ? "日报" : "周报与日报"}。
            {kind === "weekly" ? "如果该周没有日报，会直接提示，不会调用大模型。" : ""}
          </p>
        )}

        {shown && (
          <div className="space-y-2">
            {isHistorical && (
              <Notice tone="info">
                正在查看历史版本 v{viewing!.versionNo}（{ORIGIN_LABEL[viewing!.origin]} · {fmtTime(viewing!.createdAt)}）
                <span className="ml-2 inline-flex gap-1.5 align-middle">
                  <Button size="sm" onClick={() => restore(viewing!)}>
                    恢复为当前版本
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setViewing(null)}>
                    返回当前版本
                  </Button>
                </span>
              </Notice>
            )}
            {editing ? (
              <div className="space-y-2">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={16}
                  maxLength={50000}
                  className="pixel-field font-mono"
                  aria-label={`编辑${label}`}
                />
                {editError && <ErrorNotice error={editError} />}
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="primary" onClick={saveEdit} disabled={draft.trim() === ""}>
                    保存为新版本
                  </Button>
                  <Button onClick={() => setEditing(false)}>取消</Button>
                  <span className="text-xs text-muted">保存会新增一个版本，历史版本不会被覆盖。</span>
                </div>
              </div>
            ) : (
              <div className="pixel-well p-4">
                <Markdown text={shown.content} />
              </div>
            )}
            {!editing && (
              <div className="flex flex-wrap gap-2">
                <CopyButton text={shown.content} label={`复制${label}`} />
                {!isHistorical && (
                  <Button
                    onClick={() => {
                      setDraft(shown.content);
                      setEditing(true);
                      setEditError(null);
                    }}
                  >
                    编辑
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {report && report.versions.length > 0 && (
          <details className="pixel-card p-3">
            <summary className="cursor-pointer font-pixel text-base">历史版本（{report.versions.length}）</summary>
            <ul className="mt-2 divide-y-2 divide-dashed divide-ink/20 text-sm">
              {report.versions.map((v) => {
                const isCurrent = v.id === report.currentVersionId;
                return (
                  <li key={v.id} className="flex items-center justify-between gap-2 py-2">
                    <span className="min-w-0">
                      <span className="font-semibold">v{v.versionNo}</span>{" "}
                      <span className="text-ink-soft">{ORIGIN_LABEL[v.origin]}</span>
                      {v.meta?.restoredFrom ? <span className="text-muted">（来自 v{v.meta.restoredFrom}）</span> : null}
                      {v.model && <span className="text-muted"> · {v.model}</span>}
                      <span className="text-muted"> · {fmtTime(v.createdAt)}</span>
                      {isCurrent && <span className="pixel-tag pixel-tag--green ml-1.5">当前</span>}
                    </span>
                    <span className="flex shrink-0 gap-1.5">
                      <Button size="sm" onClick={() => setViewing(v)} disabled={editing}>
                        查看
                      </Button>
                      {!isCurrent && (
                        <Button size="sm" onClick={() => restore(v)} disabled={editing}>
                          恢复
                        </Button>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </details>
        )}
      </div>

      {confirmRegen && (
        <Modal title={`重新生成${label}？`} onClose={() => setConfirmRegen(null)}>
          <p className="mb-4 text-sm text-ink-soft">
            当前版本（v{confirmRegen.versionNo}）包含你的手动编辑或恢复内容。重新生成会新增一个版本并设为当前版本；
            现有内容<strong>不会被删除</strong>，仍可在历史版本中查看和恢复。
          </p>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setConfirmRegen(null)}>取消</Button>
            <Button variant="primary" onClick={() => generate(true)}>
              继续生成
            </Button>
          </div>
        </Modal>
      )}
    </section>
  );
}
