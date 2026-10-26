import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: fileURLToPath(new URL("../../../.tmp/tabby-demo-plugin", import.meta.url)),
    emptyOutDir: true,
    lib: {
      entry: fileURLToPath(new URL("./index.ts", import.meta.url)),
      name: "TabbyTuiProtocol",
      formats: ["umd"],
      fileName: () => "index.js",
    },
    rolldownOptions: {
      external: [/^@angular\//, /^rxjs/, /^tabby-/, "node:buffer"],
      output: {
        exports: "named",
        globals: {
          "@angular/core": "ng.core",
          "node:buffer": "node_buffer",
          "tabby-core": "TabbyCore",
          "tabby-terminal": "TabbyTerminal",
        },
      },
    },
  },
});
