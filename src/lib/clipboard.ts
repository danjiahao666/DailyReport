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
