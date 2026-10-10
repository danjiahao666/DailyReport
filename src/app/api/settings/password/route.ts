import { json, readJson, route } from "@/server/http";
import { AppError } from "@/server/errors";
import { clearPagePassword, savePagePassword, validateNewPassword } from "@/server/password";
import {
  authSource,
  clearLoginFailures,
  createSessionToken,
  loginBlocked,
  passwordMatches,
  recordLoginFailure,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/server/session";
import type { AuthState } from "@/lib/prefs";

export const dynamic = "force-dynamic";

function authState(): AuthState {
  const source = authSource();
  return { enabled: source !== null, managedBy: source };
}

/**
 * 在设置中心里启用 / 修改 / 关闭访问密码。
 *
 * - 环境变量 APP_PASSWORD 优先：已由它控制时一律拒绝，页面无权覆盖部署方的配置。
 * - 未启用时可直接设置（此时本来就没有保护）；已启用后修改或关闭，除了已登录，
 *   还必须再输入一次当前密码，防止别人借用一台没锁屏的已登录浏览器改密码。
 * - 校验当前密码的失败次数与登录共用限流，避免被拿来暴力猜密码。
 * - 成功设置 / 修改后立即下发新的登录 Cookie（签名密钥已更换，旧登录态全部失效），当前用户不会被踢出。
 */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const unknown = Object.keys(body).filter((k) => !["action", "current", "password"].includes(k));
  if (unknown.length > 0) throw new AppError(400, "UNKNOWN_FIELD", `请求包含不支持的字段：${unknown.slice(0, 5).join("、")}`);

  const action = body.action;
  if (action !== "set" && action !== "change" && action !== "remove") {
    throw new AppError(400, "INVALID_ACTION", "action 只能是 set、change 或 remove");
  }
  const source = authSource();
  if (source === "env") {
    throw new AppError(409, "PASSWORD_MANAGED_BY_ENV", "访问密码由环境变量 APP_PASSWORD 控制，请在部署配置里修改，页面无法覆盖。");
  }

  if (action === "set") {
    if (source === "page") throw new AppError(409, "ALREADY_ENABLED", "访问保护已启用，请使用“修改密码”。");
    savePagePassword(validateNewPassword(body.password));
    const res = json({ auth: authState() });
    res.cookies.set(SESSION_COOKIE, createSessionToken(), sessionCookieOptions());
    return res;
  }

  if (source !== "page") throw new AppError(409, "NOT_ENABLED", "访问保护尚未启用。");

  // 再次确认当前密码。注意不能返回 401：前端遇到 401 会当作“登录过期”跳去登录页
  const ip = `pw:${req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local"}`;
  if (loginBlocked(ip)) throw new AppError(429, "TOO_MANY_ATTEMPTS", "密码错误次数过多，请 10 分钟后再试");
  const current = typeof body.current === "string" ? body.current : "";
  if (!passwordMatches(current)) {
    recordLoginFailure(ip);
    throw new AppError(403, "INVALID_CURRENT_PASSWORD", "当前密码不正确");
  }
  clearLoginFailures(ip);

  if (action === "change") {
    savePagePassword(validateNewPassword(body.password));
    const res = json({ auth: authState() });
    res.cookies.set(SESSION_COOKIE, createSessionToken(), sessionCookieOptions());
    return res;
  }

  clearPagePassword();
  const res = json({ auth: authState() });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
});
