import { test, expect, type Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { freshPhoneState, phoneReduce } from "../src/offline/engine";
import {
  beginStorageOperation,
  lockUpdate,
  unlockUpdate,
  updateLocked,
} from "../src/offline/update-lock";

test.describe.configure({ mode: "serial" });
const workerPath = resolve("dist/phone/sw.js"),
  htmlPath = resolve("dist/phone/index.html");
const originalWorker = readFileSync(workerPath, "utf8"),
  originalHtml = readFileSync(htmlPath, "utf8");
const initialBuild = originalHtml.match(
  /name="phone-build" content="([a-f0-9]+)"/,
)![1];
const nextBuild = "ab".repeat(10);
const build = (page: Page) =>
  page.locator('meta[name="phone-build"]').getAttribute("content");
const state = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<any>((resolve, reject) => {
        const open = indexedDB.open("kyokuloop-phone-v1", 1);
        open.onsuccess = () => {
          const db = open.result,
            tx = db.transaction("local", "readonly"),
            q = tx.objectStore("local").get("state");
          q.onsuccess = () => resolve(q.result);
          q.onerror = () => reject(q.error);
          tx.oncomplete = () => db.close();
        };
      }),
  );
async function boot(page: Page) {
  await page.route("**/phone/api", (r) => r.abort());
  await page.route("**/phone/mortal", (r) => r.abort());
  await page.goto("/phone/");
  await page
    .getByRole("button", { name: "問題を端末に保存", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), {
      timeout: 45000,
    })
    .toBe(true);
  await expect(page.getByTestId("version-update")).toBeEnabled();
}
function publish(worker = originalWorker.replaceAll(initialBuild, nextBuild)) {
  writeFileSync(htmlPath, originalHtml.replaceAll(initialBuild, nextBuild));
  writeFileSync(workerPath, worker);
}
async function waiting(page: Page) {
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration("/phone/"))!.update();
  });
  await expect
    .poll(
      () =>
        page.evaluate(
          async () =>
            !!(await navigator.serviceWorker.getRegistration("/phone/"))
              ?.waiting,
        ),
      { timeout: 45000 },
    )
    .toBe(true);
}
test.afterEach(() => {
  writeFileSync(workerPath, originalWorker);
  writeFileSync(htmlPath, originalHtml);
});

test("storage gate refuses an in-flight write and releases only its own lease", () => {
  const end = beginStorageOperation();
  expect(lockUpdate("one")).toBe(false);
  end();
  expect(lockUpdate("one")).toBe(true);
  expect(() => beginStorageOperation()).toThrow("update_in_progress");
  unlockUpdate("other");
  expect(updateLocked()).toBe(true);
  unlockUpdate("one");
  expect(updateLocked()).toBe(false);
});

test("existing version label updates the real waiting worker once and keeps records offline", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  await boot(page);
  const header = await page.locator(".phone-header").boundingBox();
  const material = JSON.parse(
    execFileSync(
      "python",
      [
        "-c",
        "import sys,json,base64;sys.path.insert(0,'tests');from test_p13_shortcut_json import two_rounds;from tools.mortal_material import compile_upload;print(json.dumps(compile_upload(base64.b64encode(json.dumps(two_rounds()).encode()).decode(),'2026-11-03T01:00:00.000Z')))",
      ],
      { encoding: "utf8", windowsHide: true },
    ),
  );
  let local = phoneReduce(freshPhoneState("generated-update-device"), {
    action: "enable_local",
  }).state;
  local = phoneReduce(local, {
    action: "register_local",
    material,
    analysis_id: null,
  }).state;
  let result = phoneReduce(local, { action: "study_start", mode: "practice" });
  const q = result.data as any;
  local = phoneReduce(result.state, {
    action: "study_choice",
    session: q.id,
    choice: "choose",
    answer: q.scene.own_hand[0],
  }).state;
  local = phoneReduce(local, {
    action: "study_choice",
    session: q.id,
    choice: "confirm",
  }).state;
  local = phoneReduce(local, {
    action: "study_rate",
    session: q.id,
    item: q.item_id,
    rating: "理解した",
    event: "generated-update-answer",
  }).state;
  await page.evaluate(
    (value) =>
      new Promise<void>((resolve, reject) => {
        const r = indexedDB.open("kyokuloop-phone-v1", 1);
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction("local", "readwrite");
          tx.objectStore("local").put(value, "state");
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    local,
  );
  await page.reload();
  await expect(page.getByTestId("version-update")).toBeEnabled();
  const before = await state(page);
  await page.getByText("解析結果を追加", { exact: true }).click();
  await page
    .getByLabel("Mortal JSON / JSON.gz", { exact: true })
    .setInputFiles({
      name: "fictional.json.gz",
      mimeType: "application/gzip",
      buffer: Buffer.from(material.payload, "base64"),
    });
  await expect(
    page.getByRole("button", { name: "この端末に登録", exact: true }),
  ).toBeEnabled({ timeout: 90000 });
  await page.getByTestId("version-update").click();
  await expect(page.getByTestId("version-update")).toContainText("入力を完了");
  expect(await build(page)).toBe(initialBuild);
  await page.getByRole("button", { name: "取り消す", exact: true }).click();
  publish();
  await waiting(page);
  await page.getByTestId("version-update").click();
  await expect.poll(() => build(page), { timeout: 45000 }).toBe(nextBuild);
  await expect(page.getByTestId("version-update")).toBeEnabled();
  const after = await state(page);
  expect(after).toEqual(before);
  // A tab opened in the tiny activation boundary can have an older document
  // with the new controller. Updating must also work without a waiting worker.
  await page.evaluate((old) => {
    document.querySelector<HTMLMetaElement>(
      'meta[name="phone-build"]',
    )!.content = old;
  }, initialBuild);
  await page.getByTestId("version-update").click();
  await expect.poll(() => build(page), { timeout: 45000 }).toBe(nextBuild);
  await expect(page.getByTestId("version-update")).toBeEnabled();
  expect(await state(page)).toEqual(before);
  expect((await page.locator(".phone-header").boundingBox())!.height).toBe(
    header!.height,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "復習を再開する", exact: false }),
  ).toBeEnabled();
  expect(await state(page)).toEqual(before);
  await page.getByTestId("version-update").click();
  await expect(page.getByTestId("version-update")).toContainText("接続を確認");
  await page
    .getByRole("button", { name: "復習を再開する", exact: false })
    .click();
  await page.getByTestId("version-update").click();
  await expect(page.getByTestId("version-update")).toContainText(
    "ホームで更新",
  );
  expect(await state(page)).toEqual(before);
});

test("unsubmitted URL and another editing window defer activation then both windows update", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  await boot(page);
  const other = await context.newPage();
  await boot(other);
  await other
    .getByLabel("雀魂共有URL", { exact: true })
    .fill("https://game.mahjongsoul.com/?paipu=fictional-update-draft");
  publish();
  await waiting(page);
  await other.getByTestId("version-update").click();
  await expect(other.getByTestId("version-update")).toContainText("入力を完了");
  await page.getByTestId("version-update").click();
  await expect(page.getByTestId("version-update")).toContainText(
    "他の画面を確認",
    { timeout: 15000 },
  );
  expect(await build(page)).toBe(initialBuild);
  await expect(other.getByLabel("雀魂共有URL", { exact: true })).toHaveValue(
    "https://game.mahjongsoul.com/?paipu=fictional-update-draft",
  );
  await other.getByLabel("雀魂共有URL", { exact: true }).fill("");
  await page.getByTestId("version-update").click();
  await expect.poll(() => build(page), { timeout: 45000 }).toBe(nextBuild);
  await expect.poll(() => build(other), { timeout: 45000 }).toBe(nextBuild);
  await other.close();
});

test("an incompatible generation never replaces the old offline shell", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  await boot(page);
  // A deployment changing midway supplies HTML from a different generation.
  writeFileSync(workerPath, originalWorker.replaceAll(initialBuild, nextBuild));
  await page.getByTestId("version-update").click();
  await expect(page.getByTestId("version-update")).toContainText("接続を確認", {
    timeout: 45000,
  });
  expect(await build(page)).toBe(initialBuild);
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          !(await navigator.serviceWorker.getRegistration("/phone/"))?.waiting,
      ),
    )
    .toBe(true);
  await context.setOffline(true);
  await page.reload();
  expect(await build(page)).toBe(initialBuild);
});

test("a damaged runtime candidate leaves the existing compiler and shell usable", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  await boot(page);
  const candidate = originalWorker
    .replaceAll(initialBuild, nextBuild)
    .replace(/"sha256":"[a-f0-9]{64}"/, '"sha256":"' + "0".repeat(64) + '"');
  publish(candidate);
  await page.getByTestId("version-update").click();
  await expect(page.getByTestId("version-update")).toContainText("接続を確認", {
    timeout: 45000,
  });
  expect(await build(page)).toBe(initialBuild);
  await context.setOffline(true);
  await page.reload();
  expect(await build(page)).toBe(initialBuild);
});

test("an older window without the update protocol cannot be forced to reload", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  await boot(page);
  const other = await context.newPage();
  await other.addInitScript(() => {
    const add = navigator.serviceWorker.addEventListener.bind(
      navigator.serviceWorker,
    );
    navigator.serviceWorker.addEventListener = function (
      type: any,
      callback: any,
      options: any,
    ) {
      if (type !== "message") add(type, callback, options);
    } as typeof add;
  });
  await boot(other);
  publish();
  await waiting(page);
  await page.getByTestId("version-update").click();
  await expect(page.getByTestId("version-update")).toContainText(
    "他の画面を確認",
    { timeout: 15000 },
  );
  expect(await build(other)).toBe(initialBuild);
  await expect(page.locator("main")).not.toHaveAttribute("inert", "");
  await other.close();
  await page.getByTestId("version-update").click();
  await expect.poll(() => build(page), { timeout: 45000 }).toBe(nextBuild);
});
