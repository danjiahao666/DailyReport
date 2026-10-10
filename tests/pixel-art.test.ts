import { describe, expect, it } from "vitest";
import { ALL_BITMAPS } from "@/components/pixel-art-data";

describe("像素位图数据", () => {
  for (const [name, bmp] of Object.entries(ALL_BITMAPS)) {
    it(`${name}：每行等宽，且用到的字符都有颜色`, () => {
      const width = bmp.rows[0].length;
      bmp.rows.forEach((row, i) => expect(row.length, `第 ${i} 行宽度`).toBe(width));
      const used = new Set(bmp.rows.join("").replaceAll(".", ""));
      for (const ch of used) expect(bmp.palette[ch], `字符 ${ch} 缺少颜色`).toBeTruthy();
    });
  }
});
