"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import type { LlmCustomProvider, LlmSettingsState, LlmTestResult } from "@/lib/types";
import { Button, ErrorNotice, Modal } from "./ui";

export const API_LABELS: Record<string, string> = {
  "openai-completions": "OpenAI Chat Completions 兼容（多数网关、Ollama、vLLM 选这个）",
  "openai-responses": "OpenAI Responses",
  "anthropic-messages": "Anthropic Messages",
  "google-generative-ai": "Google Gemini",
  "mistral-conversations": "Mistral",
  "azure-openai-responses": "Azure OpenAI Responses",
};

interface ModelRow {
  id: string;
  name: string;
  contextWindow: string;
  maxTokens: string;
  reasoning: boolean;
}

const emptyRow = (): ModelRow => ({ id: "", name: "", contextWindow: "", maxTokens: "", reasoning: false });

function toInt(label: string, v: string): number | undefined {
  if (v.trim() === "") return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${label}必须是正整数`);
  return n;
}

/** 单个模型的连通性测试按钮（发一次极短的真实请求） */
export function TestButton({ provider, model, disabled }: { provider: string; model: string; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LlmTestResult | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    setError(null);
    try {
      setResult(await api<LlmTestResult>("POST", "/api/settings/llm/test", { provider, model }));
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button onClick={run} disabled={busy || disabled} className="px-2 py-0.5 text-xs">
        {busy ? "测试中…" : "测试连接"}
      </Button>
      {result && <span className="text-xs text-emerald-700">✓ 连接正常（{result.ms} ms）</span>}
      {error && <span className="max-w-xs text-xs text-red-700">✗ {error.message}</span>}
    </span>
  );
}

export function ProviderForm({
  initial,
  apis,
  onClose,
  onSaved,
}: {
  initial?: LlmCustomProvider;
  apis: string[];
  onClose: () => void;
  onSaved: (state: LlmSettingsState) => void;
}) {
  const editing = initial !== undefined;
  const [id, setId] = useState(initial?.id ?? "");
  const [name, setName] = useState(initial?.name && initial.name !== initial.id ? initial.name : "");
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "");
  const [apiId, setApiId] = useState(initial?.api || "openai-completions");
  const [apiKey, setApiKey] = useState("");
  const [rows, setRows] = useState<ModelRow[]>(
    initial && initial.models.length > 0
      ? initial.models.map((m) => ({
          id: m.id,
          name: m.name ?? "",
          contextWindow: m.contextWindow?.toString() ?? "",
          maxTokens: m.maxTokens?.toString() ?? "",
          reasoning: m.reasoning ?? false,
        }))
      : [emptyRow()],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);

  const patchRow = (i: number, p: Partial<ModelRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    let models;
    try {
      models = rows.map((r) => ({
        id: r.id.trim(),
        name: r.name.trim() || undefined,
        contextWindow: toInt("上下文窗口", r.contextWindow),
        maxTokens: toInt("最大输出", r.maxTokens),
        reasoning: r.reasoning || undefined,
      }));
    } catch (err) {
      setError(err as Error);
      return;
    }
    setBusy(true);
    try {
      const state = await api<LlmSettingsState>("PUT", "/api/settings/llm/provider", {
        id: id.trim(),
        name: name.trim() || undefined,
        baseUrl: baseUrl.trim(),
        api: apiId,
        models,
        apiKey: apiKey.trim() || undefined,
      });
      onSaved(state);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }

  const input = "w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm";
  return (
    <Modal title={editing ? `编辑 ${initial.name}` : "添加自定义 provider"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="font-medium">标识 *</span>
            <input value={id} onChange={(e) => setId(e.target.value)} disabled={editing} placeholder="my-gateway" className={`${input} disabled:bg-slate-100`} />
          </label>
          <label className="space-y-1">
            <span className="font-medium">显示名称</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="我的网关" className={input} />
          </label>
        </div>
        <label className="block space-y-1">
          <span className="font-medium">接口地址 *</span>
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" className={input} />
        </label>
        <label className="block space-y-1">
          <span className="font-medium">接口协议 *</span>
          <select value={apiId} onChange={(e) => setApiId(e.target.value)} className={`${input} bg-white`}>
            {apis.map((a) => (
              <option key={a} value={a}>
                {API_LABELS[a] ?? a}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="font-medium">API 密钥</span>
          <input
            type="password"
            autoComplete="new-password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={initial?.key.configured ? "已配置（留空表示不修改）" : "sk-… 或 $环境变量名"}
            className={input}
          />
          <span className="text-xs text-slate-500">保存到 auth.json，不会写入 models.json，页面也不会再显示它。</span>
        </label>

        <fieldset className="space-y-2 rounded-md border border-slate-200 p-3">
          <legend className="px-1 font-medium">模型 *</legend>
          {rows.map((r, i) => (
            <div key={i} className="space-y-1 border-b border-slate-100 pb-2 last:border-0 last:pb-0">
              <div className="flex gap-2">
                <input value={r.id} onChange={(e) => patchRow(i, { id: e.target.value })} placeholder="模型 ID，如 qwen-plus" aria-label="模型 ID" className={input} />
                <input value={r.name} onChange={(e) => patchRow(i, { name: e.target.value })} placeholder="显示名（可选）" aria-label="显示名" className={input} />
                <Button variant="ghost" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} disabled={rows.length === 1} aria-label="删除模型" className="px-2">
                  ✕
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <input value={r.contextWindow} onChange={(e) => patchRow(i, { contextWindow: e.target.value })} placeholder="上下文窗口" inputMode="numeric" aria-label="上下文窗口" className="w-28 rounded-md border border-slate-300 px-2 py-1" />
                <input value={r.maxTokens} onChange={(e) => patchRow(i, { maxTokens: e.target.value })} placeholder="最大输出" inputMode="numeric" aria-label="最大输出" className="w-28 rounded-md border border-slate-300 px-2 py-1" />
                <label className="flex items-center gap-1 text-slate-600">
                  <input type="checkbox" checked={r.reasoning} onChange={(e) => patchRow(i, { reasoning: e.target.checked })} />
                  推理模型
                </label>
              </div>
            </div>
          ))}
          <Button onClick={() => setRows((rs) => [...rs, emptyRow()])} className="px-2 py-1 text-xs">
            + 添加模型
          </Button>
          <p className="text-xs text-slate-500">上下文窗口、最大输出可留空（默认 128000 / 16384）；“最大输出”会限制单次生成长度，周报、月报较长时不要设得太小。</p>
        </fieldset>

        {error && (error instanceof ApiError ? <ErrorNotice error={error} /> : <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-800">{error.message}</p>)}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>取消</Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "保存中…" : "保存"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
