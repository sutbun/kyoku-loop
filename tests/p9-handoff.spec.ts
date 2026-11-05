import { expect } from "@playwright/test";
import { test } from "./static-app";

const source =
  "https://game.mahjongsoul.com/?paipu=260101-fictional-handoff_a123";

const destination =
  "https://mjai.ekyu.moe/ja.html?url=" + encodeURIComponent(source);

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
    if (input.action === "analysis_bulk") {
      if (options.saveFails)
        return route.fulfill({
          json: { ok: false, error: "storage_or_input_error" },
        });
      saved.push(source);
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
  await page.getByRole("button", { name: "牌譜", exact: true }).click();
  await page.getByText("URLを追加", { exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "雀魂共有URL", exact: true }),
  ).toBeEnabled();
  return { actions, saved };
}

test("normal browser popup receives the canonical prefilled URL without submitting analysis", async ({
  page,
  context,
}) => {
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
    .getByRole("textbox", { name: "雀魂共有URL", exact: true })
    .fill("雀魂牌譜:" + source);
  const popupPromise = context.waitForEvent("page");
  await page
    .locator(".phone-source-add")
    .getByRole("button", { name: "Mortalへ" })
    .click();
  const popup = await popupPromise;
  await expect(popup.getByRole("heading")).toHaveText("Mortal input fixture");
  await expect(page.getByRole("status")).toContainText("対象プレイヤーを確認");
  await page.bringToFront();
  expect(saved).toEqual([source]);
  expect(destinations).toEqual([destination]);
  expect(await popup.evaluate(() => window.opener)).toBeNull();
  await popup.close();
});

test("one action saves and prefills the URL; its fallback and saved row retain the same destination", async ({
  page,
}) => {
  const { actions, saved } = await prepare(page);
  await page
    .getByRole("textbox", { name: "雀魂共有URL", exact: true })
    .fill("雀魂牌譜:" + source);
  await page
    .locator(".phone-source-add")
    .getByRole("button", { name: "Mortalへ", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "雀魂共有URL", exact: true }),
  ).toHaveValue("");
  await expect(page.getByRole("status")).toContainText("対象プレイヤーを確認");
  await expect(
    page.getByRole("status").getByRole("link", { name: "Mortalを開く" }),
  ).toHaveAttribute("href", destination);
  expect(saved).toEqual([source]);
  const record = await page.evaluate(() => (window as any).__mortal);
  expect(record.copied).toEqual([]);
  expect(record.opened).toEqual([
    {
      url: destination,
      target: "_blank",
      features: "noopener,noreferrer",
      active: true,
    },
  ]);
  expect(actions.every((a) => ["state", "analysis_bulk"].includes(a))).toBe(
    true,
  );
  await expect(page.getByTestId("analysis-row")).toContainText("未解析");
  await page
    .getByTestId("analysis-row")
    .getByRole("button", { name: "Mortalへ", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        await page.evaluate(() => (window as any).__mortal.opened.length),
    )
    .toBe(2);
  expect(actions).not.toContain("analysis_requested");
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await page.getByText("このPCの管理", { exact: true }).click();
  await page.getByRole("button", { name: "解析の手順", exact: true }).click();
  await expect(page.getByRole("region", { name: "解析の手順" })).toContainText(
    "雀魂へのログイン・拡張は不要",
  );
  await expect(
    page.getByRole("region", { name: "解析の手順" }),
  ).not.toContainText("NAGA");
});

test("clipboard denial does not prevent prefilling or require manual paste", async ({
  page,
}) => {
  const { saved } = await prepare(page, { copyFails: true });
  await page
    .getByRole("textbox", { name: "雀魂共有URL", exact: true })
    .fill(source);
  await page
    .locator(".phone-source-add")
    .getByRole("button", { name: "Mortalへ" })
    .click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "雀魂共有URL", exact: true }),
  ).toHaveValue("");
  expect(
    await page.evaluate(() => (window as any).__mortal.opened[0].url),
  ).toBe(destination);
  expect(saved).toEqual([source]);
  await expect(page.getByRole("status")).not.toContainText("コピーしました");
});

test("save failure and invalid hosts do not clear the input or claim a saved/started analysis", async ({
  page,
}) => {
  const { saved } = await prepare(page, { saveFails: true });
  await page
    .getByRole("textbox", { name: "雀魂共有URL", exact: true })
    .fill("https://example.invalid/");
  await expect(
    page
      .locator(".phone-source-add")
      .getByRole("button", { name: "Mortalへ", exact: true }),
  ).toHaveCount(0);
  await page
    .locator(".phone-source-add")
    .getByRole("button", { name: "追加", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(await page.evaluate(() => (window as any).__mortal.opened)).toEqual(
    [],
  );
  await page
    .getByRole("textbox", { name: "雀魂共有URL", exact: true })
    .fill(source);
  await page
    .locator(".phone-source-add")
    .getByRole("button", { name: "Mortalへ" })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "雀魂共有URL", exact: true }),
  ).toHaveValue(source);
  await expect(page.getByRole("status")).toHaveCount(0);
  expect(saved).toEqual([]);
});

test("iPad entry saves locally and reopens a stored URL with no Windows receipt or clipboard", async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    (window as any).__opened = [];
    window.open = (url) => {
      (window as any).__opened.push({
        url,
        active: navigator.userActivation.isActive,
      });
      return null;
    };
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      get() {
        throw Error("clipboard unavailable");
      },
    });
  });
  // Windows is unavailable; the URL and Mortal handoff still work on this device.
  await context.route("**/phone/api", (route) =>
    route.fulfill({ status: 503, body: "" }),
  );
  await page.goto("/phone/");
  await page.getByRole("button", { name: "牌譜", exact: true }).click();
  await page.getByText("URLを追加", { exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "雀魂共有URL", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("textbox", { name: "雀魂共有URL", exact: true })
    .fill("雀魂牌譜:" + source);
  await page
    .locator(".phone-source-add")
    .getByRole("button", { name: "Mortalへ", exact: true })
    .click();
  const row = page.getByTestId("analysis-row");
  await expect(row).toContainText("この端末に保存済み・未同期");
  await expect(
    page.getByRole("textbox", { name: "雀魂共有URL", exact: true }),
  ).toHaveValue("");
  expect(await page.evaluate(() => (window as any).__opened)).toEqual([
    { url: destination, active: true },
  ]);
  await page.reload();
  await page.getByRole("button", { name: "牌譜", exact: true }).click();
  await expect(
    row.getByRole("button", { name: "Mortalへ", exact: true }),
  ).toBeEnabled();
  await row.getByRole("button", { name: "Mortalへ", exact: true }).click();
  expect(await page.evaluate(() => (window as any).__opened)).toEqual([
    { url: destination, active: true },
  ]);
});
