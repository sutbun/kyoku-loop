import { expect, type Page } from "@playwright/test";
import { test } from "./static-app";
import type { AnalysisEntry } from "../src/analysis-queue";
import { freshPhoneState, phoneReduce } from "../src/offline/engine";
import { phoneFixture } from "./phone-fixture";

test.use({ serviceWorkers: "block" });
const player = 123;
const actor = 1358437 + ((7 * player + 1117113) ^ 86216345);
const entry = (n: number, created: string, at?: string): AnalysisEntry => {
  const id = `260101-fictional-sort-${n}_a${actor}`;
  const url = `https://game.mahjongsoul.com/?paipu=${id}`;
  return {
    id,
    url,
    created,
    ...(at
      ? {
          history: {
            at,
            rank: 1,
            seat: 0,
            mode: 12,
            player,
            url,
            players: [0, 1, 2, 3].map((i) => ({
              name: `架空${n}-${i}`,
              score: 25000,
            })),
          },
        }
      : {}),
  };
};
async function open(page: Page, phone: boolean, entries: AnalysisEntry[]) {
  await page.route("**/api/local", (route) => {
    expect(route.request().postDataJSON().action).toBe("state");
    return route.fulfill({
      json: {
        ok: true,
        data: { reports: [], items: [], analysis_queue: entries },
      },
    });
  });
  if (!phone) {
    await page.goto("/");
    return page.getByRole("button", { name: "牌譜", exact: true }).click();
  }
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "onLine", { get: () => false }),
  );
  await page.goto("/phone/");
  const state = phoneReduce(freshPhoneState("sort-fixture"), {
    action: "install_pack",
    pack: phoneFixture(),
  }).state;
  state.analysis_queue = entries;
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
  await page
    .getByRole("navigation", { name: "メイン" })
    .getByRole("button", { name: "牌譜", exact: true })
    .click();
}
const titles = (page: Page) =>
  page.getByTestId("analysis-row").locator("strong");

test("replays default to addition time, switch to game time, keep unknown dates last and preserve selection/data", async ({
  page,
}, info) => {
  const phone = info.project.name === "phone";
  const entries = [
    entry(2, "2026-01-02T00:00:00Z", "2026-01-12T00:00:00Z"),
    entry(1, "2026-01-01T00:00:00Z", "2026-01-10T00:00:00Z"),
    entry(3, "2026-01-03T00:00:00Z", "2026-01-11T00:00:00Z"),
    entry(4, "2026-01-04T00:00:00Z"),
  ];
  const before = structuredClone(entries);
  await open(page, phone, entries);
  const order = page.getByRole("combobox", {
    name: "牌譜の並び順",
    exact: true,
  });
  await expect(order).toHaveValue("added");
  await expect(titles(page)).toHaveText([
    "保存牌譜 4",
    /1\/11/,
    /1\/12/,
    /1\/10/,
  ]);
  await page.getByTestId("analysis-row").first().getByRole("checkbox").check();
  await order.selectOption("played");
  await expect(titles(page)).toHaveText([
    /1\/12/,
    /1\/11/,
    /1\/10/,
    "保存牌譜 4",
  ]);
  await expect(
    page.getByTestId("analysis-row").last().getByRole("checkbox"),
  ).toBeChecked();
  await page.getByRole("button", { name: "未解析 4件", exact: true }).click();
  await expect(order).toHaveValue("played");
  await expect(titles(page).first()).toHaveText(/1\/12/);
  await order.selectOption("added");
  await expect(titles(page).first()).toHaveText("保存牌譜 4");
  expect(entries).toEqual(before);
  if (phone) {
    const saved = await page.evaluate(
      () =>
        new Promise<AnalysisEntry[]>((done) => {
          const r = indexedDB.open("kyokuloop-phone-v1", 1);
          r.onsuccess = () => {
            const db = r.result,
              request = db
                .transaction("local")
                .objectStore("local")
                .get("state");
            request.onsuccess = () => {
              db.close();
              done(request.result.analysis_queue);
            };
          };
        }),
    );
    expect(saved).toEqual(before);
  }
  await page.screenshot({
    path: info.outputPath("replay-sort.png"),
    fullPage: true,
  });
});

test("sort changes reset pagination, equal dates use addition order and all matching pages stay selectable", async ({
  page,
}, info) => {
  const phone = info.project.name === "phone";
  const entries = Array.from({ length: 13 }, (_, i) =>
    entry(i, "2026-01-01T00:00:00Z", "2026-01-10T00:00:00Z"),
  );
  await open(page, phone, entries);
  const rows = page.getByTestId("analysis-row");
  await expect(rows).toHaveCount(10);
  await expect(rows.first()).toContainText("架空12-1");
  await page.getByRole("button", { name: /さらに10件表示/ }).click();
  await expect(rows).toHaveCount(13);
  await page
    .getByRole("combobox", { name: "牌譜の並び順", exact: true })
    .selectOption("played");
  await expect(rows).toHaveCount(10);
  await expect(rows.first()).toContainText("架空12-1");
  await page.getByRole("checkbox", { name: "全選択", exact: true }).check();
  await expect(
    page.getByRole("button", { name: "選択した13件を削除", exact: true }),
  ).toBeEnabled();
});
