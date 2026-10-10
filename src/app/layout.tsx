import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { SiteFooter } from "@/components/pixel";
import { THEME_KEY } from "@/lib/theme";

/*
 * 中文像素字体（Fusion Pixel 的字形子集，生成方式见 scripts/subset-font.mjs）。
 * 走 next/font/local：构建后落在 _next/static，随 standalone 产物一起发布，
 * 且不在登录保护的拦截范围内——登录页自己也要用这个字体。
 */
const pixelFont = localFont({
  src: "./fonts/pixel-zh.woff2",
  variable: "--font-pixel-face",
  display: "swap",
});

/**
 * 在首次绘制前恢复上次选择的主题，避免白天模式刷新时先闪一下夜晚。
 * 没有保存过选择时不写属性，样式表按夜晚处理。
 */
const themeScript = `try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t==="day"||t==="night")document.documentElement.dataset.theme=t}catch(e){}`;

export const metadata: Metadata = {
  title: "日报助手",
  description: "记录日报，生成周报与月报",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme 由内联脚本在水合前写入，服务端渲染的 <html> 上没有它，所以要关掉这一处的水合告警
    <html lang="zh-CN" className={pixelFont.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen antialiased">
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
