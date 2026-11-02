import { afterAll, describe, expect, it } from "vitest";
import { call, setupTestEnv } from "./helpers";
import { getDb } from "@/server/db";
import { MAX_BLOCKERS_PER_TODO } from "@/server/todos";
import { GET as listRoute, POST as createRoute } from "@/app/api/todos/route";
import { DELETE as deleteRoute, PATCH as patchRoute } from "@/app/api/todos/[id]/route";
import { POST as addBlockerRoute } from "@/app/api/todos/[id]/blockers/route";
import { DELETE as deleteBlockerRoute, PATCH as patchBlockerRoute } from "@/app/api/todos/[id]/blockers/[blockerId]/route";
import { countByFilter, dueInfo, sortTodos, summarizeOpen } from "@/lib/todo-view";
import type { TodoItem } from "@/lib/types";

const env = setupTestEnv();
afterAll(() => env.cleanup());

const create = (body: Record<string, unknown>) => call(createRoute, "POST", "/api/todos", body);
const patch = (id: number, body: Record<string, unknown>) => call(patchRoute, "PATCH", `/api/todos/${id}`, body, { id: String(id) });
const addBlocker = (id: number, content: unknown) => call(addBlockerRoute, "POST", "/x", { content }, { id: String(id) });
const list = async (): Promise<TodoItem[]> => (await call(listRoute, "GET", "/api/todos")).body.todos;

describe("待办事项接口", () => {
  it("新建待办：默认值正确，日期与优先级原样保存", async () => {
    const res = await create({ title: "  写周报  ", startDate: "2026-11-02", dueDate: "2026-11-06", priority: "high", note: "含图表" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      title: "写周报",
      note: "含图表",
      priority: "high",
      status: "todo",
      progress: 0,
      startDate: "2026-11-02",
      dueDate: "2026-11-06",
      completedAt: null,
      blockers: [],
      blocked: false,
    });

    const minimal = await create({ title: "只有标题" });
    expect(minimal.body).toMatchObject({ priority: "medium", startDate: null, dueDate: null, progress: 0 });
  });

  it("拒绝非法输入：空标题、超长、非法日期、倒置的日期、非法优先级和进度", async () => {
    const code = async (body: Record<string, unknown>) => (await create(body)).body.error?.code;
    expect(await code({})).toBe("INVALID_TITLE");
    expect(await code({ title: "   " })).toBe("EMPTY_TITLE");
    expect(await code({ title: "a".repeat(201) })).toBe("TITLE_TOO_LONG");
    expect(await code({ title: "x", dueDate: "2026-02-30" })).toBe("INVALID_DATE");
    expect(await code({ title: "x", startDate: "2026-11-10", dueDate: "2026-11-01" })).toBe("INVALID_DATE_RANGE");
    expect(await code({ title: "x", priority: "urgent" })).toBe("INVALID_PRIORITY");
    expect(await code({ title: "x", progress: 101 })).toBe("INVALID_PROGRESS");
    expect(await code({ title: "x", progress: 1.5 })).toBe("INVALID_PROGRESS");
    expect(await code({ title: "x", note: "n".repeat(2001) })).toBe("NOTE_TOO_LONG");
  });

  it("进度驱动状态与完成时间：0 未开始、1~99 进行中、100 已完成，回落后清除完成时间", async () => {
    const { id } = (await create({ title: "联调" })).body;

    expect((await patch(id, { progress: 40 })).body).toMatchObject({ status: "doing", progress: 40, completedAt: null });

    const done = (await patch(id, { progress: 100 })).body;
    expect(done).toMatchObject({ status: "done", progress: 100 });
    expect(done.completedAt).toEqual(expect.any(String));

    // 已完成时修改其他字段，完成时间保持不变
    const renamed = (await patch(id, { title: "联调（改）" })).body;
    expect(renamed.completedAt).toBe(done.completedAt);

    expect((await patch(id, { progress: 90 })).body).toMatchObject({ status: "doing", completedAt: null });
    expect((await patch(id, { progress: 0 })).body.status).toBe("todo");
  });

  it("局部更新只改出现的字段，日期传 null 可清除，更新后日期顺序仍会校验", async () => {
    const { id } = (await create({ title: "评审", startDate: "2026-11-03", dueDate: "2026-11-09" })).body;

    const cleared = (await patch(id, { dueDate: null })).body;
    expect(cleared).toMatchObject({ title: "评审", startDate: "2026-11-03", dueDate: null });

    // 只改期望完成日期，也要和库里已有的开始日期比较
    expect((await patch(id, { dueDate: "2026-11-01" })).body.error.code).toBe("INVALID_DATE_RANGE");
    expect((await patch(id, { progress: -1 })).body.error.code).toBe("INVALID_PROGRESS");
    expect((await patch(99999, { title: "x" })).status).toBe(404);
    expect((await call(patchRoute, "PATCH", "/x", { title: "x" }, { id: "abc" })).body.error.code).toBe("INVALID_ID");
  });

  it("卡点：新增后待办变为已卡住，全部解决后恢复；完成的待办不再算卡住", async () => {
    const { id } = (await create({ title: "对接" })).body;

    const one = await addBlocker(id, "  等待账号  ");
    expect(one.status).toBe(201);
    expect(one.body.blocked).toBe(true);
    expect(one.body.blockers).toMatchObject([{ content: "等待账号", resolvedAt: null }]);
    const blockerId = one.body.blockers[0].id;

    const second = (await addBlocker(id, "环境不稳定")).body;
    expect(second.blockers).toHaveLength(2);

    const resolveCall = (bid: number, resolved: unknown) =>
      call(patchBlockerRoute, "PATCH", "/x", { resolved }, { id: String(id), blockerId: String(bid) });

    // 解决其中一个：仍然卡着，已解决的排到后面
    const half = (await resolveCall(blockerId, true)).body;
    expect(half.blocked).toBe(true);
    expect(half.blockers.map((b: { content: string }) => b.content)).toEqual(["环境不稳定", "等待账号"]);

    const otherId = half.blockers[0].id;
    const allResolved = (await resolveCall(otherId, true)).body;
    expect(allResolved.blocked).toBe(false);

    // 重新卡住，再完成待办：完成后不再显示为卡住
    expect((await resolveCall(otherId, false)).body.blocked).toBe(true);
    expect((await patch(id, { progress: 100 })).body.blocked).toBe(false);

    expect((await resolveCall(otherId, "yes")).body.error.code).toBe("INVALID_RESOLVED");
  });

  it("卡点校验：不能为空、不能超长、数量有上限，且不能越权操作别的待办的卡点", async () => {
    const a = (await create({ title: "A" })).body;
    const b = (await create({ title: "B" })).body;

    expect((await addBlocker(a.id, "  ")).body.error.code).toBe("EMPTY_BLOCKER");
    expect((await addBlocker(a.id, "x".repeat(501))).body.error.code).toBe("BLOCKER_TOO_LONG");
    expect((await addBlocker(a.id, 1)).body.error.code).toBe("INVALID_BLOCKER");
    expect((await addBlocker(424242, "x")).status).toBe(404);

    const blockerOfA = (await addBlocker(a.id, "A 的卡点")).body.blockers[0].id;
    // 用 B 的路径操作 A 的卡点：404 且 A 的卡点不受影响
    const cross = await call(patchBlockerRoute, "PATCH", "/x", { resolved: true }, { id: String(b.id), blockerId: String(blockerOfA) });
    expect(cross.status).toBe(404);
    const crossDelete = await call(deleteBlockerRoute, "DELETE", "/x", undefined, { id: String(b.id), blockerId: String(blockerOfA) });
    expect(crossDelete.status).toBe(404);
    expect((await list()).find((t) => t.id === a.id)!.blockers).toHaveLength(1);

    const full = (await create({ title: "满了" })).body;
    for (let i = 0; i < MAX_BLOCKERS_PER_TODO; i++) expect((await addBlocker(full.id, `卡点 ${i}`)).status).toBe(201);
    expect((await addBlocker(full.id, "多一个")).body.error.code).toBe("TOO_MANY_BLOCKERS");
  });

  it("长期事项：不设进度和日期，不能被标记完成；可以记卡点；可与普通事项互相转换", async () => {
    const created = await create({ title: "关注线上告警", longTerm: true, priority: "high" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ longTerm: true, status: "ongoing", progress: 0, startDate: null, dueDate: null, completedAt: null });
    const id = created.body.id;

    // 显式带进度或日期会被拒绝，而不是悄悄丢弃
    expect((await create({ title: "x", longTerm: true, progress: 50 })).body.error.code).toBe("LONG_TERM_NO_PROGRESS");
    expect((await create({ title: "x", longTerm: true, dueDate: "2026-11-30" })).body.error.code).toBe("LONG_TERM_NO_DATES");
    expect((await patch(id, { progress: 100 })).body.error.code).toBe("LONG_TERM_NO_PROGRESS");
    expect((await patch(id, { startDate: "2026-11-01" })).body.error.code).toBe("LONG_TERM_NO_DATES");
    expect((await patch(id, { longTerm: "yes" })).body.error.code).toBe("INVALID_LONG_TERM");
    // 传 null / 空串 / 0 视为没设置，允许（前端表单就是这样提交的）
    expect((await patch(id, { dueDate: null, startDate: "", progress: 0, title: "关注线上告警（改）" })).body.title).toBe("关注线上告警（改）");

    // 长期事项也可以记卡点，并算作已卡住
    expect((await addBlocker(id, "告警规则待评审")).body).toMatchObject({ blocked: true, status: "ongoing" });

    // 普通事项转长期：已有的进度和日期被清空
    const normal = (await create({ title: "转换", startDate: "2026-11-01", dueDate: "2026-11-09", progress: 60 })).body;
    expect((await patch(normal.id, { longTerm: true })).body).toMatchObject({
      longTerm: true,
      status: "ongoing",
      progress: 0,
      startDate: null,
      dueDate: null,
    });
    // 长期转回普通：从未开始、无日期重新开始，之后可以设置
    expect((await patch(normal.id, { longTerm: false })).body).toMatchObject({ longTerm: false, status: "todo", progress: 0, dueDate: null });
    expect((await patch(normal.id, { dueDate: "2026-11-20", progress: 10 })).body).toMatchObject({ status: "doing", dueDate: "2026-11-20" });
  });

  it("?open=1 只返回未完成的待办", async () => {
    const open = (await create({ title: "open-未完成", progress: 30 })).body;
    const done = (await create({ title: "open-已完成", progress: 100 })).body;
    const ids = (await call(listRoute, "GET", "/api/todos?open=1")).body.todos.map((t: TodoItem) => t.id);
    expect(ids).toContain(open.id);
    expect(ids).not.toContain(done.id);
    expect((await list()).map((t) => t.id)).toContain(done.id);
  });

  it("删除卡点与删除待办：卡点随待办级联删除", async () => {
    const { id } = (await create({ title: "清理" })).body;
    const withBlocker = (await addBlocker(id, "临时问题")).body;
    const blockerId = withBlocker.blockers[0].id;

    const afterDelete = await call(deleteBlockerRoute, "DELETE", "/x", undefined, { id: String(id), blockerId: String(blockerId) });
    expect(afterDelete.body.blockers).toEqual([]);

    await addBlocker(id, "又一个");
    expect((await call(deleteRoute, "DELETE", "/x", undefined, { id: String(id) })).body).toEqual({ ok: true });
    expect((await call(deleteRoute, "DELETE", "/x", undefined, { id: String(id) })).status).toBe(404);
    const orphan = getDb().prepare("SELECT COUNT(*) AS n FROM todo_blockers WHERE todo_id = ?").get(id) as { n: number };
    expect(orphan.n).toBe(0);
  });
});

describe("待办展示规则", () => {
  const base = { note: "", priority: "medium", longTerm: false, startDate: null, completedAt: null, createdAt: "", updatedAt: "", blockers: [], blocked: false } as const;
  const todo = (over: Partial<TodoItem> & { id: number }): TodoItem => ({ title: `t${over.id}`, status: "todo", progress: 0, dueDate: null, ...base, ...over }) as TodoItem;

  it("到期状态：逾期、今天、临近、较远、未设置、已完成", () => {
    const today = "2026-11-02";
    expect(dueInfo({ dueDate: "2026-11-01", status: "doing" }, today)).toMatchObject({ state: "overdue", days: 1, label: "已逾期 1 天" });
    expect(dueInfo({ dueDate: "2026-11-02", status: "todo" }, today).state).toBe("today");
    expect(dueInfo({ dueDate: "2026-11-05", status: "todo" }, today)).toMatchObject({ state: "soon", days: 3 });
    expect(dueInfo({ dueDate: "2026-11-06", status: "todo" }, today).state).toBe("later");
    expect(dueInfo({ dueDate: null, status: "todo" }, today).state).toBe("none");
    // 已完成的待办即使超过期限也不算逾期；跨月、跨年也要算对
    expect(dueInfo({ dueDate: "2026-10-01", status: "done" }, today).state).toBe("done");
    expect(dueInfo({ dueDate: "2027-01-01", status: "todo" }, "2026-12-30")).toMatchObject({ state: "soon", days: 2 });
  });

  it("长期事项：排在普通事项之后、已完成之前；不算未完成；首页提醒只在有卡点时才纳入", () => {
    const blocker = { id: 1, content: "x", createdAt: "", resolvedAt: null };
    const long = (id: number, over: Partial<TodoItem> = {}) => todo({ id, longTerm: true, status: "ongoing", ...over });
    const items = [
      long(1),
      todo({ id: 2, dueDate: "2026-11-09" }),
      todo({ id: 3, status: "done", progress: 100, completedAt: "2026-11-01T00:00:00Z" }),
      long(4, { priority: "high" }),
      long(5, { blocked: true, blockers: [blocker] }),
    ];
    expect(sortTodos(items).map((t) => t.id)).toEqual([2, 4, 5, 1, 3]);
    expect(countByFilter(items, "2026-11-02")).toMatchObject({ all: 5, open: 1, long: 3, blocked: 1, done: 1 });
    const s = summarizeOpen(items, "2026-11-02", 5);
    expect(s).toMatchObject({ total: 2, blocked: 1 });
    expect(s.top.map((t) => t.id)).toEqual([2, 5]);
  });

  it("首页提醒汇总：只统计未完成，分别计逆期、今天到期、已卡住，并取最靠前的几条", () => {
    const blocker = { id: 1, content: "x", createdAt: "", resolvedAt: null };
    const items = [
      todo({ id: 1, dueDate: "2026-11-01", status: "doing", progress: 20 }),
      todo({ id: 2, dueDate: "2026-11-02" }),
      todo({ id: 3, dueDate: "2026-11-20", blocked: true, blockers: [blocker] }),
      todo({ id: 4, dueDate: "2026-10-01", status: "done", progress: 100, completedAt: "2026-10-02T00:00:00Z" }),
      todo({ id: 5 }),
    ];
    const s = summarizeOpen(items, "2026-11-02", 3);
    expect(s).toMatchObject({ total: 4, overdue: 1, dueToday: 1, blocked: 1 });
    expect(s.top.map((t) => t.id)).toEqual([1, 2, 3]);
    expect(summarizeOpen([], "2026-11-02")).toMatchObject({ total: 0, top: [] });
  });

  it("排序：未完成在前按期限由近到远，没期限的靠后，已完成最后；筛选计数正确", () => {
    const items = [
      todo({ id: 1, dueDate: null }),
      todo({ id: 2, dueDate: "2026-11-09" }),
      todo({ id: 3, dueDate: "2026-11-01", priority: "low" }),
      todo({ id: 4, dueDate: "2026-11-01", priority: "high" }),
      todo({ id: 5, status: "done", progress: 100, completedAt: "2026-10-30T00:00:00Z" }),
      todo({ id: 6, status: "done", progress: 100, completedAt: "2026-11-01T00:00:00Z" }),
      todo({ id: 7, dueDate: "2026-11-10", blocked: true, blockers: [{ id: 1, content: "x", createdAt: "", resolvedAt: null }] }),
    ];
    expect(sortTodos(items).map((t) => t.id)).toEqual([4, 3, 2, 7, 1, 6, 5]);
    expect(countByFilter(items, "2026-11-02")).toEqual({ all: 7, open: 5, long: 0, blocked: 1, overdue: 2, done: 2 });
  });
});
