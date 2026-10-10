"use client";

import { THEME_KEY } from "@/lib/theme";
import { PixelArt } from "./PixelArt";
import { MOON_ICON, SUN_ICON } from "./pixel-art-data";

/**
 * 白天 / 夜晚切换。
 *
 * 当前主题只存在于 <html data-theme> 上，按钮里显示「点了会变成什么」的那一半
 * 也是靠 CSS 按这个属性显隐，而不是 React 状态——这样服务端渲染的 HTML
 * 和首次绘制永远一致，不会出现按钮先显示错的、再跳一下的闪动。
 */
export function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;
    const next = root.dataset.theme === "day" ? "night" : "day";
    root.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // 隐私模式等场景写不进去：本次会话仍然生效，只是刷新后回到默认
    }
  }

  return (
    <button type="button" onClick={toggle} className="pixel-button" aria-label="切换白天 / 夜晚模式" title="切换白天 / 夜晚模式">
      <span className="theme-when-night inline-flex items-center gap-1.5">
        <PixelArt bitmap={SUN_ICON} scale={2} />
        白天
      </span>
      <span className="theme-when-day inline-flex items-center gap-1.5">
        <PixelArt bitmap={MOON_ICON} scale={2} />
        夜晚
      </span>
    </button>
  );
}
