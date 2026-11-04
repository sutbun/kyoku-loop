import { defineConfig } from "@playwright/test";

// No Vite server and no requests to the user's running application.
export default defineConfig({
  testDir: "./tests",
  testMatch: [
    "mortal-helper.spec.ts",
    "mortal-auto-link.spec.ts",
    "mortal-link-feedback.spec.ts",
  ],
  outputDir: "D:/dev-data/kyoku-loop/private/mortal-helper-20261104/playwright",
  workers: 1,
});
