/**
 * 设置中心的共享定义：前后端共用的取值范围、文案与状态类型。
 * 不依赖任何服务端模块，客户端组件可以直接引用。
 */

/** 可自定义系统提示词的三个任务 */
export const PROMPT_KINDS = ["optimize", "weekly", "monthly"] as const;
export type PromptKind = (typeof PROMPT_KINDS)[number];

export const PROMPT_LABELS: Record<PromptKind, string> = {
  optimize: "日报优化",
  weekly: "周报",
  monthly: "月报",
};

/** 系统提示词的长度上限（字符）。足够写很长的规则，又不至于撑爆上下文 */
export const PROMPT_MAX_CHARS = 20_000;

/** 参考模板的长度上限（字符）。模板只描述输出结构，远短于提示词 */
export const TEMPLATE_MAX_CHARS = 5_000;

/**
 * 数值类选项。min / max 是页面设置允许的范围；
 * scale 是「界面单位 → 存储单位」的倍数（超时在界面里按秒填，存毫秒）。
 */
export const NUMBER_PREFS = {
  timeoutMs: { label: "单次调用超时", unit: "秒", scale: 1000, min: 1_000, max: 600_000, default: 120_000 },
  maxInputChars: { label: "单次汇总输入上限", unit: "字符", scale: 1, min: 1_000, max: 1_000_000, default: 60_000 },
  maxTokensOptimize: { label: "日报优化最大输出", unit: "tokens", scale: 1, min: 256, max: 32_768, default: 4_096 },
  maxTokensWeekly: { label: "周报最大输出", unit: "tokens", scale: 1, min: 256, max: 32_768, default: 4_096 },
  maxTokensMonthly: { label: "月报最大输出", unit: "tokens", scale: 1, min: 256, max: 32_768, default: 6_144 },
} as const;
export type NumberPrefKey = keyof typeof NUMBER_PREFS;
export const NUMBER_PREF_KEYS = Object.keys(NUMBER_PREFS) as NumberPrefKey[];

/** 有对应环境变量的数值选项，设置页用它向用户说明「留空会沿用什么」 */
export const NUMBER_PREF_ENV: Partial<Record<NumberPrefKey, string>> = {
  timeoutMs: "LLM_TIMEOUT_MS",
  maxInputChars: "LLM_MAX_INPUT_CHARS",
};

/** 生效值的来源：页面设置优先，其次环境变量，最后是内置默认 */
export type PrefSource = "page" | "env" | "default";

export interface NumberPrefState {
  /** 页面里保存的值；null 表示没有设置，走 fallback */
  page: number | null;
  /** 没有页面设置时实际生效的值 */
  fallback: number;
  fallbackSource: Exclude<PrefSource, "page">;
}

export interface PromptState {
  /** 自定义内容；null 表示在用内置默认 */
  custom: string | null;
  default: string;
}

export interface PrefsState {
  weekStart: { value: number; source: PrefSource };
  optimizeOnSubmit: boolean;
  checkNewNumbers: boolean;
  numbers: Record<NumberPrefKey, NumberPrefState>;
  prompts: Record<PromptKind, PromptState>;
  /**
   * 输出模板：随用户消息一起发给模型，规定日报 / 周报 / 月报的结构与小节。
   * 日报优化的默认模板为空（不套模板）；周报、月报的默认模板即内置的四个小节。
   */
  templates: Record<PromptKind, PromptState>;
  auth: AuthState;
}

/** 访问保护状态：由谁控制（环境变量 / 设置中心）以及是否启用。绝不包含密码或其摘要 */
export interface AuthState {
  enabled: boolean;
  /** env：由环境变量 APP_PASSWORD 控制，页面不可改；page：在设置中心里设置；null：未启用 */
  managedBy: "env" | "page" | null;
}

/** 访问密码的长度范围（字符数） */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** 更新请求：只需要带有变化的字段；null 表示清除页面设置、回到环境变量或默认 */
export interface PrefsPatch {
  weekStart?: number;
  optimizeOnSubmit?: boolean;
  checkNewNumbers?: boolean;
  numbers?: Partial<Record<NumberPrefKey, number | null>>;
  prompts?: Partial<Record<PromptKind, string | null>>;
  templates?: Partial<Record<PromptKind, string | null>>;
}
