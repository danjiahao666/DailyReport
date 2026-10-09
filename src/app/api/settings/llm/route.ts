import { route } from "@/server/http";
import { getLlmSettings } from "@/server/llm-settings";

export const dynamic = "force-dynamic";

/** 大模型设置状态（不含任何密钥） */
export const GET = route(() => getLlmSettings());
