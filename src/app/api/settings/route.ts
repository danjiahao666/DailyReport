import { readJson, route } from "@/server/http";
import { getWeekStart, setWeekStart } from "@/server/settings";

export const dynamic = "force-dynamic";

export const GET = route(() => ({ weekStart: getWeekStart() }));

export const PUT = route(async (req) => {
  const body = await readJson(req);
  return { weekStart: setWeekStart(body.weekStart) };
});
