import { describe, expect, it } from "vitest";
import { markdownToPlainText, parseBlocks, parseSpans } from "@/lib/report-format";

describe("报告复制格式转换", () => {
  const md = ["## 本周完成", "- **登录**接口联调", "1. 修复导出缺陷", "", "## 下周计划", "继续推进 **报表** 优化"].join("\n");

  it("按行解析标题、列表与段落，丢弃空行", () => {
    expect(parseBlocks(md).map((b) => b.type)).toEqual(["heading", "bullet", "bullet", "heading", "para"]);
  });

  it("兼容 CRLF 换行", () => {
    expect(parseBlocks("## 标题\r\n- 一条\r\n")).toEqual([
      { type: "heading", text: "标题" },
      { type: "bullet", text: "一条" },
    ]);
  });

  it("拆分加粗片段；孤立的 ** 保持原样", () => {
    expect(parseSpans("a **b** c")).toEqual([
      { text: "a ", bold: false },
      { text: "b", bold: true },
      { text: " c", bold: false },
    ]);
    expect(parseSpans("****")).toEqual([{ text: "****", bold: false }]);
  });

  it("转纯文本：去掉 # 与 **，列表统一为圆点，标题前空行", () => {
    expect(markdownToPlainText(md)).toBe(
      ["本周完成", "• 登录接口联调", "• 修复导出缺陷", "", "下周计划", "继续推进 报表 优化"].join("\n"),
    );
  });

  it("空内容返回空串", () => {
    expect(markdownToPlainText("")).toBe("");
    expect(markdownToPlainText("\n\n  \n")).toBe("");
  });
});
