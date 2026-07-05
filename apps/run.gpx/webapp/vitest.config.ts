import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Vitest config for run.gpx webapp (Phase 40, AR-01).
 *
 * Wires the `@/*` path alias defined in tsconfig.json (paths → src/*) so
 * unit tests can import the same way as Next.js runtime code without pulling
 * in vite-tsconfig-paths as an extra dep. Mirrors run.auth/webapp/vitest.config.ts
 * so the copy-per-app logEvent helper is tested identically across apps.
 *
 * Node environment only — the current suite tests a pure server-side module.
 * Add environment: "jsdom" + a dom dep when a future test needs the DOM.
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
