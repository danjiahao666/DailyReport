import { getDb } from "@/server/db";
import { route } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = route(
  () => {
    getDb().prepare("SELECT 1").get();
    return { ok: true };
  },
  { public: true },
);
