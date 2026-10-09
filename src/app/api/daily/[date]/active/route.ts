import { assertDate, setActiveVersion } from "@/server/daily";
import { readJson, route } from "@/server/http";

export const dynamic = "force-dynamic";

/** 采用优化稿或回退到原文 */
export const PUT = route<{ date: string }>(async (req, { date }) => {
  const body = await readJson(req);
  return setActiveVersion(assertDate(date), body.active);
});
