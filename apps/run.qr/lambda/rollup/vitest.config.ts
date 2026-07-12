import { defineConfig } from "vitest/config";

/**
 * Vitest config for the q.defcon.run analytics rollup Lambda.
 *
 * Node-environment tests only. Covers the pure rollup core: Logs Insights
 * query builder (since-watermark), and log-line → qrstat aggregation.
 * AWS SDK calls (StartQuery/GetQueryResults, DynamoDB writes) are mocked.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.{js,mjs,ts}"],
  },
});
