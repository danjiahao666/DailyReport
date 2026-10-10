"use client";

import { addMonths, eachDay, monthGridRange, monthOf, WEEKDAY_NAMES } from "@/lib/dates";
import type { CalendarData } from "@/lib/types";
import { findJob } from "@/lib/job-client";
import type { JobView } from "@/lib/types";
import { Icon } from "./pixel";
import { Button, PixelSpinner } from "./ui";

/** 任务状态角标：进行中显示跳动的方块，失败显示红色标签；成功不额外标记（结果已体现在日报/周报/月报标记上） */
function JobBadge({ job, running, failed, className = "" }: { job: JobView | null; running: string; failed: string; className?: string }) {
  if (job?.status === "running") {
    return (
      <span className={`inline-flex items-center gap-1 ${className}`} title="大模型处理中，可切换页面，完成后回来查看">
        <PixelSpinner />
        {running}
      </span>
    );
  }
  if (job?.status === "failed") {
    return (
      <span className={`pixel-tag pixel-tag--red ${className}`} title={job.errorMessage ?? "任务失败"}>
        ⚠ {failed}
      </span>
    );
  }
  return null;
}

export type Selection =
  | { type: "daily"; date: string }
  | { type: "weekly"; date: string }
  | { type: "monthly"; month: string };

interface Props {
  month: string;
  weekStart: number;
  data: CalendarData | null;
  loading: boolean;
  today: string;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onMonthChange: (month: string) => void;
}

export function Calendar({ month, weekStart, data, loading, today, selection, onSelect, onMonthChange }: Props) {
  const grid = monthGridRange(month, weekStart);
  const days = eachDay(grid.start, grid.end);
  const weeks: string[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  const dailies = new Map(data?.dailies.map((d) => [d.date, d]));
  const weeklies = new Map(data?.weeklies.map((w) => [w.periodStart, w]));
  const monthly = data?.monthly ?? null;
  const jobs = data?.jobs ?? [];
  const monthJob = findJob(jobs, "monthly", month);
  const [y, m] = month.split("-");

  const monthlySelected = selection.type === "monthly" && selection.month === month;

  return (
    <section aria-label="日历" className="pixel-panel">
      <div className="pixel-titlebar">
        <div className="flex items-center gap-1">
          <Button size="sm" aria-label="上个月" onClick={() => onMonthChange(addMonths(month, -1))}>
            ◀
          </Button>
          <h2 className="min-w-[8rem] text-center font-pixel text-lg">
            {y} 年 {Number(m)} 月
          </h2>
          <Button size="sm" aria-label="下个月" onClick={() => onMonthChange(addMonths(month, 1))}>
            ▶
          </Button>
          <Button size="sm" onClick={() => onMonthChange(monthOf(today))}>
            今天
          </Button>
        </div>
        <Button
          size="sm"
          variant={monthly ? "primary" : "default"}
          aria-pressed={monthlySelected}
          onClick={() => onSelect({ type: "monthly", month })}
          className={monthly ? "" : "!border-dashed"}
        >
          <Icon.Chest />
          {Number(m)} 月月报{monthly ? ` · v${monthly.versionNo}` : ""}
          <JobBadge job={monthJob} running="生成中" failed="失败" className="ml-1 text-xs" />
        </Button>
      </div>

      <div className="p-3">
        <div className={`grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] gap-1.5 text-center ${loading ? "opacity-60" : ""}`}>
          <div className="py-1 font-pixel text-xs text-muted">周报</div>
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="py-1 font-pixel text-xs text-ink-soft">
              {WEEKDAY_NAMES[(weekStart + i) % 7]}
            </div>
          ))}

          {weeks.map((week) => {
            const start = week[0];
            const w = weeklies.get(start);
            const weekJob = findJob(jobs, "weekly", start);
            const weekSelected = selection.type === "weekly" && selection.date >= week[0] && selection.date <= week[6];
            const weekState = weekSelected
              ? "bg-gold text-ink shadow-[inset_2px_2px_0_0_rgb(16_20_28/0.25)]"
              : w
                ? "bg-mint-soft text-mint-deep shadow-[inset_-2px_-2px_0_0_rgb(16_20_28/0.18)] hover:brightness-105"
                : "border-dashed bg-transparent text-muted hover:bg-parchment-lit";
            return (
              <div key={start} className="contents">
                <button
                  type="button"
                  onClick={() => onSelect({ type: "weekly", date: start })}
                  aria-pressed={weekSelected}
                  title={`${week[0]} 至 ${week[6]} 的周报${weekJob?.status === "running" ? "（生成中）" : weekJob?.status === "failed" ? "（上次生成失败）" : ""}`}
                  className={`flex flex-col items-center justify-center gap-0.5 border-2 px-0.5 py-1 text-[11px] font-semibold leading-tight ${
                    weekJob?.status === "failed" ? "border-coral-deep" : "border-ink"
                  } ${weekState}`}
                >
                  <Icon.Scroll className={w || weekSelected ? "" : "opacity-40"} />
                  <span>{w ? `v${w.versionNo}` : "周报"}</span>
                  <JobBadge job={weekJob} running="生成中" failed="失败" className="text-[10px]" />
                </button>
                {week.map((date) => {
                  const inMonth = date.startsWith(month);
                  const d = dailies.get(date);
                  const optJob = findJob(jobs, "optimize", date);
                  const selected = selection.type === "daily" && selection.date === date;
                  const isToday = date === today;
                  return (
                    <button
                      key={date}
                      type="button"
                      onClick={() => onSelect({ type: "daily", date })}
                      aria-label={`${date}${d ? "，已有日报" : ""}${optJob?.status === "running" ? "，优化中" : optJob?.status === "failed" ? "，优化失败" : ""}`}
                      aria-pressed={selected}
                      data-outside={!inMonth}
                      data-today={isToday}
                      className="day-tile"
                    >
                      <span className={isToday ? "font-pixel text-base text-coral-deep" : ""}>{Number(date.slice(8))}</span>
                      {d && (
                        <span className="mt-0.5 flex items-center gap-1">
                          <span title="已有日报">
                            <Icon.Star />
                          </span>
                          {d.active === "optimized" && <span className="pixel-tag pixel-tag--blue !px-0.5 text-[10px] leading-4">优</span>}
                        </span>
                      )}
                      {/* 格子很窄，只放图形；文字说明由 aria-label 与 title 承担 */}
                      {d && <JobBadge job={optJob} running="" failed="" className="mt-0.5 text-[10px] text-sky-deep" />}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 border-t-2 border-dashed border-ink/25 pt-3 text-xs text-ink-soft">
          <li className="flex items-center gap-1.5">
            <Icon.Star /> 已有日报（“优”表示采用优化稿）
          </li>
          <li className="flex items-center gap-1.5">
            <Icon.Scroll /> 周报
          </li>
          <li className="flex items-center gap-1.5">
            <Icon.Chest /> 月报
          </li>
          <li className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-4 border-2 border-dashed border-ink/60" /> 尚未生成
          </li>
          <li className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 border-2 border-ink bg-coral" /> 今天
          </li>
        </ul>
      </div>
    </section>
  );
}
