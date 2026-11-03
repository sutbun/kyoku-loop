import { test, expect, type Page } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve, extname, sep, join } from "node:path";
import { phoneFixture } from "./phone-fixture";
import {
  freshPhoneState,
  phoneReduce,
  type PhonePack,
} from "../src/offline/engine";
import type { Meld } from "../src/real-types";
const base = phoneFixture();
test.use({ serviceWorkers: "block" });

function fixture(full: boolean | "quads" = false): PhonePack {
  const pack = structuredClone(base);
  for (const item of pack.items) {
    const scene = item.scene;
    const melds: Meld[][] = [
      [{ type: "chi", consumed: ["2m", "3m"], tile: "1m", target: 3 }],
      [
        {
          type: "kakan",
          consumed: ["5p", "5p"],
          tile: "5pr",
          added: "5p",
          target: 3,
        },
      ],
      [{ type: "ankan", consumed: ["5s", "5sr", "5s", "5s"] }],
      [
        {
          type: "daiminkan",
          consumed: ["8p", "8p", "8p"],
          tile: "8p",
          target: 0,
        },
      ],
    ];
    if (full === "quads")
      melds.splice(
        0,
        4,
        [
          {
            type: "daiminkan",
            consumed: ["E", "E", "E"],
            tile: "E",
            target: 1,
          },
          {
            type: "daiminkan",
            consumed: ["W", "W", "W"],
            tile: "W",
            target: 2,
          },
          {
            type: "kakan",
            consumed: ["5p", "5p"],
            tile: "5p",
            added: "5pr",
            target: 3,
          },
          { type: "ankan", consumed: ["5s", "5sr", "5s", "5s"] },
        ],
        [],
        [],
        [],
      );
    const remaining = ["m", "p", "s"]
      .flatMap((suit) => Array.from({ length: 9 }, (_, i) => `${i + 1}${suit}`))
      .concat(["E", "S", "W", "N", "P", "F", "C"]);
    const pool = remaining.flatMap((t) => Array(4).fill(t));
    const consume = (value: string) => {
      const index = pool.indexOf(value.replace(/r$/, ""));
      if (index < 0) throw Error("fixture overdraw");
      pool.splice(index, 1);
    };
    for (const group of melds.flat())
      for (const tile of [
        ...group.consumed,
        ...(group.tile ? [group.tile] : []),
        ...(group.added ? [group.added] : []),
      ])
        consume(tile);
    for (let seat = 0; seat < 4; seat++)
      while (
        melds[seat].length <
        (full === true ? 4 : full === "quads" ? 0 : seat === 0 ? 2 : 1)
      ) {
        const value = remaining.find(
          (t) => pool.filter((v) => v === t).length >= 3,
        )!;
        [0, 1, 2].forEach(() => consume(value));
        melds[seat].push({
          type: "pon",
          consumed: [value, value],
          tile: value,
          target: (seat + 1) % 4,
        });
      }
    scene.seat = 0;
    scene.own_wind = "E";
    scene.kyoku = 1;
    scene.melds = melds;
    scene.own_hand = pool.splice(0, 14 - 3 * melds[0].length);
    scene.drawn = scene.own_hand.at(-1)!;
    scene.actual = scene.own_hand[0];
    scene.suggested = scene.own_hand.at(-1)!;
    scene.actor = 0;
    scene.event_type = "tsumo";
    scene.dora_markers = pool.splice(0, 1);
    scene.scores = [39100, 7400, 16900, 34600];
    scene.reach_declared = [false, false, false, false];
    scene.reach_accepted = [false, false, false, false];
    scene.rivers = [[], [], [], []];
    for (const group of melds.flat())
      if (group.tile && group.target !== undefined)
        scene.rivers[group.target].push({
          tile: group.tile,
          called: true,
          reach: false,
        });
    for (const river of scene.rivers)
      while (river.length < 18)
        river.push({ tile: pool.shift()!, called: false, reach: false });
    pack.histories[item.id].scene = structuredClone(scene);
  }
  return pack;
}

async function open(page: Page, pack = fixture(), online = false) {
  let finish: (() => void) | undefined;
  let requests = 0;
  const root = resolve(process.env.KYOKULOOP_UI_DIST ?? "dist");
  await page.route("**/*", async (route) => {
    let path = new URL(route.request().url()).pathname;
    if (path === "/phone/api") {
      requests++;
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      const body = route.request().postDataJSON();
      return route.fulfill({
        json: {
          ok: true,
          data: {
            protocol: 1,
            source: pack.source,
            device: body.payload.device,
            receipts: [],
            pack,
          },
        },
      });
    }
    if (path === "/seat-fixture")
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
      ".css": "text/css",
      ".js": "text/javascript",
      ".png": "image/png",
      ".webmanifest": "application/manifest+json",
    };
    try {
      return route.fulfill({
        contentType: types[extname(file)] ?? "application/octet-stream",
        body: readFileSync(file),
      });
    } catch {
      return route.fulfill({ status: 404, body: "" });
    }
  });
  await page.addInitScript(
    (online) =>
      Object.defineProperty(navigator, "onLine", { get: () => online }),
    online,
  );
  await page.goto("/seat-fixture");
  const state = phoneReduce(freshPhoneState("seat-fixture"), {
    action: "install_pack",
    pack,
  }).state;
  await page.evaluate(
    (state) =>
      new Promise<void>((done, fail) => {
        const req = indexedDB.open("kyokuloop-phone-v1", 1);
        req.onupgradeneeded = () => req.result.createObjectStore("local");
        req.onerror = () => fail(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("local", "readwrite");
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
  await page.goto("/phone/");
  await page.getByRole("button", { name: "今日の復習を始める" }).click();
  return { requests: () => requests, finish: () => finish?.() };
}

for (const [width, height] of [
  [320, 740],
  [390, 844],
  [820, 1180],
  [1180, 820],
  [1440, 1000],
]) {
  test(`seat tiles stay inside the table at ${width}x${height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height });
    await open(page, fixture(true));
    await expect(page.locator(".concealed-hand")).toHaveCount(3);
    for (const hand of await page.locator(".concealed-hand").all()) {
      await expect(hand.locator(".tile-back")).toHaveCount(1);
      await expect(hand.locator(".tile-art")).toHaveCount(0);
    }
    await expect(page.locator(".seat-melds")).toHaveCount(4);
    await expect(page.locator(".table-center .player-label")).toHaveCount(4);
    await expect(page.locator(".real-board")).not.toContainText(
      /あなた|上家|下家|対面/,
    );
    const errors = await page.locator(".table").evaluate((table) => {
      const board = table.getBoundingClientRect();
      const center = table
        .querySelector(".table-center")!
        .getBoundingClientRect();
      const tiles = [
        ...table.querySelectorAll(
          ".river .tile,.seat-melds .tile,.concealed-hand .tile",
        ),
      ].map((e) => e.getBoundingClientRect());
      const hit = (a: DOMRect, b: DOMRect) =>
        Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.8 &&
        Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.8;
      const errors: string[] = [];
      for (const [i, r] of tiles.entries()) {
        if (
          r.left < board.left ||
          r.top < board.top ||
          r.right > board.right ||
          r.bottom > board.bottom
        )
          errors.push(`outside:${i}`);
        if (hit(r, center)) errors.push(`center:${i}`);
        if (tiles.slice(i + 1).some((other) => hit(r, other)))
          errors.push(`overlap:${i}`);
      }
      for (const e of table.querySelectorAll(".player-label")) {
        const r = e.getBoundingClientRect();
        if (
          r.left < center.left ||
          r.top < center.top ||
          r.right > center.right ||
          r.bottom > center.bottom
        )
          errors.push("score outside center");
      }
      return errors;
    });
    expect(errors).toEqual([]);
    if (process.env.KYOKULOOP_UI_PROOF && info.project.name === "phone") {
      mkdirSync(process.env.KYOKULOOP_UI_PROOF, { recursive: true });
      await page.screenshot({
        path: join(process.env.KYOKULOOP_UI_PROOF, `seats-${width}.png`),
        scale: "css",
      });
    }
    await page.getByTestId("real-hand").locator("button").first().click();
    await page.getByRole("button", { name: "回答する", exact: true }).click();
    await expect(page.getByTestId("study-comparison")).toBeVisible();
  });
}

test("calls retain their relative source, kan stacking, concealed edges and red five", async ({
  page,
}) => {
  await open(page);
  await expect(
    page.locator('.meld[data-kind="chi"] .meld-slot').first(),
  ).toHaveClass(/meld-called/);
  await expect(
    page.locator('.meld[data-kind="kakan"] .meld-slot').nth(1),
  ).toHaveClass(/meld-called/);
  await expect(
    page.locator('.meld[data-kind="daiminkan"] .meld-slot').last(),
  ).toHaveClass(/meld-called/);
  await expect(page.locator(".meld-added .tile")).toHaveCount(1);
  await expect(
    page
      .getByRole("group", { name: "加槓・対面", exact: true })
      .getByRole("img", { name: "赤5筒", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".concealed-kan .tile-back")).toHaveCount(2);
  await expect(page.locator(".concealed-kan .red")).toHaveCount(1);
  for (const [position, count] of [
    [0, 10],
    [1, 10],
    [3, 10],
  ])
    await expect(
      page.locator(`.player-${position} .concealed-hand .tile-back`),
    ).toHaveCount(count);
});

test("four quads fit along the caller's right edge without covering hidden hands", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await open(page, fixture("quads"));
  await expect(page.locator(".seat-melds .meld")).toHaveCount(4);
  await expect(page.locator(".meld-added .red")).toHaveCount(1);
  const collision = await page.locator(".table").evaluate((table) => {
    const tiles = [...table.querySelectorAll(".seat-melds .tile")].map((e) =>
      e.getBoundingClientRect(),
    );
    const others = [
      ...table.querySelectorAll(
        ".concealed-hand .tile,.river .tile,.table-center",
      ),
    ].map((e) => e.getBoundingClientRect());
    return tiles.some((a) =>
      others.some(
        (b) =>
          Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.8 &&
          Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.8,
      ),
    );
  });
  expect(collision).toBe(false);
  if (process.env.KYOKULOOP_UI_PROOF && info.project.name === "phone") {
    mkdirSync(process.env.KYOKULOOP_UI_PROOF, { recursive: true });
    await page.screenshot({
      path: join(process.env.KYOKULOOP_UI_PROOF, "four-quads.png"),
      scale: "css",
    });
  }
});

for (const [width, height] of [
  [390, 844],
  [820, 1180],
  [1180, 820],
]) {
  test(`synchronization never moves the study UI at ${width}x${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    const network = await open(page, base, true);
    const rectangles = () =>
      page
        .locator(
          ".phone-header,.table,[data-testid='real-hand'],.quiz-answer,[data-testid='version-update']",
        )
        .evaluateAll((elements) =>
          elements.map((e) => {
            const r = e.getBoundingClientRect();
            return [r.x, r.y, r.width, r.height].map(Math.round);
          }),
        );
    await expect(page.locator(".table")).toBeVisible();
    await expect
      .poll(async () => await rectangles())
      .toEqual(await rectangles());
    const before = await rectangles();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.locator(".phone-header [role='status']")).toHaveText(
      "同期中…",
    );
    await expect.poll(rectangles).toEqual(before);
    network.finish();
    await expect(page.locator(".phone-header [role='status']")).toHaveText("");
    expect(network.requests()).toBe(1);
    await expect.poll(rectangles).toEqual(before);
  });
}
