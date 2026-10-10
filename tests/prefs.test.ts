import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { call, setupTestEnv, waited } from "./helpers";
import { getDaily as getDailyEntry } from "@/server/daily";
import { getReport } from "@/server/reports";
import { getLlmTimeoutMs, getMaxInputChars, getMaxTokens, getSystemPrompt } from "@/server/prefs";
import { DEFAULT_PROMPTS, DEFAULT_TEMPLATES, WEEKLY_SYSTEM } from "@/server/llm/prompts";
import { GET as getCenter, PUT as putCenter } from "@/app/api/settings/center/route";
import { POST as submitRoute } from "@/app/api/daily/route";
import { POST as optimizeStart } from "@/app/api/daily/[date]/optimize/route";
import { POST as weeklyStart } from "@/app/api/reports/weekly/route";
import { GET as calendar } from "@/app/api/calendar/route";

/** 设置中心的后端：存取、校验、整体生效，以及自定义值真的被业务代码用上 */

const optimizeRoute = waited(optimizeStart, (job) => getDailyEntry(job.target));
const genWeekly = waited(weeklyStart, (job) => getReport("weekly", job.target));

const env = setupTestEnv();
const { faux } = env;
afterAll(() => env.cleanup());

const WEEKLY_TEXT = "## 本周完成事项\n- 完成\n\n## 重点成果\n- 无\n\n## 遇到的问题\n- 无\n\n## 下周计划建议\n- 建议跟进";

/** 记录每次请求的系统提示词，便于断言发给模型的内容 */
const systems: string[] = [];
/** 同时记录最后一条用户消息，用来断言「输出模板」有没有被带上 */
const users: string[] = [];
function reply(text: string) {
  return (context: { messages: { role: string; content: unknown }[] }) => {
    const sys = context.messages.find((m) => m.role === "system");
    const c = sys?.content;
    systems.push(typeof c === "string" ? c : Array.isArray(c) ? c.map((b: { text?: string }) => b.text ?? "").join("") : "");
    const last = context.messages[context.messages.length - 1]?.content;
    users.push(typeof last === "string" ? last : JSON.stringify(last));
    return fauxAssistantMessage([fauxText(text)]);
  };
}

const put = (body: unknown) => call(putCenter, "PUT", "/api/settings/center", body);
const get = () => call(getCenter, "GET", "/api/settings/center");

beforeEach(async () => {
  systems.length = 0;
  users.length = 0;
  faux.setResponses([]);
  delete process.env.LLM_MAX_INPUT_CHARS;
  delete process.env.LLM_TIMEOUT_MS;
  // 每个用例从干净状态开始：清掉所有页面设置
  await put({
    numbers: { timeoutMs: null, maxInputChars: null, maxTokensOptimize: null, maxTokensWeekly: null, maxTokensMonthly: null },
    prompts: { optimize: null, weekly: null, monthly: null },
    templates: { optimize: null, weekly: null, monthly: null },
    optimizeOnSubmit: false,
    checkNewNumbers: true,
  });
});

describe("设置中心：读取", () => {
  it("初始状态给出内置默认值与来源", async () => {
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.numbers.timeoutMs).toEqual({ page: null, fallback: 120_000, fallbackSource: "default" });
    expect(body.numbers.maxTokensMonthly.fallback).toBe(6144);
    expect(body.prompts.weekly).toEqual({ custom: null, default: DEFAULT_PROMPTS.weekly });
    expect(body.optimizeOnSubmit).toBe(false);
    expect(body.checkNewNumbers).toBe(true);
    expect(body.auth).toEqual({ enabled: false, managedBy: null });
  });

  it("环境变量作为兜底值，并标明来源；页面设置优先于环境变量", async () => {
    process.env.LLM_TIMEOUT_MS = "30000";
    process.env.LLM_MAX_INPUT_CHARS = "8000";
    let { body } = await get();
    expect(body.numbers.timeoutMs).toEqual({ page: null, fallback: 30_000, fallbackSource: "env" });
    expect(getLlmTimeoutMs()).toBe(30_000);
    expect(getMaxInputChars()).toBe(8000);

    await put({ numbers: { timeoutMs: 45_000 } });
    ({ body } = await get());
    expect(body.numbers.timeoutMs.page).toBe(45_000);
    expect(getLlmTimeoutMs()).toBe(45_000);

    // 清除页面设置后回到环境变量
    await put({ numbers: { timeoutMs: null } });
    expect(getLlmTimeoutMs()).toBe(30_000);
  });
});

describe("设置中心：保存与校验", () => {
  it("保存各类选项后立即生效", async () => {
    const r = await put({
      weekStart: 0,
      optimizeOnSubmit: true,
      checkNewNumbers: false,
      numbers: { timeoutMs: 60_000, maxTokensWeekly: 2048 },
    });
    expect(r.status).toBe(200);
    expect(r.body.weekStart).toEqual({ value: 0, source: "page" });
    expect(r.body.optimizeOnSubmit).toBe(true);
    expect(r.body.checkNewNumbers).toBe(false);
    expect(getMaxTokens("weekly")).toBe(2048);
    expect(getMaxTokens("monthly")).toBe(6144);
    expect(getLlmTimeoutMs()).toBe(60_000);
    // 日历把「默认勾选优化」带给前端
    expect((await call(calendar, "GET", "/api/calendar?month=2026-10")).body.optimizeOnSubmit).toBe(true);
    await put({ weekStart: 1 });
  });

  it("拒绝越界、类型错误与未知字段", async () => {
    expect((await put({ numbers: { timeoutMs: 10 } })).body.error.code).toBe("INVALID_NUMBER");
    expect((await put({ numbers: { timeoutMs: 600_001 } })).body.error.code).toBe("INVALID_NUMBER");
    expect((await put({ numbers: { timeoutMs: 1.5 * 1000 + 0.5 } })).body.error.code).toBe("INVALID_NUMBER");
    expect((await put({ numbers: { timeoutMs: "60000" } })).body.error.code).toBe("INVALID_NUMBER");
    expect((await put({ numbers: { nope: 1 } })).body.error.code).toBe("UNKNOWN_FIELD");
    expect((await put({ whatever: 1 })).body.error.code).toBe("UNKNOWN_FIELD");
    expect((await put({ weekStart: 9 })).body.error.code).toBe("INVALID_WEEK_START");
    expect((await put({ optimizeOnSubmit: "yes" })).body.error.code).toBe("INVALID_BOOLEAN");
    expect((await put({ prompts: { optimize: 1 } })).body.error.code).toBe("INVALID_PROMPT");
    expect((await put({ prompts: { optimize: "x".repeat(20_001) } })).body.error.code).toBe("PROMPT_TOO_LONG");
    expect((await put({ prompts: { daily: "x" } })).body.error.code).toBe("UNKNOWN_FIELD");
    expect((await put({ templates: { weekly: 1 } })).body.error.code).toBe("INVALID_TEMPLATE");
    expect((await put({ templates: { weekly: "x".repeat(5001) } })).body.error.code).toBe("TEMPLATE_TOO_LONG");
    expect((await put({ templates: { daily: "x" } })).body.error.code).toBe("UNKNOWN_FIELD");
    expect((await put({ templates: "x" })).body.error.code).toBe("INVALID_TEMPLATES");
  });

  it("整体校验：同一次请求里有非法项时，合法项也不会保存", async () => {
    const r = await put({ optimizeOnSubmit: true, numbers: { timeoutMs: 60_000, maxInputChars: 5 } });
    expect(r.status).toBe(400);
    const { body } = await get();
    expect(body.optimizeOnSubmit).toBe(false);
    expect(body.numbers.timeoutMs.page).toBeNull();
  });
});

describe("设置中心：提示词", () => {
  it("自定义提示词被日报优化与周报实际使用，恢复默认后回到内置", async () => {
    await call(submitRoute, "POST", "/api/daily", { date: "2026-10-12", content: "联调接口" });

    await put({ prompts: { optimize: "  你是一只猫。只输出喵。  ", weekly: "自定义周报提示词" } });
    expect(getSystemPrompt("optimize")).toBe("你是一只猫。只输出喵。");

    faux.setResponses([reply("- 联调接口")]);
    await call(optimizeRoute, "POST", "/x", undefined, { date: "2026-10-12" });
    expect(systems.at(-1)).toBe("你是一只猫。只输出喵。");

    faux.setResponses([reply(WEEKLY_TEXT)]);
    await call(genWeekly, "POST", "/x", { date: "2026-10-12" });
    expect(systems.at(-1)).toBe("自定义周报提示词");

    // null 与「提交的内容恰好等于默认」都会清除自定义
    await put({ prompts: { optimize: null, weekly: DEFAULT_PROMPTS.weekly } });
    const { body } = await get();
    expect(body.prompts.optimize.custom).toBeNull();
    expect(body.prompts.weekly.custom).toBeNull();
    faux.setResponses([reply("- 联调接口")]);
    await call(optimizeRoute, "POST", "/x", undefined, { date: "2026-10-12" });
    expect(systems.at(-1)).toBe(DEFAULT_PROMPTS.optimize);
  });

  it("提交空白内容等同于恢复默认", async () => {
    await put({ prompts: { monthly: "临时提示词" } });
    expect((await get()).body.prompts.monthly.custom).toBe("临时提示词");
    await put({ prompts: { monthly: "   \n " } });
    expect((await get()).body.prompts.monthly.custom).toBeNull();
  });
});

describe("设置中心：对业务的影响", () => {
  it("汇总输入上限可在页面里调小，超过时被拒绝且不调用大模型", async () => {
    await call(submitRoute, "POST", "/api/daily", { date: "2026-10-19", content: "这一天写了不少内容".repeat(20) });
    await put({ numbers: { maxInputChars: 1000 } });
    expect(getMaxInputChars()).toBe(1000);
    // 再造一条超过 1000 字符的日报
    await call(submitRoute, "POST", "/api/daily", { date: "2026-10-20", content: "字".repeat(1200) });
    faux.setResponses([reply(WEEKLY_TEXT)]);
    const r = await call(genWeekly, "POST", "/x", { date: "2026-10-19" });
    expect(r.status).toBe(413);
    expect(r.body.error.code).toBe("INPUT_TOO_LARGE");
    expect(systems).toHaveLength(0);
  });

  it("关闭「检查新增数字」后，优化稿里的新数字不再产生提示", async () => {
    await call(submitRoute, "POST", "/api/daily", { date: "2026-10-26", content: "修复缺陷" });
    faux.setResponses([reply("- 修复 3 个缺陷")]);
    const on = await call(optimizeRoute, "POST", "/x", undefined, { date: "2026-10-26" });
    expect(on.body.warnings.length).toBe(1);

    // 同一份优化稿：关闭检查后，读取日报时不再附带提示（不需要重新调用模型）
    await put({ checkNewNumbers: false });
    expect(getDailyEntry("2026-10-26")!.warnings).toEqual([]);
    await put({ checkNewNumbers: true });
    expect(getDailyEntry("2026-10-26")!.warnings.length).toBe(1);
  });
});

describe("设置中心：参考模板", () => {
  it("默认状态：周报、月报有内置模板，日报优化默认不套模板", async () => {
    const { body } = await get();
    expect(body.templates.optimize).toEqual({ custom: null, default: "" });
    expect(body.templates.weekly.default).toBe(DEFAULT_TEMPLATES.weekly);
    expect(body.templates.weekly.default).toContain("## 本周完成事项");
    expect(body.templates.monthly.default).toContain("## 月度工作概览");
  });

  it("系统提示词不再写死小节标题，而是指向用户消息里的输出模板", () => {
    expect(WEEKLY_SYSTEM).not.toContain("## 本周完成事项");
    expect(WEEKLY_SYSTEM).toContain("<输出模板>");
  });

  it("默认情况下，周报的用户消息带着内置模板；日报优化不带", async () => {
    await call(submitRoute, "POST", "/api/daily", { date: "2026-11-02", content: "联调接口" });
    faux.setResponses([reply("- 联调接口")]);
    await call(optimizeRoute, "POST", "/x", undefined, { date: "2026-11-02" });
    expect(users.at(-1)).not.toContain("<输出模板>");

    faux.setResponses([reply(WEEKLY_TEXT)]);
    await call(genWeekly, "POST", "/x", { date: "2026-11-02" });
    expect(users.at(-1)).toContain("<输出模板>");
    expect(users.at(-1)).toContain("## 本周完成事项");
  });

  it("自定义模板被日报优化与周报用上，清空后回到默认", async () => {
    await call(submitRoute, "POST", "/api/daily", { date: "2026-11-09", content: "联调接口" });
    await put({ templates: { optimize: "今日完成：\n遇到问题：", weekly: "## 我的周报\n- 【写要点】" } });

    faux.setResponses([reply("今日完成：联调接口")]);
    await call(optimizeRoute, "POST", "/x", undefined, { date: "2026-11-09" });
    // 用户消息经 JSON 序列化后换行为 \n 转义，这里直接检查模板文本与标签
    expect(users.at(-1)).toContain("<输出模板>");
    expect(users.at(-1)).toContain("今日完成：");
    expect(users.at(-1)).toContain("遇到问题：");

    faux.setResponses([reply(WEEKLY_TEXT)]);
    await call(genWeekly, "POST", "/x", { date: "2026-11-09" });
    expect(users.at(-1)).toContain("## 我的周报");
    expect(users.at(-1)).not.toContain("## 本周完成事项");

    await put({ templates: { optimize: null, weekly: "  " } });
    const { body } = await get();
    expect(body.templates.optimize.custom).toBeNull();
    expect(body.templates.weekly.custom).toBeNull();
    faux.setResponses([reply(WEEKLY_TEXT)]);
    await call(genWeekly, "POST", "/x", { date: "2026-11-09", confirm: true });
    expect(users.at(-1)).toContain("## 本周完成事项");
  });

  it("提交内容与内置默认完全一致时不存副本", async () => {
    await put({ templates: { weekly: DEFAULT_TEMPLATES.weekly } });
    expect((await get()).body.templates.weekly.custom).toBeNull();
  });
});
