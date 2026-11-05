import { expect, type Page } from "@playwright/test";
import { test } from "./static-app";
import { freshPhoneState, phoneReduce } from "../src/offline/engine";
import { phoneFixture } from "./phone-fixture";

const pack = phoneFixture();
const nav = (page: Page) =>
  page.getByRole("navigation", { name: "メイン", exact: true });
const tab = (page: Page, name: string) =>
  nav(page).getByRole("button", { name, exact: true });
const workspace = { reports: [], items: [], due_count: 0, practice_count: 0 };

test("Windows tab changes never wait for another full-state response", async ({
  page,
}, info) => {
  let reads = 0;
  let release!: () => void;
  const slowRead = new Promise<void>((done) => {
    release = done;
  });
  await page.route("**/api/local", async (route) => {
    expect(route.request().postDataJSON().action).toBe("state");
    if (++reads > 1) await slowRead;
    if (!page.isClosed())
      await route
        .fulfill({ json: { ok: true, data: workspace } })
        .catch(() => {});
  });
  try {
    await page.goto("/");
    await expect(
      page.getByText("学習する問題がありません", { exact: true }),
    ).toBeVisible();
    await expect(tab(page, "牌譜")).toBeEnabled();
    await tab(page, "牌譜").click();
    await tab(page, "設定").click({ timeout: 750 });
    await tab(page, "学習").click({ timeout: 750 });
    await expect(tab(page, "学習")).toHaveAttribute("aria-current", "page");
    expect(reads).toBe(1);
    await page.screenshot({
      path: info.outputPath("windows-tabs.png"),
      fullPage: true,
    });
  } finally {
    release();
  }
});

test("iPad tab changes do not re-read IndexedDB or verify the offline shell", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "onLine", { get: () => false });
    (window as any).__tabProbe = {
      reads: 0,
      checks: 0,
      holdChecks: false,
      ports: [],
    };
    const get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (key) {
      if (this.name === "local" && key === "state")
        (window as any).__tabProbe.reads++;
      return get.call(this, key);
    };
    Object.defineProperty(navigator.serviceWorker, "controller", {
      configurable: true,
      value: {
        postMessage(_message: unknown, ports: MessagePort[]) {
          const probe = (window as any).__tabProbe;
          probe.checks++;
          if (probe.holdChecks) probe.ports.push(ports[0]);
          else
            ports[0].postMessage({
              ok: true,
              build: document.querySelector<HTMLMetaElement>(
                'meta[name="phone-build"]',
              )?.content,
            });
        },
      },
    });
  });
  await page.goto("/phone/");
  await expect(tab(page, "牌譜")).toBeEnabled();
  let state = phoneReduce(freshPhoneState("tabs-retained-session"), {
    action: "install_pack",
    pack,
  }).state;
  state = phoneReduce(state, { action: "study_start", mode: "practice" }).state;
  await page.evaluate(
    (state) =>
      new Promise<void>((done, fail) => {
        const r = indexedDB.open("kyokuloop-phone-v1", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("local");
        r.onerror = () => fail(r.error);
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction("local", "readwrite");
          tx.objectStore("local").put(state, "state");
          tx.oncomplete = () => {
            db.close();
            done();
          };
          tx.onerror = () => fail(tx.error);
        };
      }),
    state,
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "続きから再開", exact: false }),
  ).toBeVisible();
  await expect(tab(page, "牌譜")).toBeEnabled();
  await page.evaluate(() =>
    Object.assign((window as any).__tabProbe, {
      reads: 0,
      checks: 0,
      holdChecks: true,
    }),
  );
  try {
    await tab(page, "牌譜").click();
    await tab(page, "設定").click({ timeout: 750 });
    await tab(page, "学習").click({ timeout: 750 });
    await expect(
      page.getByRole("button", { name: "続きから再開", exact: false }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => {
        const probe = (window as any).__tabProbe;
        return { reads: probe.reads, checks: probe.checks };
      }),
    ).toEqual({ reads: 0, checks: 0 });
    const saved = await page.evaluate(
      () =>
        new Promise<unknown>((done) => {
          const r = indexedDB.open("kyokuloop-phone-v1", 1);
          r.onsuccess = () => {
            const db = r.result,
              tx = db.transaction("local"),
              q = tx.objectStore("local").get("state");
            tx.oncomplete = () => {
              db.close();
              done(q.result);
            };
          };
        }),
    );
    expect(saved).toEqual(state);
    await page.screenshot({
      path: info.outputPath("ipad-tabs.png"),
      fullPage: true,
    });
  } finally {
    await page.evaluate(() => {
      const probe = (window as any).__tabProbe;
      probe.holdChecks = false;
      for (const port of probe.ports)
        port.postMessage({
          ok: true,
          build: document.querySelector<HTMLMetaElement>(
            'meta[name="phone-build"]',
          )?.content,
        });
    });
  }
});

test("an actual URL save still locks navigation until its durable response arrives", async ({
  page,
}) => {
  let saving = false;
  let release!: () => void;
  const save = new Promise<void>((done) => {
    release = done;
  });
  await page.route("**/api/local", async (route) => {
    const body = route.request().postDataJSON();
    if (body.action === "analysis_bulk") {
      saving = true;
      await save;
      return route.fulfill({
        json: { ok: true, data: { added: 1, existing: 0 } },
      });
    }
    expect(body.action).toBe("state");
    return route.fulfill({ json: { ok: true, data: workspace } });
  });
  try {
    await page.goto("/");
    await expect(tab(page, "牌譜")).toBeEnabled();
    await tab(page, "牌譜").click();
    await page.getByText("URLを追加", { exact: true }).click();
    await page
      .getByRole("textbox", { name: "雀魂共有URL", exact: true })
      .fill(
        "https://game.mahjongsoul.com/?paipu=260101-fictional-fast-tabs_a123",
      );
    await page.getByRole("button", { name: "追加", exact: true }).click();
    await expect.poll(() => saving).toBe(true);
    await expect(tab(page, "設定")).toBeDisabled();
    release();
    await expect(tab(page, "設定")).toBeEnabled();
    await tab(page, "設定").click();
    await expect(page.getByText("学習の設定", { exact: true })).toBeVisible();
  } finally {
    release();
  }
});
