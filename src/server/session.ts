import { createHmac, timingSafeEqual, createHash } from "node:crypto";

/**
 * 简单的单用户访问保护：设置 APP_PASSWORD 后启用。
 * 登录成功后下发 HMAC 签名的 httpOnly Cookie（含过期时间），无服务端会话存储。
 */

export const SESSION_COOKIE = "dr_session";
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;

export function authEnabled(): boolean {
  return Boolean(process.env.APP_PASSWORD);
}

function secret(): string {
  return process.env.SESSION_SECRET || `dr-v1:${process.env.APP_PASSWORD ?? ""}`;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

export function createSessionToken(now = Date.now()): string {
  const exp = String(now + SESSION_TTL_MS);
  return `${exp}.${sign(exp)}`;
}

export function verifySessionToken(token: string | undefined, now = Date.now()): boolean {
  if (!authEnabled()) return true;
  if (!token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || !/^\d+$/.test(exp)) return false;
  const expected = Buffer.from(sign(exp));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;
  return Number(exp) > now;
}

export function passwordMatches(input: string): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return false;
  // 先做摘要再做常量时间比较，避免长度泄露
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  };
}

// ---- 登录失败限流（进程内，按来源 IP） ----
const MAX_FAILS = 8;
const WINDOW_MS = 10 * 60 * 1000;
const fails = new Map<string, { count: number; first: number }>();

export function loginBlocked(key: string, now = Date.now()): boolean {
  const rec = fails.get(key);
  if (!rec) return false;
  if (now - rec.first > WINDOW_MS) {
    fails.delete(key);
    return false;
  }
  return rec.count >= MAX_FAILS;
}

export function recordLoginFailure(key: string, now = Date.now()): void {
  const rec = fails.get(key);
  if (!rec || now - rec.first > WINDOW_MS) fails.set(key, { count: 1, first: now });
  else rec.count += 1;
  if (fails.size > 1000) fails.clear();
}

export function clearLoginFailures(key: string): void {
  fails.delete(key);
}
