import { parseId, readJson, route } from "@/server/http";
import { deleteTodo, updateTodo } from "@/server/todos";

export const dynamic = "force-dynamic";

type P = { id: string };

/** 局部更新待办：只修改请求体中出现的字段，日期传 null 表示清除 */
export const PATCH = route<P>(async (req, { id }) => updateTodo(parseId(id, "待办"), await readJson(req)));

export const DELETE = route<P>((_req, { id }) => {
  deleteTodo(parseId(id, "待办"));
  return { ok: true };
});
