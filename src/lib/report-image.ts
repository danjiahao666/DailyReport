import { parseBlocks, parseSpans, type Span } from "./report-format";

/**
 * 把报告渲染成 PNG 图片（仅浏览器环境）。
 * 直接用 Canvas 绘制，不依赖额外库，也不会受页面样式、滚动区域影响。
 */

const FAMILY = `-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI", Roboto, sans-serif`;
const WIDTH = 720;
const PAD = 32;
const COLOR_BG = "#fbf6ea";
const COLOR_INK = "#10141c";
const COLOR_EMBER = "#b96a4a";
/** 画布像素上限：Safari 的单个画布面积上限约 1677 万像素，取更保守的值 */
const MAX_AREA = 16_000_000;
const MAX_SIDE = 16_000;

/** 不能出现在行首的标点：换行时留在上一行 */
const NO_LINE_START = new Set(Array.from("，。、；：！？）》」』”’,.;:!?)]}%"));

interface Run {
  text: string;
  bold: boolean;
  size: number;
  x: number;
  /** 行垂直中心 */
  y: number;
}

interface Rule {
  y: number;
  dashed: boolean;
}

interface Square {
  x: number;
  y: number;
}

interface Layout {
  runs: Run[];
  rules: Rule[];
  squares: Square[];
  height: number;
}

export interface ReportImageOptions {
  /** 图片顶部标题，如“2026-10-11 周日 · 日报” */
  title?: string;
  /** 内容是否为 Markdown；日报原文是普通文本，按行原样绘制 */
  markdown?: boolean;
}

function font(size: number, bold: boolean): string {
  return `${bold ? 700 : 400} ${size}px ${FAMILY}`;
}

/** 英文单词/数字整体换行，其余（中文等）逐字换行 */
function tokenize(text: string): string[] {
  return text.match(/[\x21-\x7e]+|\s|./gsu) ?? [];
}

function layoutReport(ctx: CanvasRenderingContext2D, content: string, opts: ReportImageOptions): Layout {
  const runs: Run[] = [];
  const rules: Rule[] = [];
  const squares: Square[] = [];
  const contentW = WIDTH - PAD * 2;
  let y = PAD;

  const width = (t: string, size: number, bold: boolean) => {
    ctx.font = font(size, bold);
    return ctx.measureText(t).width;
  };

  /** 排版一段行内文本，返回首行垂直中心，并推进 y */
  const flow = (spans: Span[], size: number, lineH: number, baseX: number, maxW: number, forceBold = false): number => {
    const firstCenter = y + lineH / 2;
    let x = 0;
    let has = false;
    for (const span of spans) {
      const bold = forceBold || span.bold;
      for (const token of tokenize(span.text)) {
        // 超过整行宽度的超长单词退化为逐字符
        const parts = width(token, size, bold) > maxW ? Array.from(token) : [token];
        for (const part of parts) {
          const blank = /^\s+$/.test(part);
          const w = width(part, size, bold);
          if (x + w > maxW && has && !NO_LINE_START.has(part)) {
            y += lineH;
            x = 0;
            has = false;
          }
          if (!has && blank) continue;
          runs.push({ text: part, bold, size, x: baseX + x, y: y + lineH / 2 });
          x += w;
          has = true;
        }
      }
    }
    y += lineH;
    return firstCenter;
  };

  if (opts.title) {
    flow([{ text: opts.title, bold: true }], 20, 30, PAD, contentW);
    y += 4;
    rules.push({ y, dashed: false });
    y += 14;
  }

  const top = y;
  if (opts.markdown === false) {
    for (const line of content.replace(/\r\n?/g, "\n").split("\n")) {
      if (line.trim() === "") continue;
      flow([{ text: line.trimEnd(), bold: false }], 15, 24, PAD, contentW);
      y += 4;
    }
  } else {
    for (const block of parseBlocks(content)) {
      const spans = parseSpans(block.text);
      if (block.type === "heading") {
        if (y > top) y += 14;
        flow(spans, 18, 28, PAD, contentW, true);
        y += 2;
        rules.push({ y, dashed: true });
        y += 8;
      } else if (block.type === "bullet") {
        const center = flow(spans, 15, 24, PAD + 22, contentW - 22);
        squares.push({ x: PAD + 4, y: center });
        y += 2;
      } else {
        flow(spans, 15, 24, PAD, contentW);
        y += 4;
      }
    }
  }
  return { runs, rules, squares, height: y + PAD - 4 };
}

/** 渲染为 PNG；内容过长超出画布上限时抛出错误 */
export function renderReportImage(content: string, opts: ReportImageOptions = {}): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      const measure = document.createElement("canvas").getContext("2d");
      if (!measure) throw new Error("当前浏览器不支持 Canvas");
      const layout = layoutReport(measure, content, opts);

      const scale = Math.min(2, Math.sqrt(MAX_AREA / (WIDTH * layout.height)), MAX_SIDE / layout.height);
      if (scale < 1) throw new Error("内容过长，无法生成图片");

      const canvas = document.createElement("canvas");
      canvas.width = Math.round(WIDTH * scale);
      canvas.height = Math.round(layout.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("当前浏览器不支持 Canvas");
      ctx.scale(scale, scale);

      ctx.fillStyle = COLOR_BG;
      ctx.fillRect(0, 0, WIDTH, layout.height);
      ctx.strokeStyle = COLOR_INK;
      ctx.lineWidth = 3;
      ctx.strokeRect(1.5, 1.5, WIDTH - 3, layout.height - 3);

      ctx.lineWidth = 2;
      for (const r of layout.rules) {
        ctx.strokeStyle = r.dashed ? "rgba(16, 20, 28, 0.25)" : COLOR_INK;
        ctx.setLineDash(r.dashed ? [6, 4] : []);
        ctx.beginPath();
        ctx.moveTo(PAD, r.y);
        ctx.lineTo(WIDTH - PAD, r.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      ctx.fillStyle = COLOR_EMBER;
      for (const s of layout.squares) ctx.fillRect(s.x, s.y - 3, 6, 6);

      ctx.fillStyle = COLOR_INK;
      ctx.textBaseline = "middle";
      for (const r of layout.runs) {
        ctx.font = font(r.size, r.bold);
        ctx.fillText(r.text, r.x, r.y);
      }

      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("图片生成失败"))), "image/png");
    } catch (e) {
      reject(e);
    }
  });
}
