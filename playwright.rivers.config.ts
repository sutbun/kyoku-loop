import { defineConfig } from "@playwright/test";
import config from "./playwright.config";

// Built UI is served inside each isolated browser context; no live server.
export default defineConfig({
  ...config,
  testMatch: "table-rivers.spec.ts",
  outputDir: ".local/rivers-results",
  webServer: undefined,
});
