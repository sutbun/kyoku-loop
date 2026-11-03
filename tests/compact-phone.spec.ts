import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { phoneFixture } from "./phone-fixture";

const pack = phoneFixture();
const proof = process.env.KYOKULOOP_UI_PROOF;

for (const [width, height] of [
  [375, 667],
  [390, 844],
  [430, 932],
]) {
  test(`compact phone ${width} keeps the hand usable and primary actions in the quiz viewport`, async ({
    page,
    context,
  }, info) => {
    await page.setViewportSize({ width, height });
    await page.route("**/phone/api", (route) => {
      const body = route.request().postDataJSON();
      return route.fulfill({
        json: {
          ok: true,
          data:
            body.action === "download"
              ? pack
              : {
                  protocol: 1,
                  source: body.payload.source,
                  device: body.payload.device,
                  receipts: [],
                  pack,
                },
        },
      });
    });
    await page.goto("/phone/");
    await page
      .getByRole("button", { name: "問題を端末に保存", exact: true })
      .click();
    await expect(page.getByTestId("offline-status")).toContainText(
      "オフライン利用可能",
    );
    await expect(
      page.getByText("今日の一打を、確かめる。", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "記録をファイルに保存" }),
    ).not.toBeVisible();
    expect(
      await page
        .locator(".study-hero")
        .evaluate((e) => e.getBoundingClientRect().height),
    ).toBeLessThan(150);
    expect(
      await page
        .locator(".phone-tools")
        .evaluate((e) => (e as HTMLDetailsElement).open),
    ).toBe(false);
    const navTop = await page
      .locator(".phone-nav")
      .evaluate((e) => e.getBoundingClientRect().top);
    expect(
      await page
        .getByText("端末の管理", { exact: true })
        .evaluate((e) => e.getBoundingClientRect().bottom),
    ).toBeLessThanOrEqual(navTop);
    if (proof && width === 390 && info.project.name === "phone") {
      mkdirSync(proof, { recursive: true });
      await page.screenshot({
        path: join(proof, "compact-home.png"),
        scale: "css",
      });
    }
    await context.setOffline(true);
    await page.getByRole("button", { name: "今日の復習を始める" }).click();
    await expect(page.locator(".phone-nav")).not.toBeVisible();
    const hand = page.getByTestId("real-hand");
    await expect(hand.locator("button")).toHaveCount(14);
    expect(
      await hand.locator("button").evaluateAll((elements) =>
        elements.every((e) => {
          const r = e.getBoundingClientRect();
          return r.width >= 44 && r.height >= 44;
        }),
      ),
    ).toBe(true);
    await expect
      .poll(() =>
        page.locator(".tile-art").evaluateAll((elements) =>
          elements.every((e) => {
            const img = e as HTMLImageElement;
            return img.complete && img.naturalWidth > 0;
          }),
        ),
      )
      .toBe(true);
    await hand.locator("button").last().click();
    await expect(
      page.getByRole("button", { name: "回答する", exact: true }),
    ).toBeEnabled();
    await page.evaluate(() => window.scrollTo(0, 0));
    const bottom = await page
      .getByRole("button", { name: "回答する", exact: true })
      .evaluate((e) => e.getBoundingClientRect().bottom);
    expect(bottom).toBeLessThanOrEqual(height);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (proof && width === 390 && info.project.name === "phone")
      await page.screenshot({
        path: join(proof, "compact-question.png"),
        scale: "css",
      });
    await page.getByRole("button", { name: "回答する", exact: true }).click();
    await expect(page.getByTestId("study-comparison")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "理解した", exact: true }),
    ).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(
      await page
        .getByRole("button", { name: "理解した", exact: true })
        .evaluate((e) => e.getBoundingClientRect().bottom),
    ).toBeLessThanOrEqual(height);
    if (proof && width === 390 && info.project.name === "phone")
      await page.screenshot({
        path: join(proof, "compact-comparison.png"),
        fullPage: true,
        scale: "css",
      });
    await page.getByRole("button", { name: "理解した", exact: true }).click();
    await expect(page.getByText("2 / 5 問", { exact: true })).toBeVisible();
  });
}

test("all 37 tile faces remain self-contained after offline reload", async ({
  page,
  context,
}) => {
  const gallery = structuredClone(pack);
  const tiles = ["m", "p", "s"]
    .flatMap((s) => Array.from({ length: 9 }, (_, n) => `${n + 1}${s}`))
    .concat(["5mr", "5pr", "5sr", "E", "S", "W", "N", "P", "F", "C"]);
  for (const item of gallery.items) {
    // Generated display fixture. Each ordinary tile remains within four visible copies.
    item.scene.own_hand = [
      "1m",
      "2m",
      "3m",
      "4m",
      "5mr",
      "6m",
      "7m",
      "8p",
      "9p",
      "1s",
      "2s",
      "3s",
      "E",
      "C",
    ];
    item.scene.drawn = "C";
    item.scene.actual = "1m";
    item.scene.suggested = "5mr";
    item.scene.melds = [[], [], [], []];
    item.scene.rivers = Array.from({ length: 4 }, (_, seat) =>
      tiles
        .slice(seat * 10, seat * 10 + 10)
        .map((tile) => ({ tile, called: false, reach: false })),
    );
    gallery.histories[item.id].scene = structuredClone(item.scene);
  }
  await page.route("**/phone/api", (route) =>
    route.fulfill({ json: { ok: true, data: gallery } }),
  );
  await page.goto("/phone/");
  await page
    .getByRole("button", { name: "問題を端末に保存", exact: true })
    .click();
  await expect(page.getByTestId("offline-status")).toContainText(
    "オフライン利用可能",
  );
  await context.setOffline(true);
  await page.reload();
  await page.getByRole("button", { name: "今日の復習を始める" }).click();
  await expect.poll(() => page.locator(".river .tile-art").count()).toBe(37);
  expect(
    await page
      .locator(".river .tile-art")
      .evaluateAll(
        (elements) =>
          new Set(elements.map((e) => (e as HTMLImageElement).src)).size,
      ),
  ).toBe(37);
  await expect
    .poll(() =>
      page.locator(".tile-art").evaluateAll((elements) =>
        elements.every((e) => {
          const img = e as HTMLImageElement;
          return img.complete && img.naturalWidth === 300;
        }),
      ),
    )
    .toBe(true);
  await expect(
    page.getByTestId("real-hand").getByRole("button", { name: /赤5萬/ }),
  ).toHaveCount(1);
  expect(
    await page
      .locator(".river .tile")
      .evaluateAll((elements) =>
        elements.every((e) => !!e.getAttribute("aria-label")),
      ),
  ).toBe(true);
});
