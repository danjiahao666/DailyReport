import { NextResponse, type NextRequest } from "next/server";
import { AppError } from "./errors";
import { authEnabled, SESSION_COOKIE, verifySessionToken } from "./session";

const MAX_BODY_BYTES = 1_000_000;

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

/** 解析路径中的正整数 ID */
export function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new AppError(400, "INVALID_ID", "报告 ID 不合法");
  return id;
}

/** 读取并校验 JSON 请求体（必须是对象，限制大小） */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new AppError(413, "BODY_TOO_LARGE", "请求内容过大");
  let parsed: unknown;
  try {
    parsed = text === "" ? {} : JSON.parse(text);
  } catch {
    throw new AppError(400, "INVALID_JSON", "请求体不是合法的 JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new AppError(400, "INVALID_JSON", "请求体必须是 JSON 对象");
  }
  return parsed as Record<string, unknown>;
}

/** 简单的同源校验：拒绝跨站发起的写请求（与 SameSite Cookie 互为补充） */
function assertSameOrigin(req: NextRequest): void {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  if (!origin) return;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new AppError(403, "FORBIDDEN", "非法的请求来源");
  }
  if (host && originHost !== host) throw new AppError(403, "FORBIDDEN", "非法的请求来源");
}

export interface RouteOptions {
  /** 不需要登录（登录、健康检查） */
  public?: boolean;
}

type Handler<P> = (req: NextRequest, params: P) => Promise<unknown> | unknown;

/**
 * 统一的接口包装：鉴权、同源校验、错误转换、耗时日志。
 * 错误响应只返回稳定错误码与中文提示，内部细节只写日志。
 */
export function route<P = Record<string, never>>(handler: Handler<P>, options: RouteOptions = {}) {
  return async (req: NextRequest, ctx?: { params: Promise<P> }): Promise<Response> => {
    const started = Date.now();
    const path = new URL(req.url).pathname;
    let status = 200;
    try {
      if (!options.public && authEnabled() && !verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value)) {
        throw new AppError(401, "UNAUTHORIZED", "未登录或登录已过期");
      }
      assertSameOrigin(req);
      const params = (ctx ? await ctx.params : {}) as P;
      const result = await handler(req, params);
      if (result instanceof Response) {
        status = result.status;
        return result;
      }
      return json(result);
    } catch (error) {
      if (error instanceof AppError) {
        status = error.status;
        return json({ error: { code: error.code, message: error.message, ...error.extra } }, error.status);
      }
      status = 500;
      console.error(JSON.stringify({ evt: "http.error", path, error: error instanceof Error ? `${error.name}: ${error.message}` : "unknown" }));
      return json({ error: { code: "INTERNAL", message: "服务器内部错误，请稍后重试" } }, 500);
    } finally {
      console.info(JSON.stringify({ evt: "http", method: req.method, path, status, ms: Date.now() - started }));
    }
  };
}
