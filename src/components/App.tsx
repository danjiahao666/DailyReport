"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, todayLocal } from "@/lib/api-client";
import { monthOf, WEEKDAY_NAMES, weekRange } from "@/lib/dates";
import { findJob, upsertJob } from "@/lib/job-client";
import type { CalendarData, JobKind, JobView } from "@/lib/types";
import { Calendar, type Selection } from "./Calendar";
import { DailyPanel } from "./DailyPanel";
import { ReportPanel } from "./ReportPanel";
import { SiteHeader } from "./pixel";
import { ErrorNotice } from "./ui";

/** 有任务在后台执行时，每隔多久向服务端同步一次状态 */
const POLL_MS = 1500;

export function App({ authEnabled }: { authEnabled: boolean }) {
  const [today] = useState(todayLocal);
  const [month, setMonth] = useState(monthOf(today));
  const [selection, setSelection] = useState<Selection>({ type: "daily", date: today });
  const [data, setData] = useState<CalendarData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [weekStart, setWeekStart] = useState(1);
  const [settingsError, setSettingsError] = useState<ApiError | null>(null);

  const monthRef = useRef(month);
  monthRef.current = month;
  const reqId = useRef(0);
  const polling = useRef(false);

  /** silent=true 用于后台轮询：不显示加载中、不弹错误，也不会和正在进行的轮询重叠 */
  const refresh = useCallback(
    async (silent = false) => {
      const m = month;
      if (silent) {
        if (polling.current) return;
        polling.current = true;
      }
      const id = silent ? reqId.current : ++reqId.current;
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const res = await api<CalendarData>("GET", `/api/calendar?month=${m}`);
        // 用户已切到别的月份，或有更新的请求，丢弃这次结果
        if (m !== monthRef.current || (!silent && id !== reqId.current)) return;
        setData(res);
        setWeekStart(res.weekStart);
      } catch (e) {
        if (!silent && id === reqId.current) setError(e as ApiError);
      } finally {
        if (silent) polling.current = false;
        else if (id === reqId.current) setLoading(false);
      }
    },
    [month],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 有进行中的大模型任务时轮询；切到别的页面再回来会重新加载，同样能拿到服务端保存的状态
  const hasRunning = data?.jobs.some((j) => j.status === "running") ?? false;
  useEffect(() => {
    if (!hasRunning) return;
    const timer = setInterval(() => void refresh(true), POLL_MS);
    return () => clearInterval(timer);
  }, [hasRunning, refresh]);

  // 页签从后台切回前台时立即同步一次
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  /** 面板启动任务或忽略失败后，立即把最新状态写入本地，不必等下一次轮询 */
  const setJob = useCallback((kind: JobKind, target: string, job: JobView | null) => {
    setData((d) => (d ? { ...d, jobs: upsertJob(d.jobs, kind, target, job) } : d));
  }, []);

  async function changeWeekStart(value: number) {
    setSettingsError(null);
    try {
      await api("PUT", "/api/settings", { weekStart: value });
      await refresh();
    } catch (e) {
      setSettingsError(e as ApiError);
    }
  }

  async function logout() {
    await api("POST", "/api/auth/logout");
    window.location.href = "/login";
  }

  // 周起始日变化后，保持选中的周报仍指向包含该日期的那一周
  const weekly = selection.type === "weekly" ? weekRange(selection.date, weekStart) : null;
  const jobs = data?.jobs ?? [];

  return (
    <>
      <SiteHeader
        title="日报助手"
        tagline="记录日报，一键整理为周报与月报"
        actions={
          <>
            <label className="flex items-center gap-2 border-2 border-ink bg-dusk/90 py-0.5 pl-2 pr-1 text-[13px] text-parchment">
              周起始日
              <select value={weekStart} onChange={(e) => void changeWeekStart(Number(e.target.value))} className="pixel-field !border-2 !py-0.5 !text-[13px]">
                {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                  <option key={d} value={d}>
                    {WEEKDAY_NAMES[d]}
                  </option>
                ))}
              </select>
            </label>
            <a href="/preferences" className="pixel-button">
              设置中心
            </a>
            <a href="/settings" className="pixel-button">
              大模型设置
            </a>
            {authEnabled && (
              <button type="button" onClick={logout} className="pixel-button">
                退出登录
              </button>
            )}
          </>
        }
      />
    <main className="page-shell space-y-5 py-6">
      {settingsError && <ErrorNotice error={settingsError} />}
      {error && <ErrorNotice error={error} onRetry={() => void refresh()} busy={loading} />}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,30rem)_minmax(0,1fr)]">
        <Calendar
          month={month}
          weekStart={weekStart}
          data={data}
          loading={loading}
          today={today}
          selection={selection}
          onSelect={(s) => {
            setSelection(s);
            if (s.type === "daily" && !s.date.startsWith(month)) setMonth(monthOf(s.date));
          }}
          onMonthChange={setMonth}
        />
        <div>
          {selection.type === "daily" && (
            <DailyPanel
              date={selection.date}
              job={findJob(jobs, "optimize", selection.date)}
              onJob={(job) => setJob("optimize", selection.date, job)}
              onChanged={() => void refresh()}
              defaultOptimize={data?.optimizeOnSubmit ?? false}
            />
          )}
          {selection.type === "weekly" && weekly && (
            <ReportPanel
              kind="weekly"
              anchor={weekly.start}
              job={findJob(jobs, "weekly", weekly.start)}
              onJob={(job) => setJob("weekly", weekly.start, job)}
              onChanged={() => void refresh()}
            />
          )}
          {selection.type === "monthly" && (
            <ReportPanel
              kind="monthly"
              anchor={selection.month}
              job={findJob(jobs, "monthly", selection.month)}
              onJob={(job) => setJob("monthly", selection.month, job)}
              onChanged={() => void refresh()}
            />
          )}
        </div>
      </div>
    </main>
    </>
  );
}
