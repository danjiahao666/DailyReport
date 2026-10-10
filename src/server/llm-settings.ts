import path from "node:path";
import { builtinModels, builtinProviders } from "@earendil-works/pi-ai/providers/all";
import type { Models } from "@earendil-works/pi-ai";
import type {
  LlmBuiltinProvider,
  LlmCustomModel,
  LlmCustomProvider,
  LlmKeyStatus,
  LlmSelectableProvider,
  LlmSettingsState,
  LlmTestResult,
} from "@/lib/types";
import { AppError } from "./errors";
import { withLock } from "./inflight";
import { generateText, resetLlmRuntime } from "./llm/client";
import { buildRuntime, configDir, STREAM_API_IDS, type LlmRuntime } from "./llm/config";
import { ConfigFileError, dirWritable, isRecord, readJsonObject, writeJsonAtomic } from "./llm/config-files";
import { FileCredentialStore } from "./llm/credentials";
import { fetchRemoteModels } from "./llm/model-list";
import { resolveConfigValue } from "./llm/config-value";
import { authEnabled } from "./session";

/**
 * 大模型设置：读写 pi 约定的 models.json / auth.json / settings.json。
 *  - 自定义 provider 写入 models.json（不含密钥）；密钥统一写入 auth.json；默认模型写入 settings.json；
 *  - 修改时读-改-写，保留文件里页面不认识的字段（headers、compat、其它 provider 等）；
 *  - 接口永不返回密钥，只返回“是否已配置”和来源说明；
 *  - 未设置 APP_PASSWORD 或配置目录不可写时，一律只读。
 */

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,47}$/;
const MAX_MODELS = 50;
const MAX_TOKENS_FIELD = 10_000_000;
/** 云厂商元数据地址：即使是内网网关也不应该指向这里 */
const BLOCKED_HOSTS = new Set(["metadata.google.internal", "[fd00:ec2::254]", "100.100.100.200"]);

let builtinIdCache: Set<string> | undefined;
function builtinIds(): Set<string> {
  builtinIdCache ??= new Set(builtinProviders().map((p) => p.id));
  return builtinIdCache;
}

function files() {
  const dir = configDir();
  return {
    dir,
    models: path.join(dir, "models.json"),
    auth: path.join(dir, "auth.json"),
    settings: path.join(dir, "settings.json"),
  };
}

const bad = (message: string) => new AppError(400, "INVALID_INPUT", message);

/** 将配置文件读写异常转换为对用户可见的业务错误 */
function guard<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof ConfigFileError) {
      if (error.code === "INVALID") throw new AppError(409, "CONFIG_INVALID", error.message);
      throw new AppError(500, "CONFIG_WRITE_FAILED", error.message);
    }
    throw error;
  }
}

// ---------- 权限 ----------

export function readonlyReason(): string | null {
  if (!authEnabled()) {
    return "未启用访问保护，出于安全考虑设置页为只读（修改涉及密钥与接口地址）。请在 .env 中设置 APP_PASSWORD 并重启，或到“设置中心”里设置访问密码，或直接编辑配置文件。";
  }
  if (!dirWritable(configDir())) {
    return "配置目录不可写，无法在页面保存。Docker 部署请确认 ./pi-config 未以只读方式挂载，且容器用户（uid 1000）对它有写权限。";
  }
  return null;
}

function assertCanEdit(): void {
  const reason = readonlyReason();
  if (reason) throw new AppError(403, "SETTINGS_READONLY", reason);
}

// ---------- 输入校验 ----------

function validateId(v: unknown, label = "名称标识"): string {
  if (typeof v !== "string" || !ID_RE.test(v)) {
    throw bad(`${label}只能包含字母、数字、点、下划线和连字符，以字母或数字开头，最长 48 个字符`);
  }
  return v;
}

function optionalText(v: unknown, label: string, max: number): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw bad(`${label}必须是文本`);
  const s = v.trim();
  if (s.length > max) throw bad(`${label}过长，最多 ${max} 个字符`);
  return s === "" ? undefined : s;
}

function validateBaseUrl(v: unknown): string {
  if (typeof v !== "string" || v.trim() === "") throw bad("请填写接口地址，例如 https://api.example.com/v1");
  const s = v.trim();
  if (s.length > 500) throw bad("接口地址过长");
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw bad("接口地址格式不正确，应形如 https://api.example.com/v1");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw bad("接口地址只支持 http 或 https");
  if (u.username || u.password) throw bad("接口地址中不要包含用户名和密码，请把密钥填在“API 密钥”里");
  const host = u.hostname.toLowerCase();
  if (host.startsWith("169.254.") || BLOCKED_HOSTS.has(host)) throw bad("不允许使用云平台元数据地址作为接口地址");
  return s;
}

function validateApi(v: unknown): string {
  if (typeof v !== "string" || !STREAM_API_IDS.includes(v)) {
    throw bad(`接口协议不受支持，可选：${STREAM_API_IDS.join("、")}`);
  }
  return v;
}

function optionalInt(v: unknown, label: string): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > MAX_TOKENS_FIELD) {
    throw bad(`${label}必须是 1 到 ${MAX_TOKENS_FIELD} 之间的整数`);
  }
  return v;
}

function validateModels(v: unknown): LlmCustomModel[] {
  if (!Array.isArray(v) || v.length === 0) throw bad("至少添加一个模型");
  if (v.length > MAX_MODELS) throw bad(`最多添加 ${MAX_MODELS} 个模型`);
  const seen = new Set<string>();
  return v.map((raw, i) => {
    if (!isRecord(raw)) throw bad(`第 ${i + 1} 个模型格式不正确`);
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    // eslint-disable-next-line no-control-regex
    if (!id || id.length > 200 || /[\x00-\x1f\x7f]/.test(id)) throw bad(`第 ${i + 1} 个模型的 ID 不能为空，且不超过 200 个字符`);
    if (seen.has(id)) throw bad(`模型 ID 重复：${id}`);
    seen.add(id);
    if (raw.reasoning !== undefined && typeof raw.reasoning !== "boolean") throw bad("reasoning 必须是布尔值");
    return {
      id,
      name: optionalText(raw.name, "模型显示名", 200),
      contextWindow: optionalInt(raw.contextWindow, "上下文窗口"),
      maxTokens: optionalInt(raw.maxTokens, "最大输出"),
      reasoning: raw.reasoning,
    };
  });
}

function validateKey(v: unknown): string {
  if (typeof v !== "string") throw bad("API 密钥必须是文本");
  const s = v.trim();
  if (s === "" || s.length > 4096) throw bad("API 密钥不能为空，且不超过 4096 个字符");
  // eslint-disable-next-line no-control-regex
  if (/[\s\x00-\x1f\x7f]/.test(s)) throw bad("API 密钥中不能包含空白字符或换行");
  if (s.startsWith("!")) throw bad("不支持以 ! 开头的命令型配置，请改用环境变量引用（如 $MY_API_KEY）");
  return s;
}

function setOpt(obj: Record<string, unknown>, key: string, value: unknown): void {
  if (value === undefined) delete obj[key];
  else obj[key] = value;
}

// ---------- 状态 ----------

function tryRead(file: string, errors: string[]): Record<string, unknown> {
  try {
    return readJsonObject(file) ?? {};
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "配置文件读取失败");
    return {};
  }
}

async function keyStatus(models: Models, id: string, rawAuth: Record<string, unknown>): Promise<LlmKeyStatus> {
  const cred = Object.hasOwn(rawAuth, id) && isRecord(rawAuth[id]) ? rawAuth[id] : undefined;
  const credentialType = cred?.type === "api_key" || cred?.type === "oauth" ? cred.type : null;
  let configured = false;
  let source: string | null = null;
  try {
    const check = await models.checkAuth(id);
    if (check) {
      configured = true;
      source = check.source ?? null;
    }
  } catch {
    /* 解析失败（如引用了不存在的命令）按未配置处理 */
  }
  return { configured, source, storedInAuthJson: cred !== undefined, credentialType };
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

export async function getLlmSettings(): Promise<LlmSettingsState> {
  const f = files();
  const errors: string[] = [];
  const rawModels = tryRead(f.models, errors);
  const rawAuth = tryRead(f.auth, errors);
  const rawSettings = tryRead(f.settings, errors);

  let rt: LlmRuntime | undefined;
  try {
    rt = errors.length === 0 ? buildRuntime() : undefined;
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "模型配置加载失败");
  }
  const models: Models = rt?.models ?? builtinModels({ credentials: new FileCredentialStore(f.auth) });

  const customRaw = isRecord(rawModels.providers) ? rawModels.providers : {};
  const customIds: string[] = [];
  const customProviders: LlmCustomProvider[] = [];
  for (const [id, raw] of Object.entries(customRaw)) {
    if (!isRecord(raw) || !Array.isArray(raw.models) || raw.models.length === 0) continue; // 与运行时一致：无 models 的条目不生效
    customIds.push(id);
    const list = raw.models.filter(isRecord).map((m) => ({
      id: String(m.id ?? ""),
      name: str(m.name),
      contextWindow: typeof m.contextWindow === "number" ? m.contextWindow : undefined,
      maxTokens: typeof m.maxTokens === "number" ? m.maxTokens : undefined,
      reasoning: typeof m.reasoning === "boolean" ? m.reasoning : undefined,
    }));
    customProviders.push({
      id,
      name: str(raw.name) ?? id,
      baseUrl: str(raw.baseUrl) ?? "",
      api: str(raw.api) ?? "",
      models: list,
      key: await keyStatus(models, id, rawAuth),
    });
  }

  const builtinList = models
    .getProviders()
    .filter((p) => p.auth.apiKey && !customIds.includes(p.id));
  const builtinStatuses = await Promise.all(builtinList.map((p) => keyStatus(models, p.id, rawAuth)));
  const builtin: LlmBuiltinProvider[] = builtinList
    .map((p, i) => ({ id: p.id, name: p.name, key: builtinStatuses[i] }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const selectable: LlmSelectableProvider[] = [];
  const keyById = new Map<string, LlmKeyStatus>([
    ...customProviders.map((p) => [p.id, p.key] as const),
    ...builtin.map((p) => [p.id, p.key] as const),
  ]);
  for (const p of models.getProviders()) {
    if (!keyById.get(p.id)?.configured) continue;
    const list = p.getModels().map((m) => ({ id: m.id, name: m.name ?? m.id }));
    if (list.length > 0) selectable.push({ id: p.id, name: p.name, models: list });
  }

  const envProvider = process.env.LLM_PROVIDER || null;
  const envModel = process.env.LLM_MODEL || null;
  const reason = readonlyReason();
  return {
    configDir: f.dir,
    canEdit: reason === null,
    readonlyReason: reason,
    configError: errors.length > 0 ? errors.join("\n") : null,
    warnings: rt?.warnings ?? [],
    envOverride: envProvider || envModel ? { provider: envProvider, model: envModel } : null,
    apis: [...STREAM_API_IDS],
    defaultProvider: str(rawSettings.defaultProvider) ?? null,
    defaultModel: str(rawSettings.defaultModel) ?? null,
    customProviders,
    builtinProviders: builtin,
    selectable,
  };
}

// ---------- 修改 ----------

function knownRuntime(): LlmRuntime {
  try {
    return buildRuntime();
  } catch (error) {
    throw new AppError(409, "CONFIG_INVALID", error instanceof Error ? error.message : "模型配置加载失败");
  }
}

function readProviders(data: Record<string, unknown>): Record<string, unknown> {
  if (data.providers === undefined) return {};
  if (!isRecord(data.providers)) throw new AppError(409, "CONFIG_INVALID", "models.json 的 providers 必须是对象，已拒绝修改");
  return data.providers;
}

export function upsertProvider(body: Record<string, unknown>): void {
  assertCanEdit();
  const id = validateId(body.id, "provider 标识");
  const name = optionalText(body.name, "显示名称", 100);
  const baseUrl = validateBaseUrl(body.baseUrl);
  const api = validateApi(body.api);
  const models = validateModels(body.models);
  let newKey: string | undefined;
  if (body.apiKey !== undefined && body.apiKey !== null && body.apiKey !== "") newKey = validateKey(body.apiKey);

  const f = files();
  guard(() => {
    const data = readJsonObject(f.models) ?? {};
    const providers = readProviders(data);
    const exists = Object.hasOwn(providers, id) && isRecord(providers[id]);
    if (!exists && builtinIds().has(id)) {
      throw bad(`“${id}”与内置 provider 同名，请换一个标识；若只是配置内置 provider 的密钥，请在“内置 provider 密钥”里填写`);
    }
    const prev = exists ? (providers[id] as Record<string, unknown>) : {};
    const prevModels = Array.isArray(prev.models) ? prev.models.filter(isRecord) : [];

    const nextModels = models.map((m) => {
      // 保留该模型在文件中页面不认识的字段（thinkingLevelMap、compat、headers 等）
      const out: Record<string, unknown> = { ...(prevModels.find((o) => o.id === m.id) ?? {}), id: m.id };
      setOpt(out, "name", m.name);
      setOpt(out, "contextWindow", m.contextWindow);
      setOpt(out, "maxTokens", m.maxTokens);
      setOpt(out, "reasoning", m.reasoning);
      return out;
    });
    const next: Record<string, unknown> = { ...prev, baseUrl, api, models: nextModels };
    setOpt(next, "name", name);
    providers[id] = next;
    data.providers = providers;
    writeJsonAtomic(f.models, data);

    if (newKey !== undefined) writeKey(id, newKey);
  });
  resetLlmRuntime();
}

function writeKey(provider: string, key: string | null): void {
  const f = files();
  const auth = readJsonObject(f.auth) ?? {};
  const existing = Object.hasOwn(auth, provider) && isRecord(auth[provider]) ? (auth[provider] as Record<string, unknown>) : undefined;
  if (existing?.type === "oauth") {
    throw new AppError(409, "OAUTH_CREDENTIAL", "该 provider 使用 OAuth 登录凭据（由 pi 管理），请在 pi 中重新登录，不能在此改为 API 密钥");
  }
  if (key === null) {
    if (!existing) return;
    delete auth[provider];
  } else {
    auth[provider] = { ...(existing ?? {}), type: "api_key", key };
  }
  writeJsonAtomic(f.auth, auth);
}

export function setProviderKey(providerInput: unknown, keyInput: unknown): void {
  assertCanEdit();
  const provider = validateId(providerInput, "provider 标识");
  const key = keyInput === null ? null : validateKey(keyInput);
  const p = knownRuntime().models.getProvider(provider);
  if (!p) throw new AppError(404, "NOT_FOUND", "provider 不存在");
  if (!p.auth.apiKey) throw bad("该 provider 不使用 API 密钥");
  guard(() => writeKey(provider, key));
  resetLlmRuntime();
}

export function deleteProvider(idInput: unknown): void {
  assertCanEdit();
  const id = validateId(idInput, "provider 标识");
  const f = files();
  guard(() => {
    const data = readJsonObject(f.models) ?? {};
    const providers = readProviders(data);
    if (!Object.hasOwn(providers, id)) throw new AppError(404, "NOT_FOUND", "provider 不存在");
    delete providers[id];
    data.providers = providers;
    writeJsonAtomic(f.models, data);

    // 默认模型指向被删除的 provider 时一并清除，避免之后一直报“找不到模型”
    const settings = readJsonObject(f.settings);
    if (settings && settings.defaultProvider === id) {
      delete settings.defaultProvider;
      delete settings.defaultModel;
      writeJsonAtomic(f.settings, settings);
    }
    // 自定义 provider 的密钥随之删除；与内置同名的不动，避免误删内置 provider 的密钥
    if (!builtinIds().has(id)) writeKey(id, null);
  });
  resetLlmRuntime();
}

export function setDefaultModel(providerInput: unknown, modelInput: unknown): void {
  assertCanEdit();
  const f = files();
  if (providerInput === null) {
    guard(() => {
      const settings = readJsonObject(f.settings);
      if (!settings) return;
      delete settings.defaultProvider;
      delete settings.defaultModel;
      writeJsonAtomic(f.settings, settings);
    });
    resetLlmRuntime();
    return;
  }
  const provider = validateId(providerInput, "provider 标识");
  if (typeof modelInput !== "string" || modelInput === "" || modelInput.length > 200) throw bad("请选择模型");
  if (!knownRuntime().models.getModel(provider, modelInput)) {
    throw new AppError(400, "INVALID_DEFAULT", "未找到该模型，请确认 provider 与模型 ID");
  }
  guard(() => {
    const settings = readJsonObject(f.settings) ?? {};
    settings.defaultProvider = provider;
    settings.defaultModel = modelInput;
    writeJsonAtomic(f.settings, settings);
  });
  resetLlmRuntime();
}

/**
 * 获取自定义 provider 的模型列表（用于添加 / 编辑页面的下拉选择）。
 *
 * 密钥来源：表单里新填的密钥优先；没填且是在编辑已有 provider 时，沿用已保存的密钥
 * （auth.json，其次 models.json 的 apiKey）。但只有接口地址没变时才沿用——
 * 否则改了地址再点按钮，已保存的密钥会被发往一个从未确认过的新地址。
 * 需要编辑权限：这个动作会带着密钥向用户填写的地址发起请求。
 */
export async function listRemoteModels(body: Record<string, unknown>) {
  assertCanEdit();
  const extra = Object.keys(body).filter((k) => !["baseUrl", "api", "apiKey", "providerId"].includes(k));
  if (extra.length > 0) throw bad(`请求包含不支持的字段：${extra.slice(0, 5).join("、")}`);
  const baseUrl = validateBaseUrl(body.baseUrl);
  const api = validateApi(body.api);

  let key: string | undefined;
  if (body.apiKey !== undefined && body.apiKey !== null && body.apiKey !== "") {
    const typed = validateKey(body.apiKey);
    key = resolveConfigValue(typed);
    if (key === undefined) throw bad("API 密钥引用的环境变量没有设置，请检查变量名，或直接填写密钥。");
  } else if (body.providerId !== undefined && body.providerId !== null && body.providerId !== "") {
    const id = validateId(body.providerId, "provider 标识");
    const f = files();
    const saved = guard(() => {
      const provider = (readProviders(readJsonObject(f.models) ?? {}) as Record<string, unknown>)[id];
      return isRecord(provider) ? provider : undefined;
    });
    if (saved) {
      if (str(saved.baseUrl) !== baseUrl) {
        throw bad("接口地址已修改，出于安全考虑不会把已保存的密钥发往新地址。请重新填写 API 密钥后再获取。");
      }
      const cred = await new FileCredentialStore(f.auth).read(id).catch(() => undefined);
      if (cred?.type === "api_key" && cred.key) key = cred.key;
      else if (typeof saved.apiKey === "string" && saved.apiKey !== "") {
        try {
          key = resolveConfigValue(saved.apiKey);
        } catch {
          key = undefined;
        }
      }
    }
  }
  return { models: await fetchRemoteModels({ baseUrl, api, key }) };
}

/** 发一次极短的真实请求，验证端点、密钥与模型 ID 是否可用；失败时抛出带中文提示的 LlmError */
export async function testModel(providerInput: unknown, modelInput: unknown): Promise<LlmTestResult> {
  const provider = validateId(providerInput, "provider 标识");
  if (typeof modelInput !== "string" || modelInput === "" || modelInput.length > 200) throw bad("请选择模型");
  return withLock(`llm-test:${provider}/${modelInput}`, async () => {
    const started = Date.now();
    await generateText({
      task: "test",
      system: "你是连通性测试助手。",
      user: "请只回复“ok”。",
      maxTokens: 512,
      target: { provider, model: modelInput },
      timeoutMs: 30_000,
      allowTruncated: true,
    });
    return { ok: true, provider, model: modelInput, ms: Date.now() - started };
  });
}
