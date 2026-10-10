import type { ReactNode } from "react";

/**
 * 极简 Markdown 渲染（标题、列表、加粗、段落）。
 * 只生成 React 节点，不使用 dangerouslySetInnerHTML，模型输出无法注入 HTML。
 */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      part
    ),
  );
}

export function Markdown({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length === 0) return;
    const items = list;
    list = [];
    nodes.push(
      <ul key={`ul-${nodes.length}`} className="my-1 list-[square] space-y-0.5 pl-5 marker:text-ember">
        {items.map((it, i) => (
          <li key={i}>{inline(it)}</li>
        ))}
      </ul>,
    );
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (bullet) {
      list.push(bullet[1]);
      continue;
    }
    flush();
    if (heading) {
      nodes.push(
        <h4 key={nodes.length} className="mb-1 mt-4 border-b-2 border-dashed border-ink/25 pb-0.5 font-pixel text-base text-ink first:mt-0">
          {inline(heading[2])}
        </h4>,
      );
    } else if (line.trim() !== "") {
      nodes.push(
        <p key={nodes.length} className="my-1">
          {inline(line)}
        </p>,
      );
    }
  }
  flush();
  return <div className="text-sm leading-relaxed text-ink">{nodes}</div>;
}
