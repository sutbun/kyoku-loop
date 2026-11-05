import { expect } from "@playwright/test";
import { test } from "./static-app";
import { sourceURL, parseAnalysisBatch } from "../src/analysis-queue";
import { freshPhoneState, phoneReduce } from "../src/offline/engine";
import { join } from "node:path";

const url = "https://game.mahjongsoul.com/?paipu=260101-fictional-game_a123";

test("shared labels normalize to the same phone queue ID and retain strict validation", () => {
  let state = freshPhoneState("fictional-share-label");
  for (const text of [
    url,
    `雀魂牌譜:${url}`,
    ` 雀魂牌譜：  ${url} \n`,
    `雀魂牌譜:${url.replace("https:", "https\\:")}`,
  ]) {
    expect(sourceURL(text)).toBe(url);
    state = phoneReduce(state, { action: "analysis_add", url: text }).state;
    expect(state.analysis_queue).toHaveLength(1);
    expect(state.analysis_queue![0].url).toBe(url);
    expect(state.analysis_queue![0].id).toBe(url.split("paipu=")[1]);
  }
  for (const text of [
    `メモ ${url}`,
    `雀魂牌譜:${url} ${url}`,
    `雀魂牌譜:${url}&x=1`,
    `雀魂牌譜:${url}#x`,
    `雀魂牌譜:${url.replace("game.", "game.evil.")}`,
    `雀魂牌譜:${url.replace("https:", "http:")}`,
    `雀魂牌譜:雀魂牌譜:${url}`,
  ])
    expect(() => sourceURL(text)).toThrow("invalid_source_url");
});

test("pasting a shared label into the URL form submits the canonical URL", async ({
  page,
}) => {
  const saved: string[] = [];
  await page.route("**/api/local", (route) => {
    const body = route.request().postDataJSON();
    if (body.action === "analysis_bulk")
      saved.push(...parseAnalysisBatch(body.data).map((e) => e.url));
    return route.fulfill({
      json: { ok: true, data: { reports: [], items: [], analysis_queue: [] } },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "牌譜", exact: true }).click();
  await page.getByText("URLを追加", { exact: true }).click();
  const field = page.getByRole("textbox", { name: "雀魂共有URL", exact: true });
  await expect(field).toBeEnabled();
  for (const text of [
    `雀魂牌譜:${url}`,
    `雀魂牌譜:${url.replace("https:", "https\\:")}`,
  ]) {
    await field.fill(text);
    await expect(field).toHaveValue(text);
    expect(
      await field.evaluate((e) => (e as HTMLInputElement).validity.valid),
    ).toBe(true);
    if (process.env.KYOKULOOP_UI_PROOF && saved.length === 0)
      await page.locator(".phone-source-add").screenshot({
        path: join(
          process.env.KYOKULOOP_UI_PROOF,
          `share-input-${test.info().project.name}.png`,
        ),
        scale: "css",
      });
    await page.getByRole("button", { name: "追加", exact: true }).click();
    await expect(field).toHaveValue("");
  }
  expect(saved).toEqual([url, url]);
});
