import { parseId, readJson, route } from "@/server/http";
import { deleteBlocker, setBlockerResolved } from "@/server/todos";

export const dynamic = "force-dynamic";

type P = { id: string; blockerId: string };

/** 标记卡点已解决（resolved=true）或重新卡住（resolved=false） */
export const PATCH = route<P>(async (req, { id, blockerId }) => {
  const body = await readJson(req);
  return setBlockerResolved(parseId(id, "待办"), parseId(blockerId, "卡点"), body.resolved);
});

export const DELETE = route<P>((_req, { id, blockerId }) => deleteBlocker(parseId(id, "待办"), parseId(blockerId, "卡点")));
