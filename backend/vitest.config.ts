import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/unit/**/*.test.ts", "test/integration/**/*.test.ts"],
    // Integration tests have real I/O and git operations — allow more time
    testTimeout: 60_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
    },
  },
});
