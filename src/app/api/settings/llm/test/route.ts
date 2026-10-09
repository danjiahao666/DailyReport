import { readJson, route } from "@/server/http";
import { testModel } from "@/server/llm-settings";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 连通性测试：向指定模型发一次极短的真实请求 */
export const POST = route(async (req) => {
  const body = await readJson(req);
  return testModel(body.provider, body.model);
});
