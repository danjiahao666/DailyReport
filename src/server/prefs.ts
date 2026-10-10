import { isValidWeekStart } from "@/lib/dates";
import {
  NUMBER_PREF_ENV,
  NUMBER_PREF_KEYS,
  NUMBER_PREFS,
  PROMPT_KINDS,
  PROMPT_LABELS,
  PROMPT_MAX_CHARS,
  TEMPLATE_MAX_CHARS,
  type NumberPrefKey,
  type PrefSource,
  type PrefsState,
  type PromptKind,
} from "@/lib/prefs";
import { getDb, transaction } from "./db";
import { AppError } from "./errors";
import { DEFAULT_PROMPTS, DEFAULT_TEMPLATES } from "./llm/prompts";
import { authSource } from "./session";
import { getWeekStart } from "./settings";

/**
 * 设置中心的后端：把「可以在页面里改的选项」统一存进 settings 表。
 *
 * 取值优先级：页面设置 > 环境变量（仅部分选项有）> 内置默认。
 * 页面设置被清除（null）后自动回到后两者，所以升级前依赖环境变量的部署行为不变。
 * 与访问保护、数据目录、模型密钥相关的选项不在这里：它们必须由部署方通过环境变量或
 * 「大模型设置」页（有登录保护要求）控制。
 */

const KEY = {
  weekStart: "week_start", // 与 settings.ts 共用同一行
  optimizeOnSubmit: "optimize_on_submit",
  checkNewNumbers: "check_new_numbers",
  numbers: {
    timeoutMs: "llm_timeout_ms",
    maxInputChars: "llm_max_input_chars",
    maxTokensOptimize: "llm_max_tokens_optimize",
    maxTokensWeekly: "llm_max_tokens_weekly",
    maxTokensMonthly: "llm_max_tokens_monthly",
  } satisfies Record<NumberPrefKey, string>,
  prompts: {
    optimize: "prompt_optimize",
    weekly: "prompt_weekly",
    monthly: "prompt_monthly",
  } satisfies Record<PromptKind, string>,
  templates: {
    optimize: "template_optimize",
    weekly: "template_weekly",
    monthly: "template_monthly",
  } satisfies Record<PromptKind, string>,
} as const;

function readRaw(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

// ---------- 数值类 ----------

/** 环境变量的取值沿用原有宽容规则：非数字或非正数视为没设置；超时按旧逻辑夹在 1~600 秒 */
function envNumber(name: NumberPrefKey): number | null {
  const envName = NUMBER_PREF_ENV[name];
  if (!envName) return null;
  const raw = process.env[envName];
  if (raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (name === "timeoutMs") return Math.min(Math.max(n, NUMBER_PREFS.timeoutMs.min), NUMBER_PREFS.timeoutMs.max);
  return n;
}

function pageNumber(name: NumberPrefKey): number | null {
  const raw = readRaw(KEY.numbers[name]);
  if (raw === null) return null;
  const n = Number(raw);
  const { min, max } = NUMBER_PREFS[name];
  // 库里的值被手工改坏时视为未设置，而不是让调用方拿到 NaN
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

function resolveNumber(name: NumberPrefKey): { value: number; source: PrefSource } {
  const page = pageNumber(name);
  if (page !== null) return { value: page, source: "page" };
  const env = envNumber(name);
  if (env !== null) return { value: env, source: "env" };
  return { value: NUMBER_PREFS[name].default, source: "default" };
}

export const getLlmTimeoutMs = (): number => resolveNumber("timeoutMs").value;
export const getMaxInputChars = (): number => resolveNumber("maxInputChars").value;
export const getMaxTokens = (task: PromptKind): number =>
  resolveNumber(task === "optimize" ? "maxTokensOptimize" : task === "weekly" ? "maxTokensWeekly" : "maxTokensMonthly").value;

// ---------- 开关 ----------

function readBool(key: string, fallback: boolean): boolean {
  const raw = readRaw(key);
  return raw === null ? fallback : raw === "1";
}

export const getOptimizeOnSubmit = (): boolean => readBool(KEY.optimizeOnSubmit, false);
/** 默认开启：优化稿里出现原文没有的数字时给出提示 */
export const getCheckNewNumbers = (): boolean => readBool(KEY.checkNewNumbers, true);

// ---------- 提示词 ----------

/** 实际发给模型的系统提示词：自定义内容优先，没有则用内置默认 */
export function getSystemPrompt(kind: PromptKind): string {
  const raw = readRaw(KEY.prompts[kind]);
  return raw !== null && raw.trim() !== "" ? raw : DEFAULT_PROMPTS[kind];
}

// ---------- 输出模板 ----------

/** 实际发给模型的输出模板：自定义内容优先，没有则用内置默认（日报优化的默认是空，即不套模板） */
export function getTemplate(kind: PromptKind): string {
  const raw = readRaw(KEY.templates[kind]);
  return raw !== null && raw.trim() !== "" ? raw : DEFAULT_TEMPLATES[kind];
}

// ---------- 读取与更新 ----------

export function getPrefsState(): PrefsState {
  const numbers = {} as PrefsState["numbers"];
  for (const k of NUMBER_PREF_KEYS) {
    const page = pageNumber(k);
    const env = envNumber(k);
    numbers[k] = {
      page,
      fallback: env ?? NUMBER_PREFS[k].default,
      fallbackSource: env !== null ? "env" : "default",
    };
  }
  const prompts = {} as PrefsState["prompts"];
  for (const kind of PROMPT_KINDS) {
    const raw = readRaw(KEY.prompts[kind]);
    prompts[kind] = { custom: raw !== null && raw.trim() !== "" ? raw : null, default: DEFAULT_PROMPTS[kind] };
  }
  const templates = {} as PrefsState["templates"];
  for (const kind of PROMPT_KINDS) {
    const raw = readRaw(KEY.templates[kind]);
    templates[kind] = { custom: raw !== null && raw.trim() !== "" ? raw : null, default: DEFAULT_TEMPLATES[kind] };
  }
  const weekRow = readRaw(KEY.weekStart);
  const weekValue = getWeekStart();
  const envWeek = process.env.WEEK_START;
  const authSrc = authSource();
  return {
    weekStart: {
      value: weekValue,
      source: weekRow !== null && isValidWeekStart(Number(weekRow)) ? "page" : envWeek !== undefined && envWeek !== "" ? "env" : "default",
    },
    optimizeOnSubmit: getOptimizeOnSubmit(),
    checkNewNumbers: getCheckNewNumbers(),
    numbers,
    prompts,
    templates,
    auth: { enabled: authSrc !== null, managedBy: authSrc },
  };
}

/** 一次写库动作：value 为 null 表示删除该行（回到环境变量或默认） */
interface Write {
  key: string;
  value: string | null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function rejectUnknown(obj: Record<string, unknown>, allowed: readonly string[], where: string): void {
  const extra = Object.keys(obj).filter((k) => !allowed.includes(k));
  if (extra.length > 0) throw new AppError(400, "UNKNOWN_FIELD", `${where}包含不支持的字段：${extra.slice(0, 5).join("、")}`);
}

/**
 * 更新设置。先把所有字段校验并转换成写库动作，全部通过后在一个事务里落库：
 * 任何一项不合法，整次保存都不生效，不会出现「保存了一半」。
 */
export function updatePrefs(body: Record<string, unknown>): PrefsState {
  rejectUnknown(body, ["weekStart", "optimizeOnSubmit", "checkNewNumbers", "numbers", "prompts", "templates"], "请求");
  const writes: Write[] = [];

  if ("weekStart" in body) {
    if (!isValidWeekStart(body.weekStart)) {
      throw new AppError(400, "INVALID_WEEK_START", "周起始日必须是 0（周日）到 6（周六）之间的整数");
    }
    writes.push({ key: KEY.weekStart, value: String(body.weekStart) });
  }

  for (const name of ["optimizeOnSubmit", "checkNewNumbers"] as const) {
    if (!(name in body)) continue;
    if (typeof body[name] !== "boolean") throw new AppError(400, "INVALID_BOOLEAN", `${name} 必须是布尔值`);
    writes.push({ key: KEY[name], value: body[name] ? "1" : "0" });
  }

  if ("numbers" in body) {
    if (!isPlainObject(body.numbers)) throw new AppError(400, "INVALID_NUMBERS", "numbers 必须是对象");
    rejectUnknown(body.numbers, NUMBER_PREF_KEYS, "numbers ");
    for (const name of NUMBER_PREF_KEYS) {
      if (!(name in body.numbers)) continue;
      const v = body.numbers[name];
      if (v === null) {
        writes.push({ key: KEY.numbers[name], value: null });
        continue;
      }
      const { label, min, max, unit, scale } = NUMBER_PREFS[name];
      if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
        throw new AppError(400, "INVALID_NUMBER", `${label}必须是 ${min / scale} 到 ${max / scale} ${unit}之间的整数`);
      }
      writes.push({ key: KEY.numbers[name], value: String(v) });
    }
  }

  if ("prompts" in body) {
    if (!isPlainObject(body.prompts)) throw new AppError(400, "INVALID_PROMPTS", "prompts 必须是对象");
    rejectUnknown(body.prompts, PROMPT_KINDS, "prompts ");
    for (const kind of PROMPT_KINDS) {
      if (!(kind in body.prompts)) continue;
      const v = body.prompts[kind];
      if (v === null) {
        writes.push({ key: KEY.prompts[kind], value: null });
        continue;
      }
      if (typeof v !== "string") throw new AppError(400, "INVALID_PROMPT", `${PROMPT_LABELS[kind]}提示词必须是文本`);
      const text = v.replace(/\r\n/g, "\n").trim();
      if (text.length > PROMPT_MAX_CHARS) {
        throw new AppError(400, "PROMPT_TOO_LONG", `${PROMPT_LABELS[kind]}提示词过长，最多 ${PROMPT_MAX_CHARS} 个字符`);
      }
      // 清空或与内置默认完全一致：不存副本，这样以后内置默认改进时，没改过的用户自动跟随
      writes.push({ key: KEY.prompts[kind], value: text === "" || text === DEFAULT_PROMPTS[kind].trim() ? null : text });
    }
  }

  if ("templates" in body) {
    if (!isPlainObject(body.templates)) throw new AppError(400, "INVALID_TEMPLATES", "templates 必须是对象");
    rejectUnknown(body.templates, PROMPT_KINDS, "templates ");
    for (const kind of PROMPT_KINDS) {
      if (!(kind in body.templates)) continue;
      const v = body.templates[kind];
      if (v === null) {
        writes.push({ key: KEY.templates[kind], value: null });
        continue;
      }
      if (typeof v !== "string") throw new AppError(400, "INVALID_TEMPLATE", `${PROMPT_LABELS[kind]}模板必须是文本`);
      const text = v.replace(/\r\n/g, "\n").trim();
      if (text.length > TEMPLATE_MAX_CHARS) {
        throw new AppError(400, "TEMPLATE_TOO_LONG", `${PROMPT_LABELS[kind]}模板过长，最多 ${TEMPLATE_MAX_CHARS} 个字符`);
      }
      // 与提示词同理：清空或与内置默认一致就不存副本
      writes.push({ key: KEY.templates[kind], value: text === "" || text === DEFAULT_TEMPLATES[kind].trim() ? null : text });
    }
  }

  if (writes.length > 0) {
    transaction((db) => {
      for (const w of writes) {
        if (w.value === null) db.prepare("DELETE FROM settings WHERE key = ?").run(w.key);
        else db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(w.key, w.value);
      }
    });
  }
  return getPrefsState();
}
