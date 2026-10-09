import { AppError } from "../errors";

/**
 * 大模型调用相关错误。message 面向用户（中文、可操作），不包含密钥、内部地址或堆栈；
 * 详细原因只写入服务端日志。所有错误都可在修复后重试，已保存的日报不受影响。
 */
export type LlmErrorCode =
  | "NO_MODEL"
  | "AUTH"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "EMPTY"
  | "TRUNCATED"
  | "UPSTREAM";

const DEFAULT_MESSAGES: Record<LlmErrorCode, { status: number; message: string }> = {
  NO_MODEL: {
    status: 503,
    message: "未配置可用的大模型。请在配置目录中配置模型与密钥（参见 README 的“大模型配置”），配置后重试。",
  },
  AUTH: {
    status: 503,
    message: "大模型凭据缺失或被拒绝，请检查 API 密钥配置后重试。",
  },
  TIMEOUT: {
    status: 504,
    message: "大模型响应超时，请稍后重试；内容较多时可适当调大 LLM_TIMEOUT_MS。",
  },
  RATE_LIMITED: {
    status: 429,
    message: "大模型服务请求过于频繁或额度不足，请稍后重试。",
  },
  EMPTY: {
    status: 502,
    message: "大模型返回了空内容，请重试。",
  },
  TRUNCATED: {
    status: 502,
    message: "大模型输出被截断（可能达到长度上限），本次结果已丢弃，请重试或缩小生成范围。",
  },
  UPSTREAM: {
    status: 502,
    message: "大模型服务调用失败，请稍后重试；若持续失败请检查服务端日志。",
  },
};

export class LlmError extends AppError {
  readonly llmCode: LlmErrorCode;

  constructor(code: LlmErrorCode, message?: string) {
    const d = DEFAULT_MESSAGES[code];
    super(d.status, `LLM_${code}`, message ?? d.message, { retryable: true });
    this.name = "LlmError";
    this.llmCode = code;
  }
}

/** 根据上游错误文本归类（只做归类，不把原文返回给用户） */
export function classifyUpstreamFailure(errorMessage: string | undefined): LlmErrorCode {
  const text = (errorMessage ?? "").toLowerCase();
  if (/\b(401|403)\b|unauthori[sz]ed|forbidden|invalid.{0,20}(api.?key|token)|authentication/.test(text)) return "AUTH";
  if (/\b429\b|rate.?limit|quota|insufficient|too many requests/.test(text)) return "RATE_LIMITED";
  if (/timed? ?out|timeout|etimedout|econnreset|socket hang up/.test(text)) return "TIMEOUT";
  return "UPSTREAM";
}
