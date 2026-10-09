import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { call, setupTestEnv, waited, waitedJob } from "./helpers";
import { getDaily as getDailyEntry } from "@/server/daily";
import { getReport } from "@/server/reports";
import { POST as submitRoute } from "@/app/api/daily/route";
import { DELETE as deleteDaily, GET as getDaily, PUT as putDaily } from "@/app/api/daily/[date]/route";
import { POST as optimizeStart } from "@/app/api/daily/[date]/optimize/route";
import { PUT as activeRoute } from "@/app/api/daily/[date]/active/route";
import { GET as getWeekly, POST as weeklyStart } from "@/app/api/reports/weekly/route";
import { GET as getMonthly, POST as monthlyStart } from "@/app/api/reports/monthly/route";
import { GET as monthlyPlan } from "@/app/api/reports/monthly/plan/route";
import { PUT as editReport } from "@/app/api/reports/[id]/route";
import { POST as restoreReport } from "@/app/api/reports/[id]/restore/route";
import { GET as calendar } from "@/app/api/calendar/route";
import { PUT as putSettings } from "@/app/api/settings/route";
import { POST as login } from "@/app/api/auth/login/route";

// 优化与周报/月报生成都是异步任务：这里的包装会在启动后等待任务结束，再返回与同步版本一致的结果
const optimizeRoute = waited(optimizeStart, (job) => {
  const entry = getDailyEntry(job.target)!;
  return { entry, warnings: entry.warnings };
});
const genWeekly = waited(weeklyStart, (job) => getReport("weekly", job.target));
const genMonthly = waited(monthlyStart, (job) => getReport("monthly", `${job.target}-01`));

const env = setupTestEnv();
const { faux } = env;
afterAll(() => env.cleanup());

const WEEKLY_TEXT = "## 本周完成事项\n- 完成接口联调\n\n## 重点成果\n- 联调通过\n\n## 遇到的问题\n- 无\n\n## 下周计划建议\n- 建议继续测试";
const MONTHLY_TEXT = "## 月度工作概览\n- 本月完成联调\n\n## 主要成果\n- 无\n\n## 问题与反思\n- 无\n\n## 下月计划建议\n- 建议跟进";

/** 记录每次请求的用户消息，便于断言发给模型的内容 */
const prompts: string[] = [];
function reply(text: string) {
  return (context: { messages: { content: unknown }[] }) => {
    prompts.push(JSON.stringify(context.messages[context.messages.length - 1].content));
    return fauxAssistantMessage([fauxText(text)]);
  };
}

async function submit(date: string, content: string, mode?: string) {
  return call(submitRoute, "POST", "/api/daily", { date, content, mode });
}

beforeEach(() => {
  prompts.length = 0;
  faux.setResponses([]);
});

describe("日报记录", () => {
  it("同一天重复提交需选择覆盖或追加", async () => {
    expect((await submit("2026-10-05", "上午开会，下午写代码")).status).toBe(200);

    const dup = await submit("2026-10-05", "晚上修复缺陷");
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("DAILY_EXISTS");
    expect(dup.body.error.existing.original).toBe("上午开会，下午写代码");

    const appended = await submit("2026-10-05", "晚上修复缺陷", "append");
    expect(appended.body.original).toBe("上午开会，下午写代码\n晚上修复缺陷");

    const overwritten = await submit("2026-10-05", "全部重写", "overwrite");
    expect(overwritten.body.original).toBe("全部重写");
  });

  it("校验日期与内容", async () => {
    expect((await submit("2026-02-30", "x")).body.error.code).toBe("INVALID_DATE");
    expect((await submit("2026-10-06", "   ")).body.error.code).toBe("EMPTY_CONTENT");
    expect((await submit("2026-10-06", "x".repeat(20001))).body.error.code).toBe("CONTENT_TOO_LONG");
    expect((await call(submitRoute, "POST", "/api/daily", { date: "2026-10-06", content: "x", mode: "boom" })).body.error.code).toBe("INVALID_MODE");
  });

  it("编辑、查看、删除，并在日历中标记", async () => {
    await submit("2026-10-07", "写文档");
    const edited = await call(putDaily, "PUT", "/api/daily/2026-10-07", { content: "写设计文档" }, { date: "2026-10-07" });
    expect(edited.body.original).toBe("写设计文档");

    const cal = await call(calendar, "GET", "/api/calendar?month=2026-10");
    expect(cal.body.gridStart).toBe("2026-09-28");
    expect(cal.body.dailies.map((d: { date: string }) => d.date)).toContain("2026-10-07");

    expect((await call(deleteDaily, "DELETE", "/api/daily/2026-10-07", undefined, { date: "2026-10-07" })).status).toBe(200);
    const after = await call(getDaily, "GET", "/api/daily/2026-10-07", undefined, { date: "2026-10-07" });
    expect(after.body.entry).toBeNull();
    expect((await call(deleteDaily, "DELETE", "/api/daily/2026-10-07", undefined, { date: "2026-10-07" })).status).toBe(404);
  });
});

describe("日报优化", () => {
  it("优化稿作为候选保存，原文保留，可采用也可随时回退", async () => {
    await submit("2026-10-12", "修bug 登录页");
    faux.setResponses([reply("- 修复登录页缺陷")]);
    const res = await call(optimizeRoute, "POST", "/api/daily/2026-10-12/optimize", undefined, { date: "2026-10-12" });
    expect(res.status).toBe(200);
    expect(res.body.entry.original).toBe("修bug 登录页");
    expect(res.body.entry.optimized).toBe("- 修复登录页缺陷");
    expect(res.body.entry.active).toBe("original");
    expect(res.body.entry.effective).toBe("修bug 登录页");
    // 系统提示词包含"不得编造"约束
    expect(prompts[0]).toContain("修bug 登录页");

    const adopt = await call(activeRoute, "PUT", "/x", { active: "optimized" }, { date: "2026-10-12" });
    expect(adopt.body.effective).toBe("- 修复登录页缺陷");
    const revert = await call(activeRoute, "PUT", "/x", { active: "original" }, { date: "2026-10-12" });
    expect(revert.body.effective).toBe("修bug 登录页");
  });

  it("原文变更后优化稿标记过期并回退到原文", async () => {
    await submit("2026-10-13", "写代码");
    faux.setResponses([reply("- 编写代码")]);
    await call(optimizeRoute, "POST", "/x", undefined, { date: "2026-10-13" });
    await call(activeRoute, "PUT", "/x", { active: "optimized" }, { date: "2026-10-13" });
    const appended = await submit("2026-10-13", "写测试", "append");
    expect(appended.body.optimizedStale).toBe(true);
    expect(appended.body.active).toBe("original");
    expect(appended.body.effective).toContain("写测试");
  });

  it("优化稿出现原文没有的数字时给出提示", async () => {
    await submit("2026-10-14", "优化了查询速度");
    faux.setResponses([reply("- 优化查询速度，提升 35%")]);
    const res = await call(optimizeRoute, "POST", "/x", undefined, { date: "2026-10-14" });
    expect(res.body.warnings[0]).toContain("35%");
  });

  it("失败不影响原文，且可重试", async () => {
    await submit("2026-10-15", "原始日报内容");
    const calls: [string, ReturnType<typeof fauxAssistantMessage>, string][] = [
      ["LLM_AUTH", fauxAssistantMessage([], { stopReason: "error", errorMessage: "401 Unauthorized" }), "凭据"],
      ["LLM_RATE_LIMITED", fauxAssistantMessage([], { stopReason: "error", errorMessage: "429 rate limit" }), "频繁"],
      ["LLM_UPSTREAM", fauxAssistantMessage([], { stopReason: "error", errorMessage: "Internal error at http://10.0.0.1/v1 key=sk-abcdefghijklmnopqrstuvwxyz" }), "调用失败"],
      ["LLM_EMPTY", fauxAssistantMessage([fauxText("   ")]), "空内容"],
      ["LLM_TRUNCATED", fauxAssistantMessage([fauxText("半截")], { stopReason: "length" }), "截断"],
    ];
    for (const [code, message, hint] of calls) {
      faux.setResponses([message]);
      const res = await call(optimizeRoute, "POST", "/x", undefined, { date: "2026-10-15" });
      expect(res.body.error.code).toBe(code);
      expect(res.body.error.message).toContain(hint);
      expect(res.body.error.retryable).toBe(true);
      // 错误提示不泄露上游地址与密钥
      expect(JSON.stringify(res.body)).not.toMatch(/10\.0\.0\.1|sk-abc/);
      const entry = (await call(getDaily, "GET", "/x", undefined, { date: "2026-10-15" })).body.entry;
      expect(entry.original).toBe("原始日报内容");
      expect(entry.optimized).toBeNull();
    }
    faux.setResponses([reply("- 原始日报内容")]);
    const retry = await call(optimizeRoute, "POST", "/x", undefined, { date: "2026-10-15" });
    expect(retry.status).toBe(200);
  });

  it("优化期间日报被改动时丢弃结果", async () => {
    await submit("2026-10-16", "旧内容");
    faux.setResponses([
      async () => {
        await call(putDaily, "PUT", "/x", { content: "新内容" }, { date: "2026-10-16" });
        return fauxAssistantMessage([fauxText("- 旧内容")]);
      },
    ]);
    const res = await call(optimizeRoute, "POST", "/x", undefined, { date: "2026-10-16" });
    expect(res.body.error.code).toBe("CHANGED_DURING_OPTIMIZE");
  });
});

describe("周报", () => {
  it("该周没有日报时给出明确提示且不调用大模型", async () => {
    const before = faux.state.callCount;
    const res = await call(genWeekly, "POST", "/api/reports/weekly", { date: "2026-11-18" });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("NO_DAILY");
    expect(res.body.error.message).toContain("2026-11-16");
    expect(faux.state.callCount).toBe(before);
  });

  it("生成、编辑、重新生成都保留历史版本，不覆盖已编辑内容", async () => {
    // 2026-10-19 ~ 2026-10-25（周一起始）
    await submit("2026-10-19", "周一联调接口");
    await submit("2026-10-21", "周三修复缺陷");
    faux.setResponses([reply(WEEKLY_TEXT)]);
    const gen = await call(genWeekly, "POST", "/api/reports/weekly", { date: "2026-10-23" });
    expect(gen.status).toBe(200);
    expect(gen.body.periodStart).toBe("2026-10-19");
    expect(gen.body.periodEnd).toBe("2026-10-25");
    expect(gen.body.current.versionNo).toBe(1);
    expect(gen.body.outdated).toBe(false);
    expect(prompts[0]).toContain("周一联调接口");
    expect(prompts[0]).toContain("没有日报的日期");
    const id = gen.body.id;

    const edited = await call(editReport, "PUT", "/x", { content: "我手动改过的周报" }, { id: String(id) });
    expect(edited.body.current.versionNo).toBe(2);
    expect(edited.body.current.origin).toBe("edited");

    // 当前为手动编辑版本时，重新生成需要确认
    faux.setResponses([reply(WEEKLY_TEXT + "\n- 重新生成")]);
    const refused = await call(genWeekly, "POST", "/x", { date: "2026-10-23" });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("CONFIRM_OVERWRITE_EDITED");
    expect(faux.getPendingResponseCount()).toBe(1);

    const regen = await call(genWeekly, "POST", "/x", { date: "2026-10-23", confirm: true });
    expect(regen.body.current.versionNo).toBe(3);
    expect(regen.body.versions.map((v: { versionNo: number }) => v.versionNo)).toEqual([3, 2, 1]);
    expect(regen.body.versions.find((v: { versionNo: number }) => v.versionNo === 2).content).toBe("我手动改过的周报");

    // 恢复手动编辑版本：新增 restored 版本，历史不丢
    const v2 = regen.body.versions.find((v: { versionNo: number }) => v.versionNo === 2);
    const restored = await call(restoreReport, "POST", "/x", { versionId: v2.id }, { id: String(id) });
    expect(restored.body.current.content).toBe("我手动改过的周报");
    expect(restored.body.current.origin).toBe("restored");
    expect(restored.body.versions).toHaveLength(4);

    const got = await call(getWeekly, "GET", "/api/reports/weekly?date=2026-10-20");
    expect(got.body.report.id).toBe(id);
    expect(got.body.range).toEqual({ start: "2026-10-19", end: "2026-10-25" });
  });

  it("来源日报变化后提示周报已过期", async () => {
    await submit("2026-10-22", "周四做了评审");
    const got = await call(getWeekly, "GET", "/api/reports/weekly?date=2026-10-20");
    expect(got.body.report.outdated).toBe(true);
  });

  it("采用优化稿后，周报使用被采用的版本", async () => {
    await submit("2026-11-02", "周一 写代码");
    faux.setResponses([reply("- 编写业务代码")]);
    await call(optimizeRoute, "POST", "/x", undefined, { date: "2026-11-02" });
    await call(activeRoute, "PUT", "/x", { active: "optimized" }, { date: "2026-11-02" });
    faux.setResponses([reply(WEEKLY_TEXT)]);
    await call(genWeekly, "POST", "/x", { date: "2026-11-02" });
    const last = prompts[prompts.length - 1];
    expect(last).toContain("编写业务代码");
    expect(last).not.toContain("周一 写代码");
  });

  it("周起始日可配置", async () => {
    expect((await call(putSettings, "PUT", "/api/settings", { weekStart: 9 })).status).toBe(400);
    expect((await call(putSettings, "PUT", "/api/settings", { weekStart: 0 })).body.weekStart).toBe(0);
    const got = await call(getWeekly, "GET", "/api/reports/weekly?date=2026-10-22");
    expect(got.body.range).toEqual({ start: "2026-10-18", end: "2026-10-24" });
    await call(putSettings, "PUT", "/api/settings", { weekStart: 1 });
  });

  it("同一周期重复启动只调用一次大模型（幂等）", async () => {
    await submit("2026-11-09", "周一");
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    faux.setResponses([
      async () => {
        await gate;
        return fauxAssistantMessage([fauxText(WEEKLY_TEXT)]);
      },
    ]);
    const calls = faux.state.callCount;
    const first = await call(weeklyStart, "POST", "/x", { date: "2026-11-09" });
    expect(first.status).toBe(202);
    expect(first.body.job).toMatchObject({ kind: "weekly", target: "2026-11-09", status: "running" });
    const second = await call(weeklyStart, "POST", "/x", { date: "2026-11-10" });
    expect(second.status).toBe(202);
    expect(second.body.job.status).toBe("running");
    await new Promise((r) => setTimeout(r, 50));
    expect(faux.state.callCount - calls).toBe(1);
    release();
    const done = await waitedJob("weekly", "2026-11-09");
    expect(done.status).toBe("succeeded");
  });
});

describe("月报与跨月周", () => {
  it("没有任何数据时给出明确提示且不调用大模型", async () => {
    const before = faux.state.callCount;
    const res = await call(genMonthly, "POST", "/api/reports/monthly", { month: "2027-03", source: "daily" });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("NO_DATA");
    expect(faux.state.callCount).toBe(before);
  });

  it("跨月周按日期归属拆分：日报来源与周报来源", async () => {
    // 2026-12 的尾部、2027-01 的头部：周 2026-12-28 ~ 2027-01-03 跨月
    await submit("2026-12-29", "九月底的工作AAA");
    await submit("2027-01-01", "十月初的工作BBB");
    // 周 2027-01-04 ~ 2027-01-10 整周在一月内
    await submit("2027-01-05", "十月第二周的工作CCC");
    faux.setResponses([reply(WEEKLY_TEXT.replace("接口联调", "第二周周报内容DDD"))]);
    const wk = await call(genWeekly, "POST", "/x", { date: "2027-01-05" });
    expect(wk.status).toBe(200);

    // 日报来源：只取十月内的日期
    const planDaily = await call(monthlyPlan, "GET", "/api/reports/monthly/plan?month=2027-01&source=daily");
    expect(planDaily.body.dailyCount).toBe(2);
    faux.setResponses([reply(MONTHLY_TEXT)]);
    const byDaily = await call(genMonthly, "POST", "/x", { month: "2027-01", source: "daily" });
    expect(byDaily.status).toBe(200);
    const p1 = prompts[prompts.length - 1];
    expect(p1).toContain("十月初的工作BBB");
    expect(p1).toContain("十月第二周的工作CCC");
    expect(p1).not.toContain("九月底的工作AAA");

    // 周报来源：完整周用周报；跨月周只取本月日期的日报
    const plan = await call(monthlyPlan, "GET", "/api/reports/monthly/plan?month=2027-01&source=weekly");
    const w0 = plan.body.weeks[0];
    expect(w0).toMatchObject({ weekStart: "2026-12-28", full: false, use: "daily" });
    expect(w0.reason).toContain("跨月");
    expect(plan.body.weeks.find((w: { weekStart: string }) => w.weekStart === "2027-01-04")).toMatchObject({ use: "weekly" });

    faux.setResponses([reply(MONTHLY_TEXT)]);
    const byWeekly = await call(genMonthly, "POST", "/x", { month: "2027-01", source: "weekly" });
    expect(byWeekly.status).toBe(200);
    expect(byWeekly.body.current.meta.source).toBe("weekly");
    expect(byWeekly.body.current.meta.weeklyRefs).toHaveLength(1);
    const p2 = prompts[prompts.length - 1];
    expect(p2).toContain("第二周周报内容DDD");
    expect(p2).toContain("十月初的工作BBB");
    expect(p2).not.toContain("九月底的工作AAA");
    expect(p2).not.toContain("十月第二周的工作CCC"); // 该周已由周报代表，不重复引用日报

    // 九月月报同样只取九月的日期，不含十月初
    faux.setResponses([reply(MONTHLY_TEXT)]);
    await call(genMonthly, "POST", "/x", { month: "2026-12", source: "daily" });
    const p3 = prompts[prompts.length - 1];
    expect(p3).toContain("九月底的工作AAA");
    expect(p3).not.toContain("十月初的工作BBB");

    // 月报版本管理与日历区分
    const m = await call(getMonthly, "GET", "/api/reports/monthly?month=2027-01");
    expect(m.body.report.versions).toHaveLength(2);
    const edited = await call(editReport, "PUT", "/x", { content: "手工月报" }, { id: String(m.body.report.id) });
    expect(edited.body.current.origin).toBe("edited");

    const cal = await call(calendar, "GET", "/api/calendar?month=2027-01");
    expect(cal.body.monthly.periodStart).toBe("2027-01-01");
    expect(cal.body.weeklies.some((w: { periodStart: string }) => w.periodStart === "2027-01-04")).toBe(true);
    expect(cal.body.dailies.length).toBeGreaterThan(0);
  });

  it("参数校验", async () => {
    expect((await call(genMonthly, "POST", "/x", { month: "2026-13", source: "daily" })).body.error.code).toBe("INVALID_MONTH");
    expect((await call(genMonthly, "POST", "/x", { month: "2026-10", source: "x" })).body.error.code).toBe("INVALID_SOURCE");
  });
});

describe("访问保护", () => {
  it("设置 APP_PASSWORD 后未登录不可访问，登录后可访问", async () => {
    process.env.APP_PASSWORD = "secret-pass";
    try {
      expect((await call(calendar, "GET", "/api/calendar?month=2026-10")).status).toBe(401);
      expect((await call(login, "POST", "/api/auth/login", { password: "bad" })).status).toBe(401);
      const ok = await call(login, "POST", "/api/auth/login", { password: "secret-pass" });
      expect(ok.status).toBe(200);
      const cookie = ok.res.headers.get("set-cookie")!.split(";")[0];
      expect(ok.res.headers.get("set-cookie")).toMatch(/HttpOnly/i);
      const authed = await call(calendar, "GET", "/api/calendar?month=2026-10", undefined, undefined, { cookie });
      expect(authed.status).toBe(200);
      // 跨站来源的写请求被拒绝
      const csrf = await call(submitRoute, "POST", "/api/daily", { date: "2026-12-01", content: "x" }, undefined, { cookie, origin: "http://evil.example" });
      expect(csrf.status).toBe(403);
    } finally {
      delete process.env.APP_PASSWORD;
    }
  });
});
