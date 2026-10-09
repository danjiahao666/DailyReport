import { isValidMonth, monthGridRange } from "@/lib/dates";
import type { CalendarData } from "@/lib/types";
import { calendarDailies } from "@/server/daily";
import { AppError } from "@/server/errors";
import { route } from "@/server/http";
import { listReportSummaries } from "@/server/reports";
import { getWeekStart } from "@/server/settings";

export const dynamic = "force-dynamic";

/** 日历数据：网格范围内的日报标记、周报、当月月报 */
export const GET = route((req): CalendarData => {
  const month = new URL(req.url).searchParams.get("month");
  if (!isValidMonth(month)) throw new AppError(400, "INVALID_MONTH", "月份格式必须为 YYYY-MM");
  const weekStart = getWeekStart();
  const grid = monthGridRange(month, weekStart);
  return {
    month,
    weekStart,
    gridStart: grid.start,
    gridEnd: grid.end,
    dailies: calendarDailies(grid.start, grid.end),
    weeklies: listReportSummaries("weekly", grid.start, grid.end),
    monthly: listReportSummaries("monthly", `${month}-01`, `${month}-01`)[0] ?? null,
  };
});
