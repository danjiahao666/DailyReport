/**
 * 复制 PNG 图片到剪贴板。
 * 剪贴板写图片只在安全上下文（HTTPS / localhost）可用；不可用时改为下载图片文件，
 * 返回 "downloaded" 让调用方提示用户。
 * 传入 Promise 而不是 Blob：Safari 要求在点击事件内同步调用 write，图片可稍后生成。
 */
export async function copyImage(png: Promise<Blob>, filename: string): Promise<"copied" | "downloaded"> {
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write && window.isSecureContext) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      return "copied";
    } catch {
      // 权限被拒或图片生成失败：下面再 await 一次，生成失败会在这里抛出
    }
  }
  const blob = await png;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "downloaded";
}

/**
 * 复制文本到剪贴板。
 * 优先使用 Clipboard API（仅在 HTTPS / localhost 等安全上下文可用）；
 * 通过局域网 HTTP 地址访问时回退到 execCommand，失败则抛出错误。
 */
export async function copyText(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // 权限被拒等情况：继续尝试回退方案
    }
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  try {
    ta.select();
    if (!document.execCommand("copy")) throw new Error("浏览器拒绝了复制操作");
  } finally {
    document.body.removeChild(ta);
  }
}
