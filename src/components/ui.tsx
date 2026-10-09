"use client";

import { ApiError } from "@/lib/api-client";

type Tone = "error" | "warn" | "info";

const TONES: Record<Tone, string> = {
  error: "border-red-200 bg-red-50 text-red-800",
  warn: "border-amber-200 bg-amber-50 text-amber-900",
  info: "border-sky-200 bg-sky-50 text-sky-900",
};

/** 业务上的"预期提示"（如该周无日报）用黄色，其余失败用红色 */
export function toneOf(error: ApiError): Tone {
  if (error.code === "NO_DAILY" || error.code === "NO_DATA") return "warn";
  return "error";
}

export function Notice({
  tone,
  children,
  onRetry,
  retryLabel = "重试",
  busy,
}: {
  tone: Tone;
  children: React.ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  busy?: boolean;
}) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-sm ${TONES[tone]}`}>
      <div className="min-w-0 flex-1 whitespace-pre-wrap break-words">{children}</div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={busy}
          className="shrink-0 rounded border border-current px-2 py-0.5 text-xs font-medium hover:bg-white/60 disabled:opacity-50"
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
}

export function ErrorNotice({ error, onRetry, busy }: { error: ApiError; onRetry?: () => void; busy?: boolean }) {
  const canRetry = onRetry && (error.retryable || error.code === "NETWORK" || error.code === "BUSY");
  return (
    <Notice tone={toneOf(error)} onRetry={canRetry ? onRetry : undefined} busy={busy}>
      {error.message}
    </Notice>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-slate-600">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
      {label}
    </span>
  );
}

export function Button({
  variant = "default",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "danger" | "ghost" }) {
  const styles = {
    default: "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
    primary: "border-blue-600 bg-blue-600 text-white hover:bg-blue-700",
    danger: "border-red-300 bg-white text-red-700 hover:bg-red-50",
    ghost: "border-transparent bg-transparent text-slate-600 hover:bg-slate-100",
  }[variant];
  return (
    <button
      type="button"
      {...props}
      className={`rounded-md border px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
    />
  );
}

export function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose?: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-lg bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold">{title}</h3>
          {onClose && (
            <button type="button" onClick={onClose} aria-label="关闭" className="text-slate-400 hover:text-slate-700">
              ✕
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
