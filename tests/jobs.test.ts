import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { call, setupTestEnv, waitedJob } from "./helpers";
import { POST as submitRoute } from "@/app/api/daily/route";
import { DELETE as deleteDaily, GET as getDaily } from "@/app/api/daily/[date]/route";
import { POST as optimizeStart } from "@/app/api/daily/[date]/optimize/route";
import { GET as getWeekly, POST as weeklyStart } from "@/app/api/reports/weekly/route";
import { POST as monthlyStart } from "@/app/api/reports/monthly/route";
import { DELETE as dismissRoute, GET as jobRoute } from "@/app/api/jobs/route";
import { GET as calendar } from "@/app/api/calendar/route";
import { PUT as editReport } from "@/app/api/reports/[id]/route";
import { closeDb, getDb } from "@/server/db";

/** 异步任务：启动即返回、状态持久化（切换页面/刷新后仍可见）、失败可重试、幂等、重启回收 */

const env = setupTestEnv();
const { faux } = env;
afterAll(() => env.cleanup());

const WEEKLY = "## 本周完成事项\n- 联调\n\n## 重点成果\n- 无\n\n## 遇到的问题\n- 无\n\n## 下周计划建议\n- 建议跟进";
const MONTHLY = "## 月度工作概览\n- 联调\n\n## 主要成果\n- 无\n\n## 问题与反思\n- 无\n\n## 下月计划建议\n- 建议跟进";

/** 让模型调用停在门口，直到测试放行，用来观察“进行中”的状态 */
function gated(text: string) {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const step = async () => {
    await gate;
    return fauxAssistantMessage([fauxText(text)]);
  };
  return { step, release: () => release() };
}

const submit = (date: string, content: string) => call(submitRoute, "POST", "/api/daily", { date, content });
const jobOf = async (kind: string, target: string) => (await call(jobRoute, "GET", `/api/jobs?kind=${kind}&target=${target}`)).body.job;
const calJobs = async (month: string) =>
  (await call(calendar, "GET", `/api/calendar?month=${month}`)).body.jobs as { kind: string; target: string; status: string }[];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => faux.setResponses([]));

describe("日报优化任务", () => {
  it("启动后立即返回进行中；期间日历与任务接口都能看到状态，结束后原文与优化稿都在", async () => {
    await submit("2026-10-05", "联调登录接口");
    const g = gated("- 联调登录接口");
    faux.setResponses([g.step]);

    const started = await call(optimizeStart, "POST", "/x", undefined, { date: "2026-10-05" });
    expect(started.status).toBe(202);
    expect(started.body.job).toMatchObject({ kind: "optimize", target: "2026-10-05", status: "running", errorCode: null });

    // “切换页面再回来”：全新的请求仍能看到进行中的状态
    expect((await jobOf("optimize", "2026-10-05")).status).toBe("running");
    expect(await calJobs("2026-10")).toContainEqual(expect.objectContaining({ kind: "optimize", target: "2026-10-05", status: "running" }));
    // 进行中不动已保存的数据
    const mid = (await call(getDaily, "GET", "/x", undefined, { date: "2026-10-05" })).body.entry;
    expect(mid.optimized).toBeNull();
    expect(mid.original).toBe("联调登录接口");

    g.release();
    expect((await waitedJob("optimize", "2026-10-05")).status).toBe("succeeded");
    const entry = (await call(getDaily, "GET", "/x", undefined, { date: "2026-10-05" })).body.entry;
    expect(entry).toMatchObject({ original: "联调登录接口", optimized: "- 联调登录接口", active: "original" });
  });

  it("同一日期重复启动是幂等的：返回同一个进行中的任务，只调用一次模型", async () => {
    await submit("2026-10-06", "评审需求");
    const g = gated("- 评审需求");
    faux.setResponses([g.step]);
    const calls = faux.state.callCount;
    const a = await call(optimizeStart, "POST", "/x", undefined, { date: "2026-10-06" });
    const b = await call(optimizeStart, "POST", "/x", undefined, { date: "2026-10-06" });
    expect([a.status, b.status]).toEqual([202, 202]);
    expect(b.body.job.startedAt).toBe(a.body.job.startedAt);
    await sleep(50);
    expect(faux.state.callCount - calls).toBe(1);
    g.release();
    expect((await waitedJob("optimize", "2026-10-06")).status).toBe("succeeded");
  });

  it("失败状态被保存：重新查询仍可见，可重试成功，也可忽略", async () => {
    await submit("2026-10-07", "写文档");
    faux.setResponses([fauxAssistantMessage([], { stopReason: "error", errorMessage: "401 Unauthorized" })]);
    await call(optimizeStart, "POST", "/x", undefined, { date: "2026-10-07" });
    const failed = await waitedJob("optimize", "2026-10-07");
    expect(failed).toMatchObject({ status: "failed", errorCode: "LLM_AUTH", retryable: true });
    expect(failed.errorMessage).toContain("凭据");

    // 失败标记在日历里持续存在，直到重试或忽略
    expect(await calJobs("2026-10")).toContainEqual(expect.objectContaining({ target: "2026-10-07", status: "failed" }));
    const entry = (await call(getDaily, "GET", "/x", undefined, { date: "2026-10-07" })).body.entry;
    expect(entry.original).toBe("写文档");
    expect(entry.optimized).toBeNull();

    // 重试成功后状态被替换，旧的失败信息不残留
    faux.setResponses([fauxAssistantMessage([fauxText("- 写文档")])]);
    await call(optimizeStart, "POST", "/x", undefined, { date: "2026-10-07" });
    const ok = await waitedJob("optimize", "2026-10-07");
    expect(ok).toMatchObject({ status: "succeeded", errorCode: null, errorMessage: null });

    // 忽略：只清除已结束的任务状态
    expect((await call(dismissRoute, "DELETE", "/api/jobs?kind=optimize&target=2026-10-07")).status).toBe(200);
    expect(await jobOf("optimize", "2026-10-07")).toBeNull();
  });

  it("进行中的任务不能被忽略", async () => {
    await submit("2026-10-08", "修缺陷");
    const g = gated("- 修缺陷");
    faux.setResponses([g.step]);
    await call(optimizeStart, "POST", "/x", undefined, { date: "2026-10-08" });
    const r = await call(dismissRoute, "DELETE", "/api/jobs?kind=optimize&target=2026-10-08");
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("JOB_RUNNING");
    g.release();
    await waitedJob("optimize", "2026-10-08");
  });

  it("日报在优化期间被删除：任务状态随之清除，不留下孤立的失败标记", async () => {
    await submit("2026-10-09", "临时记录");
    const g = gated("- 临时记录");
    faux.setResponses([g.step]);
    await call(optimizeStart, "POST", "/x", undefined, { date: "2026-10-09" });
    await call(deleteDaily, "DELETE", "/x", undefined, { date: "2026-10-09" });
    expect(await jobOf("optimize", "2026-10-09")).toBeNull();
    g.release();
    await sleep(100);
    expect(await jobOf("optimize", "2026-10-09")).toBeNull();
  });

  it("日报不存在时同步报错，不创建任务", async () => {
    const r = await call(optimizeStart, "POST", "/x", undefined, { date: "2026-10-20" });
    expect(r.status).toBe(404);
    expect(await jobOf("optimize", "2026-10-20")).toBeNull();
  });
});

describe("周报 / 月报任务", () => {
  it("周报：没有日报等校验在启动时同步返回，不创建任务也不调用模型", async () => {
    const calls = faux.state.callCount;
    const r = await call(weeklyStart, "POST", "/x", { date: "2027-02-10" });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("NO_DAILY");
    expect(await jobOf("weekly", "2027-02-08")).toBeNull();
    expect(faux.state.callCount).toBe(calls);
  });

  it("周报进行中显示在该周起始日上，完成后可查看；需要确认覆盖的校验仍在启动时返回", async () => {
    await submit("2026-10-14", "周三联调");
    const g = gated(WEEKLY);
    faux.setResponses([g.step]);
    const started = await call(weeklyStart, "POST", "/x", { date: "2026-10-14" });
    expect(started.status).toBe(202);
    expect(started.body.job).toMatchObject({ kind: "weekly", target: "2026-10-12", status: "running" });
    expect(await calJobs("2026-10")).toContainEqual(expect.objectContaining({ kind: "weekly", target: "2026-10-12", status: "running" }));
    g.release();
    expect((await waitedJob("weekly", "2026-10-12")).status).toBe("succeeded");

    const report = (await call(getWeekly, "GET", "/api/reports/weekly?date=2026-10-14")).body.report;
    expect(report.current.versionNo).toBe(1);
    await call(editReport, "PUT", "/x", { content: "我改过的周报" }, { id: String(report.id) });
    const refuse = await call(weeklyStart, "POST", "/x", { date: "2026-10-14" });
    expect(refuse.status).toBe(409);
    expect(refuse.body.error.code).toBe("CONFIRM_OVERWRITE_EDITED");
  });

  it("月报：状态记在月份上；失败可重试；日历只返回当前月份的月报任务", async () => {
    await submit("2026-10-14", "周三联调");
    faux.setResponses([fauxAssistantMessage([], { stopReason: "error", errorMessage: "boom" })]);
    const started = await call(monthlyStart, "POST", "/x", { month: "2026-10", source: "daily" });
    expect(started.status).toBe(202);
    expect(started.body.job).toMatchObject({ kind: "monthly", target: "2026-10" });
    expect((await waitedJob("monthly", "2026-10")).status).toBe("failed");
    expect(await calJobs("2026-10")).toContainEqual(expect.objectContaining({ kind: "monthly", target: "2026-10", status: "failed" }));
    expect((await calJobs("2026-11")).some((j) => j.kind === "monthly")).toBe(false);

    faux.setResponses([fauxAssistantMessage([fauxText(MONTHLY)])]);
    await call(monthlyStart, "POST", "/x", { month: "2026-10", source: "daily" });
    expect((await waitedJob("monthly", "2026-10")).status).toBe("succeeded");
  });
});

describe("进程重启", () => {
  it("上一个进程遗留的“进行中”任务在下次打开数据库时标记为失败", async () => {
    getDb()
      .prepare("INSERT INTO llm_jobs (kind, target, status, boot_id, started_at) VALUES ('weekly', '2030-01-07', 'running', 'old-process', '2030-01-07T00:00:00.000Z')")
      .run();
    closeDb(); // 模拟新进程重新打开数据库
    const job = await jobOf("weekly", "2030-01-07");
    expect(job).toMatchObject({ status: "failed", errorCode: "INTERRUPTED", retryable: true });
    expect(job.errorMessage).toContain("重启");
  });
});

describe("参数校验", () => {
  it.each([
    ["kind 非法", "kind=bad&target=2026-10-01", "INVALID_KIND"],
    ["日期格式非法", "kind=optimize&target=2026-13-01", "INVALID_TARGET"],
    ["月报 target 必须是月份", "kind=monthly&target=2026-10-01", "INVALID_TARGET"],
  ])("%s", async (_n, qs, code) => {
    const r = await call(jobRoute, "GET", `/api/jobs?${qs}`);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe(code);
  });
});
