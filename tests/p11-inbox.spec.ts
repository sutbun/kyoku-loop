import { expect } from "@playwright/test";
import { test } from "./static-app";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { EventEmitter } from "node:events";
import type { ViteDevServer } from "vite";
import { startInbox } from "../tools/local-api";

const raw = execFileSync(
  "python",
  [
    "-c",
    "import sys,json;sys.path.insert(0,'tests');from test_p8_mortal import mortal_fixture;print(json.dumps(mortal_fixture()))",
  ],
  { encoding: "utf8", windowsHide: true },
);
const first = "https://game.mahjongsoul.com/?paipu=fictional-drop-first";
const second = "https://game.mahjongsoul.com/?paipu=fictional-drop-second";

function backend(folder: string) {
  const db = join(folder, "app", "test.sqlite3");
  return {
    db,
    call: (input: object) =>
      JSON.parse(
        execFileSync("python", ["tools/p2_store.py"], {
          input: JSON.stringify(input),
          encoding: "utf8",
          windowsHide: true,
          env: { ...process.env, KYOKULOOP_DB: db },
          timeout: 60000,
        }),
      ),
  };
}

async function drop(
  page: import("@playwright/test").Page,
  index: number,
  files: { name: string; text: string }[],
) {
  const transfer = await page.evaluateHandle((values) => {
    const data = new DataTransfer();
    for (const f of values)
      data.items.add(new File([f.text], f.name, { type: "application/json" }));
    return data;
  }, files);
  await page
    .getByTestId("analysis-row")
    .nth(index)
    .dispatchEvent("drop", { dataTransfer: transfer });
  await transfer.dispose();
}

test("direct drop pins the chosen row through async inspection; cancel and invalid multi-file drops never commit", async ({
  page,
}) => {
  test.setTimeout(120000);
  const folder = mkdtempSync(
    join(resolve("D:/dev-data/kyoku-loop/private"), "inbox-drop-test-"),
  );
  const { call } = backend(folder);
  const requests: any[] = [];
  try {
    call({ action: "analysis_add", url: first });
    call({ action: "analysis_add", url: second });
    await page.route("**/api/local", async (route) => {
      const input = route.request().postDataJSON();
      requests.push(input);
      await route.fulfill({ json: call(input) });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "牌譜", exact: true }).click();
    await expect(page.getByTestId("analysis-row")).toHaveCount(2);
    // Rows are reverse chronological; the second row is the first source.
    await drop(page, 1, [{ name: "fictional.json", text: raw }]);
    await expect(page.getByLabel("元の雀魂共有URL（選択済み）")).toHaveValue(
      first,
    );
    await expect(page.getByTestId("result-source-context")).toContainText(
      "fictional-drop-first",
    );
    await page.getByRole("button", { name: "閉じる", exact: true }).click();
    expect(call({ action: "state" }).data.reports).toHaveLength(0);
    await drop(page, 0, [
      { name: "one.json", text: raw },
      { name: "two.json", text: raw },
    ]);
    await expect(page.getByRole("dialog")).toContainText(
      "ファイルを1つ選んでください",
    );
    expect(call({ action: "state" }).data.reports).toHaveLength(0);
    await page.getByRole("button", { name: "閉じる", exact: true }).click();
    await drop(page, 0, [{ name: "bad.json", text: "{" }]);
    await expect(page.getByRole("dialog")).toContainText(
      "JSONを読み取れません",
    );
    expect(call({ action: "state" }).data.reports).toHaveLength(0);
    await page.getByRole("button", { name: "閉じる", exact: true }).click();
    await drop(page, 0, [{ name: "fictional.json", text: raw }]);
    await expect(page.getByLabel("元の雀魂共有URL（選択済み）")).toHaveValue(
      second,
    );
    await expect(page.getByLabel("解析対象プレイヤー")).toBeDisabled();
    await page.getByRole("button", { name: "このプレイヤーで登録" }).click();
    await expect(page.getByTestId("real-comparison")).toContainText("Mortal");
    await expect(
      page
        .getByTestId("real-comparison")
        .getByRole("img", { name: "1萬", exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByTestId("real-comparison")
        .getByRole("img", { name: "赤5筒", exact: true }),
    ).toBeVisible();
    const commit = requests.find((r) => r.action === "commit");
    expect(commit).toMatchObject({
      source_url: second,
      analysis_id: second.split("=")[1],
    });
    expect(
      requests.filter((r) => r.action === "inspect").every((r) => !r.url),
    ).toBe(true);
    const state = call({ action: "state" }).data;
    expect(state.analysis_queue[0].reports).toHaveLength(0);
    expect(state.analysis_queue[1].reports).toHaveLength(1);
    expect(state.items).toHaveLength(1);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("folder setup drives the Windows watcher without an open app tab; later source selection survives reload", async ({
  page,
}) => {
  test.setTimeout(120000);
  const folder = mkdtempSync(
    join(resolve("D:/dev-data/kyoku-loop/private"), "inbox-watch-test-"),
  );
  const { db, call } = backend(folder);
  const previous = process.env.KYOKULOOP_DB;
  let stop = () => {};
  try {
    call({ action: "analysis_add", url: first });
    await page.route("**/api/local", async (route) =>
      route.fulfill({ json: call(route.request().postDataJSON()) }),
    );
    await page.goto("/");
    await page.getByRole("button", { name: "牌譜", exact: true }).click();
    await page.getByRole("button", { name: "設定", exact: true }).click();
    await page.getByText("Mortal 自動取り込み", { exact: true }).click();
    await page
      .getByLabel("取り込みフォルダ", { exact: true })
      .fill(join(folder, "inbox"));
    await page.getByLabel("このフォルダのMortal JSONを自動登録").check();
    await page.getByRole("button", { name: "設定を保存", exact: true }).click();
    await expect(
      page.getByText("Mortal 自動取り込み · 有効", { exact: true }),
    ).toBeVisible();
    process.env.KYOKULOOP_DB = db;
    const server = Object.assign(new EventEmitter(), { listening: true });
    stop = startInbox({
      httpServer: server as unknown as ViteDevServer["httpServer"],
    });
    await page.goto("about:blank");
    writeFileSync(join(folder, "inbox", "fictional.json"), raw);
    await expect
      .poll(() => call({ action: "state" }).data.reports.length, {
        timeout: 45000,
      })
      .toBe(1);
    expect(call({ action: "state" }).data.reports[0].source_linked).toBe(false);
    // A renamed copy cannot add a second report or study item.
    writeFileSync(join(folder, "inbox", "copy.json"), raw);
    await expect
      .poll(
        () =>
          call({ action: "inbox_status" }).data.files.find(
            (f: any) => f.name === "copy.json",
          )?.status,
        { timeout: 45000 },
      )
      .toBe("duplicate");
    await page.goto("/");
    await page.getByRole("button", { name: "牌譜", exact: true }).click();
    await page.getByText("解析結果一覧 · 1件", { exact: true }).click();
    await page.getByText("元牌譜を選ぶ", { exact: true }).click();
    await page.getByLabel("紐付け先の対局").selectOption(first.split("=")[1]);
    await page
      .getByRole("button", { name: "この対局へ紐付ける", exact: true })
      .click();
    await expect(page.getByTestId("analysis-row")).toContainText("学習可");
    await page.reload();
    await page.getByRole("button", { name: "牌譜", exact: true }).click();
    await page.getByText("解析結果一覧 · 1件", { exact: true }).click();
    await expect(
      page.getByText("元対局に紐付け済み", { exact: false }),
    ).toBeVisible();
    expect(call({ action: "state" }).data.items).toHaveLength(1);
    call({
      action: "inbox_config",
      enabled: false,
      folder: join(folder, "inbox"),
    });
    stop();
    writeFileSync(join(folder, "inbox", "stopped.json"), raw);
    expect(
      call({ action: "inbox_status" }).data.files.some(
        (f: any) => f.name === "stopped.json",
      ),
    ).toBe(false);
  } finally {
    stop();
    if (previous === undefined) delete process.env.KYOKULOOP_DB;
    else process.env.KYOKULOOP_DB = previous;
    rmSync(folder, { recursive: true, force: true });
  }
});
