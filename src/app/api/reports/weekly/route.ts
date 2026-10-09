import { isValidDate, weekRange } from "@/lib/dates";
import { AppError } from "@/server/errors";
import { readJson, route } from "@/server/http";
import { generateWeekly, getReport } from "@/server/reports";
import { getWeekStart } from "@/server/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** 查询某日期所在自然周的周报（不存在时 report 为 null） */
export const GET = route((req) => {
  const date = new URL(req.url).searchParams.get("date");
  if (!isValidDate(date)) throw new AppError(400, "INVALID_DATE", "日期格式必须为 YYYY-MM-DD 且为有效日期");
  const range = weekRange(date, getWeekStart());
  return { range, report: getReport("weekly", range.start) };
});

export const POST = route(async (req) => {
  const body = await readJson(req);
  return generateWeekly(body.date, body.confirm);
});
