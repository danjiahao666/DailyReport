import { route } from "@/server/http";
import { deleteProvider, getLlmSettings } from "@/server/llm-settings";

export const dynamic = "force-dynamic";

export const DELETE = route<{ id: string }>(async (_req, { id }) => {
  deleteProvider(id);
  return getLlmSettings();
});
