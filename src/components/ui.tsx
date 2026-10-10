"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api-client";
import { copyText } from "@/lib/clipboard";
import { jobError } from "@/lib/job-client";
import type { JobView } from "@/lib/types";

type Tone = "error" | "warn" | "info";

/** 提示条左侧徽标里的符号 */
const TONE_GLYPH: Record<Tone, string> = { error: "×", warn: "!", info: "i" };

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
    <div role={tone === "error" ? "alert" : "status"} className={`pixel-notice pixel-notice--${tone}`}>
      <span className="pixel-notice__icon font-pixel" aria-hidden>
        {TONE_GLYPH[tone]}
      </span>
      <div className="min-w-0 flex-1 whitespace-pre-wrap break-words">{children}</div>
      {onRetry && (
        <Button size="sm" onClick={onRetry} disabled={busy} className="shrink-0">
          {retryLabel}
        </Button>
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

/** 三个方块依次跳动。装饰性，文字说明由旁边的 label 承担 */
export function PixelSpinner({ className = "" }: { className?: string }) {
  return (
    <span className={`pixel-spinner ${className}`} aria-hidden>
      <i />
      <i />
      <i />
    </span>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-ink-soft">
      <PixelSpinner />
      {label}
    </span>
  );
}

export function Button({
  variant = "default",
  size = "md",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "danger" | "ghost"; size?: "md" | "sm" }) {
  const variantClass = variant === "default" ? "" : `pixel-button--${variant}`;
  const sizeClass = size === "sm" ? "pixel-button--sm" : "";
  return <button type="button" {...props} className={`pixel-button ${variantClass} ${sizeClass} ${className}`} />;
}

/** 一键复制文本到剪贴板，按钮上短暂显示“已复制”/“复制失败” */
export function CopyButton({
  text,
  label = "复制",
  variant = "default",
  size = "md",
  disabled,
}: {
  text: string;
  label?: string;
  variant?: "default" | "primary" | "danger" | "ghost";
  size?: "md" | "sm";
  disabled?: boolean;
}) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  // 内容切换（换日期、换版本）后复位提示，避免误以为新内容已复制
  useEffect(() => {
    setState("idle");
  }, [text]);

  async function onCopy() {
    let next: "done" | "failed" = "done";
    try {
      await copyText(text);
    } catch {
      next = "failed";
    }
    setState(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  }

  return (
    <Button variant={variant} size={size} onClick={onCopy} disabled={disabled || text === ""} aria-live="polite">
      {state === "done" ? "已复制" : state === "failed" ? "复制失败" : label}
    </Button>
  );
}

export function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose?: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-void/70 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="pixel-panel max-h-[90vh] w-full max-w-lg overflow-auto">
        <div className="pixel-titlebar">
          <h3 className="font-pixel text-base">{title}</h3>
          {onClose && (
            <button type="button" onClick={onClose} aria-label="关闭" className="pixel-button pixel-button--sm pixel-button--danger px-1.5">
              ✕
            </button>
          )}
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

/** 失败的异步任务：显示原因、重试与“忽略”（清除失败标记） */
export function JobFailed({
  job,
  note,
  onRetry,
  onDismiss,
  busy,
}: {
  job: JobView;
  note?: string;
  onRetry: () => void;
  onDismiss: () => void;
  busy?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <ErrorNotice error={jobError(job)} onRetry={onRetry} busy={busy} />
      <p className="flex items-center gap-2 text-xs text-muted">
        {note}
        <button type="button" onClick={onDismiss} className="underline hover:text-ink">
          忽略
        </button>
      </p>
    </div>
  );
}
