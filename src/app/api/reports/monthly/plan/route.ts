import { route } from "@/server/http";
import { getMonthlyPlan } from "@/server/reports";

export const dynamic = "force-dynamic";

/** 预览月报的取数规则（跨月周的处理方式），不调用大模型 */
export const GET = route((req) => {
  const sp = new URL(req.url).searchParams;
  return getMonthlyPlan(sp.get("month"), sp.get("source"));
});
