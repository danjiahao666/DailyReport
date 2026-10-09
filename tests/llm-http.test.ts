import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { generateText, resetLlmRuntime, setLlmBackendForTests } from "@/server/llm/client";
import { resolveConfigValue } from "@/server/llm/config-value";
import { FileCredentialStore } from "@/server/llm/credentials";
import { classifyUpstreamFailure } from "@/server/llm/errors";

/**
 * 走真实的 pi-ai 调用链：models.json（自定义端点）+ auth.json / 环境变量 + openai-completions，
 * 对端是本地的假 OpenAI 兼容服务，用来验证配置约定与各类失败场景。
 */

type Mode = "ok" | "empty" | "500" | "401" | "429" | "hang" | "length";
let mode: Mode = "ok";
let seenAuth: string[] = [];
let server: Server;
let baseUrl = "";
const dirs: string[] = [];

function sse(res: ServerResponse, text: string, finish: "stop" | "length") {
  res.writeHead(200, { "content-type": "text/event-stream" });
  const chunk = (delta: object, finish_reason: string | null, extra: object = {}) =>
    `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 1, model: "fake-1", choices: [{ index: 0, delta, finish_reason }], ...extra })}\n\n`;
  if (text) res.write(chunk({ role: "assistant", content: text }, null));
  else res.write(chunk({ role: "assistant" }, null));
  res.write(chunk({}, finish, { usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } }));
  res.end("data: [DONE]\n\n");
}

function handler(req: IncomingMessage, res: ServerResponse) {
  seenAuth.push(String(req.headers.authorization ?? ""));
  req.resume();
  req.on("end", () => {
    if (mode === "hang") return; // 不响应，等待客户端超时
    if (mode === "500") return void res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "boom internal 10.1.2.3" } }));
    if (mode === "401") return void res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "Unauthorized" } }));
    if (mode === "429") return void res.writeHead(429, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "rate limit" } }));
    if (mode === "empty") return sse(res, "", "stop");
    if (mode === "length") return sse(res, "半截内容", "length");
    sse(res, "这是模型的回复", "stop");
  });
}

function makeConfigDir(opts: { auth?: object; apiKey?: string } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "daily-report-cfg-"));
  dirs.push(dir);
  writeFileSync(
    path.join(dir, "models.json"),
    JSON.stringify({
      providers: {
        fake: {
          name: "Fake",
          baseUrl,
          api: "openai-completions",
          apiKey: opts.apiKey ?? "$FAKE_KEY",
          models: [{ id: "fake-1", maxTokens: 2000, contextWindow: 32000 }],
        },
      },
    }),
  );
  writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ defaultProvider: "fake", defaultModel: "fake-1" }));
  if (opts.auth) writeFileSync(path.join(dir, "auth.json"), JSON.stringify(opts.auth));
  return dir;
}

function use(dir: string) {
  process.env.PI_CODING_AGENT_DIR = dir;
  setLlmBackendForTests(undefined);
  resetLlmRuntime();
}

const ask = () => generateText({ task: "optimize", system: "sys", user: "hello", maxTokens: 500 });

beforeAll(async () => {
  server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
afterEach(() => {
  mode = "ok";
  seenAuth = [];
  delete process.env.FAKE_KEY;
  delete process.env.LLM_TIMEOUT_MS;
  delete process.env.LLM_PROVIDER;
  delete process.env.LLM_MODEL;
});

describe("models.json / settings.json / 环境变量（沿用 pi 约定）", () => {
  it("使用 models.json 的 $ENV 密钥调用自定义端点", async () => {
    process.env.FAKE_KEY = "key-from-env";
    use(makeConfigDir());
    const r = await ask();
    expect(r.text).toBe("这是模型的回复");
    expect(r.model).toBe("fake/fake-1");
    expect(seenAuth[0]).toBe("Bearer key-from-env");
  });

  it("auth.json 中的凭据优先于 models.json 的 apiKey", async () => {
    process.env.FAKE_KEY = "key-from-env";
    use(makeConfigDir({ auth: { fake: { type: "api_key", key: "key-from-auth-json" } } }));
    await ask();
    expect(seenAuth[0]).toBe("Bearer key-from-auth-json");
  });

  it("auth.json 的 key 支持 $ENV 引用", async () => {
    process.env.FAKE_KEY = "ref-value";
    use(makeConfigDir({ apiKey: "unused-literal", auth: { fake: { type: "api_key", key: "$FAKE_KEY" } } }));
    await ask();
    expect(seenAuth[0]).toBe("Bearer ref-value");
  });

  it("LLM_PROVIDER / LLM_MODEL 覆盖默认模型；找不到时给出明确提示", async () => {
    process.env.FAKE_KEY = "k";
    use(makeConfigDir());
    process.env.LLM_PROVIDER = "fake";
    process.env.LLM_MODEL = "not-exist";
    await expect(ask()).rejects.toMatchObject({ code: "LLM_NO_MODEL", message: expect.stringContaining("not-exist") });
  });

  it("配置文件损坏时给出明确提示而不是 500", async () => {
    const dir = makeConfigDir();
    writeFileSync(path.join(dir, "models.json"), "{ not json");
    use(dir);
    await expect(ask()).rejects.toMatchObject({ code: "LLM_NO_MODEL", message: expect.stringContaining("配置加载失败") });
  });
});

describe("失败场景：均有明确错误且可重试", () => {
  it("未配置密钥", async () => {
    use(makeConfigDir());
    await expect(ask()).rejects.toMatchObject({ code: "LLM_AUTH", message: expect.stringContaining("尚未配置凭据") });
    expect(seenAuth).toHaveLength(0); // 未发出请求
  });

  it.each([
    ["401", "LLM_AUTH"],
    ["429", "LLM_RATE_LIMITED"],
    ["500", "LLM_UPSTREAM"],
    ["empty", "LLM_EMPTY"],
    ["length", "LLM_TRUNCATED"],
  ] as const)("上游 %s → %s", async (m, code) => {
    process.env.FAKE_KEY = "k";
    use(makeConfigDir());
    mode = m;
    const err = await ask().catch((e) => e);
    expect(err.code).toBe(code);
    expect(err.extra.retryable).toBe(true);
    expect(err.message).not.toMatch(/10\.1\.2\.3|127\.0\.0\.1/);
  });

  it("超时", async () => {
    process.env.FAKE_KEY = "k";
    process.env.LLM_TIMEOUT_MS = "1000";
    use(makeConfigDir());
    mode = "hang";
    const started = Date.now();
    await expect(ask()).rejects.toMatchObject({ code: "LLM_TIMEOUT" });
    expect(Date.now() - started).toBeLessThan(8000);
  });

  it("失败后恢复即可重试成功", async () => {
    process.env.FAKE_KEY = "k";
    use(makeConfigDir());
    mode = "empty";
    await expect(ask()).rejects.toMatchObject({ code: "LLM_EMPTY" });
    mode = "ok";
    expect((await ask()).text).toBe("这是模型的回复");
  });
});

describe("辅助函数", () => {
  it("配置值解析", () => {
    expect(resolveConfigValue("plain", {})).toBe("plain");
    expect(resolveConfigValue("$A-${B}", { A: "1", B: "2" })).toBe("1-2");
    expect(resolveConfigValue("$$A", { A: "1" })).toBe("$A");
    expect(resolveConfigValue("$MISSING", {})).toBeUndefined();
    expect(() => resolveConfigValue("!echo hi", {})).toThrow();
  });

  it("上游错误归类", () => {
    expect(classifyUpstreamFailure("HTTP 401 Unauthorized")).toBe("AUTH");
    expect(classifyUpstreamFailure("429 Too Many Requests")).toBe("RATE_LIMITED");
    expect(classifyUpstreamFailure("ETIMEDOUT")).toBe("TIMEOUT");
    expect(classifyUpstreamFailure("kaboom")).toBe("UPSTREAM");
  });

  it("FileCredentialStore 不会把解析后的明文密钥写回文件", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "daily-report-cred-"));
    dirs.push(dir);
    const file = path.join(dir, "auth.json");
    writeFileSync(file, JSON.stringify({ p: { type: "api_key", key: "$CRED_ENV" } }));
    process.env.CRED_ENV = "plain-secret";
    const store = new FileCredentialStore(file);
    expect((await store.read("p"))?.type).toBe("api_key");
    await store.modify("p", async (c) => c);
    expect(JSON.parse(readFileSync(file, "utf-8")).p.key).toBe("$CRED_ENV");
    expect(await store.list()).toEqual([{ providerId: "p", type: "api_key" }]);
    delete process.env.CRED_ENV;
  });
});
