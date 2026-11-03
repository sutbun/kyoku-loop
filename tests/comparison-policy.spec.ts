import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  freshPhoneState,
  phoneReduce,
  validatePack,
} from "../src/offline/engine";
const pack = JSON.parse(
  execFileSync(
    "python",
    [
      "-c",
      `
import sys,json,tempfile
from pathlib import Path
sys.path.insert(0,'tests')
from test_p8_mortal import mortal_fixture
from tools.p2_store import Store
with tempfile.TemporaryDirectory(dir='D:/dev-data/kyoku-loop/private') as tmp:
 s=Store(Path(tmp)/'test.sqlite3')
 try:
  s.commit(s.stage(json.dumps(mortal_fixture(True)).encode(),None)['token'],0,0,None)
  print(json.dumps(s.phone_pack()))
 finally:s.close()
`,
    ],
    { encoding: "utf8", windowsHide: true },
  ),
);
test("exact policy stays hidden before confirming and old packs remain accepted", () => {
  let state = phoneReduce(freshPhoneState("policy-test"), {
    action: "install_pack",
    pack,
  }).state;
  const r = phoneReduce(state, { action: "study_start", mode: "practice" });
  expect((r.data as any).scene).not.toHaveProperty("policy_percent");
  const old = structuredClone(pack);
  delete old.items[0].scene.policy_percent;
  validatePack(old);
  const broken = structuredClone(pack);
  broken.items[0].scene.policy_percent = [100];
  expect(() => validatePack(broken)).toThrow("invalid_pack");
});
for (const width of [320, 390, 768])
  test(`three compact exact policy values at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    // Fulfil every request from this build or generated data: no request reaches
    // the server or the user's API/database even if another suite owns port 1460.
    await page.route("**/*", async (route) => {
      const u = new URL(route.request().url());
      if (u.pathname === "/phone/api")
        return route.fulfill({ json: { ok: true, data: pack } });
      const file = resolve(
        "dist",
        "." +
          (u.pathname.startsWith("/phone/assets/")
            ? u.pathname.slice(6)
            : u.pathname.endsWith("/")
              ? u.pathname + "index.html"
              : u.pathname),
      );
      if (file.startsWith(resolve("dist")) && existsSync(file))
        return route.fulfill({ path: file });
      return route.abort();
    });
    await page.addInitScript(() =>
      Object.defineProperty(navigator, "onLine", { get: () => false }),
    );
    await page.goto("/phone/");
    const seeded = phoneReduce(freshPhoneState("policy-ui"), {
      action: "install_pack",
      pack,
    }).state;
    await page.evaluate(
      (state) =>
        new Promise<void>((done, reject) => {
          const open = indexedDB.open("kyokuloop-phone-v1", 1);
          open.onupgradeneeded = () => open.result.createObjectStore("local");
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction("local", "readwrite");
            tx.objectStore("local").put(state, "state");
            tx.oncomplete = () => {
              db.close();
              done();
            };
            tx.onerror = () => reject(tx.error);
          };
          open.onerror = () => reject(open.error);
        }),
      seeded,
    );
    await page.reload();
    await page.getByRole("button", { name: "今すぐ学ぶ", exact: true }).click();
    await expect(page.locator(".comparison-policy")).toHaveCount(0);
    await page.getByTestId("real-hand").locator("button").last().click();
    await page.getByRole("button", { name: "回答する", exact: true }).click();
    await expect(page.locator(".comparison-policy")).toHaveText([
      "40.0%",
      "40.0%",
      "45.0%",
    ]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    for (const column of await page.locator(".comparison-choice").all()) {
      const c = await column.boundingBox();
      const p = await column.locator(".comparison-policy").boundingBox();
      expect(p!.x).toBeGreaterThanOrEqual(c!.x);
      expect(p!.x + p!.width).toBeLessThanOrEqual(c!.x + c!.width + 1);
    }
    await page.getByTestId("study-comparison").screenshot({
      path: `D:/dev-data/kyoku-loop/private/comparison-policy-20261104/comparison-${width}.png`,
    });
    await page
      .getByRole("button", { name: "回答を選び直す", exact: true })
      .click();
    await expect(page.locator(".comparison-policy")).toHaveCount(0);
  });
