import { ModelsError, type Api, type Model, type Models } from "@earendil-works/pi-ai";
import { buildRuntime, type LlmRuntime } from "./config";
import { classifyUpstreamFailure, LlmError } from "./errors";

/**
 * 统一的大模型调用入口：只做"系统提示词 + 一条用户消息 → 文本"。
 * 调用方式沿用 pi-ai：Models.completeSimple，失败通过 stopReason 判断（不会抛异常）。
 */

export interface LlmBackend {
  models: Models;
  model: Model<Api>;
}

export type LlmTask = "optimize" | "weekly" | "monthly";

export interface GenerateResult {
  text: string;
  /** provider/modelId，用于记录是哪个模型生成的 */
  model: string;
}

let runtime: LlmRuntime | undefined;
let testBackend: LlmBackend | undefined;

/** 仅测试使用：注入 faux 等后端；传 undefined 恢复 */
export function setLlmBackendForTests(backend: LlmBackend | undefined): void {
  testBackend = backend;
}

export function resetLlmRuntime(): void {
  runtime = undefined;
}

function timeoutMs(): number {
  const n = Number(process.env.LLM_TIMEOUT_MS);
  if (!Number.isFinite(n) || n <= 0) return 120_000;
  return Math.min(Math.max(n, 1_000), 600_000);
}

function getRuntime(): LlmRuntime {
  if (runtime) return runtime;
  try {
    runtime = buildRuntime();
  } catch (error) {
    console.error(JSON.stringify({ evt: "llm.config_error", reason: error instanceof Error ? error.message : "unknown" }));
    throw new LlmError("NO_MODEL", "大模型配置加载失败（models.json / auth.json 格式有误），请检查配置文件后重试。");
  }
  for (const w of runtime.warnings) console.warn(JSON.stringify({ evt: "llm.config_warning", warning: w }));
  return runtime;
}

async function resolveBackend(): Promise<LlmBackend> {
  if (testBackend) return testBackend;
  const rt = getRuntime();
  const wantProvider = process.env.LLM_PROVIDER || undefined;
  const wantModel = process.env.LLM_MODEL || undefined;
  const provider = wantProvider ?? (wantModel ? undefined : rt.defaultProvider);
  const id = wantModel ?? rt.defaultModel;

  if (id) {
    const model = provider
      ? rt.models.getModel(provider, id)
      : rt.models.getModels().find((m) => m.id === id);
    if (!model) {
      throw new LlmError("NO_MODEL", `未找到已配置的模型“${provider ? `${provider}/` : ""}${id}”，请检查 LLM_PROVIDER / LLM_MODEL 或 settings.json。`);
    }
    return { models: rt.models, model };
  }

  const available = await rt.models.getAvailable();
  if (available.length === 0) throw new LlmError("NO_MODEL");
  return { models: rt.models, model: available[0] };
}

/** 日志脱敏：清除类似密钥/令牌的长字符串 */
function redact(text: string): string {
  return text.replace(/(Bearer\s+)?[A-Za-z0-9_\-]{24,}/g, "[redacted]");
}

function unwrapFence(text: string): string {
  const m = /^```[a-zA-Z]*\n([\s\S]*?)\n```$/.exec(text);
  return m ? m[1].trim() : text;
}

export async function generateText(input: {
  task: LlmTask;
  system: string;
  user: string;
  maxTokens: number;
}): Promise<GenerateResult> {
  const started = Date.now();
  const backend = await resolveBackend();
  const { models, model } = backend;
  const modelLabel = `${model.provider}/${model.id}`;
  const log = (status: string, extra: Record<string, unknown> = {}) =>
    console.info(JSON.stringify({ evt: "llm.call", task: input.task, model: modelLabel, status, ms: Date.now() - started, ...extra }));

  // 在发起请求前确认凭据，缺失时给出明确提示，而不是等到上游返回 401
  try {
    const auth = await models.getAuth(model);
    if (!auth) {
      log("auth_missing");
      throw new LlmError("AUTH", `模型“${modelLabel}”尚未配置凭据，请在 auth.json 或环境变量中配置 API 密钥后重试。`);
    }
  } catch (error) {
    if (error instanceof LlmError) throw error;
    log("auth_error", { reason: error instanceof ModelsError ? error.code : "unknown" });
    throw new LlmError("AUTH");
  }

  const signal = AbortSignal.timeout(timeoutMs());
  let message;
  try {
    message = await models.completeSimple(
      model,
      {
        systemPrompt: input.system,
        messages: [{ role: "user", content: input.user, timestamp: Date.now() }],
      },
      { signal, maxTokens: Math.min(input.maxTokens, model.maxTokens) },
    );
  } catch (error) {
    // 按 pi-ai 约定请求失败不会抛出，这里兜底处理同步异常
    log(signal.aborted ? "timeout" : "exception", { reason: error instanceof Error ? error.name : "unknown" });
    if (signal.aborted) throw new LlmError("TIMEOUT");
    throw new LlmError("UPSTREAM");
  }

  const usage = { in: message.usage?.input, out: message.usage?.output };

  if (message.stopReason === "aborted") {
    log("aborted", usage);
    throw new LlmError(signal.aborted ? "TIMEOUT" : "UPSTREAM");
  }
  if (message.stopReason === "error") {
    const code = classifyUpstreamFailure(message.errorMessage);
    // 上游原文只进日志（不含请求体），不返回给前端
    log("error", { ...usage, class: code, upstream: redact(message.errorMessage ?? "").slice(0, 300) });
    throw new LlmError(code);
  }

  const text = unwrapFence(
    message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim(),
  );

  if (message.stopReason === "length") {
    log("truncated", usage);
    throw new LlmError("TRUNCATED");
  }
  if (!text) {
    log("empty", usage);
    throw new LlmError("EMPTY");
  }

  log("ok", usage);
  return { text, model: modelLabel };
}
