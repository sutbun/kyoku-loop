import { test, expect, type Page } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve, join, extname, sep } from "node:path";
import { phoneFixture } from "./phone-fixture";
import { freshPhoneState, phoneReduce } from "../src/offline/engine";

const pack = phoneFixture();
test.use({ serviceWorkers: "block" });

function fixture(count: number) {
  const result = structuredClone(pack);
  for (const item of result.items) {
    const scene = item.scene;
    scene.melds = [[], [], [], []];
    const used: Record<string, number> = {};
    for (const tile of [...scene.own_hand, ...scene.dora_markers]) {
      const key = tile.replace(/r$/, "");
      used[key] = (used[key] ?? 0) + 1;
    }
    const tiles = ["m", "p", "s"]
      .flatMap((suit) => Array.from({ length: 9 }, (_, i) => `${i + 1}${suit}`))
      .concat(["E", "S", "W", "N", "P", "F", "C"]);
    const pool = tiles.flatMap((tile) =>
      Array.from({ length: 4 - (used[tile] ?? 0) }, () => tile),
    );
    scene.rivers = Array.from({ length: 4 }, (_, seat) =>
      pool.splice(0, count).map((tile, index) => ({
        tile,
        called: seat === 0 && index === 2,
        reach: index === [4, 7, 14, 18][seat],
      })),
    );
    scene.reach_declared = scene.rivers.map((river) =>
      river.some((r) => r.reach),
    );
    scene.reach_accepted = [...scene.reach_declared];
    result.histories[item.id].scene = structuredClone(scene);
  }
  return result;
}

async function openStudy(page: Page, count: number) {
  const data = fixture(count);
  const root = resolve("dist");
  await page.route("**/*", async (route) => {
    let path = new URL(route.request().url()).pathname;
    if (path === "/phone/api") {
      return route.fulfill({
        json: { ok: false, error: "invalid_pack" },
      });
    }
    if (path === "/river-fixture")
      return route.fulfill({
        contentType: "text/html",
        body: "<!doctype html>",
      });
    if (path.startsWith("/phone/assets/")) path = path.slice(6);
    const file = resolve(
      root,
      `.${path === "/phone/" ? "/phone/index.html" : path === "/" ? "/index.html" : path}`,
    );
    if (!file.startsWith(root + sep))
      throw new Error("Unexpected fixture path");
    const types: Record<string, string> = {
      ".html": "text/html",
      ".js": "text/javascript",
      ".css": "text/css",
      ".png": "image/png",
      ".json": "application/json",
      ".webmanifest": "application/manifest+json",
    };
    try {
      return route.fulfill({
        contentType: types[extname(file)] || "application/octet-stream",
        body: readFileSync(file),
      });
    } catch {
      return route.fulfill({ status: 404, body: "" });
    }
  });
  // Load generated state directly: this layout test blocks service workers and
  // does not claim to verify the separate offline asset-caching contract.
  const state = phoneReduce(freshPhoneState("river-fixture"), {
    action: "install_pack",
    pack: data,
  }).state;
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "onLine", { get: () => false }),
  );
  await page.goto("/river-fixture");
  await page.evaluate(
    (state) =>
      new Promise<void>((done, fail) => {
        const request = indexedDB.open("kyokuloop-phone-v1", 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore("local");
        request.onerror = () => fail(request.error);
        request.onsuccess = () => {
          const db = request.result;
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
  await expect(page.locator(".river-discard")).toHaveCount(count * 4);
}

async function geometry(page: Page) {
  return page.locator(".table").evaluate((table) => {
    const rect = table.getBoundingClientRect();
    return [...table.querySelectorAll(".player")].map((player) => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(player).transform);
      const inverse = matrix.inverse();
      return {
        rotation: [matrix.a, matrix.b, matrix.c, matrix.d],
        rows: [...player.querySelectorAll(".river-row")].map((row) =>
          [...row.querySelectorAll(".tile")].map((tile) => {
            const r = tile.getBoundingClientRect();
            const point = new DOMPoint(
              (r.x + r.width / 2 - rect.x) / rect.width - 0.5,
              (r.y + r.height / 2 - rect.y) / rect.height - 0.5,
            ).matrixTransform(inverse);
            return { x: point.x, y: point.y };
          }),
        ),
      };
    });
  });
}

for (const [width, height] of [
  [320, 740],
  [390, 844],
  [820, 1180],
  [1180, 820],
  [1440, 1000],
]) {
  test(`four rotated rivers keep 6/6/12 tiles aligned and visible at ${width}x${height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height });
    await openStudy(page, 24);
    const seats = await geometry(page);
    const rotations = [
      [-1, 0, 0, -1],
      [0, 1, -1, 0],
      [1, 0, 0, 1],
      [0, -1, 1, 0],
    ];
    for (const [seat, { rows, rotation }] of seats.entries()) {
      rotation.forEach((v, i) => expect(v).toBeCloseTo(rotations[seat][i]));
      expect(rows.map((r) => r.length)).toEqual([6, 6, 12]);
      expect(rows[1][0].x).toBeCloseTo(rows[0][0].x, 3);
      expect(rows[2][0].x).toBeCloseTo(rows[0][0].x, 3);
      expect(rows[1][0].y).toBeGreaterThan(rows[0][0].y);
      expect(rows[2][0].y).toBeGreaterThan(rows[1][0].y);
      for (const row of rows) {
        for (let i = 1; i < row.length; i++) {
          expect(row[i].x).toBeGreaterThan(row[i - 1].x);
          expect(row[i].y).toBeCloseTo(row[0].y, 3);
        }
      }
      // The 19th discard stays in row three, beyond the 18th.
      expect(rows[2][6].x).toBeGreaterThan(rows[2][5].x);
    }
    const problems = await page.locator(".table").evaluate((table) => {
      const board = table.getBoundingClientRect();
      const center = table
        .querySelector(".table-center")!
        .getBoundingClientRect();
      const labels = [...table.querySelectorAll(".player-label")].map((e) =>
        e.getBoundingClientRect(),
      );
      const tiles = [...table.querySelectorAll(".river .tile")].map((e) =>
        e.getBoundingClientRect(),
      );
      const intersects = (a: DOMRect, b: DOMRect) =>
        Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 &&
        Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
      return tiles.flatMap((tile, i) => {
        const errors = [];
        if (
          tile.left < board.left ||
          tile.top < board.top ||
          tile.right > board.right ||
          tile.bottom > board.bottom
        )
          errors.push(`outside:${i}`);
        if (intersects(tile, center)) errors.push(`center:${i}`);
        if (labels.some((label) => intersects(tile, label)))
          errors.push(`label:${i}`);
        if (tiles.slice(i + 1).some((other) => intersects(tile, other)))
          errors.push(`overlap:${i}`);
        return errors;
      });
    });
    expect(problems).toEqual([]);
    await expect(page.locator(".river .reach-tile")).toHaveCount(4);
    await expect(page.locator(".river .called")).toHaveCSS("opacity", "0.35");
    await expect(page.getByTestId("study-comparison")).toHaveCount(0);
    await page.getByTestId("real-hand").locator("button").last().click();
    await page.getByRole("button", { name: "回答する", exact: true }).click();
    await expect(page.getByTestId("study-comparison")).toBeVisible();
    const revealed = await geometry(page);
    revealed.forEach(({ rows }, seat) =>
      rows.forEach((row, r) =>
        row.forEach((point, i) => {
          expect(point.x).toBeCloseTo(seats[seat].rows[r][i].x, 3);
          expect(point.y).toBeCloseTo(seats[seat].rows[r][i].y, 3);
        }),
      ),
    );
    const proof = process.env.KYOKULOOP_UI_PROOF;
    if (proof && info.project.name === "desktop") {
      mkdirSync(proof, { recursive: true });
      await page
        .locator(".table")
        .screenshot({ path: join(proof, `rivers-${width}.png`) });
    }
  });
}

test("short rivers start at the same fixed anchors as later rounds", async ({
  page,
  context,
}, info) => {
  await openStudy(page, 2);
  const short = await geometry(page);
  const other = await context.newPage();
  await openStudy(other, 24);
  const long = await geometry(other);
  for (let seat = 0; seat < 4; seat++) {
    expect(short[seat].rows.map((r) => r.length)).toEqual([2, 0, 0]);
    expect(short[seat].rows[0][0].x).toBeCloseTo(long[seat].rows[0][0].x, 3);
    expect(short[seat].rows[0][0].y).toBeCloseTo(long[seat].rows[0][0].y, 3);
  }
  const proof = process.env.KYOKULOOP_UI_PROOF;
  if (proof && info.project.name === "desktop") {
    mkdirSync(proof, { recursive: true });
    await page
      .locator(".table")
      .screenshot({ path: join(proof, "rivers-opening.png") });
  }
  await other.close();
});

test("Windows demo uses the same rotated rivers on a square table", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openStudy(page, 2);
  await page.goto("/?demo=1");
  await page
    .getByRole("button", { name: "新しい牌譜を確認", exact: true })
    .click();
  await expect(page.locator(".river-row")).toHaveCount(12);
  expect(
    await page.locator(".table").evaluate((e) => {
      const r = e.getBoundingClientRect();
      return Math.abs(r.width - r.height);
    }),
  ).toBeLessThan(1);
  const seats = await geometry(page);
  expect(seats[0].rotation).toEqual([-1, 0, 0, -1]);
  expect(seats[1].rotation).toEqual([0, 1, -1, 0]);
  expect(seats[3].rotation).toEqual([0, -1, 1, 0]);
  const proof = process.env.KYOKULOOP_UI_PROOF;
  if (proof && info.project.name === "desktop") {
    mkdirSync(proof, { recursive: true });
    await page
      .locator(".table")
      .screenshot({ path: join(proof, "rivers-desktop-demo.png") });
  }
});
