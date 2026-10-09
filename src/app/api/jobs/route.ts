import { json, route } from "@/server/http";
import { dismissJob, getJob, parseJobKey } from "@/server/jobs";

export const dynamic = "force-dynamic";

function keyOf(req: Request) {
  const sp = new URL(req.url).searchParams;
  return parseJobKey(sp.get("kind"), sp.get("target"));
}

/** 查询某个对象最近一次大模型任务的状态（不存在时 job 为 null） */
export const GET = route((req) => {
  const { kind, target } = keyOf(req);
  return { job: getJob(kind, target) };
});

/** 忽略已结束的任务状态（如不想再看到失败标记）；进行中的任务不能忽略 */
export const DELETE = route((req) => {
  const { kind, target } = keyOf(req);
  dismissJob(kind, target);
  return json({ ok: true });
});
