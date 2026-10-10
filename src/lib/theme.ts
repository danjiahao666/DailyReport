/** 主题在 localStorage 里的键；layout.tsx 的防闪烁脚本与客户端切换共用同一个键 */
export const THEME_KEY = "dr-theme";

export type Theme = "day" | "night";

/** 当前主题。只在浏览器里调用；没有 data-theme 属性时按夜晚处理，与样式表的默认一致 */
export function readTheme(): Theme {
  return document.documentElement.dataset.theme === "day" ? "day" : "night";
}

/** 切换主题：立即生效，并尽量记住选择 */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // 隐私模式等场景写不进去：本次会话仍然生效，只是刷新后回到默认
  }
}
