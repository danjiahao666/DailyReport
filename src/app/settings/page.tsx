import type { Metadata } from "next";
import { LlmSettings } from "@/components/LlmSettings";

export const metadata: Metadata = { title: "大模型设置 - 日报助手" };

export default function SettingsPage() {
  return <LlmSettings />;
}
