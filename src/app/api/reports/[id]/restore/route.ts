import { parseId, readJson, route } from "@/server/http";
import { restoreVersion } from "@/server/reports";

export const dynamic = "force-dynamic";

/** 恢复历史版本：以该版本内容新增一个"恢复"版本并设为当前，历史不丢失 */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const body = await readJson(req);
  return restoreVersion(parseId(id), body.versionId);
});
