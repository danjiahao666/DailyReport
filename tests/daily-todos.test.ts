import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { call, setupTestEnv, waited } from "./helpers";
import { getDaily as getDailyEntry } from "@/server/daily";
import { getDb } from "@/server/db";
import { addBlocker, createTodo, setBlockerResolved } from "@/server/todos";
import { POST as submitRoute } from "@/app/api/daily/route";
import { POST as optimizeStart } from "@/app/api/daily/[date]/optimize/route";
import { formatTodoContext, optimizeUser } from "@/server/llm/prompts";
import { PROMPT_MAX_ITEMS, todoPromptContext } from "@/lib/todo-view";
import type { TodoItem } from "@/lib/types";

const optimizeRoute = waited(optimizeStart, (job) => ({ entry: getDailyEntry(job.target)! }));

const env = setupTestEnv();
const { faux } = env;
afterAll(() => env.cleanup());

/** 记录发给模型的用户消息 */
const prompts: string[] = [];
const reply = (text: string) => (context: { messages: { content: unknown }[] }) => {
  const last = context.messages[context.messages.length - 1].content;
  prompts.push(typeof last === "string" ? last : JSON.stringify(last));
  return fauxAssistantMessage([fauxText(text)]);
};

beforeEach(() => {
  prompts.length = 0;
  faux.setResponses([]);
  getDb().exec("DELETE FROM todos; DELETE FROM daily_entries;");
});

async function optimize(date: string, original: string, output: string) {
  expect((await call(submitRoute, "POST", "/api/daily", { date, content: original })).status).toBe(200);
  faux.setResponses([reply(output)]);
  const res = await call(optimizeRoute, "POST", "/x", undefined, { date });
  expect(res.status).toBe(200);
  return res.body.entry;
}

describe("日报优化读取待办事项", () => {
  it("没有待办时也带上规则，并明确告诉模型“当前没有”，用于把明日计划和遇到问题填“无”", async () => {
    await optimize("2026-11-02", "- 联调接口", "- 联调接口");
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("<待办事项>");
    expect(prompts[0]).toContain("当前没有未完成的待办事项");
    expect(prompts[0]).toContain("当前没有未解决的卡点");
    expect(prompts[0]).toContain("没有内容时写“无”");
  });

  it("把未完成待办和长期事项作为计划素材、未解决卡点作为问题素材；已完成、已解决的不带；不带进度和日期", async () => {
    createTodo({ title: "推进指标平台开发", dueDate: "2026-11-09", progress: 35 });
    const kb = createTodo({ title: "修复知识库 bug", startDate: "2026-11-01" });
    createTodo({ title: "已经做完的事", progress: 100 });
    createTodo({ title: "关注线上告警", longTerm: true });
    addBlocker(kb.id, "等待测试环境");
    const resolvedId = addBlocker(kb.id, "已经解决的问题").blockers.find((b) => b.content === "已经解决的问题")!.id;
    setBlockerResolved(kb.id, resolvedId, true);
    const alarm = createTodo({ title: "长期事项的卡点", longTerm: true });
    addBlocker(alarm.id, "告警规则待评审");

    await optimize("2026-11-02", "- 联调接口", "- 联调接口");
    const p = prompts[0];
    const data = p.slice(p.indexOf("<待办事项>"), p.indexOf("</待办事项>"));
    expect(data).toContain("- 推进指标平台开发");
    expect(data).toContain("- 修复知识库 bug");
    expect(data).not.toContain("已经做完的事");
    // 长期事项也列入计划，它的卡点进“遇到问题”
    expect(data).toContain("- 关注线上告警");
    expect(data).toContain("- 修复知识库 bug：等待测试环境");
    expect(data).toContain("- 长期事项的卡点：告警规则待评审");
    expect(data).not.toContain("已经解决的问题");
    // 不带进度和日期，避免模型写出精确数字
    expect(data).not.toMatch(/35|2026-11-09|2026-11-01/);
  });

  it("待办素材中的数字不会被“新增数字”核对误报；原文和素材都没有的数字仍然会被提示", async () => {
    createTodo({ title: "对接 v2 接口" });
    const ok = await optimize("2026-11-02", "- 联调接口", "- 联调接口\n- 明日计划：对接 v2 接口");
    expect(ok.warnings).toEqual([]);
    expect(getDailyEntry("2026-11-02")!.warnings).toEqual([]);

    const bad = await optimize("2026-11-03", "- 联调接口", "- 联调接口\n- 明日计划：对接 v2 接口，预计 99 个用例");
    expect(bad.warnings).toHaveLength(1);
    expect(bad.warnings[0]).toContain("99");
    expect(bad.warnings[0]).not.toContain("2、");
  });
});

describe("待办素材的整理", () => {
  const base = { note: "", priority: "medium", longTermStatus: "ongoing", startDate: null, completedAt: null, createdAt: "", updatedAt: "" } as const;
  const todo = (over: Partial<TodoItem> & { id: number }): TodoItem =>
    ({ title: `t${over.id}`, longTerm: false, status: "todo", progress: 0, dueDate: null, blockers: [], blocked: false, ...base, ...over }) as TodoItem;

  it("期限近的在前、条数有上限并提示被省略的数量，标题里的换行被压成一行", () => {
    const many = Array.from({ length: PROMPT_MAX_ITEMS + 3 }, (_, i) => todo({ id: i + 1, title: `事项${i + 1}`, dueDate: `2026-12-${String(i + 1).padStart(2, "0")}` }));
    many.push(todo({ id: 99, title: "最紧急\n的事", dueDate: "2026-11-01" }));
    const ctx = todoPromptContext(many);
    expect(ctx.plans[0]).toBe("最紧急 的事");
    expect(ctx.plans).toHaveLength(PROMPT_MAX_ITEMS);
    expect(ctx.morePlans).toBe(4);
    expect(formatTodoContext(ctx)).toContain("另有 4 条未列出，不必写入日报");
  });

  it("不使用待办（null）时提示词里没有待办段落，保持原有行为", () => {
    expect(optimizeUser("原文", "", "2026-11-02")).not.toContain("待办事项");
    expect(optimizeUser("原文", "", "2026-11-02", formatTodoContext(todoPromptContext([])))).toContain("<待办事项>");
  });

  it("长期事项的标题进入计划素材，普通未完成事项在前", () => {
    const normal = todo({ id: 1, title: "普通待办", dueDate: "2026-11-09" });
    const long = todo({ id: 2, title: "长期事项", status: "ongoing" });
    const done = todo({ id: 3, title: "已完成的事", status: "done", progress: 100 });
    const ctx = todoPromptContext([long, done, normal]);
    expect(ctx.plans).toEqual(["普通待办", "长期事项"]);
  });

  it("已暂停和已完成的长期事项不进计划素材，也不带卡点", () => {
    const ctx = todoPromptContext([
      todo({ id: 1, title: "进行中的长期事项", longTerm: true, status: "ongoing" }),
      todo({ id: 2, title: "已暂停的长期事项", longTerm: true, status: "paused", blocked: false }),
      todo({ id: 3, title: "已完成的长期事项", longTerm: true, status: "done", blocked: false }),
    ]);
    expect(ctx.plans).toEqual(["进行中的长期事项"]);
    expect(ctx.problems).toEqual([]);
  });
});
