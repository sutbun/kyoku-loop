import { test } from "@playwright/test";
import { execFileSync } from "node:child_process";

test("Mortal helper state machine and isolated browser integration", async () => {
  test.setTimeout(300000);
  execFileSync(
    process.execPath,
    [
      "--test",
      "tests/mortal-helper.test.mjs",
      "tests/mortal-helper-browser.test.mjs",
      "tests/mortal-batch.test.mjs",
      "tests/mortal-payloads.test.mjs",
      "tests/mortal-batch-browser.test.mjs",
      "tests/mortal-helper-update.test.mjs",
      "tests/mortal-diagnostics.test.mjs",
      "tests/mortal-popup-browser.test.mjs",
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 290000,
      env: process.env,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
});
