import { defineConfig } from "@playwright/test";
import config from "./playwright.config";
export default defineConfig({
  ...config,
  testMatch: [
    "table-seats.spec.ts",
    "table-rivers.spec.ts",
    "responsive-study.spec.ts",
  ],
  outputDir: ".local/seats-results",
  webServer: undefined,
});
