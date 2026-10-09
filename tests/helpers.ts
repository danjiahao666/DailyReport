import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { createModels, fauxProvider } from "@earendil-works/pi-ai";
import { closeDb } from "@/server/db";
import { resetLlmRuntime, setLlmBackendForTests } from "@/server/llm/client";

type RouteFn = (req: NextRequest, ctx?: { params: Promise<never> }) => Promise<Response>;

/** 每个测试文件使用独立的数据目录与 faux 模型 */
export function setupTestEnv() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "daily-report-test-"));
  process.env.DATA_DIR = dir;
  delete process.env.APP_PASSWORD;
  delete process.env.WEEK_START;
  delete process.env.LLM_TIMEOUT_MS;
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  setLlmBackendForTests({ models, model: faux.getModel() });
  return {
    dir,
    faux,
    cleanup() {
      setLlmBackendForTests(undefined);
      resetLlmRuntime();
      closeDb();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export async function call(
  handler: unknown,
  method: string,
  url: string,
  body?: unknown,
  params?: Record<string, string>,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: any; res: Response }> {
  const req = new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json", host: "localhost", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await (handler as RouteFn)(req, params ? { params: Promise.resolve(params) as never } : undefined);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, res };
}
