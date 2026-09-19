/** Fixed trial corpus, not a claim to cover an application's complete output. */
export const contentSamples = [
  { name: "Chinese explanation and ASCII code", text: "分析结果\n```ts\nconst count = 42;\nconsole.log(count);\n```", expected: "分析结果```tsconst count = 42;console.log(count);```" },
  { name: "long code line", text: `const value = "${"x".repeat(160)}";`, expected: `const value = "${"x".repeat(160)}";` },
  { name: "emoji and combining text", text: "Status 😀\nCafe\u0301\nDeveloper 👩‍💻", expected: "Status 😀Cafe\u0301Developer 👩‍💻" },
  { name: "Chinese Tab and CRLF", text: "中文\tOK\r\nnext", expected: "中文    OKnext" },
] as const;

export const unsupportedTabSamples = ["😀\tvalue", "e\u0301\tvalue", "👩‍💻\tvalue"];
