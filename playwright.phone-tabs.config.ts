import { defineConfig } from "@playwright/test";
import config from "./playwright.config";

// Built files and API fixtures are served by browser routing. Never borrow the
// daily server, its database, or a user's existing browser profile.
export default defineConfig({
  ...config,
  testMatch: [
    "phone-tabs.spec.ts",
    "responsive-study.spec.ts",
    "study-controls.spec.ts",
    "phone-bulk-import.spec.ts",
    "phone-history-metadata.spec.ts",
    "mortal-source-picker.spec.ts",
  ],
  webServer: undefined,
  outputDir: `test-results-phone-tabs/${process.pid}`,
});
