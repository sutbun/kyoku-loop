import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: [
    "study-controls.spec.ts",
    "comparison-policy.spec.ts",
    "responsive-study.spec.ts",
  ],
  outputDir: "D:/dev-data/kyoku-loop/private/study-controls-20261104/edge",
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
