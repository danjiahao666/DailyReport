/**
 * 事实一致性的轻量校验：优化稿中出现、但原文中没有的数字/百分比/日期，
 * 很可能是模型编造的。无法完全杜绝编造，因此只做提示，由用户在对比后决定是否采用。
 */

const NUMBER_RE = /\d+(?:[.,]\d+)*%?/g;

/**
 * 日期：与输出模板里替换日期用的写法一致（2026-11-02、2026/11/2、2026年11月2日）。
 * 日期要整体识别，不能拆成 2026、11、02 三个数字，否则同一天换个写法就会被当成编造。
 */
const DATE_RE = /(?<!\d)(\d{4})([-/.年])(\d{1,2})([-/.月])(\d{1,2})(日?)(?!\d)/g;

/** 把日期统一成 YYYY-MM-DD，月日补零，这样同一日期的不同写法能对上 */
function normalizeDate(year: string, month: string, day: string): string {
  const m = String(Number(month)).padStart(2, "0");
  const d = String(Number(day)).padStart(2, "0");
  return `${year}-${m}-${d}`;
}

function numberTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  // 先摘掉日期，剩下的才按数字提取
  const rest = text.replace(DATE_RE, (_all, y: string, _s1: string, mo: string, _s2: string, dd: string) => {
    tokens.add(normalizeDate(y, mo, dd));
    return " ";
  });
  for (const t of rest.match(NUMBER_RE) ?? []) tokens.add(t.replace(/,/g, ""));
  return tokens;
}

export function findNewNumbers(original: string, optimized: string): string[] {
  const base = numberTokens(original);
  const added = new Set<string>();
  for (const token of numberTokens(optimized)) {
    if (!base.has(token)) added.add(token);
  }
  return [...added];
}

/** 有序列表的序号（1. 2. …）不算新增数字 */
function stripListMarkers(text: string): string {
  return text.replace(/^\s*\d+[.、)]\s+/gm, "");
}

/**
 * 找出优化稿里相对原文新增的数字。
 * trustedDates 是服务端确定的日期（如日报日期）：输出模板里的日期会被替换成日报日期，
 * 模型照抄后出现的这组数字不是编造，因此不计入新增数字。
 */
export function optimizationWarnings(original: string, optimized: string, trustedDates: string[] = []): string[] {
  const trusted = trustedDates
    .map((d) => /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(d.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => normalizeDate(m[1], m[2], m[3]));
  const base = trusted.length > 0 ? `${original}\n${trusted.join("\n")}` : original;
  const added = findNewNumbers(stripListMarkers(base), stripListMarkers(optimized));
  if (added.length === 0) return [];
  return [`优化稿中出现了原文没有的数字：${added.slice(0, 8).join("、")}。请核对后再决定是否采用。`];
}
