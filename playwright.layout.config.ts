import { defineConfig } from "@playwright/test";
import config from "./playwright.config";

// Layout fixtures serve built files through browser routing, without starting
// or borrowing the user's daily-use server on port 1460.
export default defineConfig({
  ...config,
  testMatch: "responsive-study.spec.ts",
  webServer: undefined,
});
