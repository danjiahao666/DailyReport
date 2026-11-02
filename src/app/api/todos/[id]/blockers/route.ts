import { json, parseId, readJson, route } from "@/server/http";
import { addBlocker } from "@/server/todos";

export const dynamic = "force-dynamic";

type P = { id: string };

/** 给待办新增一条卡点，返回更新后的待办 */
export const POST = route<P>(async (req, { id }) => {
  const body = await readJson(req);
  return json(addBlocker(parseId(id, "待办"), body.content), 201);
});
