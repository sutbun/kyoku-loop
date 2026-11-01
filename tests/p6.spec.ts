import { test, expect, chromium, type BrowserContext } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  freshPhoneState,
  phoneReduce,
  validatePhoneBackup,
} from "../src/offline/engine";

const url = "https://game.mahjongsoul.com/?paipu=260101-fictional-game_a123";
const second =
  "https://game.mahjongsoul.com/?paipu=260101-fictional-other_a123";
test("failed URL storage shows no success and phone API keeps the action boundary", async ({
  page,
  request,
}) => {
  for (const action of [
    "inspect",
    "analysis_requested",
    "analysis_setup",
    "backup_restore",
  ]) {
    expect(
      (await request.post("/phone/api", { data: { action } })).status(),
    ).toBe(403);
  }
  expect(
    (
      await request.post("/phone/api", {
        data: { action: "analysis_sync", entries: [] },
        headers: { Origin: "https://example.invalid" },
      })
    ).status(),
  ).toBe(403);
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: any, ...args: any[]) {
      if (this.name === "local" && value?.analysis_queue?.length)
        throw new DOMException("full", "QuotaExceededError");
      return original.call(this, value, ...(args as [IDBValidKey?]));
    };
  });
  await page.goto("/phone/");
  await page.getByLabel("雀魂共有URL", { exact: true }).fill(url);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("空き容量");
  await expect(page.getByTestId("analysis-row")).toHaveCount(0);
  await expect(
    page.getByText("解析待ちに追加しました", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("雀魂共有URL", { exact: true })).toHaveValue(
    url,
  );
});
test("URL receipt preserves concurrent local additions and URL-only backup is restorable", () => {
  let s = phoneReduce(freshPhoneState("fictional-device"), {
    action: "analysis_add",
    url,
  }).state;
  const snapshot = structuredClone(s.analysis_queue!);
  s = phoneReduce(s, { action: "analysis_add", url: second }).state;
  s = phoneReduce(s, {
    action: "analysis_ack",
    snapshot,
    entries: snapshot.map((e) => ({ ...e, requested: true, reports: [] })),
    received_at: new Date().toISOString(),
  }).state;
  expect(s.analysis_queue).toHaveLength(2);
  expect(s.analysis_queue![0].received).toBeTruthy();
  expect(s.analysis_queue![1].received).toBeUndefined();
  const broken = structuredClone(snapshot);
  broken[0].url = second;
  expect(() =>
    phoneReduce(s, {
      action: "analysis_ack",
      snapshot,
      entries: broken,
      received_at: new Date().toISOString(),
    }),
  ).toThrow();
  validatePhoneBackup(s);
  const recovered = phoneReduce(freshPhoneState("new-device"), {
    action: "restore_phone",
    backup: s,
  }).state;
  expect(recovered.analysis_queue).toHaveLength(2);
  expect(recovered.analysis_queue!.every((e) => !e.received)).toBe(true);
  expect(recovered.pack).toBeNull();
  expect(recovered.events).toEqual([]);
});

test("phone URL survives offline process restart, lost receipt and retry; Windows links explicitly", async ({
  browserName,
}, testInfo) => {
  test.setTimeout(180000);
  const folder = mkdtempSync(
    join(resolve("D:/dev-data/kyoku-loop/private"), "p6-browser-"),
  );
  const env = { ...process.env, KYOKULOOP_DB: join(folder, "server.sqlite3") };
  const backend = (r: object) =>
    JSON.parse(
      execFileSync("python", ["tools/p2_store.py"], {
        env,
        input: JSON.stringify(r),
        encoding: "utf8",
        windowsHide: true,
        timeout: 60000,
      }),
    );
  let allowReply = false;
  let context: BrowserContext;
  const start = async (offline = false) => {
    const ctx = await chromium.launchPersistentContext(
      join(folder, "profile"),
      {
        channel: "msedge",
        baseURL: "http://127.0.0.1:1460",
        headless: true,
        viewport: testInfo.project.use.viewport,
        isMobile: testInfo.project.name === "phone",
        hasTouch: testInfo.project.name === "phone",
        serviceWorkers: "allow",
      },
    );
    await ctx.route("**/phone/api", async (route) => {
      const body = route.request().postDataJSON();
      const result = backend(
        body.action === "analysis_sync" ? body : { action: "offline_pack" },
      );
      if (!allowReply) {
        await route.abort();
        return;
      }
      await route.fulfill({ json: result });
    });
    await ctx.setOffline(offline);
    return ctx;
  };
  context = await start();
  try {
    let page = await context.newPage();
    await page.goto("/phone/");
    await page
      .getByLabel("雀魂共有URL", { exact: true })
      .fill(`雀魂牌譜:${url}`);
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByTestId("analysis-row")).toContainText(
      "この端末に保存済み・未同期",
    );
    await expect
      .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), {
        timeout: 30000,
      })
      .toBe(true);
    await expect
      .poll(() => backend({ action: "state" }).data.analysis_queue.length)
      .toBe(1);
    await context.close();
    context = await start(true);
    page = await context.newPage();
    await page.goto("http://127.0.0.1:1460/phone/");
    await expect(page.getByTestId("analysis-row")).toContainText("未同期");
    await page.getByLabel("雀魂共有URL", { exact: true }).fill(url);
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByTestId("analysis-row")).toHaveCount(1);
    allowReply = true;
    await context.setOffline(false);
    await page.getByRole("button", { name: "今すぐ同期", exact: true }).click();
    await expect(page.getByTestId("analysis-row")).toContainText(
      "Windows受信済み",
      { timeout: 30000 },
    );
    expect(backend({ action: "state" }).data.analysis_queue).toHaveLength(1);
    expect(backend({ action: "state" }).data.items).toHaveLength(0);
    // Verify the Windows entry -> original URL -> JSON -> explicit player -> link.
    const win = await context.newPage();
    await win.route("**/api/local", async (route) => {
      await route.fulfill({ json: backend(route.request().postDataJSON()) });
    });
    await win.goto("http://127.0.0.1:1460/");
    const row = win.getByTestId("analysis-row");
    await expect(row).toContainText("保存済み・未解析");
    // Opening a game is navigation only; it does not mark NAGA as running.
    await win.evaluate(() => {
      window.open = () => null;
    });
    await row.getByRole("button", { name: "NAGAで解析", exact: true }).click();
    await expect(win.getByRole("region", { name: "解析の手順" })).toBeVisible();
    await win
      .getByRole("button", { name: "確認しました", exact: true })
      .click();
    await row
      .getByRole("button", { name: "解析を依頼した", exact: true })
      .click();
    await expect(row).toContainText("本人申告");
    await win.reload();
    await row.getByRole("button", { name: "NAGAで解析", exact: true }).click();
    await expect(win.getByRole("region", { name: "解析の手順" })).toHaveCount(
      0,
    );
    await row.getByRole("button", { name: "結果を登録", exact: true }).click();
    const raw = execFileSync(
      "python",
      [
        "-c",
        "import sys,json;sys.path.insert(0,'tests');from test_p0_verify import fixture;print(json.dumps(fixture()))",
      ],
      { encoding: "utf8", windowsHide: true },
    );
    await win.getByLabel("JSON / JSON.gz ファイル").setInputFiles({
      name: "fictional.json",
      mimeType: "application/json",
      buffer: Buffer.from(raw),
    });
    await expect(win.getByLabel("元の雀魂共有URL（選択済み）")).toHaveValue(
      url,
    );
    await expect(win.getByLabel("元の雀魂共有URL（選択済み）")).toBeDisabled();
    await win.getByLabel("あなたのプレイヤー").selectOption("0");
    await win.getByLabel("基準NAGAタイプ").selectOption("0");
    await win.getByRole("button", { name: "このプレイヤーで登録" }).click();
    await expect(
      win.getByRole("heading", { name: "見直したい一打" }),
    ).toBeVisible();
    const result = backend({ action: "state" }).data;
    expect(result.analysis_queue[0].reports).toHaveLength(1);
    expect(result.items).toHaveLength(1);
    await win.getByRole("button", { name: "ホーム", exact: true }).click();
    await expect(row).toContainText("学習準備完了");
    await page.getByRole("button", { name: "今すぐ同期", exact: true }).click();
    await expect(page.getByTestId("analysis-row")).toContainText(
      "学習準備完了",
      { timeout: 30000 },
    );
    await expect(page.getByTestId("offline-status")).toHaveText(
      "オフライン利用可能 · 1問",
      { timeout: 30000 },
    );
    await expect(
      page.getByRole("button", { name: "今すぐ同期", exact: true }),
    ).toBeEnabled();
    await page.screenshot({
      path: join(folder, "phone-inbox.png"),
      fullPage: true,
    });
    // Screenshot retained via the runner only; temporary profile/data stay private.
    await testInfo.attach("phone-inbox", {
      path: join(folder, "phone-inbox.png"),
      contentType: "image/png",
    });
  } finally {
    await context.close();
    if (folder.startsWith(resolve("D:/dev-data/kyoku-loop/private") + "\\"))
      rmSync(folder, { recursive: true });
  }
});
