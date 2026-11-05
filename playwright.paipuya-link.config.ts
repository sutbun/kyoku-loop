import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({
  ...base,
  testMatch: ["external-links.spec.ts", "phone-tabs.spec.ts", "p3.spec.ts"],
  webServer: undefined,
  outputDir: "./test-results/paipuya-link",
  workers: 1,
});
