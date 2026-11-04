import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

const base = "https://popup-fixture.invalid";
const evidence = "D:/dev-data/kyoku-loop/private/mortal-simple-ui-20261105";
const row = (n, mode = 12) => ({
  id: `fictional-replay-${n}`,
  available: true,
  history: mode
    ? {
        at: `2026-11-${String(n).padStart(2, "0")}T10:00:00+09:00`,
        rank: 2,
        mode,
      }
    : null,
});
const idle = {
  jobs: [],
  batch: null,
  hasPendingPayload: false,
  resumeAllowed: false,
};
async function fixture(entries, status = idle) {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 420, height: 700 } });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    assert.equal(url.origin, base, "no live application or Mortal requests");
    const file = url.pathname.slice(1);
    assert.match(file, /^[a-z-]+\.(html|css|js)$/);
    await route.fulfill({
      contentType: file.endsWith("js")
        ? "text/javascript"
        : file.endsWith("css")
          ? "text/css"
          : "text/html",
      body: await readFile(`extensions/mortal-helper/${file}`, "utf8"),
    });
  });
  await page.addInitScript(
    ({ entries, status }) => {
      window.fixture = { entries, status, calls: [] };
      window.chrome = {
        runtime: {
          getManifest: () => ({ version_name: "DEV-11.05-4" }),
          sendMessage: async (message) => {
            window.fixture.calls.push(message);
            const f = window.fixture;
            if (message.type === "STATUS") return structuredClone(f.status);
            if (message.type === "BATCH_LOAD")
              return f.loadError
                ? { error: f.loadError }
                : { entries: f.entries };
            if (message.type === "BATCH_START") {
              f.status.batch = {
                id: "batch",
                phase: "running",
                model: message.model,
                index: 0,
                items: message.ids.map((id) => ({ id, status: "queued" })),
              };
            }
            if (message.type === "BATCH_STOP")
              f.status.batch.stopAfterCurrent = true;
            return { ok: true };
          },
        },
        storage: {
          local: {
            get: async () =>
              JSON.parse(sessionStorage.getItem("preferences") || "{}"),
            set: async (value) =>
              sessionStorage.setItem("preferences", JSON.stringify(value)),
          },
        },
      };
    },
    { entries, status },
  );
  try {
    await page.goto(`${base}/popup.html`);
    await expect(page.locator("#batch-count")).not.toHaveText("");
  } catch (error) {
    await browser.close();
    throw error;
  }
  return { page, close: () => browser.close() };
}
async function update(page, status) {
  await page.evaluate(async (status) => {
    window.fixture.status = status;
    await (await import("./popup.js")).refresh();
  }, status);
}

test("opening selects oldest twenty verified games, hides clutter, and never starts analysis", async () => {
  const entries = [
    ...Array.from({ length: 25 }, (_, i) => row(25 - i)),
    row(26, null),
    { ...row(27), available: false, reason: "already_registered" },
    { ...row(28), available: false, reason: "unsupported_rule" },
  ];
  const f = await fixture(entries);
  try {
    const { page } = f;
    await expect(page.locator("#batch-start")).toHaveText("20件を解析・登録");
    await expect(page.locator("#batch-list")).not.toBeVisible();
    await expect(page.locator("#batch-model")).not.toBeVisible();
    await expect(page.locator("#batch-stop")).not.toBeVisible();
    await expect(page.locator("#copy-diagnostics")).not.toBeVisible();
    assert.deepEqual(
      await page.evaluate(() =>
        window.fixture.calls.map((x) => x.type).filter((x) => x !== "STATUS"),
      ),
      ["BATCH_LOAD"],
    );
    const visible = await page.locator("body").innerText();
    assert.ok(
      !visible.includes("127.0.0.1") && !visible.includes("fictional-replay"),
    );
    await mkdir(evidence, { recursive: true });
    await page.locator("body").screenshot({ path: `${evidence}/ready.png` });
    await page.locator("#batch-start").click();
    const start = await page.evaluate(() =>
      window.fixture.calls.find((x) => x.type === "BATCH_START"),
    );
    assert.deepEqual(
      start.ids,
      Array.from({ length: 20 }, (_, i) => row(i + 1).id),
    );
    assert.equal(start.model, "4.1b");
  } finally {
    await f.close();
  }
});

test("target editing offers bulk selection, never checks unknown rules automatically, and enforces twenty", async () => {
  const f = await fixture([
    ...Array.from({ length: 21 }, (_, i) => row(i + 1)),
    row(22, null),
    { ...row(23), available: false },
  ]);
  try {
    const { page } = f;
    await page.locator("#targets > summary").click();
    await expect(page.locator("#batch-list input")).toHaveCount(22);
    await expect(
      page.locator('input[value="fictional-replay-22"]'),
    ).not.toBeChecked();
    await page.locator('input[value="fictional-replay-21"]').click();
    await expect(
      page.locator('input[value="fictional-replay-21"]'),
    ).not.toBeChecked();
    await page.locator("#select-none").click();
    await expect(page.locator("#batch-start")).toBeDisabled();
    await page.locator('input[value="fictional-replay-22"]').check();
    await expect(page.locator("#batch-start")).toHaveText("1件を解析・登録");
    await page.locator("#select-default").click();
    await expect(page.locator("#batch-list input:checked")).toHaveCount(20);
    await expect(
      page.locator('input[value="fictional-replay-22"]'),
    ).not.toBeChecked();
    await page.locator("body").screenshot({ path: `${evidence}/targets.png` });
    await page.locator("#tools > summary").click();
    const layout = await page.evaluate(() => ({
      menuBottom: document.querySelector(".menu").getBoundingClientRect()
        .bottom,
      bodyBottom: document.body.getBoundingClientRect().bottom,
      width: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    assert.ok(
      layout.menuBottom <= layout.bodyBottom,
      "expanded menu participates in popup sizing",
    );
    assert.ok(layout.width <= layout.viewport, "no horizontal overflow");
    await page.locator("body").screenshot({ path: `${evidence}/menu.png` });
    await page.locator("#batch-model").selectOption("4.0");
    await page.reload();
    await expect(page.locator("#batch-start")).toBeEnabled();
    await expect(page.locator("#batch-model")).toHaveValue("4.0");
  } finally {
    await f.close();
  }
});

test("reopening shows ACK progress and cooldown; stop and completion keep the list current", async () => {
  const items = [
    { ...row(1), status: "done" },
    { ...row(2), status: "queued" },
    { ...row(3), status: "queued" },
  ];
  const running = {
    ...idle,
    batch: {
      id: "batch",
      phase: "running",
      model: "4.1b",
      index: 1,
      nextAt: Date.now() + 30000,
      items,
    },
  };
  const f = await fixture([], running);
  try {
    const { page } = f;
    await expect(page.locator("#batch-count")).toHaveText("登録完了 1 / 3件");
    await expect(page.locator("#batch-notice")).toContainText("次の開始まで");
    await expect(page.locator("#batch-progress")).toHaveAttribute("value", "1");
    await expect(page.locator("#batch-start")).not.toBeVisible();
    assert.equal(
      await page.evaluate(() =>
        window.fixture.calls.some((x) => x.type === "BATCH_LOAD"),
      ),
      false,
    );
    await mkdir(evidence, { recursive: true });
    await page.locator("body").screenshot({ path: `${evidence}/running.png` });
    await page.locator("#batch-stop").click();
    await expect(page.locator("#batch-stop")).toBeDisabled();
    assert.equal(
      await page.evaluate(
        () =>
          window.fixture.calls.filter((x) => x.type === "BATCH_STOP").length,
      ),
      1,
    );
    const done = {
      ...idle,
      batch: {
        ...running.batch,
        phase: "done",
        index: 3,
        items: items.map((x) => ({ ...x, status: "done" })),
      },
    };
    await update(page, done);
    await expect(page.locator("#batch-count")).toHaveText("3件を登録しました");
    await expect(page.locator("#open-app")).toBeVisible();
    await expect(page.locator("#batch-list input")).toHaveCount(0);
    assert.equal(
      await page.evaluate(
        () =>
          window.fixture.calls.filter((x) => x.type === "BATCH_LOAD").length,
      ),
      1,
    );
    await page.locator("#open-app").click();
    assert.equal(
      await page.evaluate(() => window.fixture.calls.at(-1).type),
      "OPEN_APP",
    );
    await page.locator("body").screenshot({ path: `${evidence}/done.png` });
  } finally {
    await f.close();
  }
});

test("paused view exposes only valid recovery, hides voluntary-stop diagnostics, and copies on click", async () => {
  const paused = {
    ...idle,
    resumeAllowed: true,
    hasPendingPayload: true,
    batch: {
      id: "batch",
      phase: "paused",
      reason: "local_unavailable",
      index: 1,
      items: [
        { status: "done" },
        { id: "fictional", jobId: "job", status: "active" },
      ],
    },
    jobs: [{ id: "job", phase: "saved" }],
  };
  const f = await fixture([], paused);
  try {
    const { page } = f;
    await expect(page.locator("#batch-count")).toHaveText(
      "1 / 2件を登録して停止",
    );
    await expect(page.locator("#batch-start")).toHaveText("登録を再開");
    await expect(page.locator("#batch-start")).toBeEnabled();
    await page.evaluate(() =>
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text) => {
            window.copied = text;
          },
        },
      }),
    );
    await page.locator("#copy-diagnostics").click();
    assert.match(await page.evaluate(() => window.copied), /local_unavailable/);
    await mkdir(evidence, { recursive: true });
    await page.locator("body").screenshot({ path: `${evidence}/paused.png` });
    await update(page, {
      ...paused,
      resumeAllowed: false,
      batch: { ...paused.batch, reason: "submission_uncertain" },
    });
    await expect(page.locator("#batch-start")).not.toBeVisible();
    await update(page, {
      ...paused,
      resumeAllowed: true,
      batch: { ...paused.batch, reason: "user_pause" },
    });
    await expect(page.locator("#copy-diagnostics")).not.toBeVisible();
  } finally {
    await f.close();
  }
});

test("missing app offers an open action and retry without starting anything", async () => {
  const f = await fixture([]);
  try {
    const { page } = f;
    await page.evaluate(() => {
      window.fixture.loadError = "open_kyokuloop_tab";
    });
    await page.locator("#tools > summary").click();
    await page.locator("#batch-load").click();
    await expect(page.locator("#open-app")).toBeVisible();
    await expect(page.locator("#retry-load")).toBeVisible();
    await page.locator("#tools > summary").click();
    await page.evaluate((entry) => {
      window.fixture.loadError = null;
      window.fixture.entries = [entry];
    }, row(1));
    await page.locator("#retry-load").click();
    await expect(page.locator("#batch-start")).toHaveText("1件を解析・登録");
    assert.equal(
      await page.evaluate(() =>
        window.fixture.calls.some((x) => x.type === "BATCH_START"),
      ),
      false,
    );
  } finally {
    await f.close();
  }
});
