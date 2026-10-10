import type { LlmRemoteModel } from "@/lib/types";
import { AppError } from "../errors";

/**
 * 从自定义 provider 的接口拉取可用模型列表，用于在添加页面里下拉选择。
 *
 * 这是服务端替用户向「用户填写的地址」发起请求，并且会带上 API 密钥，所以限制得比较严：
 * - 调用方已经校验过地址（http/https、无内嵌账号、非云元数据地址）并要求有编辑权限；
 * - 不跟随重定向：重定向会让密钥被带到用户没确认过的地址；
 * - 有超时、响应体大小上限与条目数量上限；
 * - 上游返回的正文只用来解析，永远不原样回传给前端，也不写进日志（只记主机名、状态与数量）。
 */

const TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_MODELS = 1000;
const MAX_ID_LENGTH = 200;

/** 能自动列出模型的协议。Azure 按「部署」而不是模型调用，没有统一的列表接口 */
export const LISTABLE_APIS = ["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai", "mistral-conversations"] as const;

const failed = (message: string) => new AppError(502, "MODEL_LIST_FAILED", message);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function posInt(v: unknown): number | undefined {
  return typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 10_000_000 ? v : undefined;
}

function text(v: unknown, max: number): string | undefined {
  return typeof v === "string" && v.trim() !== "" && v.length <= max ? v.trim() : undefined;
}

function buildRequest(baseUrl: string, api: string, key: string | undefined): { url: string; headers: Record<string, string> } {
  const base = baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = { accept: "application/json" };
  if (api === "anthropic-messages") {
    if (key) headers["x-api-key"] = key;
    headers["anthropic-version"] = "2023-06-01";
    // Anthropic SDK 的接口地址不含 /v1（由 SDK 自行拼上 /v1/messages），用户通常填 https://host；
    // 此时直接请求 /models 会落到网关的前端页面（返回 HTML）。地址末尾已带版本段（如 /v1）时则不再重复追加。
    const modelsPath = /\/v\d+$/.test(base) ? "/models" : "/v1/models";
    return { url: `${base}${modelsPath}?limit=1000`, headers };
  }
  if (api === "google-generative-ai") {
    // 用请求头而不是 ?key=，避免密钥出现在 URL 里被各种日志记录
    if (key) headers["x-goog-api-key"] = key;
    return { url: `${base}/models?pageSize=1000`, headers };
  }
  // OpenAI 兼容（含 Mistral、Ollama、vLLM、各类网关）。没有密钥时不发 Authorization，本地服务通常不需要
  if (key) headers.authorization = `Bearer ${key}`;
  return { url: `${base}/models`, headers };
}

/** 读取响应体，超过上限就中止，防止被一个超大响应拖垮内存 */
async function readLimited(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw failed("接口返回的内容过大，无法解析模型列表，请手动填写模型 ID。");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

function parseModels(api: string, json: unknown): LlmRemoteModel[] {
  const out = new Map<string, LlmRemoteModel>();
  const add = (m: LlmRemoteModel) => {
    if (out.size < MAX_MODELS && !out.has(m.id)) out.set(m.id, m);
  };

  if (api === "google-generative-ai") {
    const list = isRecord(json) && Array.isArray(json.models) ? json.models : [];
    for (const raw of list) {
      if (!isRecord(raw)) continue;
      const id = text(raw.name, MAX_ID_LENGTH + 7)?.replace(/^models\//, "");
      if (!id || id.length > MAX_ID_LENGTH) continue;
      // 只保留能做文本生成的模型，去掉 embedding 之类
      const methods = raw.supportedGenerationMethods;
      if (Array.isArray(methods) && !methods.includes("generateContent")) continue;
      add({ id, name: text(raw.displayName, 100), contextWindow: posInt(raw.inputTokenLimit), maxTokens: posInt(raw.outputTokenLimit) });
    }
  } else {
    // OpenAI 风格 { data: [...] }；个别网关直接返回数组，一并兼容
    const list = Array.isArray(json) ? json : isRecord(json) && Array.isArray(json.data) ? json.data : [];
    for (const raw of list) {
      if (!isRecord(raw)) continue;
      const id = text(raw.id, MAX_ID_LENGTH);
      if (!id) continue;
      const top = isRecord(raw.top_provider) ? raw.top_provider : {};
      add({
        id,
        // Anthropic 是 display_name；其余网关偶尔带 name，与 id 相同的不重复展示
        name: text(raw.display_name, 100) ?? (text(raw.name, 100) !== id ? text(raw.name, 100) : undefined),
        contextWindow: posInt(raw.context_length) ?? posInt(raw.max_input_tokens) ?? posInt(raw.context_window),
        maxTokens: posInt(top.max_completion_tokens) ?? posInt(raw.max_completion_tokens) ?? posInt(raw.max_output_tokens) ?? posInt(raw.max_tokens),
      });
    }
  }
  return [...out.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export async function fetchRemoteModels(input: { baseUrl: string; api: string; key?: string }): Promise<LlmRemoteModel[]> {
  if (!(LISTABLE_APIS as readonly string[]).includes(input.api)) {
    throw new AppError(400, "MODEL_LIST_UNSUPPORTED", "该接口协议暂不支持自动获取模型列表，请手动填写模型 ID。");
  }
  const { url, headers } = buildRequest(input.baseUrl, input.api, input.key);
  const host = new URL(input.baseUrl).host;
  const started = Date.now();
  const log = (status: string, extra: Record<string, unknown> = {}) =>
    console.info(JSON.stringify({ evt: "llm.list_models", host, api: input.api, status, ms: Date.now() - started, ...extra }));

  let res: Response;
  try {
    res = await fetch(url, { method: "GET", headers, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    log(timeout ? "timeout" : "network_error");
    throw failed(timeout ? "连接接口超时，请检查接口地址与网络后重试。" : "无法连接到接口地址，请检查地址是否正确、服务是否已启动。");
  }

  if (res.status >= 300 && res.status < 400) {
    await res.body?.cancel().catch(() => undefined);
    log("redirect", { code: res.status });
    throw failed("接口地址发生了重定向，出于安全考虑不会跟随。请填写重定向后的最终地址（例如把 http 改为 https）。");
  }
  if (res.status === 401 || res.status === 403) {
    await res.body?.cancel().catch(() => undefined);
    log("auth", { code: res.status });
    throw failed("接口拒绝了请求，API 密钥可能无效或没有权限。请检查密钥后重试。");
  }
  if (res.status === 404) {
    await res.body?.cancel().catch(() => undefined);
    log("not_found");
    throw failed("该地址下没有“/models”接口，可能是接口地址不对，或服务不支持列出模型。请检查地址，或手动填写模型 ID。");
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    log("http_error", { code: res.status });
    throw failed(`接口返回了错误（HTTP ${res.status}），请稍后重试。`);
  }

  const body = await readLimited(res);
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    log("bad_json");
    throw failed("接口返回的不是有效的模型列表（不是 JSON）。请确认接口地址与“接口协议”选择正确。");
  }
  const models = parseModels(input.api, json);
  log("ok", { count: models.length });
  if (models.length === 0) {
    throw failed("接口没有返回任何可用的模型。请确认接口协议选择正确，或手动填写模型 ID。");
  }
  return models;
}
