"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import type { LlmBuiltinProvider, LlmCustomProvider, LlmKeyStatus, LlmSettingsState } from "@/lib/types";
import { API_LABELS, ProviderForm, TestButton } from "./LlmProviderForm";
import { Button, ErrorNotice, Notice, Spinner } from "./ui";

function sourceLabel(source: string | null): string {
  if (!source) return "";
  if (source === "stored credential") return "auth.json";
  return source;
}

function KeyChip({ status }: { status: LlmKeyStatus }) {
  if (status.credentialType === "oauth") {
    return <span className="rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-800">OAuth 登录（由 pi 管理）</span>;
  }
  return status.configured ? (
    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800">已配置{status.source ? ` · ${sourceLabel(status.source)}` : ""}</span>
  ) : (
    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">未配置密钥</span>
  );
}

function Card({ title, hint, action, children }: { title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function DefaultModelCard({ state, busy, onSave }: { state: LlmSettingsState; busy: boolean; onSave: (provider: string | null, model: string) => void }) {
  const [provider, setProvider] = useState(state.defaultProvider ?? "");
  const [model, setModel] = useState(state.defaultModel ?? "");
  const selected = state.selectable.find((p) => p.id === provider);
  const known = state.defaultProvider === null || state.selectable.some((p) => p.id === state.defaultProvider && p.models.some((m) => m.id === state.defaultModel));
  const dirty = provider !== (state.defaultProvider ?? "") || model !== (state.defaultModel ?? "");

  return (
    <Card title="默认模型" hint="日报优化、周报、月报都使用这里选中的模型。未指定时自动使用第一个已配置密钥的模型。">
      {!known && (
        <Notice tone="warn">
          当前默认模型 {state.defaultProvider}/{state.defaultModel} 没有配置密钥或已不存在，调用会失败。请重新选择。
        </Notice>
      )}
      {state.selectable.length === 0 ? (
        <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">还没有已配置密钥的 provider。请先在下方添加自定义 provider，或为内置 provider 填写密钥。</p>
      ) : (
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="space-y-1">
            <span className="block text-slate-600">Provider</span>
            <select
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value);
                setModel(state.selectable.find((p) => p.id === e.target.value)?.models[0]?.id ?? "");
              }}
              disabled={!state.canEdit}
              className="rounded-md border border-slate-300 bg-white px-2 py-1.5"
            >
              <option value="">自动选择</option>
              {state.selectable.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}（{p.id}）
                </option>
              ))}
            </select>
          </label>
          {selected && (
            <label className="space-y-1">
              <span className="block text-slate-600">模型</span>
              <select value={model} onChange={(e) => setModel(e.target.value)} disabled={!state.canEdit} className="max-w-xs rounded-md border border-slate-300 bg-white px-2 py-1.5">
                {selected.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name === m.id ? m.id : `${m.name}（${m.id}）`}
                  </option>
                ))}
              </select>
            </label>
          )}
          {state.canEdit && (
            <Button variant="primary" onClick={() => onSave(provider || null, model)} disabled={busy || !dirty || (provider !== "" && model === "")}>
              保存
            </Button>
          )}
          {selected && model && <TestButton provider={selected.id} model={model} />}
        </div>
      )}
    </Card>
  );
}

function CustomProviderRow({ p, canEdit, busy, onEdit, onDelete }: { p: LlmCustomProvider; canEdit: boolean; busy: boolean; onEdit: () => void; onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <li className="space-y-2 rounded-md border border-slate-200 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{p.name}</span>
            <code className="text-xs text-slate-500">{p.id}</code>
            <KeyChip status={p.key} />
          </div>
          <p className="mt-0.5 break-all text-xs text-slate-500">
            {p.baseUrl} · {API_LABELS[p.api]?.split("（")[0] ?? p.api}
          </p>
          {p.key.source === "models.json apiKey" && (
            <p className="mt-0.5 text-xs text-amber-700">密钥来自 models.json 文件；在编辑里填写新密钥会保存到 auth.json 并优先生效。</p>
          )}
        </div>
        {canEdit && (
          <div className="flex shrink-0 gap-1">
            <Button onClick={onEdit} className="px-2 py-0.5 text-xs">
              编辑
            </Button>
            {confirming ? (
              <>
                <Button variant="danger" onClick={onDelete} disabled={busy} className="px-2 py-0.5 text-xs">
                  确认删除
                </Button>
                <Button onClick={() => setConfirming(false)} className="px-2 py-0.5 text-xs">
                  取消
                </Button>
              </>
            ) : (
              <Button variant="danger" onClick={() => setConfirming(true)} className="px-2 py-0.5 text-xs">
                删除
              </Button>
            )}
          </div>
        )}
      </div>
      <ul className="space-y-1">
        {p.models.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-slate-50 px-2 py-1 text-sm">
            <span>
              {m.name ?? m.id}
              {m.name && <code className="ml-1 text-xs text-slate-500">{m.id}</code>}
              {m.reasoning && <span className="ml-1 rounded bg-violet-100 px-1 text-xs text-violet-700">推理</span>}
            </span>
            <TestButton provider={p.id} model={m.id} disabled={!p.key.configured} />
          </li>
        ))}
      </ul>
    </li>
  );
}

function BuiltinRow({ p, canEdit, busy, onSave, onClear }: { p: LlmBuiltinProvider; canEdit: boolean; busy: boolean; onSave: (key: string) => void; onClear: () => void }) {
  const [key, setKey] = useState("");
  const oauth = p.key.credentialType === "oauth";
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-1 py-2">
      <div className="min-w-0">
        <span className="text-sm font-medium">{p.name}</span> <code className="text-xs text-slate-500">{p.id}</code>
        <div className="mt-0.5">
          <KeyChip status={p.key} />
        </div>
      </div>
      {canEdit && !oauth && (
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            onSave(key.trim());
            setKey("");
          }}
        >
          <input
            type="password"
            autoComplete="new-password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={p.key.storedInAuthJson ? "输入新密钥以替换" : "API 密钥或 $环境变量名"}
            aria-label={`${p.name} API 密钥`}
            className="w-56 rounded-md border border-slate-300 px-2 py-1 text-sm"
          />
          <Button type="submit" variant="primary" disabled={busy || key.trim() === ""} className="px-2 py-1 text-xs">
            保存
          </Button>
          {p.key.storedInAuthJson && (
            <Button onClick={onClear} disabled={busy} className="px-2 py-1 text-xs">
              清除
            </Button>
          )}
        </form>
      )}
    </li>
  );
}

export function LlmSettings() {
  const [state, setState] = useState<LlmSettingsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [form, setForm] = useState<{ initial?: LlmCustomProvider } | null>(null);
  const [filter, setFilter] = useState("");
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setState(await api<LlmSettingsState>("GET", "/api/settings/llm"));
    } catch (e) {
      setLoadError(e as ApiError);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function mutate(method: string, url: string, body: unknown, message: string) {
    setBusy(true);
    setActionError(null);
    setSaved(null);
    try {
      setState(await api<LlmSettingsState>(method, url, body));
      setSaved(message);
    } catch (e) {
      setActionError(e as ApiError);
    } finally {
      setBusy(false);
    }
  }

  const builtin = useMemo(() => {
    if (!state) return [];
    const q = filter.trim().toLowerCase();
    return state.builtinProviders
      .filter((p) => !q || p.id.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
      .sort((a, b) => Number(b.key.configured) - Number(a.key.configured));
  }, [state, filter]);
  const shownBuiltin = filter.trim() || showAll ? builtin : builtin.slice(0, 8);

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">大模型设置</h1>
          <p className="text-sm text-slate-500">配置保存在 pi 约定的 models.json / auth.json / settings.json，修改后立即生效，无需重启</p>
        </div>
        <a href="/" className="text-sm text-blue-700 underline hover:text-blue-900">
          ← 返回日报
        </a>
      </header>

      {loading && !state && <Spinner label="加载中…" />}
      {loadError && <ErrorNotice error={loadError} onRetry={load} busy={loading} />}
      {actionError && <ErrorNotice error={actionError} />}
      {saved && <Notice tone="info">{saved}</Notice>}

      {state && (
        <>
          {state.readonlyReason && <Notice tone="warn">{state.readonlyReason}</Notice>}
          {state.configError && <Notice tone="error">{state.configError}</Notice>}
          {state.envOverride && (
            <Notice tone="info">
              环境变量 {[state.envOverride.provider && `LLM_PROVIDER=${state.envOverride.provider}`, state.envOverride.model && `LLM_MODEL=${state.envOverride.model}`].filter(Boolean).join("、")} 已设置，
              实际使用的模型以环境变量为准，会覆盖下方的默认模型。
            </Notice>
          )}
          {state.warnings.map((w) => (
            <Notice key={w} tone="warn">
              {w}
            </Notice>
          ))}
          <p className="text-xs text-slate-500">
            配置目录：<code>{state.configDir}</code>
          </p>

          <DefaultModelCard
            key={`${state.defaultProvider}/${state.defaultModel}`}
            state={state}
            busy={busy}
            onSave={(provider, model) => mutate("PUT", "/api/settings/llm/default", { provider, model }, provider ? "默认模型已保存" : "已改为自动选择模型")}
          />

          <Card
            title="自定义 provider"
            hint="OpenAI / Anthropic / Gemini 等协议兼容的网关或自建服务（Ollama、vLLM、各类代理）。"
            action={
              state.canEdit && (
                <Button variant="primary" onClick={() => setForm({})}>
                  + 添加
                </Button>
              )
            }
          >
            {state.customProviders.length === 0 ? (
              <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">尚未添加。点击右上角“添加”，填写接口地址、协议、密钥和模型即可。</p>
            ) : (
              <ul className="space-y-3">
                {state.customProviders.map((p) => (
                  <CustomProviderRow
                    key={p.id}
                    p={p}
                    canEdit={state.canEdit}
                    busy={busy}
                    onEdit={() => setForm({ initial: p })}
                    onDelete={() => mutate("DELETE", `/api/settings/llm/provider/${encodeURIComponent(p.id)}`, undefined, `已删除 ${p.name}`)}
                  />
                ))}
              </ul>
            )}
          </Card>

          <Card title="内置 provider 密钥" hint="OpenAI、Anthropic、Gemini、DeepSeek 等直接填写 API 密钥即可使用。部分 provider 还需要额外的环境变量（如 Cloudflare 账号 ID），详见 pi-ai 文档。">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="搜索 provider，如 openai"
              aria-label="搜索 provider"
              className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            />
            <ul className="divide-y divide-slate-100">
              {shownBuiltin.map((p) => (
                <BuiltinRow
                  key={p.id}
                  p={p}
                  canEdit={state.canEdit}
                  busy={busy}
                  onSave={(key) => mutate("PUT", "/api/settings/llm/key", { provider: p.id, key }, `${p.name} 的密钥已保存`)}
                  onClear={() => mutate("PUT", "/api/settings/llm/key", { provider: p.id, key: null }, `${p.name} 的密钥已清除`)}
                />
              ))}
              {shownBuiltin.length === 0 && <li className="py-3 text-sm text-slate-500">没有匹配的 provider</li>}
            </ul>
            {!filter.trim() && builtin.length > 8 && (
              <Button variant="ghost" onClick={() => setShowAll((v) => !v)}>
                {showAll ? "收起" : `显示全部 ${builtin.length} 个`}
              </Button>
            )}
          </Card>
        </>
      )}

      {form && state && (
        <ProviderForm
          initial={form.initial}
          apis={state.apis}
          onClose={() => setForm(null)}
          onSaved={(s) => {
            setState(s);
            setSaved(form.initial ? "已保存" : "已添加，可点击模型旁的“测试连接”验证");
            setForm(null);
          }}
        />
      )}
    </main>
  );
}
