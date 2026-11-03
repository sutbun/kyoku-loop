import { test, expect, type Page, type Locator } from "@playwright/test";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join, extname, sep } from "node:path";
import { phoneFixture } from "./phone-fixture";
import { freshPhoneState, phoneReduce } from "../src/offline/engine";

const pack = phoneFixture();
test.use({ serviceWorkers: "block", screenshot: "only-on-failure" });

// Serve the built UI entirely through this fresh browser context. No request
// reaches the running daily application and no real learning state is opened.
async function openStudy(
  page: Page,
  options: {
    warning?: boolean;
    mode?: "practice";
    styles?: string;
    fixture?: typeof pack;
  } = {},
) {
  const root = resolve("dist");
  await page.route("**/*", async (route) => {
    let path = new URL(route.request().url()).pathname;
    if (path === "/phone/api")
      return route.fulfill({ json: { ok: false, error: "invalid_pack" } });
    if (path.startsWith("/phone/assets/")) path = path.slice("/phone".length);
    if (path === "/layout-fixture")
      return route.fulfill({
        contentType: "text/html",
        body: "<!doctype html>",
      });
    const file = resolve(
      root,
      `.${path === "/phone/" ? "/phone/index.html" : path}`,
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
  await page.addInitScript(
    (online) =>
      Object.defineProperty(navigator, "onLine", { get: () => online }),
    !!options.warning,
  );
  await page.goto("/layout-fixture");
  const state = phoneReduce(freshPhoneState("layout-fixture"), {
    action: "install_pack",
    pack: options.fixture ?? pack,
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
  if (options.styles) await page.addStyleTag({ content: options.styles });
  if (options.warning) {
    await page.getByRole("button", { name: "今すぐ同期", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(
      "問題の整合性を確認できません",
    );
  }
  await page
    .getByRole("button", {
      name: options.mode === "practice" ? "今すぐ学ぶ" : "今日の復習を始める",
      exact: options.mode === "practice",
    })
    .click();
  await expect(page.locator(".phone-app")).toHaveClass(/is-studying/);
}

async function actionVisible(page: Page, control: Locator) {
  await expect
    .poll(async () =>
      control.evaluate((e) => {
        const r = e.getBoundingClientRect();
        const app = document.querySelector(".phone-app")!;
        const bottom =
          innerHeight - parseFloat(getComputedStyle(app).paddingBottom);
        return r.y >= 0 && r.bottom <= bottom;
      }),
    )
    .toBe(true);
  expect(
    await control.evaluate((e) => {
      const r = e.getBoundingClientRect();
      return (
        document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === e
      );
    }),
  ).toBe(true);
}

for (const [width, height] of [
  [375, 667],
  [390, 734],
  [390, 844],
  [430, 932],
  [768, 1024],
  [820, 1180],
  [1024, 1366],
  [1180, 820],
  [1024, 768],
]) {
  test(`study fits ${width}x${height} without per-question scrolling`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height });
    await openStudy(page);
    const table = page.locator(".table");
    const hand = page.getByTestId("real-hand");
    for (let question = 1; question <= 3; question++) {
      await expect(
        page.getByText(`${question} / 5 問`, { exact: true }),
      ).toBeVisible();
      await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
      const original = await table.boundingBox();
      const handBefore = await hand.boundingBox();
      if (width >= 768 && width < height)
        expect(original!.width).toBeGreaterThan(550);
      expect(
        await hand.locator("button").evaluateAll((tiles) =>
          tiles.every((e) => {
            const r = e.getBoundingClientRect();
            return r.width >= 44 && r.height >= 44;
          }),
        ),
      ).toBe(true);
      await actionVisible(
        page,
        page.getByRole("button", { name: "回答する", exact: true }),
      );
      await hand.locator("button").first().click();
      await page.getByRole("button", { name: "回答する", exact: true }).click();
      await expect(page.getByTestId("study-comparison")).toBeVisible();
      for (const name of ["理解した", "再復習", "保留"])
        await actionVisible(
          page,
          page.getByRole("button", { name, exact: true }),
        );
      await expect
        .poll(async () =>
          Math.abs((await table.boundingBox())!.width - original!.width),
        )
        .toBeLessThanOrEqual(2);
      expect(
        Math.abs((await hand.boundingBox())!.height - handBefore!.height),
      ).toBeLessThanOrEqual(1);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      if (
        question === 1 &&
        process.env.KYOKULOOP_UI_PROOF &&
        info.project.name === "phone"
      ) {
        mkdirSync(process.env.KYOKULOOP_UI_PROOF, { recursive: true });
        await page.screenshot({
          path: join(
            process.env.KYOKULOOP_UI_PROOF,
            `study-${width}x${height}.png`,
          ),
          scale: "css",
        });
        writeFileSync(
          join(process.env.KYOKULOOP_UI_PROOF, `study-${width}x${height}.json`),
          JSON.stringify(
            {
              viewport: { width, height },
              table: await table.boundingBox(),
              hand: await hand.boundingBox(),
              actions: await page
                .locator(".ratings button")
                .evaluateAll((elements) =>
                  elements.map((e) => e.getBoundingClientRect().toJSON()),
                ),
              scroll: await page.evaluate(() => scrollY),
            },
            null,
            2,
          ),
        );
      }
      await page.getByRole("button", { name: "理解した", exact: true }).click();
    }
    await page
      .getByRole("button", { name: "直前の評価を取り消す", exact: true })
      .click();
    await expect(page.getByText("3 / 5 問", { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "回答を選び直す", exact: true })
      .click();
    await actionVisible(
      page,
      page.getByRole("button", { name: "回答する", exact: true }),
    );
    await page.getByRole("button", { name: "中断してホームへ" }).click();
    await expect(page.locator(".phone-app")).not.toHaveClass(/is-studying/);
  });
}

test("safe areas, practice, optional detail and rotation retain usable actions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openStudy(page, {
    mode: "practice",
    styles:
      ".phone-header { padding-top: 57px; } .phone-app.is-studying { padding-bottom: 34px; }",
  });
  await actionVisible(
    page,
    page.getByRole("button", { name: "回答する", exact: true }),
  );
  await page.getByTestId("real-hand").locator("button").last().click();
  await page.getByRole("button", { name: "回答する", exact: true }).click();
  const before = (await page.locator(".table").boundingBox())!.width;
  await page.locator(".comparison-weight summary").click();
  await expect(
    page.getByText("分布合計を100に換算", { exact: false }),
  ).toBeVisible();
  expect((await page.locator(".table").boundingBox())!.width).toBeCloseTo(
    before,
    0,
  );
  await page.getByRole("button", { name: "理解した", exact: true }).click();
  await expect(page.getByText("2 / 5 問", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await page.setViewportSize({ width: 1180, height: 820 });
  await expect
    .poll(() =>
      page
        .locator(".quiz-layout")
        .evaluate(
          (e) => getComputedStyle(e).gridTemplateColumns.split(" ").length,
        ),
    )
    .toBe(2);
  await actionVisible(
    page,
    page.getByRole("button", { name: "回答する", exact: true }),
  );
  await page.setViewportSize({ width: 820, height: 1180 });
  await expect
    .poll(() =>
      page
        .locator(".quiz-layout")
        .evaluate(
          (e) => getComputedStyle(e).gridTemplateColumns.split(" ").length,
        ),
    )
    .toBe(1);
  await expect
    .poll(async () => (await page.locator(".table").boundingBox())!.width)
    .toBeGreaterThan(550);
});

test("sync integrity warning remains accessible without taking over each question", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openStudy(page, { warning: true });
  const warning = page.locator(".phone-sync-notice");
  await expect(warning).toBeVisible();
  await expect(warning).toContainText("問題の整合性を確認できません");
  expect(await warning.evaluate((e) => (e as HTMLDetailsElement).open)).toBe(
    false,
  );
  await page.getByTestId("real-hand").locator("button").first().click();
  await page.getByRole("button", { name: "回答する", exact: true }).click();
  await actionVisible(
    page,
    page.getByRole("button", { name: "理解した", exact: true }),
  );
  await warning.locator("summary").click();
  await expect(
    page.getByRole("button", { name: "同期を再試行" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "同期を再試行" }).click();
  await expect(warning).toContainText("現在の保存内容は保持しています");
  await warning.locator("summary").click();
  await page.getByRole("button", { name: "理解した", exact: true }).click();
  await expect(page.getByText("2 / 5 問", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await actionVisible(
    page,
    page.getByRole("button", { name: "回答する", exact: true }),
  );
});

test("public melds and larger text stay reachable instead of being clipped", async ({
  page,
}) => {
  const fixture = structuredClone(pack);
  for (const item of fixture.items) {
    item.scene.melds[(item.scene.seat + 1) % 4] = [
      {
        type: "pon",
        consumed: ["7s", "7s"],
        tile: "7s",
        target: item.scene.seat,
      },
    ];
    fixture.histories[item.id].scene = structuredClone(item.scene);
  }
  await page.setViewportSize({ width: 820, height: 1180 });
  await openStudy(page, { fixture });
  await expect(
    page.getByLabel("公開された副露", { exact: true }),
  ).toBeVisible();
  await actionVisible(
    page,
    page.getByRole("button", { name: "回答する", exact: true }),
  );
  await page.setViewportSize({ width: 320, height: 568 });
  await page.addStyleTag({
    content: ".phone-app.is-studying .quiz-answer { font-size: 22px; }",
  });
  await page.getByTestId("real-hand").locator("button").last().click();
  expect(
    await page
      .getByTestId("real-hand")
      .locator("button")
      .evaluateAll((elements) =>
        elements.every((e) => {
          const r = e.getBoundingClientRect();
          return r.width >= 44 && r.height >= 44;
        }),
      ),
  ).toBe(true);
  await page.getByRole("button", { name: "回答する", exact: true }).click();
  await page.getByRole("button", { name: "理解した", exact: true }).click();
  await expect(page.getByText("2 / 5 問", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
