import { readJson, route } from "@/server/http";
import { getLlmSettings, setProviderKey } from "@/server/llm-settings";

export const dynamic = "force-dynamic";

/** 设置（key 为字符串）或清除（key 为 null）某个 provider 在 auth.json 中的 API 密钥 */
export const PUT = route(async (req) => {
  const body = await readJson(req);
  setProviderKey(body.provider, body.key === undefined ? "" : body.key);
  return getLlmSettings();
});
