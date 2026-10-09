import { parseId, readJson, route } from "@/server/http";
import { editReport } from "@/server/reports";

export const dynamic = "force-dynamic";

/** 手动编辑：新增一个"编辑"版本，不覆盖任何历史版本 */
export const PUT = route<{ id: string }>(async (req, { id }) => {
  const body = await readJson(req);
  return editReport(parseId(id), body.content);
});
