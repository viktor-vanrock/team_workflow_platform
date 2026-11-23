import { defineConfig } from "vitest/config";

import { browserTestFiles } from "./tests/browser-test-files.ts";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.spec.ts", "packages/**/*.spec.ts"],
    exclude: browserTestFiles.map((file) => `**/tests/e2e/${file}`),
    pool: "forks",
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: { enabled: false },
  },
});
