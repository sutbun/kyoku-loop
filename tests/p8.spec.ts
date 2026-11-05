import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect } from "@playwright/test";
import { test } from "./static-app";
import {
  freshPhoneState,
  phoneReduce,
  validatePhoneBackup,
  type PhonePack,
} from "../src/offline/engine";

const generated = JSON.parse(
  execFileSync(
    "python",
    [
      "-c",
      `
import sys,json,tempfile
from pathlib import Path
sys.path.insert(0,'tests')
from test_p8_mortal import mortal_fixture
from tools.p2_store import Store
with tempfile.TemporaryDirectory(dir='D:/dev-data/kyoku-loop/private') as temp:
 s=Store(Path(temp)/'test.sqlite3')
 try:
  raw=mortal_fixture(True)
  r=s.commit(s.stage(json.dumps(raw).encode(),None)['token'],0,0,None)
  print(json.dumps({'raw':raw,'pack':s.phone_pack()},ensure_ascii=True))
 finally:s.close()
`,
    ],
    { encoding: "utf8", windowsHide: true },
  ),
) as { raw: object; pack: PhonePack };

test("Mortal result import fixes its analysed player, preserves exact red tile and opens study history", async ({
  page,
}) => {
  test.setTimeout(120000);
  const folder = mkdtempSync(
    join(resolve("D:/dev-data/kyoku-loop/private"), "mortal-browser-"),
  );
  const env = { ...process.env, KYOKULOOP_DB: join(folder, "test.sqlite3") };
  const request = (value: object) =>
    JSON.parse(
      execFileSync("python", ["tools/p2_store.py"], {
        input: JSON.stringify(value),
        encoding: "utf8",
        env,
        windowsHide: true,
        timeout: 60000,
      }),
    );
  try {
    await page.route("**/api/local", async (route) =>
      route.fulfill({ json: request(route.request().postDataJSON()) }),
    );
    await page.goto("/");
    await page.getByRole("button", { name: "牌譜", exact: true }).click();
    await page.getByText("解析結果を追加", { exact: true }).click();
    await page.getByText("レポートURL・NAGA", { exact: true }).click();
    await page
      .getByRole("button", { name: "レポートを追加", exact: true })
      .click();
    await page.getByLabel("JSON / JSON.gz ファイル").setInputFiles({
      name: "fictional-mortal.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(generated.raw)),
    });
    await expect(page.getByLabel("解析対象プレイヤー")).toHaveValue("0");
    await expect(page.getByLabel("解析対象プレイヤー")).toBeDisabled();
    await expect(
      page.getByText("Mortal · fictional-model", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "このプレイヤーで登録" }).click();
    await expect(page.getByTestId("real-comparison")).toContainText(
      "Mortalfictional-model",
    );
    await expect(page.getByTestId("real-comparison")).not.toContainText("NAGA");
    await expect(page.getByTestId("real-comparison")).toContainText("5.00pt");
    await expect(
      page.getByTestId("real-hand").getByLabel("赤5筒"),
    ).toBeVisible();
    await page.getByRole("button", { name: "学習", exact: true }).click();
    await page
      .getByRole("button", { name: /問練習する$/, exact: false })
      .click();
    expect(request({ action: "study_current" }).data.scene).not.toHaveProperty(
      "suggested",
    );
    await expect(page.getByTestId("study-comparison")).toHaveCount(0);
    await page.getByTestId("real-hand").getByRole("button").last().click();
    await page.getByRole("button", { name: "回答する", exact: true }).click();
    await expect(page.getByTestId("study-comparison")).toContainText(
      "Mortalfictional-model",
    );
    await page.getByRole("button", { name: "理解した", exact: true }).click();
    expect(request({ action: "state" }).data.items[0].review_count).toBe(1);
    await page.reload();
    expect(request({ action: "state" }).data.items[0].review_count).toBe(1);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("shared JSON form retains a preview across tabs, registers the selected source and keeps orphan results reachable", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const folder = mkdtempSync(
    join(resolve("D:/dev-data/kyoku-loop/private"), "unified-mortal-browser-"),
  );
  const env = { ...process.env, KYOKULOOP_DB: join(folder, "test.sqlite3") };
  const call = (value: object) =>
    JSON.parse(
      execFileSync("python", ["tools/p2_store.py"], {
        input: JSON.stringify(value),
        encoding: "utf8",
        env,
        windowsHide: true,
        timeout: 60000,
      }),
    );
  const url =
    "https://game.mahjongsoul.com/?paipu=260101-fictional-shared-mortal_a123";
  try {
    expect(call({ action: "analysis_add", url }).ok).toBe(true);
    await page.route("**/api/local", (route) =>
      route.fulfill({ json: call(route.request().postDataJSON()) }),
    );
    await page.goto("/");
    await page.getByRole("button", { name: "牌譜", exact: true }).click();
    await page.getByText("解析結果を追加", { exact: true }).click();
    const localDatabases = await page.evaluate(async () =>
      (await indexedDB.databases()).map((db) => db.name).sort(),
    );
    await page
      .getByLabel("Mortal JSON / JSON.gz", { exact: true })
      .setInputFiles({
        name: "fictional-shared.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(generated.raw)),
      });
    await page
      .getByRole("combobox", { name: "元牌譜（任意）", exact: true })
      .selectOption(url.split("paipu=")[1]);
    expect(call({ action: "state" }).data.reports).toHaveLength(0);
    await page.getByRole("button", { name: "設定", exact: true }).click();
    await page.getByRole("button", { name: "牌譜", exact: true }).click();
    await expect(
      page.getByRole("combobox", { name: "元牌譜（任意）", exact: true }),
    ).toHaveValue(url.split("paipu=")[1]);
    await page
      .getByRole("button", { name: "Windowsに登録", exact: true })
      .click();
    await expect(
      page.getByText("元牌譜に紐付け済み", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(async () =>
        (await indexedDB.databases()).map((db) => db.name).sort(),
      ),
    ).toEqual(localDatabases);
    const before = call({ action: "state" }).data;
    expect(before.reports).toHaveLength(1);
    expect(before.analysis_queue[0].reports).toEqual([before.reports[0].id]);
    await page
      .getByTestId("analysis-row")
      .getByRole("button", { name: "問題を見る", exact: true })
      .click();
    await expect(page.getByTestId("real-library-row")).toHaveCount(1);
    await page.getByRole("button", { name: "牌譜", exact: true }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("checkbox", { name: "全選択", exact: true }).check();
    await page
      .getByRole("button", { name: "選択した1件を削除", exact: true })
      .click();
    await expect(page.getByTestId("analysis-row")).toHaveCount(0);
    await page.getByText("解析結果一覧 · 1件", { exact: true }).click();
    await page.getByRole("button", { name: "牌譜を確認", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "収録手順", exact: true }),
    ).toBeVisible();
    if (page.viewportSize()!.width >= 1000)
      expect(
        (await page.locator(".review-layout .table").boundingBox())!.width,
      ).toBeGreaterThanOrEqual(500);
    await page.screenshot({
      path: info.outputPath("review.png"),
      fullPage: true,
    });
    const after = call({ action: "state" }).data;
    expect(after.items).toEqual(before.items);
    expect(after.reports).toEqual(before.reports);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("Mortal phone policy survives offline study, redaction and backup without changing the red tile", () => {
  expect(generated.pack.policy).toBe(2);
  const wrongPolicy = structuredClone(generated.pack);
  wrongPolicy.policy = 1;
  expect(() =>
    phoneReduce(
      freshPhoneState("wrong-policy"),
      { action: "install_pack", pack: wrongPolicy },
      "2026-11-02T12:00:00+09:00",
    ),
  ).toThrow("invalid_pack");
  const at = "2026-11-02T12:00:00+09:00";
  let state = phoneReduce(
    freshPhoneState("fictional-mortal-phone"),
    { action: "install_pack", pack: generated.pack },
    at,
  ).state;
  const call = (request: object) => {
    const result = phoneReduce(state, request, at);
    state = result.state;
    return result.data as any;
  };
  const session = call({ action: "study_start", mode: "practice" });
  for (const key of [
    "actual",
    "suggested",
    "weights_percent",
    "raw_weights",
    "gap",
    "model_name",
  ])
    expect(session.scene).not.toHaveProperty(key);
  expect(session.scene.engine).toBe("Mortal");
  call({
    action: "study_choice",
    session: session.id,
    choice: "choose",
    answer: "5pr",
  });
  const revealed = call({
    action: "study_choice",
    session: session.id,
    choice: "confirm",
  });
  expect(revealed.scene.actual).toBe("5pr");
  expect(revealed.scene.suggested).toBe("5p");
  expect(revealed.scene.gap).toBeCloseTo(5);
  call({
    action: "study_rate",
    session: session.id,
    item: session.item_id,
    rating: "理解した",
    event: "fictional-mortal-answer",
  });
  expect(state.events).toHaveLength(1);
  const saved = JSON.parse(JSON.stringify(state));
  validatePhoneBackup(saved);
  const restored = phoneReduce(
    freshPhoneState("restored-phone"),
    { action: "restore_phone", backup: saved },
    at,
  ).state;
  expect(restored.events).toHaveLength(1);
  expect(restored.pack!.items[0].scene.engine).toBe("Mortal");
  expect(restored.pack!.items[0].scene.actual).toBe("5pr");
});
