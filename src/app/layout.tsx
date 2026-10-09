import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "日报助手",
  description: "记录日报，生成周报与月报",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
