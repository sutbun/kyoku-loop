import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: [
    "study-repetition.spec.ts",
    "practice-rotation.spec.ts",
    "offline-engine.spec.ts",
    "p5-client.spec.ts",
    "study-controls.spec.ts",
  ],
  outputDir: "D:/dev-data/kyoku-loop/private/study-repetition-20261105/edge",
  use: {
    ...devices["iPhone 13"],
    defaultBrowserType: "chromium",
    channel: "msedge",
    serviceWorkers: "block",
    baseURL: "http://127.0.0.1:1460",
  },
});
