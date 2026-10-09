import { assertDate, optimizeDaily } from "@/server/daily";
import { route } from "@/server/http";

export const dynamic = "force-dynamic";
// 模型调用可能较久，避免被平台默认的函数超时截断
export const maxDuration = 300;

export const POST = route<{ date: string }>((_req, { date }) => optimizeDaily(assertDate(date)));
