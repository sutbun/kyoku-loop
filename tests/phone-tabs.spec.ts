import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve, extname, sep } from "node:path";
import { phoneFixture } from "./phone-fixture";
import { freshPhoneState, phoneReduce } from "../src/offline/engine";

test.use({ serviceWorkers: "block" });
const pack = phoneFixture();
async function openPhone(
  page: Page,
  options: { zeroDue?: boolean; resume?: boolean; empty?: boolean } = {},
) {
  const root = resolve("dist");
  await page.route("**/*", async (route) => {
    let path = new URL(route.request().url()).pathname;
    if (path === "/fixture")
      return route.fulfill({
        contentType: "text/html",
        body: "<!doctype html>",
      });
    if (path.startsWith("/phone/assets/")) path = path.slice(6);
    const file = resolve(
      root,
      `.${path === "/phone/" ? "/phone/index.html" : path}`,
    );
    if (!file.startsWith(root + sep)) throw Error("Unexpected fixture path");
    const types: Record<string, string> = {
      ".html": "text/html",
      ".js": "text/javascript",
      ".css": "text/css",
      ".json": "application/json",
    };
    try {
      await route.fulfill({
        contentType: types[extname(file)] ?? "application/octet-stream",
        body: readFileSync(file),
      });
    } catch {
      await route.fulfill({ status: 404, body: "" });
    }
  });
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "onLine", {
      get: () => false,
      configurable: true,
    }),
  );
  await page.goto("/fixture");
  let state = phoneReduce(freshPhoneState("three-tabs-fixture"), {
    action: "install_pack",
    pack,
  }).state;
  if (options.resume)
    state = phoneReduce(state, {
      action: "study_start",
      mode: "practice",
    }).state;
  if (options.zeroDue)
    for (const item of state.pack!.items) item.due = "2099-01-01";
  if (options.empty) state = freshPhoneState("empty-fixture");
  state.analysis_queue = Array.from({ length: 25 }, (_, i) => ({
    id: `260101-fictional-tabs-${i}_a123`,
    url: `https://game.mahjongsoul.com/?paipu=260101-fictional-tabs-${i}_a123`,
    created: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
    received: "2026-11-04T00:00:00Z",
    ...(i === 24 ? { reports: [pack.items[0].report], ready: true } : {}),
  }));
  await page.evaluate(
    (state) =>
      new Promise<void>((done, fail) => {
        const r = indexedDB.open("kyokuloop-phone-v1", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("local");
        r.onerror = () => fail(r.error);
        r.onsuccess = () => {
          const db = r.result;
          const tx = db.transaction("local", "readwrite");
          tx.objectStore("local").put(state, "state");
          tx.oncomplete = () => {
            db.close();
            done();
          };
        };
      }),
    state,
  );
  await page.goto("/phone/");
  await expect(
    page.getByRole("button", { name: "学習", exact: true }),
  ).toHaveAttribute("aria-current", "page");
}
const tab = (page: Page, name: string) =>
  page
    .getByRole("navigation", { name: "メイン" })
    .getByRole("button", { name, exact: true })
    .click();

for (const [width, height] of [
  [390, 844],
  [1180, 820],
]) {
  test(`study is primary and the three tabs keep drafts at ${width}x${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await openPhone(page);
    await expect(
      page.getByRole("button", { name: "今日の復習を始める", exact: false }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "雀魂共有URL", exact: true }),
    ).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: "今すぐ同期", exact: true }),
    ).not.toBeVisible();
    const list = page.getByRole("button", {
      name: "問題一覧を見る",
      exact: false,
    });
    expect((await list.boundingBox())!.y).toBeLessThan(height - 100);
    await tab(page, "牌譜");
    await page.getByText("URLを追加", { exact: true }).click();
    await page
      .getByRole("textbox", { name: "雀魂共有URL", exact: true })
      .fill("https://game.mahjongsoul.com/?paipu=260101-fictional-tabs-draft");
    await tab(page, "設定");
    await expect(page.getByText("学習の設定", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "今すぐ同期", exact: true }),
    ).toBeVisible();
    await tab(page, "学習");
    await expect(
      page.getByRole("textbox", { name: "雀魂共有URL", exact: true }),
    ).not.toBeVisible();
    await tab(page, "牌譜");
    await expect(
      page.getByRole("textbox", { name: "雀魂共有URL", exact: true }),
    ).toHaveValue(/draft$/);
    await expect(
      page.locator(".phone-source-add textarea:not([readonly])"),
    ).toHaveCount(1);
    await page.screenshot({
      path: test.info().outputPath(`replays-${width}.png`),
      fullPage: true,
    });
    await tab(page, "学習");
    await page.screenshot({
      path: test.info().outputPath(`study-${width}.png`),
      fullPage: true,
    });
  });
}
test("zero due promotes practice and interrupted practice resumes", async ({
  page,
}) => {
  await openPhone(page, { zeroDue: true });
  await expect(
    page.getByText("今日の復習は完了", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "今日の復習を始める", exact: false }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "5問練習する", exact: true }).click();
  await expect(page.getByTestId("real-hand")).toBeVisible();
  await page
    .getByRole("button", { name: "中断して学習へ", exact: true })
    .click();
  await tab(page, "設定");
  await tab(page, "学習");
  await page
    .getByRole("button", { name: "続きから再開", exact: false })
    .click();
  await expect(page.getByText("1 / 5 問", { exact: true })).toBeVisible();
});
test("replays filter, paginate and open only the matching report's problems", async ({
  page,
}) => {
  await openPhone(page);
  await tab(page, "牌譜");
  await expect(page.getByTestId("analysis-row")).toHaveCount(10);
  await page.getByRole("button", { name: "学習準備完了", exact: true }).click();
  await expect(page.getByTestId("analysis-row")).toHaveCount(1);
  await expect(
    page.getByText("Windows受信済み", { exact: true }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "問題を見る", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "牌譜の問題", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("real-library-row")).toHaveCount(
    pack.items.filter((i) => i.report === pack.items[0].report).length,
  );
  await tab(page, "牌譜");
  await page.getByRole("button", { name: "未解析", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "問題を見る", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /さらに10件/ }).click();
  await expect(page.getByTestId("analysis-row")).toHaveCount(20);
});

test("a JSON preview and update guard survive a visit to another tab", async ({
  page,
}) => {
  await openPhone(page);
  await page.route("**/phone/mortal", (route) =>
    route.fulfill({
      json: {
        ok: true,
        data: {
          engine: "Mortal",
          token: "fictional-preview",
          source: pack.source,
          target_seat: 0,
          players: ["架空A", "架空B", "架空C", "架空D"],
          models: [{ index: 0, name: "4.1b" }],
          rounds: 4,
        },
      },
    }),
  );
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", {
      get: () => true,
      configurable: true,
    });
    window.dispatchEvent(new Event("online"));
  });
  await tab(page, "牌譜");
  await page.getByText("解析結果を追加", { exact: true }).click();
  await page
    .getByLabel("Mortal JSON / JSON.gz", { exact: true })
    .setInputFiles({
      name: "fictional-preview.json",
      mimeType: "application/json",
      buffer: Buffer.from("{}"),
    });
  await expect(
    page.getByText("解析対象：席1 · 架空A", { exact: false }),
  ).toBeVisible();
  await tab(page, "設定");
  await page.getByTestId("version-update").click();
  await expect(page.getByTestId("version-update")).toContainText("入力を完了");
  await tab(page, "牌譜");
  await expect(
    page.getByText("解析対象：席1 · 架空A", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "取り消す", exact: true }).click();
  await expect(
    page.getByText("解析対象：席1 · 架空A", { exact: false }),
  ).not.toBeVisible();
});

test("an empty device offers replay import without an unusable study button", async ({
  page,
}) => {
  await openPhone(page, { empty: true });
  await expect(
    page.getByText("学習する問題がありません", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "牌譜を追加", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "牌譜", exact: true }),
  ).toHaveAttribute("aria-current", "page");
});

const inputURL = (n: number) =>
  `https://game.mahjongsoul.com/?paipu=260101-fictional-unified-${n}_a123`;
async function stored(page: Page) {
  return page.evaluate(
    () =>
      new Promise<any>((done, fail) => {
        const r = indexedDB.open("kyokuloop-phone-v1", 1);
        r.onerror = () => fail(r.error);
        r.onsuccess = () => {
          const db = r.result;
          const t = db.transaction("local");
          const q = t.objectStore("local").get("state");
          q.onsuccess = () => done(q.result);
          t.oncomplete = () => db.close();
        };
      }),
  );
}
test("one field saves one or multiple URLs atomically and keeps invalid drafts", async ({
  page,
}) => {
  await openPhone(page);
  const before = await stored(page);
  await tab(page, "牌譜");
  await page.getByText("URLを追加", { exact: true }).click();
  const input = page.getByRole("textbox", { name: "雀魂共有URL", exact: true });
  const add = page.getByRole("button", { name: "追加", exact: true });
  await input.fill(inputURL(1));
  await expect(
    page
      .locator(".bulk-history-actions")
      .getByRole("button", { name: "Mortalへ", exact: true }),
  ).toBeVisible();
  await add.click();
  await expect(
    page.getByRole("status").filter({ hasText: "この端末に1件追加" }),
  ).toBeVisible();
  await input.fill(`${inputURL(1)}\n${inputURL(2)}\n${inputURL(3)}`);
  await expect(
    page
      .locator(".bulk-history-actions")
      .getByRole("button", { name: "Mortalへ", exact: true }),
  ).toHaveCount(0);
  await add.click();
  await expect(
    page.getByRole("status").filter({ hasText: "この端末に2件追加 · 重複1件" }),
  ).toBeVisible();
  const saved = await stored(page);
  expect(saved.analysis_queue).toHaveLength(28);
  expect(saved.pack).toEqual(before.pack);
  expect(saved.events).toEqual(before.events);
  expect(saved.session).toEqual(before.session);
  await input.fill(`${inputURL(4)}\ninvalid`);
  await add.click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(input).toHaveValue(`${inputURL(4)}\ninvalid`);
  expect((await stored(page)).analysis_queue).toEqual(saved.analysis_queue);
  await tab(page, "設定");
  await page.getByTestId("version-update").click();
  await expect(page.getByTestId("version-update")).toContainText("入力を完了");
  await tab(page, "牌譜");
  await expect(input).toHaveValue(`${inputURL(4)}\ninvalid`);
});
test("file input shares the field and a single URL opens only the prefilled Mortal page", async ({
  page,
}) => {
  await openPhone(page);
  await tab(page, "牌譜");
  await page.getByText("URLを追加", { exact: true }).click();
  const input = page.getByRole("textbox", { name: "雀魂共有URL", exact: true });
  await page
    .getByLabel("URL一覧のテキストファイル", { exact: true })
    .setInputFiles({
      name: "fictional.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(`${inputURL(5)}\n${inputURL(6)}`),
    });
  await expect(input).toHaveValue(`${inputURL(5)}\n${inputURL(6)}`);
  await page.getByRole("button", { name: "追加", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "この端末に2件追加" }),
  ).toBeVisible();
  await input.fill(inputURL(7));
  await page.evaluate(() => {
    (window as any).__opened = [];
    window.open = ((url: string) => {
      (window as any).__opened.push(url);
      return null;
    }) as typeof window.open;
  });
  await page
    .locator(".bulk-history-actions")
    .getByRole("button", { name: "Mortalへ", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Mortalを開く", exact: true }),
  ).toHaveAttribute(
    "href",
    `https://mjai.ekyu.moe/ja.html?url=${encodeURIComponent(inputURL(7))}`,
  );
  expect(await page.evaluate(() => (window as any).__opened)).toEqual([
    `https://mjai.ekyu.moe/ja.html?url=${encodeURIComponent(inputURL(7))}`,
  ]);
  expect((await stored(page)).analysis_queue).toHaveLength(28);
});
