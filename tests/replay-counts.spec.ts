import { expect, type Page } from "@playwright/test";
import { test } from "./static-app";
import type { AnalysisEntry } from "../src/analysis-queue";
import type { Workspace } from "../src/real-types";

test.use({ serviceWorkers: "block" });

const entry = (n: number): AnalysisEntry => ({
  id: `260101-fictional-count-${n}`,
  url: `https://game.mahjongsoul.com/?paipu=260101-fictional-count-${n}`,
  created: "2026-01-01T00:00:00Z",
});
const fixture = (): AnalysisEntry[] => [
  ...Array.from({ length: 12 }, (_, i) => ({
    ...entry(i + 1),
    requested: i === 0,
  })),
  { ...entry(13), reports: ["fictional-a", "fictional-b"], ready: true },
  { ...entry(14), reports: ["fictional-c"], ready: false },
  { ...entry(15), reports: ["fictional-d"], ready: true },
  { ...entry(16), visibility: { revision: 1, deleted: true } },
  {
    ...entry(17),
    reports: ["fictional-retained"],
    ready: true,
    visibility: { revision: 1, deleted: true },
  },
];
async function open(page: Page, entries = fixture()) {
  const workspace: Workspace = {
    reports: [],
    items: [],
    analysis_queue: entries,
  };
  const deletions: string[][] = [];
  await page.route("**/api/local", async (route) => {
    const body = route.request().postDataJSON();
    if (body.action === "analysis_delete") {
      deletions.push(body.ids);
      workspace.analysis_queue = workspace.analysis_queue!.filter(
        (e) => !body.ids.includes(e.id),
      );
      return route.fulfill({
        json: { ok: true, data: { deleted: body.ids.length } },
      });
    }
    expect(body.action).toBe("state");
    return route.fulfill({ json: { ok: true, data: workspace } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "牌譜", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /^保存牌譜/, exact: false }),
  ).toBeVisible();
  return { workspace, deletions };
}
const filters = (page: Page) =>
  page.getByRole("group", { name: "牌譜の状態", exact: true });

test("Windows counts all saved games, includes no-question results and counts multiple models once", async ({
  page,
}, info) => {
  await open(page);
  const group = filters(page);
  await expect(
    group.getByRole("button", { name: "すべて 15件", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    group.getByRole("button", { name: "未解析 12件", exact: true }),
  ).toBeVisible();
  await expect(
    group.getByRole("button", { name: "解析済み 3件", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("analysis-row")).toHaveCount(10);
  await page
    .getByRole("button", { name: "さらに10件表示（残り5件）", exact: true })
    .click();
  await expect(page.getByTestId("analysis-row")).toHaveCount(15);
  await group
    .getByRole("button", { name: "解析済み 3件", exact: true })
    .click();
  await expect(page.getByTestId("analysis-row")).toHaveCount(3);
  await expect(
    page.getByTestId("analysis-row").filter({ hasText: "解析済み・問題なし" }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("checkbox", { name: "保存牌譜 14を選択", exact: true }),
  ).toBeVisible();
  await group.getByRole("button", { name: "未解析 12件", exact: true }).click();
  await expect(page.getByTestId("analysis-row")).toHaveCount(10);
  await page
    .getByRole("button", { name: "さらに10件表示（残り2件）", exact: true })
    .click();
  await expect(page.getByTestId("analysis-row")).toHaveCount(12);
  await expect(
    page
      .getByTestId("analysis-row")
      .filter({ hasText: "解析依頼操作中（本人申告）" }),
  ).toHaveCount(1);
  await group.getByRole("button", { name: "すべて 15件", exact: true }).click();
  await expect(page.getByTestId("analysis-row")).toHaveCount(10);
  await page.screenshot({
    path: info.outputPath("windows-replay-counts.png"),
    fullPage: true,
  });
});

test("filter changes clear hidden selection and select-all includes every matching page only", async ({
  page,
}) => {
  const { workspace, deletions } = await open(page);
  const original = structuredClone(workspace);
  await filters(page)
    .getByRole("button", { name: "解析済み 3件", exact: true })
    .click();
  await page.getByRole("checkbox", { name: "全選択", exact: true }).check();
  await expect(
    page.getByRole("button", { name: "選択した3件を削除", exact: true }),
  ).toBeEnabled();
  await filters(page)
    .getByRole("button", { name: "未解析 12件", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "選択した0件を削除", exact: true }),
  ).toBeDisabled();
  await page.getByRole("checkbox", { name: "全選択", exact: true }).check();
  await expect(page.getByTestId("analysis-row")).toHaveCount(10);
  page.once("dialog", (dialog) => dialog.dismiss());
  await page
    .getByRole("button", { name: "選択した12件を削除", exact: true })
    .click();
  expect(deletions).toEqual([]);
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "選択した12件を削除", exact: true })
    .click();
  await expect(
    filters(page).getByRole("button", { name: "未解析 0件", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    filters(page).getByRole("button", { name: "すべて 3件", exact: true }),
  ).toBeVisible();
  await expect(
    filters(page).getByRole("button", { name: "解析済み 3件", exact: true }),
  ).toBeVisible();
  expect(deletions).toEqual([
    Array.from({ length: 12 }, (_, i) => entry(12 - i).id),
  ]);
  expect(workspace.reports).toEqual(original.reports);
  expect(workspace.items).toEqual(original.items);
  await expect(page.getByTestId("analysis-row")).toHaveCount(0);
  await expect(
    page.getByText("該当する牌譜はありません。", { exact: true }),
  ).toBeVisible();
});

test("a completed registration updates counts and the active filter without clearing URL input", async ({
  page,
}) => {
  const { workspace } = await open(page);
  await filters(page)
    .getByRole("button", { name: "未解析 12件", exact: true })
    .click();
  await page.getByText("URLを追加", { exact: true }).click();
  const input = page.getByRole("textbox", { name: "雀魂共有URL", exact: true });
  await input.fill(entry(99).url);
  workspace.analysis_queue![0] = {
    ...workspace.analysis_queue![0],
    reports: ["fictional-new"],
    ready: false,
  };
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    filters(page).getByRole("button", { name: "未解析 11件", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    filters(page).getByRole("button", { name: "解析済み 4件", exact: true }),
  ).toBeVisible();
  await expect(input).toHaveValue(entry(99).url);
});

test("zero counts remain available and a narrow filter row wraps whole buttons", async ({
  page,
}, info) => {
  await open(page, []);
  const group = filters(page);
  for (const name of ["すべて 0件", "未解析 0件", "解析済み 0件"])
    await expect(
      group.getByRole("button", { name, exact: true }),
    ).toBeVisible();
  await expect(
    page.getByText("保存した牌譜はありません。", { exact: true }),
  ).toBeVisible();
  await group.evaluate((el) => {
    el.style.width = "200px";
  });
  const boxes = await group.getByRole("button").evaluateAll((buttons) =>
    buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        height: rect.height,
        whiteSpace: getComputedStyle(button).whiteSpace,
      };
    }),
  );
  expect(boxes[2].top).toBeGreaterThan(boxes[0].top);
  expect(
    boxes.every(
      (box) => box.right - boxes[0].left <= 200 && box.whiteSpace === "nowrap",
    ),
  ).toBe(true);
  await group.screenshot({
    path: info.outputPath("replay-filters-wrapped.png"),
  });
});
