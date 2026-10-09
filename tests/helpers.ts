import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { createModels, fauxProvider } from "@earendil-works/pi-ai";
import { closeDb } from "@/server/db";
import { resetLlmRuntime, setLlmBackendForTests } from "@/server/llm/client";

export type RouteFn = (req: NextRequest, ctx?: { params: Promise<never> }) => Promise<Response>;

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface TestJob {
  kind: string;
  target: string;
  status: "running" | "succeeded" | "failed";
  errorCode: string | null;
  errorMessage: string | null;
  retryable: boolean;
}

/** 轮询任务直到结束（成功或失败），最多约 8 秒 */
export async function waitedJob(kind: string, target: string, headers: Record<string, string> = {}): Promise<TestJob> {
  const { GET } = await import("@/app/api/jobs/route");
  for (let i = 0; i < 400; i++) {
    const r = await call(GET, "GET", `/api/jobs?kind=${kind}&target=${target}`, undefined, undefined, headers);
    const job = r.body?.job as TestJob | null | undefined;
    if (job && job.status !== "running") return job;
    await sleep(20);
  }
  throw new Error(`任务未在预期时间内结束：${kind}:${target}`);
}

/**
 * 把“启动异步任务”的路由包装成“等任务结束再返回结果”的形式：
 * 启动阶段的校验错误原样返回；任务失败时返回与旧同步接口一致的错误体。
 */
export function waited(real: RouteFn, finish: (job: TestJob) => unknown): RouteFn {
  return async (req, ctx) => {
    const res = await real(req, ctx);
    if (res.status !== 202) return res;
    const { job } = (await res.json()) as { job: TestJob };
    const done = await waitedJob(job.kind, job.target);
    if (done.status === "failed") {
      return Response.json({ error: { code: done.errorCode, message: done.errorMessage, retryable: done.retryable } }, { status: 502 });
    }
    return Response.json(finish(done));
  };
}
