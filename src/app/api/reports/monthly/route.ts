import { isValidMonth, monthRange } from "@/lib/dates";
import { AppError } from "@/server/errors";
import { readJson, route } from "@/server/http";
import { generateMonthly, getReport } from "@/server/reports";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = route((req) => {
  const month = new URL(req.url).searchParams.get("month");
  if (!isValidMonth(month)) throw new AppError(400, "INVALID_MONTH", "月份格式必须为 YYYY-MM");
  const range = monthRange(month);
  return { range, report: getReport("monthly", range.start) };
});

export const POST = route(async (req) => {
  const body = await readJson(req);
  return generateMonthly(body.month, body.source, body.confirm);
});
