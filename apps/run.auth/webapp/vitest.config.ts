import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Vitest config for run.auth webapp.
 *
 * Wires the `@/*` path alias defined in tsconfig.json (paths → src/*) so
 * unit tests can import the same way as Next.js runtime code without
 * pulling in vite-tsconfig-paths as an extra dep.
 *
 * Copied from run.bib/webapp/vitest.config.ts (node env; `@` → ./src). The
 * include glob is extended to also match config-adjacent __tests__ dirs
 * (e.g. src/config/__tests__/...) so pure server-side modules can be tested
 * next to their source.
 *
 * We deliberately do NOT include a jsdom environment yet — the current suite
 * only tests a pure server-side module. Add environment: "jsdom" + a dom dep
 * when a future test needs the DOM.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: [
      "src/__tests__/**/*.test.{ts,tsx}",
      "src/**/__tests__/**/*.test.{ts,tsx}",
      "src/**/*.test.{ts,tsx}",
    ],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
