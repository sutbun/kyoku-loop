import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({
  ...base,
  testMatch: [
    "tab-navigation.spec.ts",
    "unified-ui.spec.ts",
    "phone-tabs.spec.ts",
    "replay-counts.spec.ts",
  ],
  webServer: undefined,
  workers: 1,
  outputDir: process.env.KYOKULOOP_TEST_OUTPUT ?? "./test-results/fast-tabs",
});
