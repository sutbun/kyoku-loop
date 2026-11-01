import { test, expect, chromium, devices } from "@playwright/test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { phoneFixture } from "./phone-fixture";
import { phoneAllowed } from "../tools/phone";

const pack = phoneFixture();
test("phone access is private and never exposes the Windows write API", async ({
  request,
}) => {
  const req = (headers: Record<string, string>) =>
    ({ headers, socket: { remoteAddress: "127.0.0.1" } }) as Parameters<
      typeof phoneAllowed
    >[0];
  const access = {
    origin: "https://generated.example:1460",
    login: "generated-owner",
  };
  expect(phoneAllowed(req({ host: "127.0.0.1:1460" }), access)).toBe(true);
  expect(
    phoneAllowed(
      req({
        host: "127.0.0.1:1460",
        "tailscale-user-login": "generated-owner",
      }),
      access,
    ),
  ).toBe(false);
  expect(
    phoneAllowed(
      req({
        host: "generated.example:1460",
        "tailscale-user-login": "someone-else",
      }),
      access,
    ),
  ).toBe(false);
  expect(
    phoneAllowed(
      req({
        host: "generated.example:1460",
        "tailscale-user-login": "generated-owner",
        origin: "https://hostile.example",
      }),
      access,
    ),
  ).toBe(false);
  expect(
    phoneAllowed(
      req({
        host: "generated.example:1460",
        "tailscale-user-login": "generated-owner",
      }),
      access,
    ),
  ).toBe(true);
  for (const path of ["/api/local", "/phone/api", "/src/main.tsx"]) {
    const r = await request.post(path, {
      headers: { "tailscale-user-login": "generated-owner" },
      data: { action: "study_rate" },
    });
    expect(r.status()).toBe(403);
  }
  expect(
    (
      await request.post("/phone/api", { data: { action: "study_rate" } })
    ).status(),
  ).toBe(403);
});

test("PWA commits atomically, resumes with no network after browser restart and retains unsent records", async () => {
  test.setTimeout(150000);
  const root = resolve("D:/dev-data/kyoku-loop/private");
  const profile = mkdtempSync(join(root, "p4-browser-"));
  const workerFile = resolve("dist/phone/sw.js"),
    htmlFile = resolve("dist/phone/index.html");
  const originalWorker = readFileSync(workerFile, "utf8"),
    originalHtml = readFileSync(htmlFile, "utf8");
  const { defaultBrowserType: _, ...device } = devices["iPhone 13"];
  let context = await chromium.launchPersistentContext(profile, {
    ...device,
    channel: "msedge",
    headless: true,
  });
  const read = async (page: import("@playwright/test").Page) =>
    page.evaluate(
      () =>
        new Promise<any>((resolve, reject) => {
          const r = indexedDB.open("kyokuloop-phone-v1", 1);
          r.onsuccess = () => {
            const db = r.result;
            const tx = db.transaction("local");
            const q = tx.objectStore("local").get("state");
            tx.oncomplete = () => {
              db.close();
              resolve(q.result);
            };
          };
          r.onerror = () => reject(r.error);
        }),
    );
  try {
    let page = await context.newPage();
    await context.route("**/phone/api", (r) =>
      r.fulfill({ json: { ok: true, data: pack } }),
    );
    await page.goto("http://127.0.0.1:1460/phone/");
    await expect(
      page.getByRole("button", { name: "問題を端末に保存", exact: true }),
    ).toBeEnabled();
    // Failure before commit must neither install the pack nor claim success.
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      (window as any).restorePut = () => {
        IDBObjectStore.prototype.put = put;
      };
      IDBObjectStore.prototype.put = function (value, ...args) {
        if (value.pack)
          throw new DOMException("generated quota", "QuotaExceededError");
        return put.call(this, value, ...(args as [IDBValidKey]));
      };
    });
    await page
      .getByRole("button", { name: "問題を端末に保存", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("空き容量");
    expect((await read(page)).pack).toBeNull();
    await expect(page.getByTestId("offline-status")).not.toContainText(
      "オフライン利用可能",
    );
    await page.evaluate(() => (window as any).restorePut());
    // Request success is still not commit: an abort after put succeeds must roll back.
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      (window as any).restorePut = () => {
        IDBObjectStore.prototype.put = put;
      };
      IDBObjectStore.prototype.put = function (value, ...args) {
        const r = put.call(this, value, ...(args as [IDBValidKey]));
        if (value.pack)
          r.addEventListener("success", () => this.transaction.abort());
        return r;
      };
    });
    await page
      .getByRole("button", { name: "問題を端末に保存", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "端末に保存できませんでした",
    );
    expect((await read(page)).pack).toBeNull();
    await expect(page.getByTestId("offline-status")).not.toContainText(
      "オフライン利用可能",
    );
    await page.evaluate(() => (window as any).restorePut());
    await page
      .getByRole("button", { name: "問題を端末に保存", exact: true })
      .click();
    await expect(page.getByTestId("offline-status")).toContainText(
      "オフライン利用可能 · 5問",
    );
    const cachePaths = await page.evaluate(async () => {
      const all = [];
      for (const k of await caches.keys())
        for (const r of await (await caches.open(k)).keys())
          all.push(new URL(r.url).pathname);
      return all;
    });
    expect(cachePaths.some((p) => p.includes("/api"))).toBe(false);
    await context.setOffline(true);
    await page.getByRole("button", { name: "今日の復習を始める" }).click();
    await expect(page.getByTestId("study-comparison")).toHaveCount(0);
    await page.locator(".hand button").first().click();
    await page.getByRole("button", { name: "回答する", exact: true }).click();
    await expect(page.getByTestId("study-comparison")).toBeVisible();
    const before = await read(page);
    // A failing rating does not advance the current question or append an event.
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      (window as any).restorePut = () => {
        IDBObjectStore.prototype.put = put;
      };
      IDBObjectStore.prototype.put = function () {
        throw new DOMException("generated quota", "QuotaExceededError");
      };
    });
    await page.getByRole("button", { name: "理解した", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("空き容量");
    expect(await read(page)).toEqual(before);
    await page.evaluate(() => (window as any).restorePut());
    await page.getByRole("button", { name: "理解した", exact: true }).click();
    await expect(page.getByText("2 / 5 問", { exact: true })).toBeVisible();
    await expect.poll(async () => (await read(page)).events.length).toBe(1);
    const event = (await read(page)).events[0];
    await context.close();
    context = await chromium.launchPersistentContext(profile, {
      ...device,
      channel: "msedge",
      headless: true,
    });
    await context.setOffline(true);
    page = await context.newPage();
    await page.goto("http://127.0.0.1:1460/phone/");
    await expect(page.getByTestId("offline-status")).toContainText(
      "オフライン利用可能 · 5問",
    );
    await expect(page.getByText("未送信 1件", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "復習を再開する" }).click();
    await expect(page.getByText("2 / 5 問", { exact: true })).toBeVisible();
    expect((await read(page)).events[0]).toEqual(event);
    await page.getByRole("button", { name: "中断してホームへ" }).click();
    // Missing one shell asset must invalidate readiness even with a valid pack.
    await page.evaluate(async () => {
      for (const k of await caches.keys())
        await (await caches.open(k)).delete("/phone/icon-192.png");
    });
    await page.reload();
    await expect(page.getByTestId("offline-status")).not.toContainText(
      "オフライン利用可能",
    );
    expect((await read(page)).events).toHaveLength(1);
    await context.setOffline(false);
    let downloads = 0;
    await context.route("**/phone/api", (route) => {
      downloads++;
      return route.fulfill({ json: { ok: true, data: pack } });
    });
    await page.getByRole("button", { name: "アプリ本体の保存を確認" }).click();
    await expect(page.getByTestId("offline-status")).toContainText(
      "オフライン利用可能 · 5問",
    );
    expect(downloads).toBe(0);
    expect((await read(page)).events[0]).toEqual(event);
    // A new application generation activates only after old clients close.
    const oldBuild = originalHtml.match(
      /name="phone-build" content="([a-f0-9]+)"/,
    )![1];
    const nextBuild = oldBuild + "generated";
    writeFileSync(workerFile, originalWorker.replace(oldBuild, nextBuild));
    writeFileSync(htmlFile, originalHtml.replace(oldBuild, nextBuild));
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration("/phone/");
      await reg!.update();
    });
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            !!(await navigator.serviceWorker.getRegistration("/phone/"))
              ?.waiting,
        ),
      )
      .toBe(true);
    expect((await read(page)).events[0]).toEqual(event);
    await context.close();
    context = await chromium.launchPersistentContext(profile, {
      ...device,
      channel: "msedge",
      headless: true,
    });
    await context.setOffline(true);
    page = await context.newPage();
    await page.goto("http://127.0.0.1:1460/phone/");
    await expect(page.getByTestId("offline-status")).toContainText(
      "オフライン利用可能 · 5問",
    );
    expect((await read(page)).events[0]).toEqual(event);
    expect(
      await page.locator('meta[name="phone-build"]').getAttribute("content"),
    ).toBe(nextBuild);
  } finally {
    await context.close();
    writeFileSync(workerFile, originalWorker);
    writeFileSync(htmlFile, originalHtml);
    if (
      dirname(resolve(profile)) !== root ||
      !basename(profile).startsWith("p4-browser-")
    )
      throw new Error("unexpected profile");
    rmSync(profile, { recursive: true, force: true });
  }
});

test("a failed first storage write can be retried without reloading or resetting data", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    (window as any).restorePut = () => {
      IDBObjectStore.prototype.put = put;
    };
    IDBObjectStore.prototype.put = function () {
      throw new DOMException("generated quota", "QuotaExceededError");
    };
  });
  await page.goto("/phone/");
  await expect(page.getByRole("alert")).toContainText("空き容量");
  await page.evaluate(() => (window as any).restorePut());
  await page
    .getByRole("button", { name: "保存状態を確認", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "問題を端末に保存", exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
