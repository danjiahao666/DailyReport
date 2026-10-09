import { assertDate, deleteDaily, editDaily, getDaily } from "@/server/daily";
import { readJson, route } from "@/server/http";

export const dynamic = "force-dynamic";

type P = { date: string };

export const GET = route<P>((_req, { date }) => ({ entry: getDaily(assertDate(date)) }));

export const PUT = route<P>(async (req, { date }) => {
  const body = await readJson(req);
  return editDaily(assertDate(date), body.target ?? "original", body.content);
});

export const DELETE = route<P>((_req, { date }) => {
  deleteDaily(assertDate(date));
  return { ok: true };
});
