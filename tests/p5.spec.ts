import {
  test,
  expect,
  chromium,
  devices,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { resolve, join, dirname, basename } from "node:path";

test("lost ACK, failed local receipt, retry, process restart and exported backup recovery preserve one canonical answer", async () => {
  test.setTimeout(180000);
  const root = resolve("D:/dev-data/kyoku-loop/private"),
    folder = mkdtempSync(join(root, "p5-browser-"));
  const env = { ...process.env, KYOKULOOP_DB: join(folder, "server.sqlite3") };
  const backend = (request: object) =>
    JSON.parse(
      execFileSync("python", ["tools/p2_store.py"], {
        env,
        input: JSON.stringify(request),
        encoding: "utf8",
        windowsHide: true,
        timeout: 60000,
      }),
    );
  execFileSync(
    "python",
    [
      "-c",
      `
import os,sys,json
sys.path.insert(0,'tests')
from test_p3_study import five_fixture
from tools.p2_store import Store
s=Store(os.environ['KYOKULOOP_DB'])
try:
 r=s.commit(s.stage(json.dumps(five_fixture()).encode(),None)['token'],0,0,None)
 for scene in s.detail(r['id'])['decisions'][3:]:s.save(r['id'],scene['id'],True)
 s.db.execute('UPDATE study_items SET due=?',(s.today(),));s.db.commit()
finally:s.close()
`,
    ],
    { env, windowsHide: true },
  );
  const { defaultBrowserType: _, ...device } = devices["iPhone 13"];
  let context: BrowserContext = await chromium.launchPersistentContext(
    join(folder, "profile"),
    { ...device, channel: "msedge", headless: true },
  );
  let lost = false;
  const routes = async (ctx: BrowserContext) =>
    ctx.route("**/phone/api", async (route) => {
      const request = route.request().postDataJSON();
      const result = backend(
        request.action === "download"
          ? { action: "offline_pack" }
          : { action: "phone_sync", payload: request.payload },
      );
      if (request.action === "sync" && request.payload.events.length && !lost) {
        lost = true;
        await route.abort();
        return;
      }
      await route.fulfill({ json: result });
    });
  const read = (page: Page) =>
    page.evaluate(
      () =>
        new Promise<any>((resolve, reject) => {
          const r = indexedDB.open("kyokuloop-phone-v1");
          r.onerror = () => reject(r.error);
          r.onsuccess = () => {
            const db = r.result,
              tx = db.transaction("local"),
              q = tx.objectStore("local").get("state");
            tx.oncomplete = () => {
              db.close();
              resolve(q.result);
            };
          };
        }),
    );
  try {
    await routes(context);
    let page = await context.newPage();
    await page.goto("http://127.0.0.1:1460/phone/");
    await page
      .getByRole("button", { name: "問題を端末に保存", exact: true })
      .click();
    await expect(page.getByTestId("offline-status")).toContainText(
      "オフライン利用可能 · 5問",
      { timeout: 30000 },
    );
    await context.setOffline(true);
    await page.getByRole("button", { name: "今日の復習を始める" }).click();
    await page.locator(".hand button").first().click();
    await page.getByRole("button", { name: "回答する", exact: true }).click();
    await page.getByRole("button", { name: "理解した", exact: true }).click();
    await expect(page.getByText("2 / 5 問", { exact: true })).toBeVisible();
    const raw = (await read(page)).events[0];
    expect(raw.mode).toBe("scheduled");
    await page.getByRole("button", { name: "中断してホームへ" }).click();
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      (window as any).restorePut = () => {
        IDBObjectStore.prototype.put = put;
      };
      IDBObjectStore.prototype.put = function (value, ...args) {
        if (Object.keys(value.receipts ?? {}).length)
          throw new DOMException("generated quota", "QuotaExceededError");
        return put.call(this, value, ...(args as [IDBValidKey]));
      };
    });
    await context.setOffline(false);
    await expect.poll(() => lost, { timeout: 30000 }).toBe(true);
    await expect(
      page.getByRole("alert").filter({ hasText: "受信確認を保存できません" }),
    ).toBeVisible({ timeout: 45000 });
    expect((await read(page)).events[0]).toEqual(raw);
    expect(Object.keys((await read(page)).receipts ?? {})).toHaveLength(0);
    let history = backend({ action: "item_history", item: raw.item }).data
      .events;
    expect(history).toHaveLength(1);
    await page.evaluate(() => (window as any).restorePut());
    await page.getByRole("button", { name: "今すぐ同期", exact: true }).click();
    await expect
      .poll(async () => Object.keys((await read(page)).receipts ?? {}).length, {
        timeout: 30000,
      })
      .toBe(1);
    expect(
      backend({ action: "item_history", item: raw.item }).data.events,
    ).toHaveLength(1);
    expect((await read(page)).events[0]).toEqual(raw);
    await page.getByText("端末の管理", { exact: true }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "記録をファイルに保存" }).click();
    const backup = join(folder, "phone-records.json");
    await (await downloadPromise).saveAs(backup);
    const windows = await context.newPage();
    await windows.route("**/api/local", (route) =>
      route.fulfill({ json: backend(route.request().postDataJSON()) }),
    );
    await windows.goto("http://127.0.0.1:1460/");
    await windows.getByRole("button", { name: "学習", exact: true }).click();
    await windows
      .getByRole("button", { name: "バックアップと復元", exact: true })
      .click();
    await windows.getByLabel("端末の記録ファイルを選択").setInputFiles(backup);
    await expect(
      windows.getByText("追加 0件 · 登録済み 1件", { exact: true }),
    ).toBeVisible();
    await windows
      .getByRole("button", { name: "この記録を追加", exact: true })
      .click();
    await expect(
      windows.getByText(
        "端末の回答記録を追加しました。現在の記録も保持しています。",
        { exact: true },
      ),
    ).toBeVisible();
    expect(
      backend({ action: "item_history", item: raw.item }).data.events,
    ).toHaveLength(1);
    await windows.close();
    // Importing over existing local records must fail without replacing anything.
    await page.getByLabel("記録ファイルから復旧").setInputFiles(backup);
    await expect(
      page.getByRole("alert").filter({ hasText: "上書きできません" }),
    ).toBeVisible();
    expect((await read(page)).events[0]).toEqual(raw);
    await context.close();
    context = await chromium.launchPersistentContext(join(folder, "profile"), {
      ...device,
      channel: "msedge",
      headless: true,
    });
    await context.setOffline(true);
    page = await context.newPage();
    await page.goto("http://127.0.0.1:1460/phone/");
    await expect(
      page.getByText("回答 未送信 0件", { exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "復習を再開する" }).click();
    await expect(page.getByText("2 / 5 問", { exact: true })).toBeVisible();
    expect((await read(page)).events[0]).toEqual(raw);
    await context.close();
    context = await chromium.launchPersistentContext(
      join(folder, "recovered"),
      { ...device, channel: "msedge", headless: true },
    );
    await routes(context);
    page = await context.newPage();
    await page.goto("http://127.0.0.1:1460/phone/");
    await page.getByText("端末の管理", { exact: true }).click();
    await expect(
      page.getByRole("button", { name: "記録をファイルに保存" }),
    ).toBeEnabled();
    await context.setOffline(true);
    await page.getByLabel("記録ファイルから復旧").setInputFiles(backup);
    await expect(
      page.getByText("回答 未送信 1件", { exact: true }),
    ).toBeVisible();
    const recovered = await read(page);
    expect(recovered.events[0]).toEqual(raw);
    expect(recovered.device).not.toBe(raw.device);
    await page.getByRole("button", { name: "復習を再開する" }).click();
    await expect(page.getByText("2 / 5 問", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "中断してホームへ" }).click();
    await context.setOffline(false);
    await expect
      .poll(async () => Object.keys((await read(page)).receipts ?? {}).length, {
        timeout: 30000,
      })
      .toBe(1);
    history = backend({ action: "item_history", item: raw.item }).data.events;
    expect(history).toHaveLength(1);
  } finally {
    await context.close();
    if (
      dirname(resolve(folder)) !== root ||
      !basename(folder).startsWith("p5-browser-")
    )
      throw new Error("unexpected folder");
    rmSync(folder, { recursive: true, force: true });
  }
});
