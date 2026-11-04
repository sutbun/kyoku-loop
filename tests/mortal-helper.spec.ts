import { test } from "@playwright/test";
import { execFileSync } from "node:child_process";

test("Mortal helper state machine and isolated browser integration", async () => {
  test.setTimeout(150000);
  execFileSync(
    process.execPath,
    [
      "--test",
      "tests/mortal-helper.test.mjs",
      "tests/mortal-helper-browser.test.mjs",
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 140000,
      env: process.env,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
});
