import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { call, setupTestEnv, waited } from "./helpers";
import { editDaily, getDaily as getDailyEntry, MAX_OPTIMIZED_VERSIONS } from "@/server/daily";
import { closeDb, getDb } from "@/server/db";
import { POST as submitRoute } from "@/app/api/daily/route";
import { DELETE as deleteDaily, GET as getDaily, PUT as putDaily } from "@/app/api/daily/[date]/route";
import { POST as optimizeStart } from "@/app/api/daily/[date]/optimize/route";
import { POST as restoreRoute } from "@/app/api/daily/[date]/restore/route";
import type { DailyEntry, DailyOptimizedVersion } from "@/lib/types";

const optimizeRoute = waited(optimizeStart, (job) => {
  const entry = getDailyEntry(job.target)!;
  return { entry, warnings: entry.warnings };
});

const env = setupTestEnv();
const { faux } = env;
afterAll(() => env.cleanup());

beforeEach(() => faux.setResponses([]));

const reply = (text: string) => () => fauxAssistantMessage([fauxText(text)]);

function submit(date: string, content: string, mode?: string) {
  return call(submitRoute, "POST", "/api/daily", { date, content, mode });
}

async function optimize(date: string, text: string): Promise<DailyEntry> {
  faux.setResponses([reply(text)]);
  const res = await call(optimizeRoute, "POST", "/x", undefined, { date });
  expect(res.status).toBe(200);
  return res.body.entry;
}

function restore(date: string, versionId: unknown) {
  return call(restoreRoute, "POST", "/x", { versionId }, { date });
}

const versionsOf = (date: string): DailyOptimizedVersion[] => getDailyEntry(date)!.optimizedVersions!;

describe("日报优化稿历史版本", () => {
  it("每次优化都追加版本：新的在前，旧版本保留，最新一条为当前", async () => {
    await submit("2026-12-01", "修bug");
    await optimize("2026-12-01", "- 修复缺陷 A");
    await optimize("2026-12-01", "- 修复缺陷 B");

    const v = versionsOf("2026-12-01");
    expect(v.map((x) => [x.versionNo, x.content, x.origin, x.isCurrent, x.stale])).toEqual([
      [2, "- 修复缺陷 B", "generated", true, false],
      [1, "- 修复缺陷 A", "generated", false, false],
    ]);
    expect(getDailyEntry("2026-12-01")!.optimized).toBe("- 修复缺陷 B");

    // 通过接口读取同样带历史版本
    const res = await call(getDaily, "GET", "/x", undefined, { date: "2026-12-01" });
    expect(res.body.entry.optimizedVersions).toHaveLength(2);
  });

  it("手动编辑优化稿会记为新版本，内容未变不追加，再次优化不会冲掉编辑稿", async () => {
    await submit("2026-12-02", "写文档");
    await optimize("2026-12-02", "- 编写文档");

    const edited = await call(putDaily, "PUT", "/x", { target: "optimized", content: "- 编写设计文档" }, { date: "2026-12-02" });
    expect(edited.status).toBe(200);
    expect(versionsOf("2026-12-02")[0]).toMatchObject({ versionNo: 2, origin: "edited", content: "- 编写设计文档", stale: false });

    await call(putDaily, "PUT", "/x", { target: "optimized", content: "- 编写设计文档" }, { date: "2026-12-02" });
    expect(versionsOf("2026-12-02")).toHaveLength(2);

    await optimize("2026-12-02", "- 完成文档");
    const contents = versionsOf("2026-12-02").map((x) => x.content);
    expect(contents).toEqual(["- 完成文档", "- 编写设计文档", "- 编写文档"]);
  });

  it("恢复历史版本：新增“恢复”版本并成为当前优化稿，历史不丢失；恢复当前版本不新增", async () => {
    await submit("2026-12-03", "测试");
    await optimize("2026-12-03", "- 版本一");
    await optimize("2026-12-03", "- 版本二");
    const [, v1] = versionsOf("2026-12-03");

    const res = await restore("2026-12-03", v1.id);
    expect(res.status).toBe(200);
    expect(res.body.optimized).toBe("- 版本一");
    expect(res.body.optimizedStale).toBe(false);
    expect(res.body.optimizedVersions.map((x: DailyOptimizedVersion) => [x.versionNo, x.origin, x.restoredFrom, x.isCurrent])).toEqual([
      [3, "restored", 1, true],
      [2, "generated", null, false],
      [1, "generated", null, false],
    ]);

    // 当前版本再次恢复：不新增
    const again = await restore("2026-12-03", res.body.optimizedVersions[0].id);
    expect(again.body.optimizedVersions).toHaveLength(3);
  });

  it("恢复不改变当前采用的是原文还是优化稿", async () => {
    await submit("2026-12-04", "测试");
    await optimize("2026-12-04", "- 一");
    await optimize("2026-12-04", "- 二");
    const [, v1] = versionsOf("2026-12-04");
    const res = await restore("2026-12-04", v1.id);
    expect(res.body.active).toBe("original");
    expect(res.body.effective).toBe("测试");
  });

  it("原文变更后：旧版本标记为基于旧原文；恢复旧版本得到“已过期”，恢复匹配当前原文的版本则不过期", async () => {
    await submit("2026-12-05", "A");
    await optimize("2026-12-05", "- 优化 A");
    const appended = await submit("2026-12-05", "B", "append");
    expect(appended.body.optimizedStale).toBe(true);
    expect(appended.body.optimizedVersions[0].stale).toBe(true);

    const fresh = await optimize("2026-12-05", "- 优化 A、B");
    expect(fresh.optimizedStale).toBe(false);
    expect(versionsOf("2026-12-05").map((x) => x.stale)).toEqual([false, true]);

    const [v2, v1] = versionsOf("2026-12-05");
    const restoredOld = await restore("2026-12-05", v1.id);
    expect(restoredOld.body.optimizedStale).toBe(true);
    expect(restoredOld.body.optimizedVersions[0].stale).toBe(true);

    const restoredNew = await restore("2026-12-05", v2.id);
    expect(restoredNew.body.optimizedStale).toBe(false);
    expect(restoredNew.body.optimized).toBe("- 优化 A、B");
  });

  it("恢复接口校验：版本 ID 类型、不存在、不能跨日期使用", async () => {
    await submit("2026-12-06", "甲");
    await submit("2026-12-07", "乙");
    await optimize("2026-12-06", "- 甲 1");
    await optimize("2026-12-07", "- 乙 1");
    const other = versionsOf("2026-12-07")[0];

    expect((await restore("2026-12-06", "1")).body.error.code).toBe("INVALID_VERSION");
    expect((await restore("2026-12-06", 1.5)).body.error.code).toBe("INVALID_VERSION");
    expect((await restore("2026-12-06", 999999)).status).toBe(404);
    // 别的日期的版本 ID 视为不存在
    expect((await restore("2026-12-06", other.id)).status).toBe(404);
    expect((await restore("2026-12-31", other.id)).status).toBe(404);
    expect((await restore("2026-02-30", other.id)).body.error.code).toBe("INVALID_DATE");
    // 失败不改变数据
    expect(getDailyEntry("2026-12-06")!.optimized).toBe("- 甲 1");
  });

  it("覆盖提交清空优化稿及其历史；追加不清空；删除日报级联清除", async () => {
    await submit("2026-12-08", "原文");
    await optimize("2026-12-08", "- 一");
    await optimize("2026-12-08", "- 二");

    await submit("2026-12-08", "追加内容", "append");
    expect(versionsOf("2026-12-08")).toHaveLength(2);

    const overwritten = await submit("2026-12-08", "全部重写", "overwrite");
    expect(overwritten.body.optimized).toBeNull();
    expect(overwritten.body.optimizedVersions).toEqual([]);

    await optimize("2026-12-08", "- 新一");
    expect(versionsOf("2026-12-08").map((x) => x.versionNo)).toEqual([1]);

    const count = () => (getDb().prepare("SELECT COUNT(*) AS n FROM daily_optimized_versions WHERE date = ?").get("2026-12-08") as { n: number }).n;
    expect(count()).toBe(1);
    await call(deleteDaily, "DELETE", "/x", undefined, { date: "2026-12-08" });
    expect(count()).toBe(0);
  });

  it(`历史版本最多保留 ${MAX_OPTIMIZED_VERSIONS} 条，超出时删除最旧的，当前版本始终保留`, async () => {
    await submit("2026-12-09", "原文");
    await optimize("2026-12-09", "- 初版");
    for (let i = 1; i <= MAX_OPTIMIZED_VERSIONS + 2; i++) editDaily("2026-12-09", "optimized", `- 修改 ${i}`);

    const v = versionsOf("2026-12-09");
    expect(v).toHaveLength(MAX_OPTIMIZED_VERSIONS);
    expect(v[0]).toMatchObject({ versionNo: MAX_OPTIMIZED_VERSIONS + 3, content: `- 修改 ${MAX_OPTIMIZED_VERSIONS + 2}`, isCurrent: true });
    expect(v[v.length - 1].versionNo).toBe(4);
    expect(getDailyEntry("2026-12-09")!.optimized).toBe(v[0].content);
  });

  it("日期范围查询不带历史版本（避免列表接口体积膨胀）", async () => {
    const { listDailies } = await import("@/server/daily");
    const rows = listDailies("2026-12-01", "2026-12-31");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.optimizedVersions === undefined)).toBe(true);
  });

  it("升级兼容：已有优化稿但没有历史的旧数据，打开数据库时自动补一条 v1", async () => {
    await submit("2026-12-10", "旧数据");
    await optimize("2026-12-10", "- 旧优化稿");
    await submit("2026-12-11", "旧数据二");
    await optimize("2026-12-11", "- 旧优化稿二");
    // 模拟升级前：没有历史记录；第二条原文已变更（优化稿过期）
    getDb().prepare("DELETE FROM daily_optimized_versions WHERE date IN ('2026-12-10','2026-12-11')").run();
    getDb().prepare("UPDATE daily_entries SET optimized_stale = 1 WHERE date = '2026-12-11'").run();
    closeDb();

    const a = versionsOf("2026-12-10");
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ versionNo: 1, content: "- 旧优化稿", origin: "generated", isCurrent: true, stale: false });
    // 过期的旧优化稿无法确认对应哪版原文，保守地标记为基于旧原文
    expect(versionsOf("2026-12-11")[0].stale).toBe(true);

    // 重复打开不会重复补录
    closeDb();
    expect(versionsOf("2026-12-10")).toHaveLength(1);
  });
});
