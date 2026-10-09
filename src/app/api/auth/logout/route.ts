import { json, route } from "@/server/http";
import { SESSION_COOKIE } from "@/server/session";

export const dynamic = "force-dynamic";

export const POST = route(
  () => {
    const res = json({ ok: true });
    res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  },
  { public: true },
);
