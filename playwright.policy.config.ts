import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "comparison-policy.spec.ts",
  outputDir:
    "D:/dev-data/kyoku-loop/private/comparison-policy-20261104/playwright",
  use: {
    channel: "msedge",
    serviceWorkers: "block",
    baseURL: "http://127.0.0.1:1460",
  },
  projects: [
    {
      name: "phone",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
});
