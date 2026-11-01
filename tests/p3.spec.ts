import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { test, expect } from "@playwright/test";

const privateRoot = resolve("D:/dev-data/kyoku-loop/private");
let folder: string;
let env: NodeJS.ProcessEnv;
const request = (value: object) =>
  JSON.parse(
    execFileSync("python", ["tools/p2_store.py"], {
      encoding: "utf8",
      input: JSON.stringify(value),
      env,
      windowsHide: true,
      timeout: 60000,
    }),
  );
test.beforeEach(async ({ page }) => {
  test.setTimeout(150000);
  folder = mkdtempSync(join(privateRoot, "p3-browser-"));
  env = { ...process.env, KYOKULOOP_DB: join(folder, "test.sqlite3") };
  execFileSync(
    "python",
    [
      "-c",
      `
import sys,json,os
sys.path.insert(0,'tests')
from test_p3_study import five_fixture
from tools.p2_store import Store
s=Store(os.environ['KYOKULOOP_DB'])
try:
 stage=s.stage(json.dumps(five_fixture()).encode(),None)
 r=s.commit(stage['token'],0,0,None)
 for scene in s.detail(r['id'])['decisions'][3:]: s.save(r['id'],scene['id'],True)
 s.db.execute('UPDATE study_items SET due=?',(s.today(),));s.db.commit()
finally: s.close()
`,
    ],
    { env, windowsHide: true, timeout: 60000 },
  );
  await page.route("**/api/local", async (route) => {
    await route.fulfill({ json: request(route.request().postDataJSON()) });
  });
});
test.afterEach(() => {
  if (
    dirname(resolve(folder)) !== privateRoot ||
    !basename(folder).startsWith("p3-browser-")
  )
    throw new Error("unexpected test directory");
  rmSync(folder, { recursive: true, force: true });
});

test("real study five-question flow, durable answer concealment, undo and library history", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "今日の復習を始める" }).click();
  for (let n = 1; n <= 5; n++) {
    await expect(page.getByText(`${n} / 5 問`, { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    await expect(page.getByTestId("study-comparison")).toHaveCount(0);
    const current = request({ action: "study_current" }).data;
    expect(current.scene).not.toHaveProperty("actual");
    expect(current.scene).not.toHaveProperty("raw_weights");
    await page.getByTestId("real-hand").getByRole("button").last().click();
    await expect(
      page.getByRole("button", { name: "回答する", exact: true }),
    ).toBeEnabled();
    if (n === 1) {
      await page.reload();
      await expect(page.getByText("1 / 5 問", { exact: true })).toBeVisible();
      await expect(
        page.getByRole("button", { name: "回答する", exact: true }),
      ).toBeEnabled();
      await page.getByRole("button", { name: "選択を取り消す" }).click();
      await expect(
        page.getByRole("button", { name: "回答する", exact: true }),
      ).toBeDisabled();
      await page.getByTestId("real-hand").getByRole("button").first().click();
    }
    await page.getByRole("button", { name: "回答する", exact: true }).click();
    await expect(page.getByTestId("study-comparison")).toContainText(
      "今回の回答",
    );
    await expect(page.getByTestId("study-comparison")).toContainText(
      "対局時の打牌",
    );
    if (n === 1) {
      await page.getByRole("button", { name: "回答を選び直す" }).click();
      await expect(page.getByTestId("study-comparison")).toHaveCount(0);
      await page.getByRole("button", { name: "回答する", exact: true }).click();
    }
    await page
      .getByRole("button", {
        name: n === 2 ? "再復習" : n === 3 ? "保留" : "理解した",
        exact: true,
      })
      .click();
  }
  await expect(
    page.getByRole("heading", { name: "5問、おつかれさまでした。" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "直前の評価を取り消す" }).click();
  await expect(page.getByText("5 / 5 問", { exact: true })).toBeVisible();
  await expect(page.getByTestId("study-comparison")).toBeVisible();
  await page.getByRole("button", { name: "理解した", exact: true }).click();
  await page.getByRole("button", { name: "ライブラリへ", exact: true }).click();
  await expect(page.getByTestId("real-library-row")).toHaveCount(5);
  await page
    .getByTestId("real-library-row")
    .first()
    .getByRole("button", { name: "局面と履歴" })
    .click();
  await expect(page.getByRole("dialog")).toContainText("回答履歴");
  await expect(
    page.getByRole("dialog").locator(".answer-history article").first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  await page.getByRole("button", { name: "復習中", exact: true }).click();
  await page
    .getByTestId("real-library-row")
    .first()
    .getByRole("button", { name: "保留", exact: true })
    .click();
  await page.getByRole("button", { name: "保留", exact: true }).first().click();
  await expect(page.getByTestId("real-library-row")).toHaveCount(2);
  await page.getByRole("button", { name: "変更を取り消す" }).click();
  await expect(page.getByTestId("real-library-row")).toHaveCount(1);
  expect(
    request({ action: "state" }).data.items.filter(
      (i: { streak: number }) => i.streak === 1,
    ),
  ).toHaveLength(3);
});

test("a lost grading response retries the same immutable event without grading the next question", async ({
  page,
}) => {
  let lose = true;
  await page.route("**/api/local", async (route) => {
    const r = route.request().postDataJSON();
    const result = request(r);
    if (r.action === "study_rate" && lose) {
      lose = false;
      await route.abort("failed");
    } else await route.fulfill({ json: result });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "今日の復習を始める" }).click();
  await page.getByTestId("real-hand").getByRole("button").first().click();
  await page.getByRole("button", { name: "回答する", exact: true }).click();
  await page.getByRole("button", { name: "理解した", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "理解した", exact: true }).click();
  await expect(page.getByText("2 / 5 問", { exact: true })).toBeVisible();
  const state = request({ action: "state" }).data;
  expect(
    state.items.reduce(
      (a: number, i: { review_count: number }) => a + i.review_count,
      0,
    ),
  ).toBe(1);
  await page.getByRole("button", { name: "中断してホームへ" }).click();
  await page.getByRole("button", { name: "復習を再開する" }).click();
  await expect(page.getByText("2 / 5 問", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const brand = page.getByRole("button", {
    name: "KyokuLoop ホーム",
    exact: true,
  });
  if (await brand.isVisible()) await brand.click();
  else await page.getByRole("button", { name: "ホーム", exact: true }).click();
  await page.getByRole("button", { name: "すべて見る" }).click();
  await expect(
    page.getByRole("heading", { name: "学習ライブラリ", exact: true }),
  ).toBeVisible();
});

test("backup download, file preview, additive restore and malformed-file rejection", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "学習", exact: true }).click();
  await page
    .getByRole("button", { name: "バックアップと復元", exact: true })
    .click();
  await page
    .getByRole("button", { name: "バックアップを作成", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "バックアップを保存しました",
  );
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "ダウンロード", exact: true }).click();
  const download = await downloading;
  const path = join(folder, "portable.sqlite3.gz");
  await download.saveAs(path);
  await page.getByLabel("バックアップファイルを選択").setInputFiles(path);
  await expect(
    page.getByRole("heading", { name: "復元する内容" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "この内容を復元", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("復元しました");
  expect(request({ action: "state" }).data.items).toHaveLength(5);
  await page.getByLabel("バックアップファイルを選択").setInputFiles({
    name: "broken.sqlite3",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("not-a-database"),
  });
  await expect(page.getByRole("alert")).toContainText(
    "バックアップは読み取れません",
  );
});
