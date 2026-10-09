/** 业务错误：带稳定错误码与对用户可见的中文提示，不携带内部细节 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;

  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
