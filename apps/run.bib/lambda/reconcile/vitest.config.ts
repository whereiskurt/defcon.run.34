import { defineConfig } from "vitest/config";

/**
 * Vitest config for the bib-reconcile Lambda.
 *
 * Node-environment tests only (no DOM). Plan 22-03-01 lands the config and
 * a basic module-load smoke test; Plan 22-04-01 adds Haiku-extractor tests
 * against fixtures in `tests/fixtures/`.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.{js,mjs,ts}"],
  },
});
