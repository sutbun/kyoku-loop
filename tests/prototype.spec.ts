import { DEVELOPMENT_VERSION } from "../src/version";
import { test, expect } from "@playwright/test";
import {
  decisions,
  frames,
  handFor,
  initialState,
  isDemoState,
  newSession,
} from "../src/demo";

test("study queue excludes paused and graduated items, and detects broken demo state", () => {
  const state = initialState();
  expect(isDemoState(state)).toBe(true);
  expect(newSession(state.items).ids).toHaveLength(5);
  for (const id of newSession(state.items).ids)
    expect(["保留", "習得済み"]).not.toContain(
      state.items.find((i) => i.id === id)!.status,
    );
  expect(isDemoState({ ...state, reviewIndex: -1 })).toBe(false);
  expect(
    isDemoState({
      ...state,
      session: { ...newSession(state.items), index: 999 },
    }),
  ).toBe(false);
});

test("manual saving registers one library item, and cancellation removes that registration", async ({
  page,
}) => {
  await page.goto("/?demo=1");
  await page.getByRole("button", { name: "新しい牌譜を確認" }).click();
  await page.getByRole("button", { name: "学習に保存", exact: true }).click();
  await page.getByRole("button", { name: "学習", exact: true }).click();
  await page.getByRole("button", { name: "すべて", exact: true }).click();
  await expect(page.getByTestId("library-row")).toHaveCount(8);
  await page.getByRole("button", { name: "牌譜・分析", exact: true }).click();
  await page.getByRole("button", { name: "保存を取り消す" }).click();
  await page.getByRole("button", { name: "学習", exact: true }).click();
  await expect(page.getByTestId("library-row")).toHaveCount(7);
});

test("malformed fictional local storage starts safely with a fresh prototype", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "kyokuloop-fictional-prototype-v2",
      JSON.stringify({
        version: 1,
        data: { screen: "review", reviewIndex: 999, items: [] },
      }),
    ),
  );
  await page.goto("/?demo=1");
  await expect(
    page.getByRole("button", { name: "今日の復習を始める" }),
  ).toBeVisible();
});

test("fictional scene projections keep tile counts and draw/discard continuity", () => {
  expect(decisions).toHaveLength(5);
  for (let n = 0; n < frames.length; n++) {
    const frame = frames[n];
    expect(frame.hand).toHaveLength(13);
    const visible = [...handFor(frame), ...frame.rivers.flat(), frame.dora];
    for (const tile of new Set(visible.map((t) => t.replace("0", "5")))) {
      expect(
        visible.filter((t) => t.replace("0", "5") === tile).length,
      ).toBeLessThanOrEqual(4);
    }
    if (frame.actor === 2) expect(handFor(frame)).toContain(frame.actual);
    const next = frames[n + 1];
    if (next?.round === frame.round) {
      expect(next.rivers[frame.actor]).toEqual([
        ...frame.rivers[frame.actor],
        frame.actual,
      ]);
    }
  }
});

test("review opens at top priority, traverses important and all events, saves with undo", async ({
  page,
}) => {
  await page.goto("/?demo=1");
  await page.getByRole("button", { name: "新しい牌譜を確認" }).click();
  await expect(
    page.getByRole("heading", { name: "重要局面 1 / 5" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "次の重要局面" }).click();
  await expect(
    page.getByRole("heading", { name: "重要局面 2 / 5" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "前の重要局面" }).click();
  await page.getByRole("button", { name: "学習に保存", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "保存を取り消す" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "保存を取り消す" }).click();
  await expect(
    page.getByRole("button", { name: "学習に保存", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "全手順", exact: true }).click();
  const before = await page.getByTestId("event-position").textContent();
  await page.getByRole("button", { name: "次の手順" }).click();
  await expect(page.getByTestId("event-position")).not.toHaveText(before!);
  await expect(page.locator("[data-hidden-hand]")).toHaveCount(0);
});

test("five question flow conceals answers, supports corrections, self rating and completion", async ({
  page,
}) => {
  await page.goto("/?demo=1");
  await page.screenshot({
    path: `test-results/home-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "今日の復習を始める" }).click();
  for (let i = 1; i <= 5; i++) {
    await expect(page.getByText(`${i} / 5 問`, { exact: true })).toBeVisible();
    await expect(page.getByTestId("comparison")).toHaveCount(0);
    await expect(page.getByText("対局時の打牌", { exact: true })).toHaveCount(
      0,
    );
    if (i === 1)
      await page.screenshot({
        path: `test-results/quiz-${test.info().project.name}.png`,
        fullPage: true,
      });
    await expect(
      page.getByRole("button", { name: "回答する", exact: true }),
    ).toBeDisabled();
    await page.getByTestId("hand").getByRole("button").first().click();
    await page.getByRole("button", { name: "選択を取り消す" }).click();
    await expect(
      page.getByRole("button", { name: "回答する", exact: true }),
    ).toBeDisabled();
    await page.getByTestId("hand").getByRole("button").last().click();
    await page.getByRole("button", { name: "回答する", exact: true }).click();
    await expect(page.getByTestId("comparison")).toContainText("今回の回答");
    await expect(page.getByTestId("comparison")).toContainText("対局時の打牌");
    await expect(page.getByTestId("comparison")).toContainText("NAGA推奨");
    if (i === 1) {
      await page.getByRole("button", { name: "回答を選び直す" }).click();
      await expect(page.getByTestId("comparison")).toHaveCount(0);
      await page.getByRole("button", { name: "回答する", exact: true }).click();
    }
    await page.getByRole("button", { name: "理解した", exact: true }).click();
  }
  await expect(
    page.getByRole("heading", { name: "5問、おつかれさまでした。" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "直前の評価を取り消す" }).click();
  await expect(page.getByText("5 / 5 問", { exact: true })).toBeVisible();
  await expect(page.getByTestId("comparison")).toBeVisible();
});

test("interruption and reload retain demo progress without revealing the next answer", async ({
  page,
}) => {
  await page.goto("/?demo=1");
  await page.getByRole("button", { name: "今日の復習を始める" }).click();
  await page.getByTestId("hand").getByRole("button").first().click();
  await page.getByRole("button", { name: "回答する", exact: true }).click();
  await page.getByRole("button", { name: "再復習", exact: true }).click();
  await page.reload();
  await expect(page.getByText("2 / 5 問", { exact: true })).toBeVisible();
  await expect(page.getByTestId("comparison")).toHaveCount(0);
  await page.getByRole("button", { name: "中断してホームへ" }).click();
  await page.getByRole("button", { name: "復習を再開する" }).click();
  await expect(page.getByText("2 / 5 問", { exact: true })).toBeVisible();
});

test("library has four states, details, pause/resume and undo", async ({
  page,
}) => {
  await page.goto("/?demo=1");
  await page.getByRole("button", { name: "学習", exact: true }).click();
  for (const state of ["未学習", "復習中", "習得済み", "保留"]) {
    await page.getByRole("button", { name: state, exact: true }).click();
    await expect(page.getByTestId("library-row").first()).toContainText(state);
  }
  await page
    .getByTestId("library-row")
    .first()
    .getByRole("button", { name: "再開", exact: true })
    .click();
  await page.getByRole("button", { name: "変更を取り消す" }).click();
  await expect(page.getByTestId("library-row").first()).toContainText("保留");
  await page
    .getByTestId("library-row")
    .first()
    .getByRole("button", { name: "局面と履歴" })
    .click();
  await expect(page.getByRole("dialog")).toContainText("回答履歴");
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
});

test("no external data calls, layout fits viewport and shows build and stub boundary", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith("http://127.0.0.1:1460")) requests.push(r.url());
  });
  await page.goto("/?demo=1");
  await expect(
    page.getByText(DEVELOPMENT_VERSION, { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "牌譜を追加", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("利用条件を確認中");
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  await page.getByRole("button", { name: "新しい牌譜を確認" }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: `test-results/review-${test.info().project.name}.png`,
    fullPage: true,
  });
  expect(requests).toEqual([]);
});

test("local save failure stays visible and never claims saved or synced", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("test quota", "QuotaExceededError");
    };
  });
  await page.goto("/?demo=1");
  await expect(page.getByRole("alert")).toContainText("保存できません");
  await page.getByRole("button", { name: "今日の復習を始める" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "画面を閉じると失われます",
  );
});
