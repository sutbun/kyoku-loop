import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const raw = execFileSync(
  "python",
  [
    "-c",
    "import sys,json;sys.path.insert(0,'tests');from test_p8_mortal import mortal_fixture;print(json.dumps(mortal_fixture()))",
  ],
  { encoding: "utf8", windowsHide: true },
);
function backend(folder: string, initial = false) {
  const env = { ...process.env, KYOKULOOP_DB: join(folder, "test.sqlite3") };
  const call = (r: object) =>
    JSON.parse(
      execFileSync("python", ["tools/p2_store.py"], {
        input: JSON.stringify(r),
        encoding: "utf8",
        env,
        windowsHide: true,
        timeout: 60000,
      }),
    );
  if (initial)
    execFileSync(
      "python",
      [
        "-c",
        "import os,sys,json;sys.path.insert(0,'tests');from test_p0_verify import fixture;from tools.p2_store import Store;s=Store(os.environ['KYOKULOOP_DB']);s.commit(s.stage(json.dumps(fixture()).encode(),None)['token'],0,0,None);s.close()",
      ],
      { env, windowsHide: true },
    );
  return call;
}
async function phoneState(page: Page) {
  return page.evaluate(
    () =>
      new Promise<any>((resolve, reject) => {
        const r = indexedDB.open("kyokuloop-phone-v1", 1);
        r.onsuccess = () => {
          const db = r.result;
          const tx = db.transaction("local", "readonly");
          const q = tx.objectStore("local").get("state");
          q.onsuccess = () => resolve(q.result);
          q.onerror = () => reject(q.error);
          tx.oncomplete = () => db.close();
        };
        r.onerror = () => reject(r.error);
      }),
  );
}
async function routePhone(
  page: Page,
  call: ReturnType<typeof backend>,
  options: {
    blockSync: boolean;
    loseRegistration: boolean;
    failDownloadOnce?: boolean;
  } = { blockSync: false, loseRegistration: false },
) {
  await page.route("**/phone/api", async (route) => {
    const r = route.request().postDataJSON();
    if (r.action === "sync" && options.blockSync) return route.abort();
    if (r.action === "download" && options.failDownloadOnce) {
      options.failDownloadOnce = false;
      return route.abort();
    }
    const input =
      r.action === "download"
        ? { action: "offline_pack" }
        : r.action === "sync"
          ? { action: "phone_sync", payload: r.payload }
          : { action: "analysis_sync", entries: r.entries };
    await route.fulfill({ json: call(input) });
  });
  await page.route("**/phone/mortal", async (route) => {
    const r = route.request().postDataJSON();
    const result = call({
      ...r,
      action:
        r.action === "inspect"
          ? "phone_mortal_inspect"
          : "phone_mortal_register",
    });
    if (r.action === "register" && options.loseRegistration) {
      options.loseRegistration = false;
      return route.abort();
    }
    await route.fulfill({ json: result });
  });
}

test("iPad entry validates JSON.gz, requires explicit registration, then downloads a review pack without a prior pack", async ({
  page,
}) => {
  test.setTimeout(120000);
  const folder = mkdtempSync(
    join(resolve("D:/dev-data/kyoku-loop/private"), "phone-import-new-"),
  );
  const call = backend(folder);
  try {
    await routePhone(page, call);
    await page.goto("/phone/");
    await page
      .getByRole("navigation", { name: "メイン" })
      .getByRole("button", { name: "牌譜", exact: true })
      .click();
    await page.getByText("解析結果を追加", { exact: true }).click();
    const file = page.getByLabel("Mortal JSON / JSON.gz", { exact: true });
    await file.setInputFiles({
      name: "bad.json",
      mimeType: "application/json",
      buffer: Buffer.from("<html>MHTML is not JSON</html>"),
    });
    await expect(page.getByRole("alert")).toContainText("JSONを読み取れません");
    expect(call({ action: "state" }).data.reports).toHaveLength(0);
    await file.setInputFiles({
      name: "fictional.json.gz",
      mimeType: "application/gzip",
      buffer: gzipSync(raw),
    });
    await expect(
      page.getByText("解析対象：席1 · 架空A", { exact: false }),
    ).toBeVisible();
    expect(call({ action: "state" }).data.reports).toHaveLength(0);
    await page.getByRole("button", { name: "取り消す", exact: true }).click();
    expect(call({ action: "state" }).data.reports).toHaveLength(0);
    await file.setInputFiles({
      name: "fictional.json",
      mimeType: "application/json",
      buffer: Buffer.from(raw),
    });
    await page
      .getByRole("button", { name: "Windowsに登録", exact: true })
      .click();
    await expect(
      page.getByText("Windowsに登録しました", { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("offline-status")).toHaveText(
      "オフライン利用可能 · 1問",
      { timeout: 45000 },
    );
    await page.reload();
    await expect(page.getByTestId("offline-status")).toHaveText(
      "オフライン利用可能 · 1問",
      { timeout: 45000 },
    );
    expect(call({ action: "state" }).data.items).toHaveLength(1);
    await page
      .getByRole("navigation", { name: "メイン" })
      .getByRole("button", { name: "学習", exact: true })
      .click();
    await page.getByRole("button", { name: /問練習する/, exact: true }).click();
    await expect(page.getByTestId("real-hand")).toBeVisible();
    await expect(page.getByTestId("study-comparison")).toHaveCount(0);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("lost registration acknowledgement retries once and merges new review items without clearing pending answers or the active session", async ({
  page,
}) => {
  test.setTimeout(180000);
  const folder = mkdtempSync(
    join(resolve("D:/dev-data/kyoku-loop/private"), "phone-import-retain-"),
  );
  const call = backend(folder, true);
  const options = { blockSync: true, loseRegistration: true };
  try {
    await routePhone(page, call, options);
    await page.goto("/phone/");
    await page
      .getByRole("navigation", { name: "メイン" })
      .getByRole("button", { name: "設定", exact: true })
      .click();
    await page
      .getByRole("button", { name: "問題を端末に保存", exact: true })
      .click();
    await expect(page.getByTestId("offline-status")).toHaveText(
      "オフライン利用可能 · 1問",
      { timeout: 45000 },
    );
    await page
      .getByRole("navigation", { name: "メイン" })
      .getByRole("button", { name: "学習", exact: true })
      .click();
    await page.getByRole("button", { name: /問練習する/, exact: true }).click();
    await page.getByTestId("real-hand").getByRole("button").last().click();
    await page.getByRole("button", { name: "回答する", exact: true }).click();
    await page.getByRole("button", { name: "理解した", exact: true }).click();
    await page.getByRole("button", { name: "学習へ", exact: true }).click();
    await page
      .getByRole("navigation", { name: "メイン" })
      .getByRole("button", { name: "学習", exact: true })
      .click();
    await page.getByRole("button", { name: /問練習する/, exact: true }).click();
    await page.getByTestId("real-hand").getByRole("button").last().click();
    await page
      .getByRole("button", { name: "中断して学習へ", exact: true })
      .click();
    const before = await phoneState(page);
    expect(before.events).toHaveLength(1);
    await page
      .getByRole("navigation", { name: "メイン" })
      .getByRole("button", { name: "牌譜", exact: true })
      .click();
    await page.getByText("解析結果を追加", { exact: true }).click();
    await page
      .getByLabel("Mortal JSON / JSON.gz", { exact: true })
      .setInputFiles({
        name: "fictional.json",
        mimeType: "application/json",
        buffer: Buffer.from(raw),
      });
    await page
      .getByRole("button", { name: "Windowsに登録", exact: true })
      .click();
    await expect(page.getByText(/登録結果を確認できません/)).toBeVisible();
    expect(call({ action: "state" }).data.reports).toHaveLength(2);
    const retained = await phoneState(page);
    expect(retained.events).toEqual(before.events);
    expect(retained.session).toEqual(before.session);
    await page
      .getByRole("button", { name: "Windowsに登録", exact: true })
      .click();
    await expect(
      page.getByText("Windowsに登録済みの結果です", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/Windows登録済みです。端末の問題を更新できませんでした/),
    ).toBeVisible();
    const stillRetained = await phoneState(page);
    expect(stillRetained.events).toEqual(before.events);
    expect(stillRetained.session).toEqual(before.session);
    options.blockSync = false;
    await page
      .getByRole("navigation", { name: "メイン" })
      .getByRole("button", { name: "設定", exact: true })
      .click();
    await page.getByRole("button", { name: "今すぐ同期", exact: true }).click();
    await expect
      .poll(async () => (await phoneState(page)).pack.items.length, {
        timeout: 45000,
      })
      .toBe(2);
    const after = await phoneState(page);
    expect(after.events).toEqual(before.events);
    expect(after.session).toEqual(before.session);
    expect(call({ action: "state" }).data.items).toHaveLength(2);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "続きから再開", exact: false }),
    ).toBeVisible();
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("dedicated phone import endpoint rejects cross-site access and arbitrary URL, path, seat or backend commands", async ({
  request,
}) => {
  for (const body of [
    {
      action: "inspect",
      source: null,
      url: "https://example.invalid/report.json",
    },
    { action: "register", source: "x", token: "x", analysis_id: null, seat: 0 },
    {
      action: "register",
      source: "x",
      token: "x",
      analysis_id: null,
      model: 0,
    },
    { action: "inspect", source: null, data: "", path: "D:/private.json" },
    { action: "backup_restore" },
  ])
    expect((await request.post("/phone/mortal", { data: body })).status()).toBe(
      403,
    );
  expect(
    (
      await request.post("/phone/mortal", {
        headers: { Origin: "https://example.invalid" },
        data: { action: "inspect", source: null, data: "" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post("/phone/api", {
        data: { action: "phone_mortal_register", token: "x" },
      })
    ).status(),
  ).toBe(403);
});

test("first device retries only pack delivery after registration without registering the result again", async ({
  page,
}) => {
  test.setTimeout(120000);
  const folder = mkdtempSync(
    join(resolve("D:/dev-data/kyoku-loop/private"), "phone-import-delivery-"),
  );
  const base = backend(folder);
  let registrations = 0;
  const call = (r: object) => {
    if ((r as { action: string }).action === "phone_mortal_register")
      registrations++;
    return base(r);
  };
  try {
    await routePhone(page, call, {
      blockSync: false,
      loseRegistration: false,
      failDownloadOnce: true,
    });
    await page.goto("/phone/");
    await page
      .getByRole("navigation", { name: "メイン" })
      .getByRole("button", { name: "牌譜", exact: true })
      .click();
    await page.getByText("解析結果を追加", { exact: true }).click();
    await page
      .getByLabel("Mortal JSON / JSON.gz", { exact: true })
      .setInputFiles({
        name: "fictional.json",
        mimeType: "application/json",
        buffer: Buffer.from(raw),
      });
    await page
      .getByRole("button", { name: "Windowsに登録", exact: true })
      .click();
    await expect(
      page.getByText("Windowsに登録しました", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "問題の更新を再試行", exact: true }),
    ).toBeEnabled();
    expect(registrations).toBe(1);
    expect(call({ action: "state" }).data.reports).toHaveLength(1);
    await page
      .getByRole("button", { name: "問題の更新を再試行", exact: true })
      .click();
    await expect(page.getByTestId("offline-status")).toHaveText(
      "オフライン利用可能 · 1問",
      { timeout: 45000 },
    );
    expect(registrations).toBe(1);
    expect(call({ action: "state" }).data.items).toHaveLength(1);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("shortcut JSON with identical repeated rounds registers once and opens a review", async ({
  page,
}) => {
  test.setTimeout(120000);
  const folder = mkdtempSync(
    join(resolve("D:/dev-data/kyoku-loop/private"), "phone-shortcut-rounds-"),
  );
  const call = backend(folder);
  const ordinary = execFileSync(
    "python",
    [
      "-c",
      "import sys,json;sys.path.insert(0,'tests');from test_p13_shortcut_json import two_rounds;print(json.dumps(two_rounds()))",
    ],
    { encoding: "utf8", windowsHide: true },
  );
  const repeated = JSON.parse(ordinary);
  const rounds = repeated.split_logs.map(
    (cell: { log: unknown[] }) => cell.log[0],
  );
  repeated.split_logs.forEach((cell: { log: unknown[] }) => {
    cell.log = rounds;
  });
  try {
    await routePhone(page, call);
    await page.goto("/phone/");
    await page
      .getByRole("navigation", { name: "メイン" })
      .getByRole("button", { name: "牌譜", exact: true })
      .click();
    await page.getByText("解析結果を追加", { exact: true }).click();
    await page
      .getByLabel("Mortal JSON / JSON.gz", { exact: true })
      .setInputFiles({
        name: "fictional-shortcut.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(repeated)),
      });
    await expect(page.getByText("2局 · Mortal fictional-model")).toBeVisible();
    expect(call({ action: "state" }).data.reports).toHaveLength(0);
    await page
      .getByRole("button", { name: "Windowsに登録", exact: true })
      .click();
    await expect(
      page.getByText("Windowsに登録しました", { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("offline-status")).toHaveText(
      "オフライン利用可能 · 2問",
      { timeout: 45000 },
    );
    await page
      .getByLabel("Mortal JSON / JSON.gz", { exact: true })
      .setInputFiles({
        name: "fictional-original.json",
        mimeType: "application/json",
        buffer: Buffer.from(ordinary),
      });
    await page
      .getByRole("button", { name: "Windowsに登録", exact: true })
      .click();
    await expect(
      page.getByText("Windowsに登録済みの結果です", { exact: true }),
    ).toBeVisible();
    expect(call({ action: "state" }).data.reports).toHaveLength(1);
    await page
      .getByRole("navigation", { name: "メイン" })
      .getByRole("button", { name: "学習", exact: true })
      .click();
    await page.getByRole("button", { name: /問練習する/, exact: true }).click();
    await expect(page.getByTestId("real-hand")).toBeVisible();
    await expect(page.getByTestId("study-comparison")).toHaveCount(0);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test.describe("tablet layout", () => {
  test.use({
    viewport: { width: 1024, height: 1366 },
    isMobile: true,
    hasTouch: true,
  });
  test("JSON entry is reachable at iPad width without horizontal overflow", async ({
    page,
  }) => {
    await page.route("**/phone/api", (route) => route.abort());
    await page.goto("/phone/");
    await page
      .getByRole("navigation", { name: "メイン" })
      .getByRole("button", { name: "牌譜", exact: true })
      .click();
    await page.getByText("解析結果を追加", { exact: true }).click();
    await expect(
      page.getByLabel("Mortal JSON / JSON.gz", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: resolve(
        "D:/dev-data/kyoku-loop/private/ipad-import-20261103/tablet-entry.png",
      ),
      fullPage: true,
    });
  });
});
