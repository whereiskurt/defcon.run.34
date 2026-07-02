import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Vitest config for run.bib webapp.
 *
 * Wires the `@/*` path alias defined in tsconfig.json (paths → src/*) so
 * unit tests can import the same way as Next.js runtime code without
 * pulling in vite-tsconfig-paths as an extra dep.
 *
 * We deliberately do NOT include a jsdom environment yet — Phase 21-03
 * only tests the runner-code util (a pure server-side module). If a
 * future test needs the DOM (React component tests, BibForm interaction),
 * add environment: "jsdom" + happy-dom or jsdom as a devDep at that time.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/__tests__/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
