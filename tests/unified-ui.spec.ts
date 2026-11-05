import { expect, type Page } from "@playwright/test";
import { test } from "./static-app";
import { phoneFixture } from "./phone-fixture";
import { freshPhoneState, phoneReduce } from "../src/offline/engine";
import type { AnalysisEntry } from "../src/analysis-queue";

test.use({ serviceWorkers: "block" });
const pack = phoneFixture();
const entries: AnalysisEntry[] = [0, 1, 2].map((i) => ({
  id: `260101-fictional-unified-${i}_a123`,
  url: `https://game.mahjongsoul.com/?paipu=260101-fictional-unified-${i}_a123`,
  created: `2026-01-0${i + 1}T00:00:00Z`,
  ...(i
    ? {
        reports: [i === 1 ? pack.items[0].report : "a".repeat(64)],
        ready: i === 1,
      }
    : {}),
}));
async function open(page: Page, phone: boolean) {
  const writes: object[] = [];
  await page.route("**/api/local", (route) => {
    const body = route.request().postDataJSON();
    if (body.action !== "state") writes.push(body);
    return route.fulfill({
      json: {
        ok: true,
        data: {
          reports: [],
          items: [],
          due_count: 0,
          practice_count: 0,
          analysis_queue: entries,
        },
      },
    });
  });
  if (!phone) await page.goto("/");
  else {
    await page.addInitScript(() =>
      Object.defineProperty(navigator, "onLine", { get: () => false }),
    );
    await page.goto("/phone/");
    const state = phoneReduce(freshPhoneState("unified-fixture"), {
      action: "install_pack",
      pack,
    }).state;
    for (const item of state.pack!.items) item.due = "2099-01-01";
    state.analysis_queue = structuredClone(entries);
    await page.evaluate(
      (state) =>
        new Promise<void>((done, fail) => {
          const r = indexedDB.open("kyokuloop-phone-v1", 1);
          r.onupgradeneeded = () => r.result.createObjectStore("local");
          r.onerror = () => fail(r.error);
          r.onsuccess = () => {
            const db = r.result,
              tx = db.transaction("local", "readwrite");
            tx.objectStore("local").put(state, "state");
            tx.oncomplete = () => {
              db.close();
              done();
            };
            tx.onerror = () => fail(tx.error);
          };
        }),
      state,
    );
    await page.reload();
  }
  return writes;
}
const tab = (page: Page, name: string) =>
  page
    .getByRole("navigation", { name: "メイン", exact: true })
    .getByRole("button", { name, exact: true })
    .click();

test("shared tabs start in study, hide empty actions and retain URL drafts without writes", async ({
  page,
}, info) => {
  const phone = info.project.name === "phone";
  const writes = await open(page, phone);
  await expect(
    page
      .getByRole("navigation", { name: "メイン", exact: true })
      .getByRole("button"),
  ).toHaveText(["学習", "牌譜", "設定"]);
  await expect(
    page.getByRole("button", { name: "今日の復習を始める" }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "問題一覧を見る", exact: false }),
  ).toBeVisible();
  await tab(page, "牌譜");
  await page.getByText("URLを追加", { exact: true }).click();
  const field = page.getByRole("textbox", { name: "雀魂共有URL", exact: true });
  await field.fill("unfinished draft");
  await tab(page, "設定");
  await expect(page.getByText("学習の設定", { exact: true })).toBeVisible();
  if (!phone) {
    await expect(
      page.getByRole("button", { name: "バックアップと復元", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Mortal 自動取り込み", { exact: false }),
    ).toBeVisible();
  }
  await tab(page, "学習");
  await page.screenshot({ path: info.outputPath("study.png"), fullPage: true });
  await tab(page, "牌譜");
  await expect(field).toHaveValue("unfinished draft");
  expect(writes).toEqual([]);
});

test("shared analysed filter includes no-question results and detail actions stay available", async ({
  page,
}, info) => {
  const phone = info.project.name === "phone";
  await open(page, phone);
  await tab(page, "牌譜");
  await page.getByRole("button", { name: "解析済み 2件", exact: true }).click();
  const rows = page.getByTestId("analysis-row");
  await expect(rows).toHaveCount(2);
  await expect(
    page.getByText("解析済み・問題なし", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "問題を見る", exact: true }),
  ).toHaveCount(1);
  const empty = rows.filter({ hasText: "解析済み・問題なし" });
  await expect(
    empty.getByRole("button", { name: "Mortalへ", exact: true }),
  ).not.toBeVisible();
  await empty.getByText("詳細", { exact: true }).click();
  await expect(
    empty.getByRole("button", { name: "Mortalへ", exact: true }),
  ).toBeVisible();
  if (!phone)
    await expect(
      empty.getByRole("button", { name: "結果を登録", exact: true }),
    ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("replays.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "未解析 1件", exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(
    rows.getByRole("button", { name: "Mortalへ", exact: true }),
  ).toBeVisible();
});
