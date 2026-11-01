import { expect, test } from "@playwright/test";

const source =
  "https://game.mahjongsoul.com/?paipu=260101-fictional-handoff_a123";

async function prepare(
  page: import("@playwright/test").Page,
  options: { copyFails?: boolean; saveFails?: boolean; native?: boolean } = {},
) {
  const actions: string[] = [],
    saved: string[] = [];
  await page.addInitScript(
    ({ copyFails, native }) => {
      if (native) return;
      const state = { copied: [] as string[], opened: [] as unknown[] };
      (window as any).__mortal = state;
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: (text: string) => {
            state.copied.push(text);
            return copyFails
              ? Promise.reject(new Error("denied"))
              : Promise.resolve();
          },
        },
      });
      window.open = (url, target, features) => {
        state.opened.push({
          url,
          target,
          features,
          active: navigator.userActivation.isActive,
        });
        return null;
      };
    },
    { copyFails: !!options.copyFails, native: !!options.native },
  );
  await page.route("**/api/local", (route) => {
    const input = route.request().postDataJSON();
    actions.push(input.action);
    if (input.action === "analysis_add") {
      if (options.saveFails)
        return route.fulfill({
          json: { ok: false, error: "storage_or_input_error" },
        });
      saved.push(input.url);
    }
    return route.fulfill({
      json: {
        ok: true,
        data: {
          reports: [],
          items: [],
          analysis_queue: saved.map((url) => ({
            id: url.split("paipu=")[1],
            url,
            created: "2026-01-01T00:00:00Z",
            requested: false,
            reports: [],
          })),
        },
      },
    });
  });
  await page.goto("/");
  await expect(page.getByLabel("雀魂共有URL", { exact: true })).toBeEnabled();
  return { actions, saved };
}

test("real clipboard and browser popup deliver a canonical URL without sending it to the destination", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const destinations: string[] = [];
  await context.route("https://mjai.ekyu.moe/**", (route) => {
    destinations.push(route.request().url());
    return route.fulfill({
      contentType: "text/html",
      body: "<title>Mortal input fixture</title><h1>Mortal input fixture</h1>",
    });
  });
  const { saved } = await prepare(page, { native: true });
  await page
    .getByLabel("雀魂共有URL", { exact: true })
    .fill("雀魂牌譜:" + source);
  const popupPromise = context.waitForEvent("page");
  await page
    .locator(".source-input")
    .getByRole("button", { name: "コピーしてMortalへ" })
    .click();
  const popup = await popupPromise;
  await expect(popup.getByRole("heading")).toHaveText("Mortal input fixture");
  await expect(page.getByRole("status")).toContainText("コピーしました");
  await page.bringToFront();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    source,
  );
  expect(saved).toEqual([source]);
  expect(destinations).toEqual(["https://mjai.ekyu.moe/ja.html"]);
  expect(await popup.evaluate(() => window.opener)).toBeNull();
  await popup.close();
});

test("one action saves the labelled URL, copies it and opens the normal Japanese Mortal page without submitting analysis", async ({
  page,
}) => {
  const { actions, saved } = await prepare(page);
  await page
    .getByLabel("雀魂共有URL", { exact: true })
    .fill("雀魂牌譜:" + source);
  await page
    .locator(".source-input")
    .getByRole("button", { name: "コピーしてMortalへ", exact: true })
    .click();
  await expect(page.getByLabel("雀魂共有URL", { exact: true })).toHaveValue("");
  await expect(page.getByRole("status")).toContainText("貼り付けて「送信」");
  await expect(
    page.getByRole("status").getByRole("link", { name: "Mortalを開く" }),
  ).toHaveAttribute("href", "https://mjai.ekyu.moe/ja.html");
  expect(saved).toEqual([source]);
  const record = await page.evaluate(() => (window as any).__mortal);
  expect(record.copied).toEqual([source]);
  expect(record.opened).toEqual([
    {
      url: "https://mjai.ekyu.moe/ja.html",
      target: "_blank",
      features: "noopener,noreferrer",
      active: true,
    },
  ]);
  expect(actions.every((a) => ["state", "analysis_add"].includes(a))).toBe(
    true,
  );
  await expect(page.getByTestId("analysis-row")).toContainText(
    "保存済み・未解析",
  );
  await page
    .getByTestId("analysis-row")
    .getByRole("button", { name: "コピーしてMortalへ" })
    .click();
  await expect
    .poll(
      async () =>
        await page.evaluate(() => (window as any).__mortal.opened.length),
    )
    .toBe(2);
  expect(actions).not.toContain("analysis_requested");
  await page.getByRole("button", { name: "解析の手順", exact: true }).click();
  await expect(page.getByRole("region", { name: "解析の手順" })).toContainText(
    "雀魂へのログイン・拡張は不要",
  );
  await expect(
    page.getByRole("region", { name: "解析の手順" }),
  ).not.toContainText("NAGA");
});

test("clipboard denial preserves the URL for manual copy and saved state without a false copy success", async ({
  page,
}) => {
  const { saved } = await prepare(page, { copyFails: true });
  await page.getByLabel("雀魂共有URL", { exact: true }).fill(source);
  await page
    .locator(".source-input")
    .getByRole("button", { name: "コピーしてMortalへ" })
    .click();
  await expect(page.getByRole("alert")).toContainText("コピーできませんでした");
  await expect(page.getByLabel("雀魂共有URL", { exact: true })).toHaveValue(
    source,
  );
  expect(saved).toEqual([source]);
  await expect(page.getByRole("status")).not.toContainText("コピーしました");
});

test("save failure and invalid hosts do not clear the input or claim a saved/started analysis", async ({
  page,
}) => {
  const { saved } = await prepare(page, { saveFails: true });
  await page
    .getByLabel("雀魂共有URL", { exact: true })
    .fill("https://example.invalid/");
  await page
    .locator(".source-input")
    .getByRole("button", { name: "コピーしてMortalへ" })
    .click();
  await expect(page.getByRole("alert")).toContainText("共有URLを確認");
  expect(await page.evaluate(() => (window as any).__mortal.opened)).toEqual(
    [],
  );
  await page.getByLabel("雀魂共有URL", { exact: true }).fill(source);
  await page
    .locator(".source-input")
    .getByRole("button", { name: "コピーしてMortalへ" })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("雀魂共有URL", { exact: true })).toHaveValue(
    source,
  );
  await expect(page.getByRole("status")).toHaveCount(0);
  expect(saved).toEqual([]);
});
