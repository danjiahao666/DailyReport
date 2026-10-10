/**
 * 中文像素字体子集化。
 *
 * Fusion Pixel Font 的 zh_hans 完整字重约 660 KB，直接放进首屏不可接受。
 * 本站的中文文案全部写在源码里，用到的汉字集合在构建期就完全确定，可以精确子集化。
 *
 * 产物 src/app/fonts/pixel-zh.woff2 会提交进仓库，因此构建环境（含 Docker）不需要 Python。
 * 只有新增或修改了中文文案、出现字体里缺字的方块时，才需要重跑本脚本：
 *
 *   node scripts/subset-font.mjs
 *
 * 依赖：fonttools + brotli（pip install fonttools brotli）。
 * 可用环境变量 PYFTSUBSET 指定 pyftsubset 的完整路径。
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_FONT = join(ROOT, "assets/fonts/fusion-pixel-12px-proportional-zh_hans.otf.woff2");
const OUT_FONT = join(ROOT, "src/app/fonts/pixel-zh.woff2");
const PYFTSUBSET = process.env.PYFTSUBSET || "pyftsubset";

/** 无论源码里有没有出现都保留的字符：ASCII、常用标点、箭头与符号 */
const ALWAYS_INCLUDE =
  Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join("") +
  "·—…、。，；：？！“”‘’（）《》〈〉【】「」～" +
  "←↑→↓↔★☆●○◆■□▲▼✓✕✗⚠×÷";

const SCAN_DIRS = ["src"];
const SCAN_EXT = new Set([".ts", ".tsx", ".css"]);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SCAN_EXT.has(extname(entry))) out.push(full);
  }
  return out;
}

function collectChars() {
  const chars = new Set(ALWAYS_INCLUDE);
  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(ROOT, dir))) {
      for (const ch of readFileSync(file, "utf8")) {
        if (ch.codePointAt(0) > 127) chars.add(ch);
      }
    }
  }
  return Array.from(chars).sort().join("");
}

if (!existsSync(SRC_FONT)) throw new Error(`字体源文件缺失：${SRC_FONT}`);

const text = collectChars();
execFileSync(
  PYFTSUBSET,
  [SRC_FONT, `--text=${text}`, `--output-file=${OUT_FONT}`, "--flavor=woff2", "--layout-features=", "--no-hinting", "--desubroutinize", "--drop-tables+=DSIG"],
  { stdio: ["ignore", "inherit", "inherit"] },
);

const kb = (p) => (statSync(p).size / 1024).toFixed(1);
console.log(`子集化完成：${Array.from(text).length} 个字符，${kb(SRC_FONT)} KB → ${kb(OUT_FONT)} KB`);
