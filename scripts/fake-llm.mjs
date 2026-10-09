#!/usr/bin/env node
/**
 * 本地假的 OpenAI 兼容服务（/v1/chat/completions，SSE 流式），用于在没有真实密钥时演示和冒烟验证。
 * 它不是真正的大模型：只会按提示词类型把输入材料机械地整理成固定结构，不会产生新内容。
 *
 * 用法：
 *   node scripts/fake-llm.mjs [端口，默认 4010]
 * 切换故障模式（用于验证错误提示与重试）：
 *   curl -X POST "http://127.0.0.1:4010/__mode?m=ok|slow|500|401|429|empty|length|hang"
 */
import { createServer } from "node:http";

const port = Number(process.argv[2] || process.env.PORT || 4010);
let mode = "ok";
let calls = 0;

function between(text, open, close) {
  const m = text.match(new RegExp(`${open}([\\s\\S]*?)${close}`));
  return m ? m[1].trim() : "";
}

function bullets(text) {
  return text
    .split(/[\n，。；;]+/)
    .map((s) => s.replace(/^[-*\s]+/, "").trim())
    .filter(Boolean)
    .map((s) => `- ${s}`);
}

function compose(system, user) {
  if (system.includes("工作日报") && system.includes("优化规则")) {
    return bullets(between(user, "<日报原文>", "</日报原文>")).join("\n");
  }
  const blocks = [...user.matchAll(/<(日报|周报)\s+[^>]*>\n([\s\S]*?)\n<\/\1>/g)];
  const lines = blocks.flatMap((b) => bullets(b[2]));
  const done = lines.length ? lines.join("\n") : "- （无）";
  if (system.includes("## 本周完成事项")) {
    return `## 本周完成事项\n${done}\n\n## 重点成果\n本周日报中未明确记录重点成果。\n\n## 遇到的问题\n本周日报中未记录明显问题。\n\n## 下周计划建议\n- 建议继续跟进本周未完成事项。`;
  }
  return `## 月度工作概览\n本月共整理 ${blocks.length} 份材料。\n${done}\n\n## 主要成果\n本月材料中未明确记录主要成果。\n\n## 问题与反思\n本月材料中未记录明显问题。\n\n## 下月计划建议\n- 建议继续跟进本月未完成事项。`;
}

function chunk(delta, finish, extra = {}) {
  return `data: ${JSON.stringify({ id: "fake-1", object: "chat.completion.chunk", created: 1, model: "fake-model", choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`;
}

createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/__mode") {
    mode = url.searchParams.get("m") || "ok";
    return res.end(`mode=${mode}\n`);
  }
  if (url.pathname === "/__stats") return res.end(JSON.stringify({ calls, mode }));
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", async () => {
    calls += 1;
    if (mode === "hang") return;
    if (mode === "slow") await new Promise((r) => setTimeout(r, Number(process.env.SLOW_MS) || 2000)); // 模拟较慢的模型（默认 2 秒，可用 SLOW_MS 调整），用来观察异步任务的“进行中”状态
    const json = (status, message) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message } }));
    };
    if (mode === "500") return json(500, "internal error");
    if (mode === "401") return json(401, "Unauthorized");
    if (mode === "429") return json(429, "rate limit");
    let text = "";
    if (mode === "ok" || mode === "slow" || mode === "length") {
      const messages = JSON.parse(body || "{}").messages ?? [];
      const system = messages.filter((m) => m.role === "system" || m.role === "developer").map((m) => m.content).join("\n");
      const user = String(messages.filter((m) => m.role === "user").at(-1)?.content ?? "");
      text = compose(system, user);
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(chunk({ role: "assistant", content: mode === "length" ? text.slice(0, 20) : text }, null));
    res.write(chunk({}, mode === "length" ? "length" : "stop", { usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }));
    res.end("data: [DONE]\n\n");
  });
}).listen(port, "127.0.0.1", () => console.log(`fake llm listening on http://127.0.0.1:${port}/v1 (mode=${mode})`));
