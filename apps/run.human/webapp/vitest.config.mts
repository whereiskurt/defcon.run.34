import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    // Mirror tsconfig's "@/*" -> "./src/*" so route/entity tests can use app imports.
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
