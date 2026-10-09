"use client";

import { addMonths, eachDay, monthGridRange, monthOf, WEEKDAY_NAMES } from "@/lib/dates";
import type { CalendarData } from "@/lib/types";
import { Button } from "./ui";

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
  const [y, m] = month.split("-");

  return (
    <section aria-label="日历" className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button variant="ghost" aria-label="上个月" onClick={() => onMonthChange(addMonths(month, -1))}>
            ◀
          </Button>
          <h2 className="min-w-[8rem] text-center text-lg font-semibold">
            {y} 年 {Number(m)} 月
          </h2>
          <Button variant="ghost" aria-label="下个月" onClick={() => onMonthChange(addMonths(month, 1))}>
            ▶
          </Button>
          <Button variant="ghost" onClick={() => onMonthChange(monthOf(today))}>
            今天
          </Button>
        </div>
        <button
          type="button"
          onClick={() => onSelect({ type: "monthly", month })}
          className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
            selection.type === "monthly" && selection.month === month ? "ring-2 ring-violet-500 " : ""
          }${monthly ? "border-violet-600 bg-violet-600 text-white" : "border-dashed border-violet-400 text-violet-700 hover:bg-violet-50"}`}
        >
          {Number(m)} 月月报{monthly ? ` · v${monthly.versionNo}` : ""}
        </button>
      </div>

      <div className={`grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] gap-1 text-center ${loading ? "opacity-60" : ""}`}>
        <div className="py-1 text-xs text-slate-400">周报</div>
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="py-1 text-xs font-medium text-slate-500">
            {WEEKDAY_NAMES[(weekStart + i) % 7]}
          </div>
        ))}

        {weeks.map((week) => {
          const start = week[0];
          const w = weeklies.get(start);
          const weekSelected = selection.type === "weekly" && selection.date >= week[0] && selection.date <= week[6];
          return (
            <div key={start} className="contents">
              <button
                type="button"
                onClick={() => onSelect({ type: "weekly", date: start })}
                title={`${week[0]} 至 ${week[6]} 的周报`}
                className={`flex items-center justify-center rounded-md border text-xs font-medium ${
                  weekSelected ? "ring-2 ring-emerald-500 " : ""
                }${w ? "border-emerald-600 bg-emerald-600 text-white" : "border-dashed border-emerald-400 text-emerald-700 hover:bg-emerald-50"}`}
              >
                {w ? `周报 v${w.versionNo}` : "周报"}
              </button>
              {week.map((date) => {
                const inMonth = date.startsWith(month);
                const d = dailies.get(date);
                const selected = selection.type === "daily" && selection.date === date;
                const isToday = date === today;
                return (
                  <button
                    key={date}
                    type="button"
                    onClick={() => onSelect({ type: "daily", date })}
                    aria-label={`${date}${d ? "，已有日报" : ""}`}
                    aria-pressed={selected}
                    className={`relative flex h-14 flex-col items-center justify-start rounded-md border pt-1 text-sm transition ${
                      selected ? "border-blue-600 bg-blue-50" : "border-slate-200 hover:bg-slate-50"
                    } ${inMonth ? "text-slate-900" : "bg-slate-50/60 text-slate-400"} ${isToday ? "ring-1 ring-blue-400" : ""}`}
                  >
                    <span className={isToday ? "font-bold text-blue-700" : ""}>{Number(date.slice(8))}</span>
                    {d && (
                      <span className="mt-1 flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full bg-blue-500" title="已有日报" />
                        {d.active === "optimized" && <span className="rounded bg-blue-100 px-1 text-[10px] leading-4 text-blue-700">优</span>}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
        <li className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-blue-500" /> 已有日报（“优”表示采用优化稿）
        </li>
        <li className="flex items-center gap-1">
          <span className="h-3 w-4 rounded border border-emerald-600 bg-emerald-600" /> 已有周报
        </li>
        <li className="flex items-center gap-1">
          <span className="h-3 w-4 rounded border border-violet-600 bg-violet-600" /> 已有月报
        </li>
        <li className="flex items-center gap-1">
          <span className="h-3 w-4 rounded border border-dashed border-slate-400" /> 尚未生成
        </li>
      </ul>
    </section>
  );
}
