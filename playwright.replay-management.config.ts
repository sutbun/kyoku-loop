import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: ["mortal-batch.spec.ts", "replay-delete.spec.ts"],
  outputDir: "./test-results/replay-management",
  workers: 1,
});
