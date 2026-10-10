"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import type { LlmCustomProvider, LlmRemoteModel, LlmSettingsState, LlmTestResult } from "@/lib/types";
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
  /** 在列表模式下手动输入（列表里没有想要的模型时） */
  manual?: boolean;
  /** 名称 / 上下文 / 最大输出是选模型时自动带出的：换选别的模型时可以被覆盖，用户亲手改过就不再覆盖 */
  auto?: boolean;
}

const MANUAL = "__manual__";

/** 下拉里的显示文字：有名称且与 id 不同时带上名称 */
const optionLabel = (m: LlmRemoteModel) => (m.name && m.name !== m.id ? `${m.name}（${m.id}）` : m.id);

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
      <Button size="sm" onClick={run} disabled={busy || disabled}>
        {busy ? "测试中…" : "测试连接"}
      </Button>
      {result && <span className="text-xs font-semibold text-mint-deep">✓ 连接正常（{result.ms} ms）</span>}
      {error && <span className="max-w-xs text-xs font-semibold text-coral-deep">✗ {error.message}</span>}
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
  const [baseUrl, setBaseUrlState] = useState(initial?.baseUrl ?? "");
  const [apiId, setApiIdState] = useState(initial?.api || "openai-completions");
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

  // 获取到的模型列表；null 表示还没获取过
  const [available, setAvailable] = useState<LlmRemoteModel[] | null>(null);
  const [listing, setListing] = useState(false);
  const [listError, setListError] = useState<ApiError | null>(null);

  // 地址或协议变了，旧列表就不再可信，清掉让用户重新获取
  const setBaseUrl = (v: string) => {
    setBaseUrlState(v);
    setAvailable(null);
  };
  const setApiId = (v: string) => {
    setApiIdState(v);
    setAvailable(null);
  };

  async function fetchModels() {
    setListing(true);
    setListError(null);
    try {
      const res = await api<{ models: LlmRemoteModel[] }>("POST", "/api/settings/llm/models", {
        baseUrl: baseUrl.trim(),
        api: apiId,
        // 没填新密钥且是在编辑已有 provider 时，由服务端沿用已保存的密钥（地址没变的前提下）
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : editing ? { providerId: initial.id } : {}),
      });
      setAvailable(res.models);
    } catch (e) {
      setListError(e as ApiError);
    } finally {
      setListing(false);
    }
  }

  /** 从下拉里选中一个模型：填入 id，并在对应字段还空着（或上次也是自动带出）时补上名称、上下文与最大输出 */
  function pickModel(i: number, id: string) {
    if (id === MANUAL) return patchRow(i, { manual: true, id: "" });
    const m = available?.find((x) => x.id === id);
    setRows((rs) =>
      rs.map((r, j) => {
        if (j !== i) return r;
        const fill = r.auto || (r.name === "" && r.contextWindow === "" && r.maxTokens === "");
        if (!m || !fill) return { ...r, id };
        return {
          ...r,
          id,
          name: m.name ?? "",
          contextWindow: m.contextWindow?.toString() ?? "",
          maxTokens: m.maxTokens?.toString() ?? "",
          auto: true,
        };
      }),
    );
  }

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

  const input = "pixel-field";
  return (
    <Modal title={editing ? `编辑 ${initial.name}` : "添加自定义 provider"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="font-medium">标识 *</span>
            <input value={id} onChange={(e) => setId(e.target.value)} disabled={editing} placeholder="my-gateway" className={input} />
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
          <select value={apiId} onChange={(e) => setApiId(e.target.value)} className={`${input} !w-full`}>
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
          <span className="text-xs text-muted">保存到 auth.json，不会写入 models.json，页面也不会再显示它。</span>
        </label>

        <fieldset className="pixel-card space-y-2 p-3">
          <legend className="bg-parchment px-1.5 font-pixel text-base">模型 *</legend>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={fetchModels} disabled={listing || baseUrl.trim() === ""} title={baseUrl.trim() === "" ? "请先填写接口地址" : undefined}>
              {listing ? "获取中…" : available ? "重新获取模型列表" : "获取模型列表"}
            </Button>
            <span className="text-xs text-muted">
              {available
                ? `已获取 ${available.length} 个模型，可在下方“模型 ID”处下拉选择。`
                : "填好接口地址与密钥后，可从供应商获取可用模型，免去手敲 ID。"}
            </span>
          </div>
          {listError && <ErrorNotice error={listError} />}
          {rows.map((r, i) => {
            // 已获取列表后，空行或 id 在列表里的行用下拉；列表里没有的 id（或选了“手动输入”）仍用文本框
            const inList = available?.some((m) => m.id === r.id) ?? false;
            const useSelect = available !== null && !r.manual && (r.id === "" || inList);
            const usedElsewhere = new Set(rows.filter((_, j) => j !== i).map((x) => x.id));
            return (
              <div key={i} className="space-y-1.5 border-b-2 border-dashed border-ink/20 pb-2 last:border-0 last:pb-0">
                <div className="flex gap-2">
                  {useSelect ? (
                    <select value={r.id} onChange={(e) => pickModel(i, e.target.value)} aria-label="模型 ID" className={`${input} !w-full min-w-0`}>
                      <option value="">请选择模型…</option>
                      {available!
                        .filter((m) => !usedElsewhere.has(m.id))
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {optionLabel(m)}
                          </option>
                        ))}
                      <option value={MANUAL}>✎ 手动输入…</option>
                    </select>
                  ) : (
                    <input value={r.id} onChange={(e) => patchRow(i, { id: e.target.value })} placeholder="模型 ID，如 qwen-plus" aria-label="模型 ID" className={input} />
                  )}
                  <input value={r.name} onChange={(e) => patchRow(i, { name: e.target.value, auto: false })} placeholder="显示名（可选）" aria-label="显示名" className={input} />
                  <Button size="sm" variant="ghost" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} disabled={rows.length === 1} aria-label="删除模型" className="shrink-0">
                    ✕
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <input value={r.contextWindow} onChange={(e) => patchRow(i, { contextWindow: e.target.value, auto: false })} placeholder="上下文窗口" inputMode="numeric" aria-label="上下文窗口" className="pixel-field !w-28 !py-0.5 !text-xs" />
                  <input value={r.maxTokens} onChange={(e) => patchRow(i, { maxTokens: e.target.value, auto: false })} placeholder="最大输出" inputMode="numeric" aria-label="最大输出" className="pixel-field !w-28 !py-0.5 !text-xs" />
                  <label className="flex items-center gap-1 text-ink-soft">
                    <input type="checkbox" className="pixel-check" checked={r.reasoning} onChange={(e) => patchRow(i, { reasoning: e.target.checked })} />
                    推理模型
                  </label>
                  {available && !useSelect && (
                    <Button size="sm" variant="ghost" onClick={() => patchRow(i, { manual: false })}>
                      从列表选择
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
          <Button size="sm" onClick={() => setRows((rs) => [...rs, emptyRow()])}>
            + 添加模型
          </Button>
          <p className="text-xs text-muted">上下文窗口、最大输出可留空（默认 128000 / 16384）；“最大输出”会限制单次生成长度，周报、月报较长时不要设得太小。</p>
        </fieldset>

        {error && (error instanceof ApiError ? <ErrorNotice error={error} /> : <p role="alert" className="pixel-notice pixel-notice--error">{error.message}</p>)}
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
