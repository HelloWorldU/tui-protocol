/**
 * Fixed markdown sample for the wrap-baking experiment: one construct per
 * paragraph, each long enough to wrap at 60 and 36 columns.
 */
export const WRAP_SAMPLE = [
  "## Wrapping sample",
  "",
  "A long prose paragraph with **a bold phrase that keeps going** and `inline code` so that it wraps across several rows at narrow widths.",
  "",
  "- A bullet item whose text is long enough to wrap onto a continuation line at sixty columns.",
  "- Short item.",
  "",
  "1. A numbered item that also runs long enough to need a continuation line when narrow.",
  "",
  "> A quoted paragraph that is long enough to wrap, so every quoted row needs its prefix.",
  "",
  "```ts",
  "const longCodeLine = computeSomethingWithAVeryLongName(argumentOne, argumentTwo);",
  "```",
  "",
  "---",
  "",
  "Closing line.",
].join("\n");

/**
 * Chinese, mixed Chinese/English, nested bullet and numbered lists, and a
 * Chinese quote: the RFC 0003 samples beyond ASCII and one list level.
 */
export const CJK_NESTED_SAMPLE = [
  "## 中文样例",
  "",
  "终端协议让应用把内容交给终端管理，终端负责排版、滚动和选择，这样窗口变窄时内容仍然整齐。",
  "",
  "Mixed English 和中文混排的段落 that wraps across rows at narrow widths 也要正确。",
  "",
  "- 列表项里的中文内容也需要在续行保持缩进，才能和原生排版一致。",
  "  - nested item with enough words to wrap onto a continuation line here",
  "    - third level nested item that also wraps around the narrow width",
  "",
  "1. First numbered item",
  "   1. nested numbered item long enough to wrap at narrow widths too",
  "",
  "> 引用里的中文也要在每一行保留引用标记，宽度变化时不能丢。",
].join("\n");
