import { expect } from "@playwright/test";
import { test } from "./static-app";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve, sep } from "node:path";
import { DEVELOPMENT_VERSION } from "../src/version";

test.use({ serviceWorkers: "block" });

const code = readFileSync("public/history-collector.js", "utf8").replaceAll(
  "__KYOKULOOP_VERSION__",
  DEVELOPMENT_VERSION,
);
const bookmarklet = "javascript:" + encodeURIComponent(code.trim());
const actor = 1358437 + ((7 * 123456 + 1117113) ^ 86216345);
const url = `https://game.mahjongsoul.com/?paipu=260101-fictional-bulk_a${actor}`;
const second = url.replace("fictional-bulk", "fictional-second");
function row(source: string, mode = "玉") {
  return `<div role="row"><div role="gridcell">${mode}</div><div role="gridcell">一</div><div role="gridcell">${["架空A", "架空B", "架空C", "架空D"].map((name, i) => `<a title="牌譜を見る" href="#">[架空] ${name} [${[25000, 30000, 30000, 15000][i]}]</a>`).join("")}<a title="AI レビュー" href="https://mjai.ekyu.moe/ja.html?url=${encodeURIComponent(source)}">AI レビュー</a></div><div role="gridcell">2026/1/1 12:30</div></div>`;
}
async function collectorPage(
  page: import("@playwright/test").Page,
  copyFails = false,
) {
  const requests: string[] = [];
  await page.route("**/*", (route) => {
    requests.push(route.request().url());
    return route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: "<html><body>" + row(url) + "</body></html>",
    });
  });
  await page.addInitScript((fails) => {
    (window as any).__copies = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          if (fails) throw new Error("denied");
          (window as any).__copies.push(text);
        },
      },
    });
  }, copyFails);
  await page.goto("https://amae-koromo.sapk.ch/player/123456/12");
  await page.evaluate((value) => {
    const a = document.createElement("a");
    a.href = value;
    a.textContent = "取得を起動";
    document.body.append(a);
  }, bookmarklet);
  await page.getByRole("link", { name: "取得を起動", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "KyokuLoop 一括取得" }),
  ).toBeVisible();
  return requests;
}

test("bookmarklet accumulates rendered rows, deduplicates and copies metadata without any extra request", async ({
  page,
}) => {
  const requests = await collectorPage(page);
  const initial = requests.length;
  await page.evaluate(
    (html) => document.body.insertAdjacentHTML("beforeend", html),
    row(second) + row(url),
  );
  await expect(page.locator("#kyokuloop-history-collector")).toContainText(
    "2件",
  );
  await page
    .getByRole("button", { name: "KyokuLoopへコピー", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("2件をコピー");
  const data = JSON.parse(
    await page.evaluate(() => (window as any).__copies[0]),
  );
  expect(data.entries.map((e: any) => e.url)).toEqual([url, second]);
  expect(data.entries[0]).toMatchObject({
    at: "2026-01-01T12:30:00+09:00",
    mode: 12,
    seat: 1,
  });
  expect(data.entries[0].players[2].name).toBe("架空C");
  await page.getByRole("button", { name: "URLだけコピー" }).click();
  expect(await page.evaluate(() => (window as any).__copies[1])).toBe(
    url + "\n" + second,
  );
  expect(requests.length).toBe(initial);
  await page.getByRole("button", { name: "取得を終了" }).click();
  await expect(page.locator("#kyokuloop-history-collector")).toHaveCount(0);
});

test("clipboard denial keeps an explicitly selectable copy field and a page change stops collection", async ({
  page,
}) => {
  await collectorPage(page, true);
  await page.getByRole("button", { name: "KyokuLoopへコピー" }).click();
  await expect(page.getByLabel("コピー用データ")).toHaveValue(
    /kyokuloop-history/,
  );
  await page.evaluate((html) => {
    history.pushState({}, "", "/player/999999/12");
    document.body.insertAdjacentHTML("beforeend", html);
  }, row(second));
  await expect(page.getByRole("status")).toContainText("ページが変わった");
  await expect(page.locator("#kyokuloop-history-collector")).toContainText(
    "1件",
  );
});

test("bulk UI stores a complete batch, shows metadata and opens only the public prefill URL", async ({
  page,
  context,
}) => {
  const folder = mkdtempSync("D:/dev-data/kyoku-loop/private/bulk-ui-");
  try {
    await page.route("**/api/local", (route) => {
      const result = execFileSync("python", ["tools/p2_store.py"], {
        input: route.request().postData()!,
        encoding: "utf8",
        windowsHide: true,
        env: { ...process.env, KYOKULOOP_DB: join(folder, "fixture.sqlite3") },
      });
      return route.fulfill({ contentType: "application/json", body: result });
    });
    await context.route("https://mjai.ekyu.moe/**", (route) =>
      route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: "<h1>入力済み画面の架空ページ</h1>",
      }),
    );
    await page.goto("/");
    await page.getByText("牌譜屋から一括追加", { exact: true }).click();
    await expect(
      page.getByRole("link", { name: "牌譜URLを一括取得" }),
    ).toHaveAttribute("href", bookmarklet);
    const payload = JSON.stringify({
      kind: "kyokuloop-history",
      version: 1,
      player: 123456,
      entries: [
        {
          url,
          at: "2026-01-01T12:30:00+09:00",
          mode: 12,
          seat: 1,
          players: ["架空A", "架空B", "架空C", "架空D"].map((name, i) => ({
            name,
            score: [25000, 30000, 30000, 15000][i],
          })),
        },
        { url: second },
      ],
    });
    await page.getByLabel("一括データ", { exact: true }).fill(payload);
    await page.getByRole("button", { name: "まとめて追加" }).click();
    await expect(page.getByRole("status")).toContainText("2件追加");
    await expect(page.getByTestId("analysis-row")).toHaveCount(2);
    await expect(page.getByTestId("analysis-row").first()).toContainText(
      "保存牌譜 2",
    );
    await page
      .getByRole("combobox", { name: "牌譜の並び順", exact: true })
      .selectOption("played");
    await expect(page.getByTestId("analysis-row").first()).toContainText("1位");
    await expect(page.getByTestId("analysis-row").first()).toContainText(
      "架空A / 架空C / 架空D",
    );
    await page.getByLabel("一括データ", { exact: true }).fill(payload);
    await page.getByRole("button", { name: "まとめて追加" }).click();
    await expect(page.getByRole("status")).toContainText("0件追加 · 重複2件");
    await page.screenshot({
      path: test.info().outputPath("fixture-history.png"),
      fullPage: true,
    });
    const popupPromise = context.waitForEvent("page");
    await page
      .getByTestId("analysis-row")
      .first()
      .getByRole("button", { name: "Mortalへ", exact: true })
      .click();
    const popup = await popupPromise;
    await expect(popup.getByRole("heading")).toHaveText(
      "入力済み画面の架空ページ",
    );
    expect(popup.url()).toBe(
      "https://mjai.ekyu.moe/ja.html?url=" + encodeURIComponent(url),
    );
    expect(await popup.evaluate(() => window.opener)).toBeNull();
    await popup.close();
    await page.reload();
    await expect(
      page.getByRole("combobox", { name: "牌譜の並び順", exact: true }),
    ).toHaveValue("added");
    await expect(page.getByTestId("analysis-row")).toHaveCount(2);
    await expect(page.getByTestId("analysis-row").first()).toContainText(
      "保存済み・未解析",
    );
  } finally {
    if (
      !resolve(folder).startsWith(
        resolve("D:/dev-data/kyoku-loop/private") + sep,
      )
    )
      throw new Error("Unexpected fixture path");
    rmSync(folder, { recursive: true, force: true });
  }
});
