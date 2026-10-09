import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createProvider,
  type Api,
  type ApiKeyAuth,
  type AuthResult,
  type Model,
  type MutableModels,
  type Provider,
  type ProviderStreams,
} from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { azureOpenAIResponsesApi } from "@earendil-works/pi-ai/api/azure-openai-responses.lazy";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { mistralConversationsApi } from "@earendil-works/pi-ai/api/mistral-conversations.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { resolveConfigValue } from "./config-value";
import { FileCredentialStore } from "./credentials";

/**
 * 模型与密钥配置，沿用 pi 的约定（不另起一套）：
 *  - 配置目录：环境变量 PI_CODING_AGENT_DIR，默认 ~/.pi/agent
 *  - auth.json：各 provider 的凭据（{type:"api_key", key}），或直接使用 provider 的环境变量（如 OPENAI_API_KEY）
 *  - models.json：自定义/兼容端点（providers.<id>.{baseUrl, api, apiKey, headers, compat, models[]}）
 *  - settings.json：defaultProvider / defaultModel
 * 额外提供 LLM_PROVIDER / LLM_MODEL 环境变量，用于在部署时覆盖默认模型。
 */

const STREAM_APIS: Record<string, () => ProviderStreams> = {
  "openai-completions": openAICompletionsApi,
  "openai-responses": openAIResponsesApi,
  "anthropic-messages": anthropicMessagesApi,
  "google-generative-ai": googleGenerativeAIApi,
  "mistral-conversations": mistralConversationsApi,
  "azure-openai-responses": azureOpenAIResponsesApi,
};

/** 支持的自定义端点协议（models.json 的 api 字段） */
export const STREAM_API_IDS: readonly string[] = Object.keys(STREAM_APIS);

interface JsonModel {
  id: string;
  name?: string;
  api?: string;
  baseUrl?: string;
  reasoning?: boolean;
  thinkingLevelMap?: unknown;
  input?: ("text" | "image")[];
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow?: number;
  maxTokens?: number;
  headers?: Record<string, string>;
  compat?: unknown;
  samplingParams?: unknown;
}

interface JsonProvider {
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  api?: string;
  headers?: Record<string, string>;
  compat?: unknown;
  authHeader?: boolean;
  models?: JsonModel[];
}

export interface LlmRuntime {
  models: MutableModels;
  configDir: string;
  defaultProvider?: string;
  defaultModel?: string;
  /** 配置加载过程中的非致命问题（不含密钥） */
  warnings: string[];
}

export function configDir(): string {
  return path.resolve(/* turbopackIgnore: true */ process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent"));
}

function readJsonFile(file: string): unknown {
  if (!existsSync(file)) return undefined;
  const text = readFileSync(file, "utf-8").replace(/^\uFEFF/, "");
  if (text.trim() === "") return undefined;
  return JSON.parse(text);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function resolveHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!headers) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const resolved = resolveConfigValue(v);
    if (resolved !== undefined) out[k] = resolved;
  }
  return out;
}

function toModel(providerId: string, def: JsonModel, p: JsonProvider): Model<Api> {
  const api = def.api ?? p.api;
  if (!api) throw new Error(`models.json: provider "${providerId}" 的模型 "${def.id}" 未指定 api`);
  if (!STREAM_APIS[api]) throw new Error(`models.json: 不支持的 api "${api}"（provider "${providerId}"）`);
  const baseUrl = def.baseUrl ?? p.baseUrl;
  if (!baseUrl) throw new Error(`models.json: provider "${providerId}" 缺少 baseUrl`);
  const compat = { ...(isRecord(p.compat) ? p.compat : {}), ...(isRecord(def.compat) ? def.compat : {}) };
  return {
    id: def.id,
    name: def.name ?? def.id,
    api: api as Api,
    provider: providerId,
    baseUrl,
    reasoning: def.reasoning ?? false,
    thinkingLevelMap: def.thinkingLevelMap,
    input: def.input ?? ["text"],
    cost: def.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: def.contextWindow ?? 128000,
    maxTokens: def.maxTokens ?? 16384,
    samplingParams: def.samplingParams,
    headers: resolveHeaders({ ...(p.headers ?? {}), ...(def.headers ?? {}) }),
    compat: Object.keys(compat).length > 0 ? compat : undefined,
  } as Model<Api>;
}

function customAuth(providerId: string, p: JsonProvider): ApiKeyAuth {
  return {
    name: p.name ?? providerId,
    // 优先级与 pi 一致：auth.json 中的凭据 > models.json 的 apiKey
    resolve: async ({ credential }): Promise<AuthResult | undefined> => {
      const key = credential?.key ?? (p.apiKey !== undefined ? resolveConfigValue(p.apiKey) : undefined);
      if (!key) return undefined;
      const source = credential?.key ? "stored credential" : "models.json apiKey";
      if (p.authHeader) return { auth: { headers: { Authorization: `Bearer ${key}` } }, source };
      return { auth: { apiKey: key }, source };
    },
  };
}

function customProvider(providerId: string, p: JsonProvider): Provider {
  const defs = p.models ?? [];
  const chat = defs.map((d) => toModel(providerId, d, p));
  const apis: Record<string, ProviderStreams> = {};
  for (const m of chat) apis[m.api] ??= STREAM_APIS[m.api]();
  return createProvider({
    id: providerId,
    name: p.name ?? providerId,
    baseUrl: p.baseUrl,
    auth: { apiKey: customAuth(providerId, p) },
    models: chat,
    api: apis,
  }) as Provider;
}

export function buildRuntime(): LlmRuntime {
  const dir = configDir();
  const warnings: string[] = [];
  const models = builtinModels({ credentials: new FileCredentialStore(path.join(dir, "auth.json")) });

  let modelsJson: unknown;
  try {
    modelsJson = readJsonFile(path.join(dir, "models.json"));
  } catch {
    throw new Error("models.json 不是合法的 JSON");
  }
  if (isRecord(modelsJson) && isRecord(modelsJson.providers)) {
    for (const [id, raw] of Object.entries(modelsJson.providers)) {
      if (!isRecord(raw)) continue;
      const p = raw as JsonProvider;
      if (!p.models || p.models.length === 0) {
        warnings.push(`models.json: provider "${id}" 未定义 models，已忽略（内置 provider 请直接使用环境变量或 auth.json）`);
        continue;
      }
      models.setProvider(customProvider(id, p));
    }
  }

  let defaultProvider: string | undefined;
  let defaultModel: string | undefined;
  try {
    const settings = readJsonFile(path.join(dir, "settings.json"));
    if (isRecord(settings)) {
      if (typeof settings.defaultProvider === "string") defaultProvider = settings.defaultProvider;
      if (typeof settings.defaultModel === "string") defaultModel = settings.defaultModel;
    }
  } catch {
    warnings.push("settings.json 不是合法的 JSON，已忽略");
  }

  return { models, configDir: dir, defaultProvider, defaultModel, warnings };
}
