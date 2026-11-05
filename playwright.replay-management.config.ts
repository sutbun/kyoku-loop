import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({
  ...base,
  testDir: "./tests",
  testMatch: [
    "replay-sort.spec.ts",
    "p10-bulk-history.spec.ts",
    "replay-counts.spec.ts",
    "mortal-batch.spec.ts",
    "replay-delete.spec.ts",
    "replay-management-ui.spec.ts",
    "mortal-link-feedback.spec.ts",
    "mortal-auto-link.spec.ts",
    "offline-engine.spec.ts",
    "phone-bulk-import.spec.ts",
    "phone-history-metadata.spec.ts",
    "phone-tabs.spec.ts",
    "p3.spec.ts",
    "p8.spec.ts",
  ],
  webServer: undefined,
  outputDir: "./test-results/replay-management",
  workers: 1,
});
