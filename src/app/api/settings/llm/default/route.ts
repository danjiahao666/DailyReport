import { readJson, route } from "@/server/http";
import { getLlmSettings, setDefaultModel } from "@/server/llm-settings";

export const dynamic = "force-dynamic";

/** 设置默认模型；provider 为 null 表示清除（改为自动选择第一个已配置密钥的模型） */
export const PUT = route(async (req) => {
  const body = await readJson(req);
  setDefaultModel(body.provider ?? null, body.model);
  return getLlmSettings();
});
