/**
 * 事实一致性的轻量校验：优化稿中出现、但原文中没有的数字/百分比/日期，
 * 很可能是模型编造的。无法完全杜绝编造，因此只做提示，由用户在对比后决定是否采用。
 */

const NUMBER_RE = /\d+(?:[.,]\d+)*%?/g;

function numberTokens(text: string): Set<string> {
  return new Set((text.match(NUMBER_RE) ?? []).map((t) => t.replace(/,/g, "")));
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

export function optimizationWarnings(original: string, optimized: string): string[] {
  const added = findNewNumbers(stripListMarkers(original), stripListMarkers(optimized));
  if (added.length === 0) return [];
  return [`优化稿中出现了原文没有的数字：${added.slice(0, 8).join("、")}。请核对后再决定是否采用。`];
}
