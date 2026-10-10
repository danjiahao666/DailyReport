import type { Metadata } from "next";
import { Preferences } from "@/components/Preferences";

export const metadata: Metadata = { title: "设置中心 - 日报助手" };

export default function PreferencesPage() {
  return <Preferences />;
}
