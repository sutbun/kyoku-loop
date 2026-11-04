import { test, expect, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { phoneFixture } from "./phone-fixture";
import {
  freshPhoneState,
  phoneReduce,
  type PhoneState,
} from "../src/offline/engine";
const pack = phoneFixture();
const mortal = JSON.parse(
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
  raw=mortal_fixture(True);raw['review']['model_tag']='4.1b'
  s.commit(s.stage(json.dumps(raw).encode(),None)['token'],0,0,None)
  print(json.dumps(s.phone_pack()))
 finally:s.close()
`,
    ],
    { encoding: "utf8", windowsHide: true },
  ),
);
const initial = (p = pack) =>
  phoneReduce(freshPhoneState("study-controls-generated"), {
    action: "install_pack",
    pack: p,
  }).state;
async function read(page: Page): Promise<PhoneState> {
  return page.evaluate(
    () =>
      new Promise((done, reject) => {
        const r = indexedDB.open("kyokuloop-phone-v1", 1);
        r.onsuccess = () => {
          const db = r.result;
          const q = db.transaction("local").objectStore("local").get("state");
          q.onsuccess = () => {
            db.close();
            done(q.result);
          };
          q.onerror = () => reject(q.error);
        };
        r.onerror = () => reject(r.error);
      }),
  );
}
async function open(page: Page, state = initial()) {
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === "/phone/api")
      return route.fulfill({ status: 503, body: "Unavailable" });
    const path = u.pathname.startsWith("/phone/assets/")
      ? u.pathname.slice(6)
      : u.pathname.endsWith("/")
        ? u.pathname + "index.html"
        : u.pathname;
    const file = resolve("dist", "." + path);
    if (file.startsWith(resolve("dist")) && existsSync(file))
      return route.fulfill({ path: file });
    return route.abort();
  });
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "onLine", {
      get: () => (window as any).__testOnline === true,
    }),
  );
  await page.goto("/phone/");
  await page.evaluate(
    (state) =>
      new Promise<void>((done, reject) => {
        const r = indexedDB.open("kyokuloop-phone-v1", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("local");
        r.onsuccess = () => {
          const db = r.result;
          const tx = db.transaction("local", "readwrite");
          tx.objectStore("local").put(state, "state");
          tx.oncomplete = () => {
            db.close();
            done();
          };
          tx.onerror = () => reject(tx.error);
        };
        r.onerror = () => reject(r.error);
      }),
    state,
  );
  await page.reload();
}
const settle = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
for (const mode of ["button", "select", "repeat"] as const)
  test(`answer mode ${mode} persists, confirms only as requested and can rechoose`, async ({
    page,
  }) => {
    await open(page);
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "設定", exact: true })
      .click();
    await page.getByText("学習の設定", { exact: true }).click();
    const labels = {
      button: "回答ボタンで決定",
      select: "牌を選択した時点で決定",
      repeat: "選択中の牌をもう一度タップして決定",
    };
    if (mode === "button") {
      await expect(
        page.getByRole("radio", { name: labels.button, exact: true }),
      ).toBeChecked();
      await page
        .getByRole("radio", { name: labels.select, exact: true })
        .check();
    }
    await page.getByRole("radio", { name: labels[mode], exact: true }).check();
    await page.reload();
    expect(
      await page.evaluate(() => localStorage.getItem("kyokuloop-answer-mode")),
    ).toBe(mode);
    await page
      .getByRole("button", { name: /問練習する/, exact: true })
      .click();
    const tile = page.getByTestId("real-hand").locator("button").first();
    await tile.click();
    if (mode !== "select") {
      await expect(page.getByTestId("study-comparison")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "回答する", exact: true }),
      ).toBeEnabled();
      if (mode === "repeat") await tile.click();
      else {
        await tile.click();
        await expect(page.getByTestId("study-comparison")).toHaveCount(0);
        await page
          .getByRole("button", { name: "回答する", exact: true })
          .click();
      }
    }
    await expect(page.getByTestId("study-comparison")).toBeVisible();
    expect((await read(page)).events).toEqual([]);
    await page
      .getByRole("button", { name: "回答を選び直す", exact: true })
      .click();
    await expect(page.getByTestId("study-comparison")).toHaveCount(0);
  });
test("changed remote questions advance automatically while keeping pending answers and due dates", async ({
  page,
}) => {
  let state = initial();
  const call = (r: object) => {
    const v = phoneReduce(state, r);
    state = v.state;
    return v.data as any;
  };
  let q = call({ action: "study_start", mode: "practice" });
  call({
    action: "study_choice",
    session: q.id,
    choice: "choose",
    answer: q.scene.own_hand[0],
  });
  call({ action: "study_choice", session: q.id, choice: "confirm" });
  q = call({
    action: "study_rate",
    session: q.id,
    item: q.item_id,
    rating: "理解した",
    event: "unsubmitted-answer",
  });
  for (const entry of state.session!.queue.slice(1, 3)) {
    const item = state.pack!.items.find((i) => i.id === entry.id)!;
    item.revision++;
    item.due = "2099-01-01";
  }
  const before = structuredClone(state);
  await open(page, state);
  await page
    .getByRole("button", { name: "続きから再開", exact: false })
    .click();
  await expect(page.getByText("4 / 5 問", { exact: true })).toBeVisible();
  await expect(page.getByTestId("real-hand")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "この問題をスキップ" }),
  ).toHaveCount(0);
  const saved = await read(page);
  expect(saved.session!.index).toBe(3);
  expect(saved.events).toEqual(before.events);
  expect(saved.pack).toEqual(before.pack);
  expect(saved.session!.answers).toEqual(before.session!.answers);
});
test("all changed remote questions finish without a manual skip or invented answers", async ({
  page,
}) => {
  let state = phoneReduce(initial(), {
    action: "study_start",
    mode: "practice",
  }).state;
  for (const item of state.pack!.items) item.revision++;
  await open(page, state);
  await page
    .getByRole("button", { name: "続きから再開", exact: false })
    .click();
  await expect(
    page.getByText("この復習の対象は更新済みです。", { exact: true }),
  ).toBeVisible();
  const saved = await read(page);
  expect(saved.session!.index).toBe(5);
  expect(saved.events).toEqual([]);
  expect(saved.session!.answers).toEqual([]);
});
for (const [width, height] of [
  [390, 844],
  [768, 1024],
  [1180, 820],
  [1280, 960],
])
  test(`answer placement and comparison rows align at ${width}x${height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height });
    await open(page, initial(mortal));
    await page
      .getByRole("button", { name: /問練習する/, exact: true })
      .click();
    await settle(page);
    const hand = page.getByTestId("real-hand");
    if (width >= 1000) {
      const board = await page.locator(".board-panel").boundingBox();
      const card = await page.locator(".quiz-answer").boundingBox();
      expect(
        Math.abs(board!.y + board!.height - card!.y - card!.height),
      ).toBeLessThan(2);
      const handBounds = await hand.boundingBox();
      const confirmBounds = await page
        .getByRole("button", { name: "回答する", exact: true })
        .boundingBox();
      expect(
        Math.abs(
          confirmBounds!.y +
            confirmBounds!.height -
            handBounds!.y -
            handBounds!.height,
        ),
      ).toBeLessThan(14);
    }
    await hand.locator("button").last().click();
    await page.getByRole("button", { name: "回答する", exact: true }).click();
    await settle(page);
    const labels = page
      .getByTestId("study-comparison")
      .locator(":scope > div:not(.comparison-tools) > span:first-child");
    await expect(labels).toHaveText(["今回", "対局時", "Mortal4.1b"]);
    const tiles = await page
      .locator(".comparison-choice .tile")
      .evaluateAll((es) =>
        es.map((e) => ({
          x: e.getBoundingClientRect().x + e.getBoundingClientRect().width / 2,
          y: e.getBoundingClientRect().y,
        })),
      );
    const policies = await page
      .locator(".comparison-policy")
      .evaluateAll((es) =>
        es.map((e) => ({
          x: e.getBoundingClientRect().x + e.getBoundingClientRect().width / 2,
          y: e.getBoundingClientRect().y,
        })),
      );
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(tiles[i].x - policies[i].x)).toBeLessThan(1);
      expect(Math.abs(tiles[i].y - tiles[0].y)).toBeLessThan(1);
      expect(Math.abs(policies[i].y - policies[0].y)).toBeLessThan(1);
    }
    if (width >= 1000) {
      const board = await page.locator(".board-panel").boundingBox();
      const card = await page.locator(".quiz-answer").boundingBox();
      expect(
        Math.abs(board!.y + board!.height - card!.y - card!.height),
      ).toBeLessThan(2);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath("study-layout.png") });
  });
test("sync trouble stays in the fixed header and its details never move the board", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 960 });
  const state = initial();
  state.last_sync = "2026-11-01T00:00:00Z";
  await open(page, state);
  await page.getByRole("button", { name: /問練習する/, exact: true }).click();
  await settle(page);
  const before = await page.locator(".board-panel").boundingBox();
  await page.evaluate(() => {
    (window as any).__testOnline = true;
    window.dispatchEvent(new Event("online"));
  });
  const button = page.getByRole("button", {
    name: "同期の状態を確認",
    exact: true,
  });
  await expect(button).toContainText("同期を確認");
  await settle(page);
  const after = await page.locator(".board-panel").boundingBox();
  expect(after!.y).toBeCloseTo(before!.y, 1);
  expect(after!.height).toBeCloseTo(before!.height, 1);
  await expect(page.locator("main .phone-sync-notice")).toHaveCount(0);
  await button.click();
  await expect(
    page.getByRole("dialog", { name: "同期の状態", exact: true }),
  ).toBeVisible();
  await settle(page);
  expect((await page.locator(".board-panel").boundingBox())!.y).toBeCloseTo(
    before!.y,
    1,
  );
  await page.getByRole("button", { name: "同期の詳細を閉じる" }).click();
  expect((await read(page)).events).toEqual([]);
});
