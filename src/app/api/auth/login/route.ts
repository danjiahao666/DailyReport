import { json, readJson, route } from "@/server/http";
import { AppError } from "@/server/errors";
import {
  authEnabled,
  clearLoginFailures,
  createSessionToken,
  loginBlocked,
  passwordMatches,
  recordLoginFailure,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/server/session";

export const dynamic = "force-dynamic";

export const POST = route(
  async (req) => {
    if (!authEnabled()) return { ok: true, authEnabled: false };
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    if (loginBlocked(ip)) throw new AppError(429, "TOO_MANY_ATTEMPTS", "登录失败次数过多，请 10 分钟后再试");
    const body = await readJson(req);
    const password = typeof body.password === "string" ? body.password : "";
    if (!passwordMatches(password)) {
      recordLoginFailure(ip);
      throw new AppError(401, "INVALID_PASSWORD", "密码不正确");
    }
    clearLoginFailures(ip);
    const res = json({ ok: true, authEnabled: true });
    res.cookies.set(SESSION_COOKIE, createSessionToken(), sessionCookieOptions());
    return res;
  },
  { public: true },
);
