import { defineConfig } from "vitest/config";

/**
 * Vitest config for the q.defcon.run resolver Lambda.
 *
 * Node-environment tests only (no DOM). Covers the pure resolver core:
 * path parser, rule engine, enrichment, response/log builders, and the
 * ElectroDB entity shapes. Handler integration tests mock DynamoDB.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.{js,mjs,ts}"],
  },
});
