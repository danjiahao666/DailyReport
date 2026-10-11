import type { VersionOrigin } from "./types";

/** 版本来源的显示文案（日报优化稿与周报、月报共用） */
export const ORIGIN_LABEL: Record<VersionOrigin, string> = {
  generated: "模型生成",
  edited: "手动编辑",
  restored: "历史恢复",
};

/** ISO 时间转本地 YYYY-MM-DD HH:mm */
export function fmtTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
