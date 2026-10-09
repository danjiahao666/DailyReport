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
  gridStart: string;
  gridEnd: string;
  dailies: CalendarDaily[];
  weeklies: ReportSummary[];
  monthly: ReportSummary | null;
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
