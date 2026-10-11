/**
 * 报告内容的复制格式转换。
 * 块级规则与 components/Markdown.tsx 保持一致（标题、列表、加粗、段落），
 * 这样复制出的文本、图片与页面上看到的结构相同。
 */

export type Block =
  | { type: "heading"; text: string }
  | { type: "bullet"; text: string }
  | { type: "para"; text: string };

/** 一段行内文本：加粗用于图片绘制，纯文本转换时直接丢弃标记 */
export interface Span {
  text: string;
  bold: boolean;
}

/** 把 Markdown 按行拆成块；空行丢弃 */
export function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (bullet) blocks.push({ type: "bullet", text: bullet[1] });
    else if (heading) blocks.push({ type: "heading", text: heading[2] });
    else if (line.trim() !== "") blocks.push({ type: "para", text: line });
  }
  return blocks;
}

/** 按 **加粗** 拆分行内文本 */
export function parseSpans(text: string): Span[] {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .filter((p) => p !== "")
    .map((p) =>
      p.startsWith("**") && p.endsWith("**") && p.length > 4 ? { text: p.slice(2, -2), bold: true } : { text: p, bold: false },
    );
}

/**
 * Markdown 转纯文本：去掉标题 # 与加粗 **，列表统一为“• ”，标题前空一行。
 * 适合粘贴到不识别 Markdown 的聊天、邮件或表单里。
 */
export function markdownToPlainText(markdown: string): string {
  const lines: string[] = [];
  for (const block of parseBlocks(markdown)) {
    const text = parseSpans(block.text)
      .map((s) => s.text)
      .join("");
    if (block.type === "heading" && lines.length > 0) lines.push("");
    lines.push(block.type === "bullet" ? `• ${text}` : text);
  }
  return lines.join("\n");
}
