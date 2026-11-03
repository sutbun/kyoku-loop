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
    await page
      .getByRole("button", { name: "牌譜を追加", exact: false })
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
      "Mortal推奨",
    );
    await expect(page.getByTestId("real-comparison")).not.toContainText("NAGA");
    await expect(page.getByTestId("real-comparison")).toContainText("5.00pt");
    await expect(
      page.getByTestId("real-hand").getByLabel("赤5筒"),
    ).toBeVisible();
    await page.getByRole("button", { name: "ホーム", exact: true }).click();
    await page.getByRole("button", { name: "今すぐ学ぶ", exact: true }).click();
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
