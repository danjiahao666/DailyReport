#!/usr/bin/env node
/**
 * 端到端冒烟验证（自包含）：启动假的 OpenAI 兼容模型服务 + 构建产物服务，
 * 依次验证 记录日报 → 优化 → 周报 → 月报 的核心流程，以及失败重试、版本管理、访问保护。
 * 数据写入临时目录，结束后清理，不会碰真实数据。
 *
 * 前置：npm run build
 * 运行：npm run smoke
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LLM_PORT = 4010;
const APP_PORT = 3100;
const BASE = `http://127.0.0.1:${APP_PORT}`;
const LLM = `http://127.0.0.1:${LLM_PORT}`;
const PASSWORD = "smoke-password";

const tmp = mkdtempSync(path.join(os.tmpdir(), "daily-report-smoke-"));
const cfg = path.join(tmp, "pi-config");
const data = path.join(tmp, "data");
const procs = [];
let cookie = "";
let failed = 0;

function ok(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failed += 1;
    console.log(`  ✗ ${name}${detail !== undefined ? `\n      ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
  }
}

async function req(method, url, body, { auth = true, headers = {} } = {}) {
  const res = await fetch(BASE + url, {
    method,
    redirect: "manual",
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(auth && cookie ? { cookie } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* 非 JSON（页面） */
  }
  return { status: res.status, json, text, res };
}

const llmStats = async () => (await (await fetch(`${LLM}/__stats`)).json()).calls;
const llmMode = (m) => fetch(`${LLM}/__mode?m=${m}`, { method: "POST" });

function start(cmd, args, env) {
  const p = spawn(cmd, args, { cwd: root, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  p.stdout.on("data", () => {});
  p.stderr.on("data", (d) => process.env.SMOKE_VERBOSE && process.stderr.write(d));
  procs.push(p);
  return p;
}

async function waitFor(url, label) {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {
      /* 继续等待 */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`${label} 启动超时`);
}

async function main() {
  const standalone = path.join(root, ".next", "standalone", "server.js");
  if (!existsSync(standalone)) throw new Error("未找到构建产物，请先执行 npm run build");

  // pi 风格配置：models.json（自定义端点，密钥通过 $ENV 引用）+ settings.json
  const { mkdirSync } = await import("node:fs");
  mkdirSync(cfg, { recursive: true });
  writeFileSync(
    path.join(cfg, "models.json"),
    JSON.stringify({
      providers: {
        fake: { name: "Fake", baseUrl: `${LLM}/v1`, api: "openai-completions", apiKey: "$SMOKE_KEY", models: [{ id: "fake-model", maxTokens: 4096 }] },
      },
    }),
  );
  writeFileSync(path.join(cfg, "settings.json"), JSON.stringify({ defaultProvider: "fake", defaultModel: "fake-model" }));

  start("node", ["scripts/fake-llm.mjs", String(LLM_PORT)], {});
  start("node", [standalone], {
    PORT: String(APP_PORT),
    HOSTNAME: "127.0.0.1",
    NODE_ENV: "production",
    DATA_DIR: data,
    PI_CODING_AGENT_DIR: cfg,
    SMOKE_KEY: "smoke-key",
    APP_PASSWORD: PASSWORD,
    LLM_TIMEOUT_MS: "3000",
    NODE_OPTIONS: "--disable-warning=ExperimentalWarning",
  });
  await waitFor(`${LLM}/__stats`, "假模型服务");
  await waitFor(`${BASE}/api/health`, "应用");

  console.log("访问保护");
  ok("健康检查无需登录", (await req("GET", "/api/health", undefined, { auth: false })).status === 200);
  const anon = await req("GET", "/", undefined, { auth: false });
  ok("未登录访问页面被重定向到 /login", anon.status === 307 && anon.res.headers.get("location")?.endsWith("/login"), anon.status);
  ok("未登录访问接口返回 401", (await req("GET", "/api/calendar?month=2026-10", undefined, { auth: false })).status === 401);
  ok("密码错误被拒绝", (await req("POST", "/api/auth/login", { password: "x" }, { auth: false })).status === 401);
  const login = await req("POST", "/api/auth/login", { password: PASSWORD }, { auth: false });
  cookie = (login.res.headers.get("set-cookie") ?? "").split(";")[0];
  ok("登录成功并下发 httpOnly Cookie", login.status === 200 && /httponly/i.test(login.res.headers.get("set-cookie") ?? ""));
  const page = await req("GET", "/");
  ok("登录后可打开首页", page.status === 200 && page.text.includes("日报助手"), page.status);

  console.log("1. 记录日报");
  const D1 = "2026-12-29"; // 周二，周 2026-12-28 ~ 2027-01-03 跨月
  const D2 = "2027-01-01";
  const D3 = "2027-01-05"; // 周 2027-01-04 ~ 2027-01-10，整周在一月
  ok("提交日报", (await req("POST", "/api/daily", { date: D1, content: "整理年底归档资料；评审发布方案" })).status === 200);
  await req("POST", "/api/daily", { date: D2, content: "跟进元旦值班；修复登录页缺陷" });
  await req("POST", "/api/daily", { date: D3, content: "联调报表接口；编写测试用例" });
  const dup = await req("POST", "/api/daily", { date: D1, content: "补充：同步评审结论" });
  ok("同一天重复提交返回冲突并附带已有内容", dup.status === 409 && dup.json.error.code === "DAILY_EXISTS" && dup.json.error.existing.original.includes("归档"));
  const app = await req("POST", "/api/daily", { date: D1, content: "补充：同步评审结论", mode: "append" });
  ok("选择追加后合并到原文", app.json.original.endsWith("补充：同步评审结论") && app.json.original.includes("归档"));

  console.log("2. 日报优化");
  const opt = await req("POST", `/api/daily/${D1}/optimize`);
  ok("优化成功，原文保留，优化稿作为候选", opt.status === 200 && opt.json.entry.optimized?.startsWith("- ") && opt.json.entry.active === "original", opt.json);
  ok("采用优化稿", (await req("PUT", `/api/daily/${D1}/active`, { active: "optimized" })).json.active === "optimized");
  ok("随时回退到原文", (await req("PUT", `/api/daily/${D1}/active`, { active: "original" })).json.effective.includes("归档资料"));
  await llmMode("500");
  const bad = await req("POST", `/api/daily/${D2}/optimize`);
  ok("模型故障时返回明确错误且可重试", bad.status === 502 && bad.json.error.code === "LLM_UPSTREAM" && bad.json.error.retryable === true, bad.json);
  ok("失败不影响已保存的原文", (await req("GET", `/api/daily/${D2}`)).json.entry.original.includes("元旦值班"));
  await llmMode("empty");
  ok("空内容有明确提示", (await req("POST", `/api/daily/${D2}/optimize`)).json.error.code === "LLM_EMPTY");
  await llmMode("hang");
  const slow = await req("POST", `/api/daily/${D2}/optimize`);
  ok("超时有明确提示", slow.status === 504 && slow.json.error.code === "LLM_TIMEOUT", slow.json);
  await llmMode("ok");
  ok("故障恢复后重试成功", (await req("POST", `/api/daily/${D2}/optimize`)).status === 200);

  console.log("3. 周报");
  const before = await llmStats();
  const empty = await req("POST", "/api/reports/weekly", { date: "2027-02-10" });
  ok("无日报的周给出明确提示", empty.status === 422 && empty.json.error.code === "NO_DAILY", empty.json);
  ok("且没有调用大模型", (await llmStats()) === before);
  const wk = await req("POST", "/api/reports/weekly", { date: D3 });
  const wid = wk.json?.id;
  ok("生成周报（周一起始 2027-01-04 ~ 2027-01-10）", wk.status === 200 && wk.json.periodStart === "2027-01-04" && wk.json.periodEnd === "2027-01-10" && wk.json.current.content.includes("## 下周计划建议"), wk.json);
  ok("手动编辑生成新版本", (await req("PUT", `/api/reports/${wid}`, { content: "## 我的周报\n- 手写内容" })).json.current.versionNo === 2);
  const refuse = await req("POST", "/api/reports/weekly", { date: D3 });
  ok("重新生成前需确认，避免覆盖已编辑内容", refuse.status === 409 && refuse.json.error.code === "CONFIRM_OVERWRITE_EDITED");
  const regen = await req("POST", "/api/reports/weekly", { date: D3, confirm: true });
  ok("确认后生成新版本，已编辑版本仍保留", regen.json.current.versionNo === 3 && regen.json.versions.some((v) => v.versionNo === 2 && v.content.includes("手写内容")));
  const v2 = regen.json.versions.find((v) => v.versionNo === 2);
  const rest = await req("POST", `/api/reports/${wid}/restore`, { versionId: v2.id });
  ok("可恢复历史版本", rest.json.current.content.includes("手写内容") && rest.json.versions.length === 4);

  console.log("4. 月报（2027-01，含跨月周）");
  const planW = await req("GET", "/api/reports/monthly/plan?month=2027-01&source=weekly");
  const w0 = planW.json.weeks[0];
  ok("跨月周按日期归属拆分，仅取属于本月的日期", w0.weekStart === "2026-12-28" && w0.full === false && w0.use === "daily" && w0.from === "2027-01-01", w0);
  ok("整周在本月且有周报的周使用周报", planW.json.weeks.some((w) => w.weekStart === "2027-01-04" && w.use === "weekly"));
  const mDaily = await req("POST", "/api/reports/monthly", { month: "2027-01", source: "daily" });
  ok("基于日报生成月报", mDaily.status === 200 && mDaily.json.current.content.includes("## 月度工作概览"), mDaily.json);
  ok("月报不包含上月日期的日报", !mDaily.json.current.content.includes("归档") && mDaily.json.current.meta.dailyDates.join() === `${D2},${D3}`, mDaily.json.current.meta);
  const mWeekly = await req("POST", "/api/reports/monthly", { month: "2027-01", source: "weekly" });
  ok("基于周报生成月报（保留为新版本）", mWeekly.status === 200 && mWeekly.json.current.versionNo === 2 && mWeekly.json.current.meta.source === "weekly", mWeekly.json);
  const mEmpty = await req("POST", "/api/reports/monthly", { month: "2027-05", source: "daily" });
  ok("无数据的月份给出明确提示", mEmpty.status === 422 && mEmpty.json.error.code === "NO_DATA");

  console.log("5. 日历");
  const cal = await req("GET", "/api/calendar?month=2027-01");
  ok("日历同时区分日报、周报、月报", cal.json.dailies.length === 3 && cal.json.weeklies.length >= 1 && cal.json.monthly?.periodStart === "2027-01-01", { d: cal.json.dailies.length, w: cal.json.weeklies.length, m: cal.json.monthly });
  ok("删除日报", (await req("DELETE", `/api/daily/${D3}`)).status === 200);
  ok("来源变化后周报提示已过期", (await req("GET", `/api/reports/weekly?date=${D3}`)).json.report.outdated === true);
}

try {
  await main();
} catch (e) {
  failed += 1;
  console.log(`  ✗ 冒烟脚本异常：${e instanceof Error ? e.message : e}`);
} finally {
  for (const p of procs) p.kill();
  await new Promise((r) => setTimeout(r, 500));
  rmSync(tmp, { recursive: true, force: true });
}
console.log(failed === 0 ? "\n全部通过" : `\n失败 ${failed} 项`);
process.exit(failed === 0 ? 0 : 1);
