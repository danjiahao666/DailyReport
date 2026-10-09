import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { call } from "./helpers";
import { GET as getState } from "@/app/api/settings/llm/route";
import { PUT as putProvider } from "@/app/api/settings/llm/provider/route";
import { DELETE as delProvider } from "@/app/api/settings/llm/provider/[id]/route";
import { PUT as putKey } from "@/app/api/settings/llm/key/route";
import { PUT as putDefault } from "@/app/api/settings/llm/default/route";
import { POST as postTest } from "@/app/api/settings/llm/test/route";
import { POST as login } from "@/app/api/auth/login/route";
import { generateText, resetLlmRuntime, setLlmBackendForTests } from "@/server/llm/client";

/** 设置页的后端：读写 pi 配置文件、密钥不外泄、权限、校验、连通性测试 */

type Mode = "ok" | "401" | "empty";
let mode: Mode = "ok";
let seenAuth: string[] = [];
let server: Server;
let baseUrl = "";
let dir = "";
let cookie = "";
const SECRET = "secret-key-123456";

function handler(req: IncomingMessage, res: ServerResponse) {
  seenAuth.push(String(req.headers.authorization ?? ""));
  req.resume();
  req.on("end", () => {
    if (mode === "401") return void res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "Unauthorized" } }));
    res.writeHead(200, { "content-type": "text/event-stream" });
    const chunk = (delta: object, finish: string | null, extra: object = {}) =>
      `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", created: 1, model: "m1", choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`;
    res.write(chunk({ role: "assistant", content: mode === "empty" ? "" : "ok" }, null));
    res.write(chunk({}, "stop", { usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    res.end("data: [DONE]\n\n");
  });
}

const file = (n: string) => path.join(dir, n);
const readJson = (n: string) => JSON.parse(readFileSync(file(n), "utf-8"));
const S = (method: string, url: string, body?: unknown, handlerFn: unknown = getState, params?: Record<string, string>) =>
  call(handlerFn, method, url, body, params, cookie ? { cookie } : {});

const provider = (over: Record<string, unknown> = {}) => ({
  id: "gw",
  name: "网关",
  baseUrl,
  api: "openai-completions",
  models: [{ id: "m1", name: "M1", maxTokens: 2000 }],
  apiKey: SECRET,
  ...over,
});

beforeAll(async () => {
  server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  dir = mkdtempSync(path.join(os.tmpdir(), "daily-report-settings-"));
  process.env.PI_CODING_AGENT_DIR = dir;
  process.env.APP_PASSWORD = "pw-for-tests";
  process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "daily-report-settings-data-"));
  const res = await call(login, "POST", "/api/auth/login", { password: "pw-for-tests" });
  cookie = res.res.headers.get("set-cookie")!.split(";")[0];
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.APP_PASSWORD;
  delete process.env.PI_CODING_AGENT_DIR;
});
beforeEach(() => {
  for (const n of ["models.json", "auth.json", "settings.json"]) rmSync(file(n), { force: true });
  setLlmBackendForTests(undefined);
  resetLlmRuntime();
});
afterEach(() => {
  mode = "ok";
  seenAuth = [];
  delete process.env.LLM_PROVIDER;
  delete process.env.LLM_MODEL;
  delete process.env.OPENAI_API_KEY;
});

describe("权限", () => {
  it("未设置 APP_PASSWORD 时设置页只读，不能修改", async () => {
    const saved = process.env.APP_PASSWORD;
    delete process.env.APP_PASSWORD;
    try {
      const state = await call(getState, "GET", "/api/settings/llm");
      expect(state.status).toBe(200);
      expect(state.body.canEdit).toBe(false);
      expect(state.body.readonlyReason).toContain("APP_PASSWORD");
      for (const [h, m, b] of [
        [putProvider, "PUT", provider()],
        [putKey, "PUT", { provider: "openai", key: "sk-x" }],
        [putDefault, "PUT", { provider: null }],
      ] as const) {
        const r = await call(h, m, "/x", b);
        expect(r.status).toBe(403);
        expect(r.body.error.code).toBe("SETTINGS_READONLY");
      }
      expect(existsSync(file("models.json"))).toBe(false);
    } finally {
      process.env.APP_PASSWORD = saved;
    }
  });

  it("设置了 APP_PASSWORD 后未登录不能访问", async () => {
    expect((await call(getState, "GET", "/api/settings/llm")).status).toBe(401);
  });
});

describe("自定义 provider", () => {
  it("新增后写入 models.json（不含密钥）与 auth.json，接口永不返回密钥", async () => {
    const r = await S("PUT", "/x", provider(), putProvider);
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toContain(SECRET);

    const models = readJson("models.json");
    expect(models.providers.gw).toMatchObject({ name: "网关", baseUrl, api: "openai-completions" });
    expect(models.providers.gw.models).toEqual([{ id: "m1", name: "M1", maxTokens: 2000 }]);
    expect(JSON.stringify(models)).not.toContain(SECRET);
    expect(readJson("auth.json").gw).toEqual({ type: "api_key", key: SECRET });

    const state = (await S("GET", "/x")).body;
    expect(JSON.stringify(state)).not.toContain(SECRET);
    expect(state.canEdit).toBe(true);
    const gw = state.customProviders.find((p: { id: string }) => p.id === "gw");
    expect(gw.key).toMatchObject({ configured: true, storedInAuthJson: true, credentialType: "api_key" });
    expect(state.selectable.find((p: { id: string }) => p.id === "gw").models[0].id).toBe("m1");
  });

  it("修改时保留文件中页面不认识的字段与其它 provider；apiKey 留空不改密钥", async () => {
    writeFileSync(
      file("models.json"),
      JSON.stringify({
        $schema: "https://example.com/schema.json",
        providers: {
          other: {
            baseUrl: "http://10.0.0.5:5000",
            api: "anthropic-messages",
            headers: { "X-Team": "a" },
            compat: { supportsDeveloperRole: false },
            models: [{ id: "o1", thinkingLevelMap: { high: "high" }, input: ["text", "image"] }],
          },
        },
      }),
    );
    await S("PUT", "/x", provider(), putProvider);
    // 修改 other：只改地址和模型显示名
    const r = await S(
      "PUT",
      "/x",
      { id: "other", baseUrl: "http://10.0.0.6:5000", api: "anthropic-messages", models: [{ id: "o1", name: "O1" }] },
      putProvider,
    );
    expect(r.status).toBe(200);
    const models = readJson("models.json");
    expect(models.$schema).toBe("https://example.com/schema.json");
    expect(models.providers.gw.baseUrl).toBe(baseUrl);
    expect(models.providers.other).toMatchObject({
      baseUrl: "http://10.0.0.6:5000",
      headers: { "X-Team": "a" },
      compat: { supportsDeveloperRole: false },
    });
    expect(models.providers.other.models[0]).toEqual({ id: "o1", name: "O1", thinkingLevelMap: { high: "high" }, input: ["text", "image"] });
    // 未提供 apiKey：gw 的密钥不变
    await S("PUT", "/x", provider({ apiKey: undefined, name: "新名字" }), putProvider);
    expect(readJson("auth.json").gw.key).toBe(SECRET);
    expect(readJson("models.json").providers.gw.name).toBe("新名字");
  });

  it.each([
    ["非法标识", { id: "bad id" }],
    ["标识以符号开头", { id: "-x" }],
    ["与内置 provider 同名", { id: "openai" }],
    ["不支持的协议", { api: "foo" }],
    ["非 http 地址", { baseUrl: "ftp://x/v1" }],
    ["不是 URL", { baseUrl: "not a url" }],
    ["地址含账号密码", { baseUrl: "http://u:p@h.example/v1" }],
    ["云元数据地址", { baseUrl: "http://169.254.169.254/v1" }],
    ["没有模型", { models: [] }],
    ["模型 ID 重复", { models: [{ id: "a" }, { id: "a" }] }],
    ["maxTokens 非法", { models: [{ id: "a", maxTokens: 0 }] }],
    ["密钥含空白", { apiKey: "a b" }],
    ["命令型密钥", { apiKey: "!echo hi" }],
  ] as const)("拒绝非法输入：%s", async (_name, over) => {
    const r = await S("PUT", "/x", provider(over), putProvider);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("INVALID_INPUT");
    expect(existsSync(file("models.json"))).toBe(false);
    expect(existsSync(file("auth.json"))).toBe(false);
  });

  it("删除 provider：同时清除其密钥与指向它的默认模型，不影响其它配置", async () => {
    await S("PUT", "/x", provider(), putProvider);
    await S("PUT", "/x", provider({ id: "gw2", apiKey: "k2" }), putProvider);
    await S("PUT", "/x", { provider: "gw", model: "m1" }, putDefault);
    writeFileSync(file("settings.json"), JSON.stringify({ ...readJson("settings.json"), theme: "dark" }));

    const r = await S("DELETE", "/x", undefined, delProvider, { id: "gw" });
    expect(r.status).toBe(200);
    expect(readJson("models.json").providers.gw).toBeUndefined();
    expect(readJson("models.json").providers.gw2).toBeDefined();
    expect(readJson("auth.json")).toEqual({ gw2: { type: "api_key", key: "k2" } });
    expect(readJson("settings.json")).toEqual({ theme: "dark" });
    expect((await S("DELETE", "/x", undefined, delProvider, { id: "gw" })).status).toBe(404);
  });
});

describe("内置 provider 密钥", () => {
  it("设置与清除；环境变量来源的密钥只显示来源", async () => {
    let state = (await S("GET", "/x")).body;
    expect(state.builtinProviders.find((p: { id: string }) => p.id === "openai").key.configured).toBe(false);

    const set = await S("PUT", "/x", { provider: "openai", key: "sk-test-openai" }, putKey);
    expect(set.status).toBe(200);
    expect(JSON.stringify(set.body)).not.toContain("sk-test-openai");
    expect(readJson("auth.json").openai).toEqual({ type: "api_key", key: "sk-test-openai" });
    state = set.body;
    expect(state.builtinProviders.find((p: { id: string }) => p.id === "openai").key).toMatchObject({ configured: true, storedInAuthJson: true });

    const cleared = await S("PUT", "/x", { provider: "openai", key: null }, putKey);
    expect(readJson("auth.json").openai).toBeUndefined();
    expect(cleared.body.builtinProviders.find((p: { id: string }) => p.id === "openai").key.configured).toBe(false);

    process.env.OPENAI_API_KEY = "sk-from-env-9999";
    const envState = (await S("GET", "/x")).body;
    const key = envState.builtinProviders.find((p: { id: string }) => p.id === "openai").key;
    expect(key).toMatchObject({ configured: true, source: "OPENAI_API_KEY", storedInAuthJson: false });
    expect(JSON.stringify(envState)).not.toContain("sk-from-env-9999");
  });

  it("不能覆盖 OAuth 凭据；未知 provider 404；空密钥 400", async () => {
    writeFileSync(file("auth.json"), JSON.stringify({ anthropic: { type: "oauth", access: "a", refresh: "r", expires: 1 } }));
    const oauth = await S("PUT", "/x", { provider: "anthropic", key: "sk-ant-x" }, putKey);
    expect(oauth.status).toBe(409);
    expect(oauth.body.error.code).toBe("OAUTH_CREDENTIAL");
    expect(readJson("auth.json").anthropic.type).toBe("oauth");
    expect((await S("PUT", "/x", { provider: "nope", key: "k" }, putKey)).status).toBe(404);
    expect((await S("PUT", "/x", { provider: "openai", key: "" }, putKey)).status).toBe(400);
  });
});

describe("默认模型与连通性测试", () => {
  it("设置默认模型后真实调用使用它与保存的密钥（无需重启）", async () => {
    await S("PUT", "/x", provider(), putProvider);
    const r = await S("PUT", "/x", { provider: "gw", model: "m1" }, putDefault);
    expect(r.body).toMatchObject({ defaultProvider: "gw", defaultModel: "m1" });
    expect(readJson("settings.json")).toEqual({ defaultProvider: "gw", defaultModel: "m1" });

    const out = await generateText({ task: "optimize", system: "s", user: "u", maxTokens: 100 });
    expect(out).toEqual({ text: "ok", model: "gw/m1" });
    expect(seenAuth.at(-1)).toBe(`Bearer ${SECRET}`);

    // 换密钥立即生效
    await S("PUT", "/x", { provider: "gw", key: "rotated-key-999" }, putKey);
    await generateText({ task: "optimize", system: "s", user: "u", maxTokens: 100 });
    expect(seenAuth.at(-1)).toBe("Bearer rotated-key-999");

    const cleared = await S("PUT", "/x", { provider: null }, putDefault);
    expect(cleared.body.defaultProvider).toBeNull();
    expect(readJson("settings.json")).toEqual({});
  });

  it("拒绝不存在的默认模型", async () => {
    await S("PUT", "/x", provider(), putProvider);
    const r = await S("PUT", "/x", { provider: "gw", model: "nope" }, putDefault);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("INVALID_DEFAULT");
    expect(existsSync(file("settings.json"))).toBe(false);
  });

  it("环境变量覆盖时给出提示", async () => {
    process.env.LLM_MODEL = "x";
    expect((await S("GET", "/x")).body.envOverride).toEqual({ provider: null, model: "x" });
  });

  it("测试连接：成功、凭据被拒、空内容、未保存的模型", async () => {
    await S("PUT", "/x", provider(), putProvider);
    const ok = await S("POST", "/x", { provider: "gw", model: "m1" }, postTest);
    expect(ok.body).toMatchObject({ ok: true, provider: "gw", model: "m1" });
    expect(seenAuth.at(-1)).toBe(`Bearer ${SECRET}`);

    mode = "401";
    const denied = await S("POST", "/x", { provider: "gw", model: "m1" }, postTest);
    expect(denied.status).toBe(503);
    expect(denied.body.error).toMatchObject({ code: "LLM_AUTH", retryable: true });

    mode = "empty";
    expect((await S("POST", "/x", { provider: "gw", model: "m1" }, postTest)).body.error.code).toBe("LLM_EMPTY");

    mode = "ok";
    const missing = await S("POST", "/x", { provider: "gw", model: "ghost" }, postTest);
    expect(missing.body.error.code).toBe("LLM_NO_MODEL");

    // 没有密钥时在发请求前就提示
    await S("PUT", "/x", { provider: "gw", key: null }, putKey);
    seenAuth = [];
    const nokey = await S("POST", "/x", { provider: "gw", model: "m1" }, postTest);
    expect(nokey.body.error.code).toBe("LLM_AUTH");
    expect(seenAuth).toHaveLength(0);
  });

  it("测试连接不受 LLM_PROVIDER / LLM_MODEL 影响", async () => {
    await S("PUT", "/x", provider(), putProvider);
    process.env.LLM_PROVIDER = "other";
    process.env.LLM_MODEL = "other-model";
    expect((await S("POST", "/x", { provider: "gw", model: "m1" }, postTest)).body.ok).toBe(true);
  });
});

describe("配置文件损坏", () => {
  it("models.json 不是合法 JSON：页面提示错误，拒绝修改且不覆盖原文件", async () => {
    writeFileSync(file("models.json"), "{ // 我的注释\n \"providers\": {} }");
    const state = (await S("GET", "/x")).body;
    expect(state.configError).toContain("models.json");
    expect(state.customProviders).toEqual([]);

    const r = await S("PUT", "/x", provider(), putProvider);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("CONFIG_INVALID");
    expect(readFileSync(file("models.json"), "utf-8")).toContain("我的注释");
  });

  it("auth.json 损坏时同样拒绝写入密钥", async () => {
    writeFileSync(file("auth.json"), "[]");
    const r = await S("PUT", "/x", { provider: "openai", key: "sk-x" }, putKey);
    expect(r.status).toBe(409);
    expect(readFileSync(file("auth.json"), "utf-8")).toBe("[]");
  });
});
