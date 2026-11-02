import { json, readJson, route } from "@/server/http";
import { createTodo, listTodos } from "@/server/todos";

export const dynamic = "force-dynamic";

/** 待办列表；?open=1 只返回未完成的 */
export const GET = route((req) => ({ todos: listTodos(new URL(req.url).searchParams.get("open") === "1") }));

/** 新建待办：title 必填，note / priority / startDate / dueDate / progress 可选 */
export const POST = route(async (req) => json(createTodo(await readJson(req)), 201));
