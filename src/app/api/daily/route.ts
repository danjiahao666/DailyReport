import { assertDate, submitDaily } from "@/server/daily";
import { json, readJson, route } from "@/server/http";

export const dynamic = "force-dynamic";

/** 提交日报；同一天已存在时返回 409，需带 mode=overwrite|append 重新提交 */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const date = assertDate(body.date);
  return json(submitDaily(date, body.content, body.mode), 200);
});
