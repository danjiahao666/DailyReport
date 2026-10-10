"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import type { LlmBuiltinProvider, LlmCustomProvider, LlmKeyStatus, LlmSettingsState } from "@/lib/types";
import { API_LABELS, ProviderForm, TestButton } from "./LlmProviderForm";
import { SiteHeader } from "./pixel";
import { Button, ErrorNotice, Notice, Spinner } from "./ui";

function sourceLabel(source: string | null): string {
  if (!source) return "";
  if (source === "stored credential") return "auth.json";
  return source;
}

function KeyChip({ status }: { status: LlmKeyStatus }) {
  if (status.credentialType === "oauth") {
    return <span className="pixel-tag pixel-tag--blue">OAuth 登录（由 pi 管理）</span>;
  }
  return status.configured ? (
    <span className="pixel-tag pixel-tag--green">已配置{status.source ? ` · ${sourceLabel(status.source)}` : ""}</span>
  ) : (
    <span className="pixel-tag pixel-tag--plain">未配置密钥</span>
  );
}

function Card({ title, hint, action, children }: { title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="pixel-panel">
      <header className="pixel-titlebar">
        <div>
          <h2 className="font-pixel text-lg">{title}</h2>
          {hint && <p className="mt-0.5 text-xs text-parchment/80">{hint}</p>}
        </div>
        {action}
      </header>
      <div className="space-y-3 p-4">{children}</div>
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
        <p className="pixel-well border-dashed p-3 text-sm text-ink-soft">还没有已配置密钥的 provider。请先在下方添加自定义 provider，或为内置 provider 填写密钥。</p>
      ) : (
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="space-y-1">
            <span className="block text-ink-soft">Provider</span>
            <select
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value);
                setModel(state.selectable.find((p) => p.id === e.target.value)?.models[0]?.id ?? "");
              }}
              disabled={!state.canEdit}
              className="pixel-field"
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
              <span className="block text-ink-soft">模型</span>
              <select value={model} onChange={(e) => setModel(e.target.value)} disabled={!state.canEdit} className="pixel-field max-w-xs">
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
    <li className="pixel-card space-y-2 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{p.name}</span>
            <code className="text-xs text-muted">{p.id}</code>
            <KeyChip status={p.key} />
          </div>
          <p className="mt-0.5 break-all text-xs text-muted">
            {p.baseUrl} · {API_LABELS[p.api]?.split("（")[0] ?? p.api}
          </p>
          {p.key.source === "models.json apiKey" && (
            <p className="mt-0.5 text-xs text-amber-deep">密钥来自 models.json 文件；在编辑里填写新密钥会保存到 auth.json 并优先生效。</p>
          )}
        </div>
        {canEdit && (
          <div className="flex shrink-0 gap-1">
            <Button size="sm" onClick={onEdit}>
              编辑
            </Button>
            {confirming ? (
              <>
                <Button size="sm" variant="danger" onClick={onDelete} disabled={busy}>
                  确认删除
                </Button>
                <Button size="sm" onClick={() => setConfirming(false)}>
                  取消
                </Button>
              </>
            ) : (
              <Button size="sm" variant="danger" onClick={() => setConfirming(true)}>
                删除
              </Button>
            )}
          </div>
        )}
      </div>
      <ul className="space-y-1">
        {p.models.map((m) => (
          <li key={m.id} className="pixel-well flex flex-wrap items-center justify-between gap-2 px-2 py-1 text-sm">
            <span>
              {m.name ?? m.id}
              {m.name && <code className="ml-1 text-xs text-muted">{m.id}</code>}
              {m.reasoning && <span className="pixel-tag pixel-tag--violet ml-1">推理</span>}
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
    <li className="flex flex-wrap items-center justify-between gap-2 px-1 py-2.5">
      <div className="min-w-0">
        <span className="text-sm font-semibold">{p.name}</span> <code className="text-xs text-muted">{p.id}</code>
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
            className="pixel-field !w-56 !py-0.5"
          />
          <Button type="submit" size="sm" variant="primary" disabled={busy || key.trim() === ""}>
            保存
          </Button>
          {p.key.storedInAuthJson && (
            <Button size="sm" onClick={onClear} disabled={busy}>
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
    <>
      <SiteHeader
        narrow
        title="大模型设置"
        tagline="配置保存在 pi 约定的 models.json / auth.json / settings.json，修改后立即生效，无需重启"
        actions={
          <>
            <a href="/" className="pixel-button">
              ← 返回日报
            </a>
            <a href="/preferences" className="pixel-button">
              设置中心
            </a>
          </>
        }
      />
    <main className="page-shell max-w-4xl space-y-5 py-6">
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
          <p className="text-xs text-[color:var(--page-text-dim)]">
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
                <Button size="sm" variant="primary" onClick={() => setForm({})}>
                  + 添加
                </Button>
              )
            }
          >
            {state.customProviders.length === 0 ? (
              <p className="pixel-well border-dashed p-3 text-sm text-ink-soft">尚未添加。点击右上角“添加”，填写接口地址、协议、密钥和模型即可。</p>
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
              className="pixel-field"
            />
            <ul className="divide-y-2 divide-dashed divide-ink/20">
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
              {shownBuiltin.length === 0 && <li className="py-3 text-sm text-muted">没有匹配的 provider</li>}
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
    </>
  );
}
