import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { call, setupTestEnv } from "./helpers";
import { POST as passwordRoute } from "@/app/api/settings/password/route";
import { GET as getCenter } from "@/app/api/settings/center/route";
import { GET as calendar } from "@/app/api/calendar/route";
import { POST as login } from "@/app/api/auth/login/route";
import { getDb } from "@/server/db";

/** 设置中心里的访问密码：启用、修改、关闭、与环境变量的优先级、登录态失效、不泄露 */

const env = setupTestEnv();
afterAll(() => env.cleanup());

const PW = "correct horse 1";
const post = (body: unknown, cookie?: string) => call(passwordRoute, "POST", "/api/settings/password", body, undefined, cookie ? { cookie } : {});
const cal = (cookie?: string) => call(calendar, "GET", "/api/calendar?month=2026-10", undefined, undefined, cookie ? { cookie } : {});
const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0];

beforeEach(async () => {
  delete process.env.APP_PASSWORD;
  delete process.env.SESSION_SECRET;
  // 每个用例从「未启用」开始：清掉页面设置的密码
  getDb().prepare("DELETE FROM settings WHERE key IN ('auth_password_hash','auth_session_secret')").run();
});

describe("访问密码（设置中心）", () => {
  it("未启用时可直接设置，设置后立即下发登录态，之后未登录的请求被拒绝", async () => {
    expect((await cal()).status).toBe(200);
    const r = await post({ action: "set", password: PW });
    expect(r.status).toBe(200);
    expect(r.body.auth).toEqual({ enabled: true, managedBy: "page" });
    const cookie = cookieOf(r.res);
    expect(r.res.headers.get("set-cookie")).toMatch(/HttpOnly/i);

    expect((await cal()).status).toBe(401);
    expect((await cal(cookie)).status).toBe(200);
    // 设置中心状态里只有「是否启用 / 由谁控制」，没有密码或摘要
    const state = await call(getCenter, "GET", "/api/settings/center", undefined, undefined, { cookie });
    expect(state.body.auth).toEqual({ enabled: true, managedBy: "page" });
    expect(JSON.stringify(state.body)).not.toContain(PW);
    expect(JSON.stringify(state.body)).not.toContain("scrypt");
  });

  it("库里只存加盐摘要，不存明文；用新密码可以登录，错误密码不行", async () => {
    await post({ action: "set", password: PW });
    const rows = getDb().prepare("SELECT key, value FROM settings WHERE key LIKE 'auth_%'").all() as { key: string; value: string }[];
    expect(rows.map((r) => r.key).sort()).toEqual(["auth_password_hash", "auth_session_secret"]);
    for (const r of rows) expect(r.value).not.toContain(PW);
    expect(rows.find((r) => r.key === "auth_password_hash")!.value).toMatch(/^scrypt\$[0-9a-f]+\$[0-9a-f]+$/);

    expect((await call(login, "POST", "/api/auth/login", { password: "wrong" })).status).toBe(401);
    const ok = await call(login, "POST", "/api/auth/login", { password: PW });
    expect(ok.status).toBe(200);
    expect((await cal(cookieOf(ok.res))).status).toBe(200);
  });

  it("校验新密码的长度与类型", async () => {
    for (const bad of ["short", "x".repeat(129), "        ", 12345678, undefined]) {
      const r = await post({ action: "set", password: bad });
      expect(r.status, String(bad)).toBe(400);
      expect(r.body.error.code).toBe("INVALID_PASSWORD_FORMAT");
    }
    // 按字符数计算：8 个汉字合法
    expect((await post({ action: "set", password: "一二三四五六七八" })).status).toBe(200);
  });

  it("已启用后不能再 set；修改与关闭必须提供正确的当前密码", async () => {
    const first = await post({ action: "set", password: PW });
    const cookie = cookieOf(first.res);
    expect((await post({ action: "set", password: "another-pass-1" }, cookie)).body.error.code).toBe("ALREADY_ENABLED");

    // 当前密码错误：用 403 而不是 401（前端遇到 401 会跳转登录页）
    const wrong = await post({ action: "change", current: "nope", password: "new-pass-1234" }, cookie);
    expect(wrong.status).toBe(403);
    expect(wrong.body.error.code).toBe("INVALID_CURRENT_PASSWORD");
    expect((await post({ action: "remove" }, cookie)).status).toBe(403);
    // 仍然是启用状态
    expect((await cal()).status).toBe(401);
  });

  it("修改密码：旧密码与旧登录态立即失效，新登录态可用", async () => {
    const first = await post({ action: "set", password: PW });
    const oldCookie = cookieOf(first.res);
    const changed = await post({ action: "change", current: PW, password: "new-pass-1234" }, oldCookie);
    expect(changed.status).toBe(200);
    const newCookie = cookieOf(changed.res);

    expect((await cal(oldCookie)).status).toBe(401);
    expect((await cal(newCookie)).status).toBe(200);
    expect((await call(login, "POST", "/api/auth/login", { password: PW })).status).toBe(401);
    expect((await call(login, "POST", "/api/auth/login", { password: "new-pass-1234" })).status).toBe(200);
  });

  it("关闭访问保护后恢复开放，并清掉库里的记录", async () => {
    const first = await post({ action: "set", password: PW });
    const r = await post({ action: "remove", current: PW }, cookieOf(first.res));
    expect(r.status).toBe(200);
    expect(r.body.auth).toEqual({ enabled: false, managedBy: null });
    expect((await cal()).status).toBe(200);
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'auth_%'").get()).toEqual({ n: 0 });
    // 未启用时修改 / 关闭没有意义
    expect((await post({ action: "remove", current: PW })).body.error.code).toBe("NOT_ENABLED");
  });

  it("环境变量 APP_PASSWORD 优先：页面无权覆盖，状态显示由环境变量控制", async () => {
    process.env.APP_PASSWORD = "env-secret-pass";
    const login1 = await call(login, "POST", "/api/auth/login", { password: "env-secret-pass" });
    const cookie = cookieOf(login1.res);
    for (const body of [{ action: "set", password: PW }, { action: "change", current: "env-secret-pass", password: PW }, { action: "remove", current: "env-secret-pass" }]) {
      const r = await post(body, cookie);
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe("PASSWORD_MANAGED_BY_ENV");
    }
    const state = await call(getCenter, "GET", "/api/settings/center", undefined, undefined, { cookie });
    expect(state.body.auth).toEqual({ enabled: true, managedBy: "env" });
    // 环境变量的行为不变：仍可用环境变量密码登录
    expect((await cal(cookie)).status).toBe(200);
  });

  it("参数校验：未知字段与非法 action", async () => {
    expect((await post({ action: "boom" })).body.error.code).toBe("INVALID_ACTION");
    expect((await post({ action: "set", password: PW, extra: 1 })).body.error.code).toBe("UNKNOWN_FIELD");
  });

  it("连续输错当前密码会被限流", async () => {
    const first = await post({ action: "set", password: PW });
    const cookie = cookieOf(first.res);
    let last = 0;
    for (let i = 0; i < 9; i++) last = (await post({ action: "remove", current: `bad-${i}` }, cookie)).status;
    expect(last).toBe(429);
    // 限流期间连正确密码也不接受，避免被用来暴力猜解
    expect((await post({ action: "remove", current: PW }, cookie)).status).toBe(429);
  });
});
