import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({
  ...base,
  testMatch: [
    "round-review.spec.ts",
    "round-review-worker.spec.ts",
    "round-review-api.spec.ts",
  ],
  webServer: undefined,
  workers: 1,
  outputDir: process.env.KYOKULOOP_TEST_OUTPUT ?? "./test-results/round-review",
});
