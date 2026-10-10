import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "./helpers";
import { PUT as putProvider } from "@/app/api/settings/llm/provider/route";
import { POST as login } from "@/app/api/auth/login/route";
import { generateText, resetLlmRuntime } from "@/server/llm/client";

/** Anthropic 协议的推理模型：不能向网关发送 thinking: disabled（grok 等上游会 400） */

let server: ReturnType<typeof createServer>;
let origin = "";
let dir = "";
let cookie = "";
let bodies: Record<string, unknown>[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      bodies.push(JSON.parse(b));
      // 只关心请求体，回一个 400 让调用尽快结束
      res.writeHead(400, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  dir = mkdtempSync(path.join(os.tmpdir(), "daily-report-thinking-"));
  process.env.PI_CODING_AGENT_DIR = dir;
  process.env.APP_PASSWORD = "pw-for-tests";
  process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "daily-report-thinking-data-"));
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

async function requestBody(api: string, reasoning: boolean): Promise<Record<string, unknown>> {
  bodies = [];
  await call(putProvider, "PUT", "/x", { id: "gw", baseUrl: origin, api, models: [{ id: "m1", reasoning }], apiKey: "dummy-key-1234" }, undefined, { cookie });
  resetLlmRuntime();
  await generateText({ task: "test", system: "s", user: "u", maxTokens: 64, target: { provider: "gw", model: "m1" }, timeoutMs: 5000 }).catch(() => undefined);
  return bodies[0];
}

describe("Anthropic 协议的推理模型请求体", () => {
  it("不发送 thinking: disabled", async () => {
    const body = await requestBody("anthropic-messages", true);
    expect(body).toBeTruthy();
    expect(body).not.toHaveProperty("thinking");
  });

  it("非推理模型同样不带 thinking", async () => {
    expect(await requestBody("anthropic-messages", false)).not.toHaveProperty("thinking");
  });
});
