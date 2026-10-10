import { readJson, route } from "@/server/http";
import { listRemoteModels } from "@/server/llm-settings";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** 从供应商接口获取模型列表，供添加 / 编辑自定义 provider 时下拉选择 */
export const POST = route(async (req) => listRemoteModels(await readJson(req)));
