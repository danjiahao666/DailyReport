import { assertDate, restoreOptimizedVersion } from "@/server/daily";
import { readJson, route } from "@/server/http";

export const dynamic = "force-dynamic";

/** 恢复优化稿的历史版本：以该版本内容新增一个“恢复”版本并设为当前优化稿，历史不丢失 */
export const POST = route<{ date: string }>(async (req, { date }) => {
  const body = await readJson(req);
  return restoreOptimizedVersion(assertDate(date), body.versionId);
});
