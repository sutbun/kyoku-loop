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
    "あなた · 東",
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
  await page.getByLabel("NAGAレポートURL / report_id").fill("generated-input");
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
  await page.getByLabel("NAGAレポートURL / report_id").fill("generated-input");
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
