import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({
  ...base,
  webServer: undefined,
  testMatch: ["p3.spec.ts", "p8.spec.ts"],
  outputDir:
    "D:/dev-data/kyoku-loop/private/study-controls-20261104/integration",
});
