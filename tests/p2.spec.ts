import { execFileSync } from "node:child_process";
import { test, expect } from "@playwright/test";
import type { Detail, Workspace } from "../src/real-types";

// Build fictional API responses with the actual normalizer/private SQLite code.
const generated = JSON.parse(
  execFileSync(
    "python",
    [
      "-c",
      `
import sys,json,tempfile
from pathlib import Path
sys.path.insert(0,'tests')
from test_p0_verify import fixture
from tools.p2_store import Store
with tempfile.TemporaryDirectory(dir='D:/dev-data/kyoku-loop/private') as temp:
 s=Store(Path(temp)/'browser-fixture.sqlite3')
 raw=fixture()
 staged=s.stage(json.dumps(raw).encode(),None)
 result=s.commit(staged['token'],0,0,None)
 print(json.dumps({'raw':raw,'detail':s.detail(result['id']),'workspace':s.state()},ensure_ascii=True))
 s.close()
`,
    ],
    { encoding: "utf8", windowsHide: true },
  ),
) as { raw: object; detail: Detail; workspace: Workspace };

test("real import confirms player, opens top scene, persists registration and avoids duplicates", async ({
  page,
}) => {
  let imported = false;
  await page.route("**/api/local", async (route) => {
    const r = route.request().postDataJSON();
    const data =
      r.action === "state"
        ? imported
          ? generated.workspace
          : { reports: [], items: [] }
        : r.action === "inspect"
          ? {
              token: "generated",
              players: ["架空A", "架空B", "架空C", "架空D"],
              models: [{ index: 0, name: "架空モデル" }],
              preferred_model: 0,
              rounds: 1,
            }
          : r.action === "commit"
            ? { id: generated.detail.id, duplicate: imported }
            : generated.detail;
    if (r.action === "commit") imported = true;
    await route.fulfill({ json: { ok: true, data } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "牌譜を追加", exact: false }).click();
  await page.getByLabel("JSON / JSON.gz ファイル").setInputFiles({
    name: "generated.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(generated.raw)),
  });
  await expect(
    page.getByRole("button", { name: "このプレイヤーで登録" }),
  ).toBeDisabled();
  await page.getByLabel("あなたのプレイヤー").selectOption("0");
  await page.getByRole("button", { name: "このプレイヤーで登録" }).click();
  await expect(
    page.getByRole("heading", { name: "重要局面 1 / 1" }),
  ).toBeVisible();
  await expect(page.getByTestId("real-hand").getByLabel("赤5筒")).toBeVisible();
  await expect(page.getByTestId("real-comparison")).toContainText("40.04pt");
  await expect(page.locator(".player-2 .player-label")).toContainText(
    "東",
  );
  await page.getByRole("button", { name: "収録手順", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "収録手順 2 / 3" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "次の手順" }).click();
  await expect(
    page.getByRole("heading", { name: "収録手順 3 / 3" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "学習", exact: true }).click();
  await page.getByRole("button", { name: "すべて", exact: true }).click();
  await expect(page.getByTestId("real-library-row")).toHaveCount(1);
  await page.reload();
  await page.getByRole("button", { name: "学習", exact: true }).click();
  await page.getByRole("button", { name: "すべて", exact: true }).click();
  await expect(page.getByTestId("real-library-row")).toHaveCount(1);
  await page.getByRole("button", { name: "ホーム", exact: true }).click();
  await page.getByRole("button", { name: "牌譜を追加", exact: false }).click();
  await page.getByLabel("NAGA / Mortal レポートURL").fill("generated-input");
  await page.getByRole("button", { name: "レポートを読み込む" }).click();
  await page.getByLabel("あなたのプレイヤー").selectOption("0");
  await page.getByRole("button", { name: "このプレイヤーで登録" }).click();
  await expect(page.getByRole("status")).toContainText(
    "登録済みの牌譜を開きました",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

const preferenceModels = [
  { index: 0, name: "ニシキ" },
  { index: 1, name: "ヒバカリ" },
];

test("preference selects the remembered type but player and commit remain explicit", async ({
  page,
}) => {
  const commits: { seat: number; model: number }[] = [];
  await page.route("**/api/local", async (route) => {
    const input = route.request().postDataJSON();
    if (input.action === "commit") commits.push(input);
    const data =
      input.action === "state"
        ? { reports: [], items: [] }
        : input.action === "inspect"
          ? {
              token: "generated",
              players: ["架空A", "架空B", "架空C", "架空D"],
              models: preferenceModels,
              preferred_model: 1,
              rounds: 1,
            }
          : input.action === "commit"
            ? { id: generated.detail.id, duplicate: false }
            : generated.detail;
    await route.fulfill({ json: { ok: true, data } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "牌譜を追加", exact: false }).click();
  await page
    .getByLabel("JSON / JSON.gz ファイル")
    .setInputFiles({
      name: "generated.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(generated.raw)),
    });
  await expect(page.getByLabel("基準NAGAタイプ")).toHaveValue("1");
  await expect(page.getByLabel("あなたのプレイヤー")).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "このプレイヤーで登録" }),
  ).toBeDisabled();
  expect(commits).toHaveLength(0);
  await page.getByLabel("あなたのプレイヤー").selectOption("0");
  await page.getByLabel("基準NAGAタイプ").selectOption("0");
  await page.getByRole("button", { name: "このプレイヤーで登録" }).click();
  await expect(page.getByRole("status")).toContainText("牌譜を保存しました");
  expect(commits.map(({ seat, model }) => ({ seat, model }))).toEqual([
    { seat: 0, model: 0 },
  ]);
});

test("preference missing or ambiguous never picks a different or nonexistent type", async ({
  page,
}) => {
  let commits = 0;
  for (const candidate of [
    { models: preferenceModels.slice(0, 1), preferred_model: null },
    {
      models: preferenceModels.map((m) => ({ ...m, name: "ニシキ" })),
      preferred_model: null,
    },
    { models: preferenceModels, preferred_model: 99 },
  ]) {
    await page.unroute("**/api/local");
    await page.route("**/api/local", async (route) => {
      const input = route.request().postDataJSON();
      if (input.action === "commit") commits++;
      await route.fulfill({
        json: {
          ok: true,
          data:
            input.action === "state"
              ? { reports: [], items: [] }
              : {
                  token: "generated",
                  players: ["架空A", "架空B", "架空C", "架空D"],
                  ...candidate,
                  rounds: 1,
                },
        },
      });
    });
    await page.goto("/");
    await page
      .getByRole("button", { name: "牌譜を追加", exact: false })
      .click();
    await page
      .getByLabel("JSON / JSON.gz ファイル")
      .setInputFiles({
        name: "generated.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(generated.raw)),
      });
    await page.getByLabel("あなたのプレイヤー").selectOption("0");
    await expect(page.getByLabel("基準NAGAタイプ")).toHaveValue("");
    await expect(
      page.getByRole("button", { name: "このプレイヤーで登録" }),
    ).toBeDisabled();
    await page.getByLabel("基準NAGAタイプ").selectOption("0");
    await expect(
      page.getByRole("button", { name: "このプレイヤーで登録" }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "閉じる", exact: true }).click();
  }
  expect(commits).toBe(0);
});

test("preference changes in a cancelled dialog do not submit or replace the next default", async ({
  page,
}) => {
  let commits = 0;
  await page.route("**/api/local", async (route) => {
    const input = route.request().postDataJSON();
    if (input.action === "commit") commits++;
    await route.fulfill({
      json: {
        ok: true,
        data:
          input.action === "state"
            ? { reports: [], items: [] }
            : {
                token: "generated",
                players: ["架空A", "架空B", "架空C", "架空D"],
                models: preferenceModels,
                preferred_model: 1,
                rounds: 1,
              },
      },
    });
  });
  await page.goto("/");
  for (let attempt = 0; attempt < 2; attempt++) {
    await page
      .getByRole("button", { name: "牌譜を追加", exact: false })
      .click();
    await page
      .getByLabel("JSON / JSON.gz ファイル")
      .setInputFiles({
        name: "generated.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(generated.raw)),
      });
    await expect(page.getByLabel("基準NAGAタイプ")).toHaveValue("1");
    await page.getByLabel("基準NAGAタイプ").selectOption("0");
    await page.getByRole("button", { name: "閉じる", exact: true }).click();
  }
  expect(commits).toBe(0);
});

test("access restriction and local save failure remain visible without false success", async ({
  page,
}) => {
  await page.route("**/api/local", async (route) => {
    const r = route.request().postDataJSON();
    await route.fulfill({
      json:
        r.action === "state"
          ? { ok: true, data: { reports: [], items: [] } }
          : { ok: false, error: "access_denied" },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "牌譜を追加", exact: false }).click();
  await page.getByLabel("NAGA / Mortal レポートURL").fill("generated-input");
  await page.getByRole("button", { name: "レポートを読み込む" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "アクセスが拒否されました",
  );
  await expect(
    page.getByRole("button", { name: "このプレイヤーで登録" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  await expect(page.getByText("取り込んだ牌譜", { exact: true })).toBeVisible();
});
