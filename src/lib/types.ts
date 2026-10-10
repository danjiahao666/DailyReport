/** 前后端共享的数据类型 */

export type ReportKind = "weekly" | "monthly";
export type DailyVersion = "original" | "optimized";
export type VersionOrigin = "generated" | "edited" | "restored";
export type MonthlySource = "daily" | "weekly";

export interface DailyEntry {
  date: string;
  original: string;
  optimized: string | null;
  /** 当前采用的版本 */
  active: DailyVersion;
  /** 原文变更后，已有优化稿对应的是旧原文 */
  optimizedStale: boolean;
  optimizedModel: string | null;
  optimizedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** 当前采用版本的文本（周报、月报使用此文本） */
  effective: string;
  /** 优化稿的事实核对提示（如出现了原文没有的数字），由原文与优化稿即时计算 */
  warnings: string[];
}

export interface ReportMeta {
  source?: MonthlySource;
  inputHash?: string;
  /** 本次生成实际使用的日报日期 */
  dailyDates?: string[];
  /** 月报使用周报作为来源时，实际引用的周报 */
  weeklyRefs?: { weekStart: string; weekEnd: string; versionNo: number }[];
  warnings?: string[];
  /** 由哪个历史版本恢复而来 */
  restoredFrom?: number;
}

export interface ReportVersion {
  id: number;
  versionNo: number;
  content: string;
  origin: VersionOrigin;
  model: string | null;
  meta: ReportMeta | null;
  createdAt: string;
}

export interface Report {
  id: number;
  kind: ReportKind;
  periodStart: string;
  periodEnd: string;
  currentVersionId: number | null;
  current: ReportVersion | null;
  versions: ReportVersion[];
  /** 来源日报/周报在上次生成之后发生了变化 */
  outdated: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReportSummary {
  id: number;
  kind: ReportKind;
  periodStart: string;
  periodEnd: string;
  versionNo: number;
  origin: VersionOrigin;
  updatedAt: string;
}

export interface CalendarDaily {
  date: string;
  active: DailyVersion;
  hasOptimized: boolean;
  optimizedStale: boolean;
}

export interface CalendarData {
  month: string;
  weekStart: number;
  /** 设置中心里的「提交日报时默认勾选大模型优化」 */
  optimizeOnSubmit: boolean;
  gridStart: string;
  gridEnd: string;
  dailies: CalendarDaily[];
  weeklies: ReportSummary[];
  monthly: ReportSummary | null;
  /** 网格范围内的大模型任务状态（日报优化、周报，以及当月月报） */
  jobs: JobView[];
}

export interface MonthlyPlan {
  month: string;
  source: MonthlySource;
  /** 逐周的取数规则，便于用户确认 */
  weeks: {
    weekStart: string;
    weekEnd: string;
    from: string;
    to: string;
    full: boolean;
    use: "weekly" | "daily" | "none";
    reason: string;
    dailyCount: number;
  }[];
  dailyCount: number;
  weeklyCount: number;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    [key: string]: unknown;
  };
}

// ---------- 大模型设置 ----------

export interface LlmCustomModel {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
}

/** 密钥状态：只有“是否配置”与来源说明，永远不包含密钥本身 */
export interface LlmKeyStatus {
  configured: boolean;
  /** 来源说明，如 stored credential / OPENAI_API_KEY / models.json apiKey */
  source: string | null;
  storedInAuthJson: boolean;
  credentialType: "api_key" | "oauth" | null;
}

export interface LlmCustomProvider {
  id: string;
  name: string;
  baseUrl: string;
  api: string;
  models: LlmCustomModel[];
  key: LlmKeyStatus;
}

export interface LlmBuiltinProvider {
  id: string;
  name: string;
  key: LlmKeyStatus;
}

export interface LlmSelectableProvider {
  id: string;
  name: string;
  models: { id: string; name: string }[];
}

export interface LlmSettingsState {
  configDir: string;
  /** 是否允许在页面修改；为 false 时 readonlyReason 说明原因 */
  canEdit: boolean;
  readonlyReason: string | null;
  /** 配置文件格式错误时的提示 */
  configError: string | null;
  warnings: string[];
  /** 环境变量 LLM_PROVIDER / LLM_MODEL 会覆盖默认模型 */
  envOverride: { provider: string | null; model: string | null } | null;
  apis: string[];
  defaultProvider: string | null;
  defaultModel: string | null;
  customProviders: LlmCustomProvider[];
  builtinProviders: LlmBuiltinProvider[];
  /** 已配置密钥、可作为默认模型的 provider 及其模型 */
  selectable: LlmSelectableProvider[];
}

export interface LlmTestResult {
  ok: true;
  provider: string;
  model: string;
  ms: number;
}

// ---------- 异步任务 ----------

export type JobKind = "optimize" | "weekly" | "monthly";
export type JobStatus = "running" | "succeeded" | "failed";

/**
 * 大模型异步任务的状态。target：
 *  - optimize：日期 YYYY-MM-DD
 *  - weekly：该周起始日 YYYY-MM-DD
 *  - monthly：月份 YYYY-MM
 */
export interface JobView {
  kind: JobKind;
  target: string;
  status: JobStatus;
  errorCode: string | null;
  errorMessage: string | null;
  retryable: boolean;
  startedAt: string;
  finishedAt: string | null;
}
