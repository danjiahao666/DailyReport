import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { call } from "./helpers";
import { POST as listModels } from "@/app/api/settings/llm/models/route";
import { PUT as putProvider } from "@/app/api/settings/llm/provider/route";
import { POST as login } from "@/app/api/auth/login/route";
import { resetLlmRuntime, setLlmBackendForTests } from "@/server/llm/client";

/** 获取供应商模型列表：各协议的解析、鉴权头、失败场景，以及密钥不外泄 */

interface Seen {
  url: string;
  headers: IncomingMessage["headers"];
}
let seen: Seen[] = [];
let server: Server;
let origin = "";
let dir = "";
let cookie = "";
const SECRET = "secret-key-123456";

function handler(req: IncomingMessage, res: ServerResponse) {
  seen.push({ url: req.url ?? "", headers: req.headers });
  const url = new URL(req.url ?? "/", "http://x");
  const send = (status: number, body: unknown, extra: Record<string, string> = {}) => {
    res.writeHead(status, { "content-type": "application/json", ...extra });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };
  switch (url.pathname) {
    case "/openai/v1/models":
      return send(200, {
        object: "list",
        data: [
          { id: "zeta-model" },
          { id: "alpha-model", context_length: 131072, top_provider: { max_completion_tokens: 8192 } },
          { id: "alpha-model" }, // 重复项应被去重
          { id: "" }, // 非法项应被忽略
          { nope: 1 },
        ],
      });
    case "/anthropic/v1/models":
      return send(200, { data: [{ id: "claude-x", display_name: "Claude X", max_input_tokens: 200000, max_tokens: 64000 }], has_more: false });
    case "/google/v1beta/models":
      return send(200, {
        models: [
          { name: "models/gemini-a", displayName: "Gemini A", inputTokenLimit: 1048576, outputTokenLimit: 65536, supportedGenerationMethods: ["generateContent"] },
          { name: "models/embed-a", supportedGenerationMethods: ["embedContent"] },
        ],
      });
    case "/array/v1/models":
      return send(200, [{ id: "m-from-array" }]);
    case "/unauth/v1/models":
      return send(401, { error: { message: `bad key ${SECRET}` } });
    case "/forbidden/v1/models":
      return send(403, {});
    case "/boom/v1/models":
      return send(500, "internal details: stack trace");
    case "/redirect/v1/models":
      return send(302, "", { location: `${origin}/openai/v1/models` });
    case "/html/v1/models":
      return send(200, "<html>not json</html>");
    case "/empty/v1/models":
      return send(200, { data: [] });
    case "/big/v1/models": {
      res.writeHead(200, { "content-type": "application/json" });
      res.write('{"data":[');
      const chunk = `{"id":"${"x".repeat(1000)}"},`.repeat(1000);
      for (let i = 0; i < 4; i++) res.write(chunk);
      return res.end("]}");
    }
    default:
      return send(404, { error: "not found" });
  }
}

const L = (body: unknown, withCookie = true) => call(listModels, "POST", "/api/settings/llm/models", body, undefined, withCookie && cookie ? { cookie } : {});
const body = (p: string, over: Record<string, unknown> = {}) => ({ baseUrl: `${origin}${p}`, api: "openai-completions", apiKey: SECRET, ...over });

beforeAll(async () => {
  server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  dir = mkdtempSync(path.join(os.tmpdir(), "daily-report-modellist-"));
  process.env.PI_CODING_AGENT_DIR = dir;
  process.env.APP_PASSWORD = "pw-for-tests";
  process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "daily-report-modellist-data-"));
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
  seen = [];
  for (const n of ["models.json", "auth.json", "settings.json"]) rmSync(path.join(dir, n), { force: true });
  setLlmBackendForTests(undefined);
  resetLlmRuntime();
});

describe("获取模型列表：解析", () => {
  it("OpenAI 兼容：带 Bearer 密钥，按 id 排序、去重、忽略非法项，并带出上下文与最大输出", async () => {
    const r = await L(body("/openai/v1"));
    expect(r.status).toBe(200);
    expect(r.body.models).toEqual([
      { id: "alpha-model", contextWindow: 131072, maxTokens: 8192 },
      { id: "zeta-model" },
    ]);
    expect(seen[0].url).toBe("/openai/v1/models");
    expect(seen[0].headers.authorization).toBe(`Bearer ${SECRET}`);
  });

  it("接口地址末尾带斜杠、返回顶层数组的网关也能处理", async () => {
    const r = await L(body("/array/v1/"));
    expect(r.body.models).toEqual([{ id: "m-from-array" }]);
    expect(seen[0].url).toBe("/array/v1/models");
  });

  it("没有密钥时不发送 Authorization（本地 Ollama / vLLM）", async () => {
    const r = await L({ baseUrl: `${origin}/openai/v1`, api: "openai-completions" });
    expect(r.status).toBe(200);
    expect(seen[0].headers.authorization).toBeUndefined();
  });

  it("Anthropic：用 x-api-key 与版本头，名称取 display_name", async () => {
    const r = await L(body("/anthropic/v1", { api: "anthropic-messages" }));
    expect(r.body.models).toEqual([{ id: "claude-x", name: "Claude X", contextWindow: 200000, maxTokens: 64000 }]);
    expect(seen[0].headers["x-api-key"]).toBe(SECRET);
    expect(seen[0].headers["anthropic-version"]).toBeTruthy();
    expect(seen[0].headers.authorization).toBeUndefined();
  });

  it("Anthropic：接口地址不带 /v1 时自动补上（网关根路径的 /models 是前端页面）", async () => {
    const r = await L(body("/anthropic", { api: "anthropic-messages" }));
    expect(r.status).toBe(200);
    expect(r.body.models).toEqual([{ id: "claude-x", name: "Claude X", contextWindow: 200000, maxTokens: 64000 }]);
    expect(seen[0].url).toBe("/anthropic/v1/models?limit=1000");
  });

  it("Gemini：密钥走请求头而不是 URL，去掉 models/ 前缀并过滤掉不能生成文本的模型", async () => {
    const r = await L(body("/google/v1beta", { api: "google-generative-ai" }));
    expect(r.body.models).toEqual([{ id: "gemini-a", name: "Gemini A", contextWindow: 1048576, maxTokens: 65536 }]);
    expect(seen[0].headers["x-goog-api-key"]).toBe(SECRET);
    expect(seen[0].url).not.toContain(SECRET);
  });

  it("Azure 等没有统一列表接口的协议给出明确提示，且不发起请求", async () => {
    const r = await L(body("/openai/v1", { api: "azure-openai-responses" }));
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("MODEL_LIST_UNSUPPORTED");
    expect(seen).toHaveLength(0);
  });
});

describe("获取模型列表：失败场景", () => {
  it("密钥无效：给出中文提示，且不回传上游正文（正文里带着密钥）", async () => {
    for (const p of ["/unauth/v1", "/forbidden/v1"]) {
      const r = await L(body(p));
      expect(r.status).toBe(502);
      expect(r.body.error.code).toBe("MODEL_LIST_FAILED");
      expect(r.body.error.message).toContain("密钥");
      expect(JSON.stringify(r.body)).not.toContain(SECRET);
    }
  });

  it("404、5xx、非 JSON、空列表各有明确提示，且不泄露上游细节", async () => {
    expect((await L(body("/nowhere/v1"))).body.error.message).toContain("/models");
    const boom = await L(body("/boom/v1"));
    expect(boom.body.error.message).toContain("500");
    expect(JSON.stringify(boom.body)).not.toContain("stack trace");
    expect((await L(body("/html/v1"))).body.error.message).toContain("不是 JSON");
    expect((await L(body("/empty/v1"))).body.error.message).toContain("没有返回任何");
  });

  it("不跟随重定向：只请求一次，避免把密钥带到未确认的地址", async () => {
    const r = await L(body("/redirect/v1"));
    expect(r.status).toBe(502);
    expect(r.body.error.message).toContain("重定向");
    expect(seen).toHaveLength(1);
  });

  it("响应体超过上限时中止", async () => {
    const r = await L(body("/big/v1"));
    expect(r.status).toBe(502);
    expect(r.body.error.message).toContain("过大");
  });

  it("连不上时给出提示", async () => {
    const r = await L({ baseUrl: "http://127.0.0.1:1/v1", api: "openai-completions" });
    expect(r.status).toBe(502);
    expect(r.body.error.message).toContain("无法连接");
  });
});

describe("获取模型列表：权限与校验", () => {
  it("未登录 401；未设置 APP_PASSWORD 时只读 403（会带密钥外发，必须有编辑权限）", async () => {
    expect((await L(body("/openai/v1"), false)).status).toBe(401);
    const saved = process.env.APP_PASSWORD;
    delete process.env.APP_PASSWORD;
    try {
      const r = await L(body("/openai/v1"), false);
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe("SETTINGS_READONLY");
      expect(seen).toHaveLength(0);
    } finally {
      process.env.APP_PASSWORD = saved;
    }
  });

  it("拒绝非法地址、云元数据地址、未知字段，以及引用了不存在环境变量的密钥", async () => {
    expect((await L({ baseUrl: "ftp://x/v1", api: "openai-completions" })).body.error.code).toBe("INVALID_INPUT");
    expect((await L({ baseUrl: "http://169.254.169.254/v1", api: "openai-completions" })).body.error.code).toBe("INVALID_INPUT");
    expect((await L({ baseUrl: `${origin}/openai/v1`, api: "nope" })).body.error.code).toBe("INVALID_INPUT");
    expect((await L({ ...body("/openai/v1"), extra: 1 })).body.error.code).toBe("INVALID_INPUT");
    expect((await L(body("/openai/v1", { apiKey: "$DEFINITELY_NOT_SET_VAR_123" }))).body.error.code).toBe("INVALID_INPUT");
    expect(seen).toHaveLength(0);
  });

  it("新填的 $ENV 引用会被解析后再使用", async () => {
    process.env.MODEL_LIST_TEST_KEY = "from-env-value";
    try {
      await L(body("/openai/v1", { apiKey: "$MODEL_LIST_TEST_KEY" }));
      expect(seen[0].headers.authorization).toBe("Bearer from-env-value");
    } finally {
      delete process.env.MODEL_LIST_TEST_KEY;
    }
  });
});

describe("获取模型列表：编辑已有 provider 时沿用已保存的密钥", () => {
  const save = () =>
    call(putProvider, "PUT", "/x", { id: "gw", baseUrl: `${origin}/openai/v1`, api: "openai-completions", models: [{ id: "m1" }], apiKey: SECRET }, undefined, { cookie });

  it("没填新密钥、地址未变：使用 auth.json 里已保存的密钥", async () => {
    await save();
    const r = await L({ baseUrl: `${origin}/openai/v1`, api: "openai-completions", providerId: "gw" });
    expect(r.status).toBe(200);
    expect(seen.at(-1)!.headers.authorization).toBe(`Bearer ${SECRET}`);
  });

  it("地址已改：绝不把已保存的密钥发往新地址，要求重新填写", async () => {
    await save();
    seen = [];
    const r = await L({ baseUrl: `${origin}/array/v1`, api: "openai-completions", providerId: "gw" });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toContain("重新填写");
    expect(seen).toHaveLength(0);
    // 重新填了密钥就可以
    expect((await L({ baseUrl: `${origin}/array/v1`, api: "openai-completions", providerId: "gw", apiKey: "another-key-1" })).status).toBe(200);
  });

  it("models.json 里直接写 apiKey 的 provider 也能沿用", async () => {
    writeFileSync(
      path.join(dir, "models.json"),
      JSON.stringify({ providers: { legacy: { baseUrl: `${origin}/openai/v1`, api: "openai-completions", apiKey: "literal-key-9", models: [{ id: "m1" }] } } }),
    );
    resetLlmRuntime();
    const r = await L({ baseUrl: `${origin}/openai/v1`, api: "openai-completions", providerId: "legacy" });
    expect(r.status).toBe(200);
    expect(seen.at(-1)!.headers.authorization).toBe("Bearer literal-key-9");
  });
});
