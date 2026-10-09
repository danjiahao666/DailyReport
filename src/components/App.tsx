"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, todayLocal } from "@/lib/api-client";
import { monthOf, WEEKDAY_NAMES, weekRange } from "@/lib/dates";
import type { CalendarData } from "@/lib/types";
import { Calendar, type Selection } from "./Calendar";
import { DailyPanel } from "./DailyPanel";
import { ReportPanel } from "./ReportPanel";
import { ErrorNotice } from "./ui";

export function App({ authEnabled }: { authEnabled: boolean }) {
  const [today] = useState(todayLocal);
  const [month, setMonth] = useState(monthOf(today));
  const [selection, setSelection] = useState<Selection>({ type: "daily", date: today });
  const [data, setData] = useState<CalendarData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [weekStart, setWeekStart] = useState(1);
  const [settingsError, setSettingsError] = useState<ApiError | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<CalendarData>("GET", `/api/calendar?month=${month}`);
      setData(res);
      setWeekStart(res.weekStart);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">日报助手</h1>
          <p className="text-sm text-slate-500">记录日报，一键整理为周报与月报</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <label className="flex items-center gap-1.5 text-slate-600">
            周起始日
            <select
              value={weekStart}
              onChange={(e) => void changeWeekStart(Number(e.target.value))}
              className="rounded-md border border-slate-300 bg-white px-2 py-1"
            >
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <option key={d} value={d}>
                  {WEEKDAY_NAMES[d]}
                </option>
              ))}
            </select>
          </label>
          {authEnabled && (
            <button type="button" onClick={logout} className="text-slate-500 underline hover:text-slate-800">
              退出登录
            </button>
          )}
        </div>
      </header>

      {settingsError && <ErrorNotice error={settingsError} />}
      {error && <ErrorNotice error={error} onRetry={refresh} busy={loading} />}

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
          {selection.type === "daily" && <DailyPanel date={selection.date} onChanged={refresh} />}
          {selection.type === "weekly" && weekly && <ReportPanel kind="weekly" anchor={weekly.start} onChanged={refresh} />}
          {selection.type === "monthly" && <ReportPanel kind="monthly" anchor={selection.month} onChanged={refresh} />}
        </div>
      </div>
    </main>
  );
}
