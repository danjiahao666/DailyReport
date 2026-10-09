import { assertDate, startOptimizeDaily } from "@/server/daily";
import { json, route } from "@/server/http";

export const dynamic = "force-dynamic";

/** 启动日报优化（异步）：立即返回任务状态，结果通过日历/任务状态查看；失败可直接重试 */
export const POST = route<{ date: string }>((_req, { date }) => json({ job: startOptimizeDaily(assertDate(date)) }, 202));
