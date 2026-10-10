import { readJson, route } from "@/server/http";
import { getPrefsState, updatePrefs } from "@/server/prefs";

export const dynamic = "force-dynamic";

/** 设置中心：读取全部可配置选项（含内置默认值与来源） */
export const GET = route(() => getPrefsState());

/** 设置中心：保存有变化的选项；整体校验、整体生效，任何一项不合法则全部不保存 */
export const PUT = route(async (req) => updatePrefs(await readJson(req)));
