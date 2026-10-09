import type { ApiErrorBody } from "./types";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly data: Record<string, unknown>;

  constructor(status: number, code: string, message: string, data: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }

  get retryable(): boolean {
    return this.data.retryable === true;
  }
}

/** 调用后端接口；失败时抛出带错误码与中文提示的 ApiError */
export async function api<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "NETWORK", "网络请求失败，请检查网络或服务是否可用后重试");
  }
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") {
      window.location.href = "/login";
    }
    const err = (parsed as ApiErrorBody | null)?.error;
    if (err) {
      const { code, message, ...rest } = err;
      throw new ApiError(res.status, code, message, rest);
    }
    throw new ApiError(res.status, "HTTP_ERROR", `请求失败（${res.status}）`);
  }
  return parsed as T;
}

export function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
