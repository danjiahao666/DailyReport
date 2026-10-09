import { isValidMonth, monthRange } from "@/lib/dates";
import { AppError } from "@/server/errors";
import { json, readJson, route } from "@/server/http";
import { getReport, startMonthly } from "@/server/reports";

export const dynamic = "force-dynamic";

export const GET = route((req) => {
  const month = new URL(req.url).searchParams.get("month");
  if (!isValidMonth(month)) throw new AppError(400, "INVALID_MONTH", "月份格式必须为 YYYY-MM");
  const range = monthRange(month);
  return { range, report: getReport("monthly", range.start) };
});

/** 启动月报生成（异步） */
export const POST = route(async (req) => {
  const body = await readJson(req);
  return json({ job: startMonthly(body.month, body.source, body.confirm) }, 202);
});
