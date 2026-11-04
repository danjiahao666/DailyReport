import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { call, setupTestEnv, waited } from "./helpers";
import { getDaily as getDailyEntry } from "@/server/daily";
import { getDb } from "@/server/db";
import { findNewNumbers, optimizationWarnings } from "@/server/llm/guard";
import { POST as submitRoute } from "@/app/api/daily/route";
import { POST as optimizeStart } from "@/app/api/daily/[date]/optimize/route";

const optimizeRoute = waited(optimizeStart, (job) => {
  const entry = getDailyEntry(job.target)!;
  return { entry, warnings: entry.warnings };
});

const env = setupTestEnv();
const { faux } = env;
afterAll(() => env.cleanup());

beforeEach(() => {
  faux.setResponses([]);
  getDb().exec("DELETE FROM daily_entries");
});

/** 让模型返回指定内容 */
function reply(text: string) {
  return () => fauxAssistantMessage([fauxText(text)]);
}

async function optimize(date: string, original: string, output: string) {
  expect((await call(submitRoute, "POST", "/api/daily", { date, content: original })).status).toBe(200);
  faux.setResponses([reply(output)]);
  const res = await call(optimizeRoute, "POST", "/x", undefined, { date });
  expect(res.status).toBe(200);
  return res.body.entry as { optimized: string; warnings: string[] };
}

describe("数字核对：日期整体识别", () => {
  it("同一天的写法不同不算新增数字", () => {
    expect(findNewNumbers("2026-11-02 完成联调", "2026/11/02 完成联调")).toEqual([]);
    expect(findNewNumbers("2026-11-02 完成联调", "2026年11月2日 完成联调")).toEqual([]);
  });

  it("不同的日期仍然算新增数字，并按完整日期报出", () => {
    expect(findNewNumbers("2026-11-02 完成联调", "2026-11-03 完成联调")).toEqual(["2026-11-03"]);
  });

  it("日期里的数字不会顺带让单独的月份、日期数字失去约束", () => {
    // 基准里只有 2026-11-02，单独的 11 仍然算新增
    expect(findNewNumbers("2026-11-02 完成联调", "2026-11-02 完成联调，共 11 个用例")).toEqual(["11"]);
  });
});

describe("数字核对：日报日期是可信来源", () => {
  it("日报日期出现在优化稿里不报警", () => {
    expect(optimizationWarnings("完成登录模块联调", "2026-11-02\n完成登录模块联调", ["2026-11-02"])).toEqual([]);
  });

  it("日报日期的各种写法都算可信", () => {
    expect(optimizationWarnings("完成登录模块联调", "2026年11月2日\n完成登录模块联调", ["2026-11-02"])).toEqual([]);
  });

  it("不是日报日期的其他日期仍然报警", () => {
    const warnings = optimizationWarnings("完成登录模块联调", "2026-11-03\n完成登录模块联调", ["2026-11-02"]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("2026-11-03");
  });

  it("其它数字不受影响，仍然报警", () => {
    const warnings = optimizationWarnings("完成登录模块联调", "2026-11-02\n完成登录模块联调，共 99 个用例", ["2026-11-02"]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("99");
  });
});

describe("日报优化后的数字警告", () => {
  it("优化稿里的模板日期不再被当成新增数字，其它数字照常提示", async () => {
    const entry = await optimize("2026-11-02", "- 完成登录模块联调", "淡嘉浩--日报\n2026-11-02完成任务进度和计划\n\n【完成情况】\n- 完成登录模块联调");
    expect(entry.warnings).toEqual([]);
    expect(getDailyEntry("2026-11-02")!.warnings).toEqual([]);
  });

  it("优化稿里出现别的日期，仍然提示核对", async () => {
    const entry = await optimize("2026-11-03", "- 完成登录模块联调", "淡嘉浩--日报\n2026-11-02完成任务进度和计划\n\n【完成情况】\n- 完成登录模块联调");
    expect(entry.warnings).toHaveLength(1);
    expect(entry.warnings[0]).toContain("2026-11-02");
  });
});
