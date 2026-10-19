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
