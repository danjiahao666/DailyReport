"use client";

import { useEffect, useRef, useState } from "react";
import { copyImage, copyText } from "@/lib/clipboard";
import { markdownToPlainText } from "@/lib/report-format";
import { renderReportImage } from "@/lib/report-image";
import { Button } from "./ui";

interface Props {
  /** 当前显示的内容（报告为 Markdown，日报为普通文本） */
  content: string;
  /**
   * 内容是否按 Markdown 解析（默认是）。日报是普通文本：Markdown / 纯文本两项都原样复制，
   * 图片按行原样绘制，不把行首的 - 或 1. 当成列表，也不吞掉 # 和 **。
   */
  markdown?: boolean;
  /** 图片顶部标题与下载文件名的来源，如“2026-10-11 周日 · 日报” */
  title: string;
  label?: string;
  size?: "md" | "sm";
  /** 菜单与提示的对齐边：按钮靠右时用 right，避免向右溢出卡片或屏幕 */
  align?: "left" | "right";
}

type Format = "markdown" | "text" | "image";

const TOAST_MS = 2500;

/** 复制菜单：可选择以 Markdown、纯文本或图片格式复制内容 */
export function CopyMenu({ content, markdown = true, title, label = "复制", size = "md", align = "left" }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const box = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  // 内容切换（换日期、换版本）后清掉上一次的结果提示，避免误以为新内容已复制
  useEffect(() => {
    setToast(null);
    setOpen(false);
  }, [content]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function notify(message: string) {
    setToast(message);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), TOAST_MS);
  }

  async function run(format: Format) {
    setOpen(false);
    setBusy(true);
    try {
      if (format === "image") {
        // 必须在点击事件内同步发起，Safari 才允许稍后写入剪贴板
        const png = renderReportImage(content, { title, markdown });
        const result = await copyImage(png, `${title.replace(/[\\/:*?"<>|\s]+/g, "_")}.png`);
        notify(result === "copied" ? "已复制图片" : "当前环境无法写入剪贴板，已下载图片");
      } else {
        await copyText(format === "markdown" || !markdown ? content : markdownToPlainText(content));
        notify(format === "markdown" ? "已复制 Markdown" : "已复制文本");
      }
    } catch (e) {
      notify(e instanceof Error && e.message ? `复制失败：${e.message}` : "复制失败");
    } finally {
      setBusy(false);
    }
  }

  const edge = align === "right" ? "right-0" : "left-0";
  const items: { format: Format; text: string }[] = [
    { format: "markdown", text: "Markdown 格式" },
    { format: "text", text: "纯文本格式" },
    { format: "image", text: "图片" },
  ];

  return (
    <span ref={box} className="relative inline-block">
      <Button
        size={size}
        onClick={() => setOpen((v) => !v)}
        disabled={busy || content === ""}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-busy={busy}
        className="whitespace-nowrap"
      >
        {`${label} ▾`}
      </Button>
      {/* 结果提示用绝对定位浮层，按钮文字保持不变，不会撑大所在卡片的标题栏 */}
      {(busy || toast) && !open && (
        <span role="status" className={`pixel-card absolute ${edge} top-full z-20 mt-1.5 whitespace-nowrap px-2 py-1 text-xs`}>
          {busy ? "生成中…" : toast}
        </span>
      )}
      {open && (
        <span role="menu" className={`pixel-card absolute ${edge} top-full z-20 mt-1.5 flex min-w-36 flex-col gap-1 p-1.5`}>
          {items.map((it) => (
            <Button key={it.format} role="menuitem" size="sm" variant="ghost" className="justify-start whitespace-nowrap text-left" onClick={() => void run(it.format)}>
              {it.text}
            </Button>
          ))}
        </span>
      )}
    </span>
  );
}
