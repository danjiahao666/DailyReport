import type { Metadata } from "next";
import { Todos } from "@/components/Todos";

export const metadata: Metadata = { title: "待办事项 - 日报助手" };

export default function TodosPage() {
  return <Todos />;
}
