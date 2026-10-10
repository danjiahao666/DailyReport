/**
 * 预构建打包：把 `next build` 生成的 standalone 产物整理成可直接放进 Linux 容器的目录。
 *
 * 用途：服务器内存很小（如 1~2GB）时，在本机构建，服务器只构建“运行阶段”镜像（Dockerfile.prebuilt）。
 *
 * 做了什么：
 *  1. 复制 .next/standalone 与 .next/static 到 prebuilt/，排除 .env* 与构建时产生的 data/（避免泄露本机配置）；
 *  2. 删除其他平台专属的原生二进制（如 Windows 的 sharp），本项目不使用图片优化，运行时不需要；
 *  3. 把产物里写死的本机绝对路径改成容器内的 /app，并把清单里的反斜杠路径改成正斜杠；
 *  4. 自检：仍残留本机路径或非 Linux 二进制时直接报错，不生成压缩包；
 *  5. 生成 daily-report-prebuilt.tgz，便于上传。
 *
 * 用法：npm run pack:prebuilt （会先执行 next build）
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const STANDALONE = path.join(ROOT, ".next", "standalone");
const STATIC = path.join(ROOT, ".next", "static");
const OUT = path.join(ROOT, "prebuilt");
const ARCHIVE = path.join(ROOT, "daily-report-prebuilt.tgz");
const CONTAINER_ROOT = "/app";

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(path.join(STANDALONE, "server.js"))) fail("未找到 .next/standalone/server.js，请先执行 next build");
if (!fs.existsSync(STATIC)) fail("未找到 .next/static，请先执行 next build");

/**
 * 递归删除目录。同样不用 fs.rmSync：在部分 Windows + Node 25 环境下它会只删除一部分文件却不报错。
 * 删除后再检查一次，确实没删干净就报错，避免残留旧文件被打进上传包。
 */
function removeDir(p) {
  if (!fs.existsSync(p) && !fs.lstatSync(p, { throwIfNoEntry: false })) return;
  const st = fs.lstatSync(p);
  if (st.isSymbolicLink() || !st.isDirectory()) {
    fs.unlinkSync(p);
    return;
  }
  for (const name of fs.readdirSync(p)) removeDir(path.join(p, name));
  fs.rmdirSync(p);
}

// ---------- 1. 复制 ----------
/**
 * 递归复制目录。不使用 fs.cpSync：它在部分 Node 版本（如 Windows 上的 Node 25）会无报错地直接退出进程。
 *
 * 符号链接（Windows 上为 junction）会被展开为真实目录/文件：
 * Turbopack 为 serverExternalPackages 生成的 .next/node_modules/@earendil-works/pi-ai-<hash>
 * 是指向本机绝对路径的链接，直接带到 Linux 上就是断链。链接目标必须位于 standalone 目录内。
 */
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    let kind = e;
    let from = s;
    if (e.isSymbolicLink()) {
      from = fs.realpathSync(s);
      const rel = path.relative(STANDALONE, from);
      if (rel.startsWith("..") || path.isAbsolute(rel)) fail(`符号链接指向 standalone 目录之外，拒绝复制：${path.relative(ROOT, s)} -> ${from}`);
      kind = fs.statSync(from);
      console.log(`  展开符号链接 ${path.relative(STANDALONE, s)} -> ${rel}`);
    }
    if (kind.isDirectory()) copyDir(from, d);
    else if (kind.isFile()) fs.copyFileSync(from, d);
    else fail(`不支持复制特殊文件：${path.relative(ROOT, s)}`);
  }
}

removeDir(OUT);
if (fs.existsSync(OUT)) fail(`无法清理旧目录：${OUT}`);
fs.rmSync(ARCHIVE, { force: true });
fs.mkdirSync(OUT, { recursive: true });

// 顶层只放行 .next / node_modules / package.json / server.js：.env*、data/ 等一律不带
const TOP_ALLOWED = new Set([".next", "node_modules", "package.json", "server.js"]);
for (const name of fs.readdirSync(STANDALONE)) {
  if (!TOP_ALLOWED.has(name)) {
    console.log(`  跳过 ${name}`);
    continue;
  }
  const s = path.join(STANDALONE, name);
  const d = path.join(OUT, name);
  if (fs.statSync(s).isDirectory()) copyDir(s, d);
  else fs.copyFileSync(s, d);
}
copyDir(STATIC, path.join(OUT, ".next", "static"));

// ---------- 2. 删除其他平台的原生二进制 ----------
const removed = [];
function pruneNative(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (!e.isDirectory()) continue;
    if (/-(win32|darwin|freebsd|android)-/.test(e.name)) {
      removeDir(p);
      if (fs.existsSync(p)) fail(`无法删除：${path.relative(OUT, p)}`);
      removed.push(path.relative(OUT, p));
      continue;
    }
    // 只在 node_modules 及其作用域目录下查找，避免遍历整棵依赖树
    if (e.name === "node_modules" || e.name.startsWith("@")) pruneNative(p);
  }
}
pruneNative(path.join(OUT, "node_modules"));
removed.forEach((r) => console.log(`  删除非 Linux 二进制目录 ${r}`));

// ---------- 3. 修正路径 ----------
const nativeRoot = ROOT; // 例如 E:\Work\日报助手\DailyReport
const variants = [...new Set([nativeRoot, nativeRoot.replaceAll("\\", "\\\\"), nativeRoot.replaceAll("\\", "/")])];

/** 把文本中的本机根路径替换为容器路径，返回替换次数 */
function replaceRoot(text) {
  let n = 0;
  for (const v of variants) {
    if (!v) continue;
    const parts = text.split(v);
    n += parts.length - 1;
    text = parts.join(CONTAINER_ROOT);
  }
  return { text, n };
}

// server.js：内嵌的配置里写死了构建时的绝对路径
const serverFile = path.join(OUT, "server.js");
const sv = replaceRoot(fs.readFileSync(serverFile, "utf8"));
fs.writeFileSync(serverFile, sv.text);
console.log(`  server.js 修正根路径 ${sv.n} 处`);

// required-server-files.json：根路径 + 反斜杠分隔的相对路径
const rsfFile = path.join(OUT, ".next", "required-server-files.json");
let rsfChanged = 0;
function fixPathString(s) {
  let r = replaceRoot(s).text;
  // 只处理“看起来是文件路径”的字符串；含正则元字符的不动
  if (r.includes("\\") && !/[\^$()|*+?{}]/.test(r)) r = r.replaceAll("\\", "/");
  if (r !== s) rsfChanged++;
  return r;
}
function walkJson(v) {
  if (typeof v === "string") return fixPathString(v);
  if (Array.isArray(v)) return v.map(walkJson);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walkJson(x)]));
  return v;
}
fs.writeFileSync(rsfFile, JSON.stringify(walkJson(JSON.parse(fs.readFileSync(rsfFile, "utf8")))));
console.log(`  required-server-files.json 修正 ${rsfChanged} 个路径字符串`);

// ---------- 4. 自检 ----------
const problems = [];
const TEXT_EXT = /\.(js|json|mjs|cjs|html|rsc|txt|map)$/;
function scan(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      scan(p);
      continue;
    }
    const rel = path.relative(OUT, p);
    if (/^\.env/.test(e.name)) problems.push(`含环境文件：${rel}`);
    if (/\.(exe|dll|dylib)$/.test(e.name)) problems.push(`含非 Linux 二进制：${rel}`);
    if (/\.node$/.test(e.name) && /(win32|darwin)/.test(rel)) problems.push(`含非 Linux 原生模块：${rel}`);
    if (!TEXT_EXT.test(e.name)) continue;
    const s = fs.readFileSync(p, "utf8");
    if (variants.some((v) => v && s.includes(v))) problems.push(`残留本机路径：${rel}`);
  }
}
scan(OUT);
// 清单里不应再有盘符路径
const rsfText = fs.readFileSync(rsfFile, "utf8");
if (/[A-Za-z]:[\\/]/.test(rsfText.replace(/https?:\/\//g, ""))) problems.push("required-server-files.json 仍含盘符路径");
if (problems.length) fail(`产物自检未通过：\n  - ${problems.join("\n  - ")}`);
console.log("  自检通过：无本机路径、无 .env、无非 Linux 二进制");

// ---------- 5. 压缩 ----------
// 使用相对路径并在项目根目录执行：GNU tar 会把“E:\...”里的盘符当成远程主机名
const tar = spawnSync("tar", ["-czf", path.basename(ARCHIVE), "-C", path.basename(OUT), "."], { cwd: ROOT, stdio: "inherit" });
if (tar.status !== 0) {
  console.warn(`\n! 压缩失败（tar 退出码 ${tar.status ?? "无"}）。请手动打包 ${OUT} 目录后上传。`);
  process.exit(1);
} else {
  const mb = (fs.statSync(ARCHIVE).size / 1024 / 1024).toFixed(1);
  console.log(`\n✓ 已生成 ${path.relative(ROOT, ARCHIVE)}（${mb} MB）和目录 prebuilt/`);
}
