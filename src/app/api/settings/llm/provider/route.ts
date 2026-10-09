import { readJson, route } from "@/server/http";
import { getLlmSettings, upsertProvider } from "@/server/llm-settings";

export const dynamic = "force-dynamic";

/** 新增或修改自定义 provider；apiKey 留空表示不修改已有密钥 */
export const PUT = route(async (req) => {
  upsertProvider(await readJson(req));
  return getLlmSettings();
});
