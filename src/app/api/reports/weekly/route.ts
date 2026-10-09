import { isValidDate, weekRange } from "@/lib/dates";
import { AppError } from "@/server/errors";
import { json, readJson, route } from "@/server/http";
import { getReport, startWeekly } from "@/server/reports";
import { getWeekStart } from "@/server/settings";

export const dynamic = "force-dynamic";

/** 查询某日期所在自然周的周报（不存在时 report 为 null） */
export const GET = route((req) => {
  const date = new URL(req.url).searchParams.get("date");
  if (!isValidDate(date)) throw new AppError(400, "INVALID_DATE", "日期格式必须为 YYYY-MM-DD 且为有效日期");
  const range = weekRange(date, getWeekStart());
  return { range, report: getReport("weekly", range.start) };
});

/** 启动周报生成（异步）；没有日报、需要确认覆盖等情况会直接返回错误，不创建任务 */
export const POST = route(async (req) => {
  const body = await readJson(req);
  return json({ job: startWeekly(body.date, body.confirm) }, 202);
});
