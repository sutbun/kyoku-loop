import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { gzipSync } from "node:zlib";
import {
  freshPhoneState,
  phoneReduce,
  validatePhoneBackup,
  type PhoneState,
} from "../src/offline/engine";
import { syncPayload, validateSyncReply } from "../src/offline/protocol";
import { phoneFixture } from "./phone-fixture";

for (const scenario of ["save", "sync", "retry", "empty"] as const) {
  test(`standalone preparation before first pack can receive Windows questions: ${scenario}`, async ({
    page,
  }) => {
    test.setTimeout(180000);
    const pack = phoneFixture();
    let downloads = 0;
    let unavailable = scenario === "retry";
    await page.route("**/phone/api", async (route) => {
      const request = route.request().postDataJSON();
      if (request.action === "download") {
        downloads++;
        if (unavailable) return route.fulfill({ status: 503, body: "" });
        return route.fulfill({
          json: {
            ok: true,
            data:
              scenario === "empty"
                ? { ...pack, items: [], histories: {} }
                : pack,
          },
        });
      }
      if (scenario === "empty" && request.action === "sync") {
        expect(request.payload.source).toBe(pack.source);
        expect(request.payload.events).toEqual([]);
        return route.fulfill({
          json: {
            ok: true,
            data: {
              protocol: 1,
              source: pack.source,
              device: request.payload.device,
              receipts: [],
              pack,
            },
          },
        });
      }
      throw Error("Unexpected initial-pack request");
    });
    await page.goto("/phone/");
    if (scenario === "empty") {
      await page
        .getByRole("button", { name: "問題を端末に保存", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "端末だけで使う準備", exact: true }),
      ).toBeEnabled({ timeout: 30000 });
    }
    await page
      .getByRole("button", { name: "端末だけで使う準備", exact: true })
      .click();
    await expect(page.getByTestId("compiler-ready")).toBeVisible({
      timeout: 120000,
    });
    await page
      .getByRole("button", {
        name:
          scenario === "save" || scenario === "retry"
            ? "問題を端末に保存"
            : "今すぐ同期",
        exact: true,
      })
      .click({ timeout: 5000 });
    if (scenario === "retry") {
      await expect(page.getByRole("alert")).toContainText(
        "Windowsに接続できません",
        { timeout: 120000 },
      );
      await expect(page.getByTestId("offline-status")).not.toContainText(
        "オフライン利用可能",
      );
      unavailable = false;
      await page
        .getByRole("button", { name: "今すぐ同期", exact: true })
        .click();
    }
    await expect(page.getByTestId("offline-status")).toHaveText(
      `オフライン利用可能 · ${pack.items.length}問`,
      { timeout: 120000 },
    );
    expect(downloads).toBe(scenario === "retry" ? 2 : 1);
    await expect(page.getByRole("alert")).toHaveCount(0);
    const state = await page.evaluate(
      () =>
        new Promise<PhoneState>((resolve, reject) => {
          const request = indexedDB.open("kyokuloop-phone-v1", 1);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const read = db
              .transaction("local")
              .objectStore("local")
              .get("state");
            read.onsuccess = () => {
              db.close();
              resolve(read.result);
            };
            read.onerror = () => {
              db.close();
              reject(read.error);
            };
          };
        }),
    );
    expect(state.schema).toBe(2);
    expect(state.local_imports).toEqual([]);
    expect(state.pack).toEqual(pack);
    await page.context().setOffline(true);
    await page.reload();
    await expect(page.getByTestId("offline-status")).toHaveText(
      `オフライン利用可能 · ${pack.items.length}問`,
    );
    await page
      .getByRole("button", { name: "今日の復習を始める", exact: false })
      .click();
    await expect(page.getByTestId("real-hand")).toBeVisible();
  });
}

const created = "2026-11-03T01:00:00.000Z";
const raw = execFileSync(
  "python",
  [
    "-c",
    "import sys,json;sys.path.insert(0,'tests');from test_p13_shortcut_json import two_rounds,repeated_rounds;print(json.dumps(repeated_rounds(two_rounds())))",
  ],
  { encoding: "utf8", windowsHide: true },
);
const expected = JSON.parse(
  execFileSync(
    "python",
    [
      "-c",
      `import sys,json,base64;from tools.mortal_material import compile_upload;print(json.dumps(compile_upload(base64.b64encode(sys.stdin.buffer.read()).decode(),'${created}')))`,
    ],
    { input: raw, encoding: "utf8", windowsHide: true },
  ),
);

test("atomic local import preserves session, answers, due, duplicates and backup; delayed Windows sync retains credit", async () => {
  let state = phoneReduce(freshPhoneState("fictional-ipad"), {
    action: "enable_local",
  }).state;
  let at = "2026-11-03T01:00:00.000Z";
  const call = (request: object): any => {
    const result = phoneReduce(state, request, at);
    state = result.state;
    return result.data;
  };
  call({ action: "register_local", material: expected, analysis_id: null });
  expect(state.schema).toBe(2);
  expect(state.pack!.items).toHaveLength(2);
  expect(state.local_source).toBe("local:fictional-ipad");
  at = "2026-11-04T01:00:00.000Z";
  let q = call({ action: "study_start", mode: "scheduled" });
  expect(q.scene.actual).toBeUndefined();
  call({
    action: "study_choice",
    session: q.id,
    choice: "choose",
    answer: q.scene.own_hand[0],
  });
  call({ action: "study_choice", session: q.id, choice: "confirm" });
  q = call({
    action: "study_rate",
    session: q.id,
    item: q.item_id,
    rating: "理解した",
    event: "fictional-local-answer",
  });
  expect(state.events[0].credited).toBe(1);
  const before = structuredClone(state);
  expect(
    call({ action: "register_local", material: expected, analysis_id: null })
      .duplicate,
  ).toBe(true);
  expect(state).toEqual(before);
  const invalid = structuredClone(expected);
  invalid.items[0].scene.own_hand[0] = "bad-tile";
  expect(() =>
    call({ action: "register_local", material: invalid, analysis_id: null }),
  ).toThrow();
  expect(state).toEqual(before);
  validatePhoneBackup(JSON.parse(JSON.stringify(state)));
  expect(() => call({ action: "restore_phone", backup: before })).toThrow(
    "phone_restore_exists",
  );
  const restored = phoneReduce(freshPhoneState("restored-device"), {
    action: "restore_phone",
    backup: before,
  }).state;
  expect(restored.events).toEqual(before.events);
  expect(restored.session).toEqual(before.session);
  expect(restored.local_imports).toEqual(before.local_imports);

  const output = JSON.parse(
    execFileSync(
      "python",
      [
        "-c",
        `
import sys,json,tempfile
from pathlib import Path
from datetime import datetime,timezone
from tools.p2_store import Store
r=json.loads(sys.stdin.buffer.read().decode("utf-8"))
with tempfile.TemporaryDirectory(dir='D:/dev-data/kyoku-loop/private') as temp:
 s=Store(Path(temp)/'test.sqlite3',clock=lambda:datetime(2026,11,20,tzinfo=timezone.utc))
 stage=s.phone_mortal_inspect(r['material']['payload'],None)
 result=s.phone_mortal_register(stage['token'],stage['source'],None,r['material']['created'],r['ids'])
 payload=r['payload'];payload['source']=stage['source']
 reply=s.phone_sync(payload)
 print(json.dumps({'reply':reply,'result':result}))
 s.close()
`,
      ],
      {
        input: JSON.stringify({
          material: expected,
          ids: state.local_imports![0].item_ids,
          payload: syncPayload(state),
        }),
        encoding: "utf8",
        windowsHide: true,
      },
    ),
  );
  call({ action: "bind_source", source: output.result.source });
  expect(() => call({ action: "bind_source", source: "different" })).toThrow(
    "different_source",
  );
  call({
    action: "import_ack",
    analysis_id: null,
    id: expected.id,
    source: output.result.source,
  });
  const payload = syncPayload(state);
  const reply = await validateSyncReply(payload, output.reply);
  call({ action: "apply_sync", snapshot: payload, reply });
  expect(state.events).toEqual(before.events);
  expect(
    state.pack!.items.find((i) => i.id === before.events[0].item)!.due,
  ).toBe("2026-11-07");
  expect(state.receipts![before.events[0].id].credited).toBe(1);
  expect(state.session).toEqual(before.session);
  validatePhoneBackup(state);
});

test("cached standalone Worker matches Windows material offline under the phone CSP", async ({
  page,
  context,
}) => {
  test.setTimeout(240000);
  const folder = mkdtempSync(
    join(resolve("D:/dev-data/kyoku-loop/private"), "standalone-sync-"),
  );
  const backend = (r: object) =>
    JSON.parse(
      execFileSync("python", ["tools/p2_store.py"], {
        input: JSON.stringify(r),
        encoding: "utf8",
        windowsHide: true,
        env: { ...process.env, KYOKULOOP_DB: join(folder, "test.sqlite3") },
      }),
    );
  let connected = false,
    lostAck = false;
  await page.route("**/phone/api", async (route) => {
    if (!connected) return route.abort();
    const r = route.request().postDataJSON();
    await route.fulfill({
      json: backend(
        r.action === "sync"
          ? { action: "phone_sync", payload: r.payload }
          : r.action === "download"
            ? { action: "offline_pack" }
            : { action: "analysis_sync", entries: r.entries },
      ),
    });
  });
  await page.route("**/phone/mortal", async (route) => {
    if (!connected) return route.abort();
    const r = route.request().postDataJSON();
    const result = backend({
      ...r,
      action:
        r.action === "inspect"
          ? "phone_mortal_inspect"
          : "phone_mortal_register",
    });
    if (r.action === "register" && !lostAck) {
      lostAck = true;
      return route.abort();
    }
    await route.fulfill({ json: result });
  });
  try {
    await page.goto("/phone/");
    await page
      .getByRole("button", { name: "端末だけで使う準備", exact: true })
      .click();
    await expect(page.getByTestId("compiler-ready")).toBeVisible({
      timeout: 120000,
    });
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByTestId("compiler-ready")).toBeVisible();
    const filename = readdirSync(resolve("dist/assets")).find((n) =>
      /^mortal-compiler\.worker-.*\.js$/.test(n),
    );
    expect(filename).toBeTruthy();
    const result = await page.evaluate(
      async ({ file, data, created }) => {
        const worker = new Worker("/phone/assets/" + file, { type: "module" });
        try {
          return await new Promise<any>((resolve, reject) => {
            worker.onmessage = (e) => resolve(e.data);
            worker.onerror = () => reject(Error("worker failed"));
            worker.postMessage({ id: 1, data, created });
          });
        } finally {
          worker.terminate();
        }
      },
      { file: filename!, data: gzipSync(raw).toString("base64"), created },
    );
    expect(result.ok).toBe(true);
    // Compression headers can differ between platform zlib builds.
    const { payload: ignored, ...actual } = result.data;
    const { payload: original, ...wanted } = expected;
    expect(actual).toEqual(wanted);

    // Use the shipped UI, not a direct reducer call, for the offline path.
    await page.getByText("解析結果を追加", { exact: true }).click();
    const input = page.getByLabel("Mortal JSON / JSON.gz", { exact: true });
    await input.setInputFiles({
      name: "fictional.json.gz",
      mimeType: "application/gzip",
      buffer: gzipSync(raw),
    });
    await expect(
      page.getByRole("button", { name: "この端末に登録", exact: true }),
    ).toBeVisible({ timeout: 90000 });
    await page.evaluate(() => {
      const original = IDBObjectStore.prototype.put;
      let failed = false;
      IDBObjectStore.prototype.put = function (value, ...args) {
        if (!failed && value.local_imports?.length) {
          failed = true;
          throw new DOMException("fictional full disk", "QuotaExceededError");
        }
        return original.call(this, value, ...args);
      };
    });
    await page
      .getByRole("button", { name: "この端末に登録", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "空き容量が足りず保存できません",
    );
    await page
      .getByRole("button", { name: "この端末に登録", exact: true })
      .click();
    await expect(
      page.getByText("この端末に登録しました", { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("offline-status")).toHaveText(
      "オフライン利用可能 · 2問",
    );
    await input.setInputFiles({
      name: "wrong.json",
      mimeType: "application/json",
      buffer: Buffer.from("<html>not a result</html>"),
    });
    await expect(page.getByRole("alert")).toContainText(
      "JSONを読み取れません",
      { timeout: 90000 },
    );
    await expect(page.getByTestId("offline-status")).toHaveText(
      "オフライン利用可能 · 2問",
    );
    await page.getByRole("button", { name: "今すぐ学ぶ", exact: true }).click();
    await expect(page.getByTestId("real-hand")).toBeVisible();
    await expect(page.getByTestId("study-comparison")).toHaveCount(0);
    await page.locator(".concealed-hand").first().click();
    await expect(page.locator(".concealed-hand").first()).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.locator(".concealed-hand").first().click();
    await page.getByTestId("real-hand").getByRole("button").first().click();
    await page.getByRole("button", { name: "回答する", exact: true }).click();
    await expect(page.getByTestId("study-comparison")).toBeVisible();
    await expect(page.locator(".comparison-policy")).toHaveCount(3);
    await expect(page.locator(".comparison-policy")).toHaveText([
      /^\d+\.\d%$/,
      /^\d+\.\d%$/,
      /^\d+\.\d%$/,
    ]);
    // Returning to the app refreshes the nested workspace session offline.
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByRole("button", { name: "理解した", exact: true })).toBeEnabled();
    await expect(page.locator(".comparison-policy")).toHaveText([
      /^\d+\.\d%$/, /^\d+\.\d%$/, /^\d+\.\d%$/,
    ]);
    await page.getByRole("button", { name: "理解した", exact: true }).click();
    await page.reload();
    await page
      .getByRole("button", { name: "復習を再開する", exact: false })
      .click();
    await expect(page.getByTestId("real-hand")).toBeVisible();
    await page
      .getByRole("button", { name: "中断してホームへ", exact: true })
      .click();
    await page.getByText("端末の管理", { exact: true }).click();
    const downloadEvent = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "記録をファイルに保存", exact: true })
      .click();
    const download = await downloadEvent;
    const { readFileSync } = await import("node:fs");
    const backup = readFileSync((await download.path())!);
    const saved = JSON.parse(backup.toString());
    expect(saved.schema).toBe(2);
    expect(saved.events).toHaveLength(1);
    expect(saved.session.index).toBe(1);
    expect(saved.local_imports).toHaveLength(1);
    // A pre-reveal backup retains the original JSON but has no display cache.
    delete saved.pack.reveals;
    for (const entry of saved.local_imports) {
      delete entry.material.reveals;
      delete entry.material.policies;
    }
    // Empty generated device, with runtime cache retained. Real user data is never touched.
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const r = indexedDB.deleteDatabase("kyokuloop-phone-v1");
          r.onsuccess = () => resolve();
          r.onerror = () => reject(r.error);
        }),
    );
    await page.reload();
    await page.getByText("端末の管理", { exact: true }).click();
    await expect(page.getByTestId("compiler-ready")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "端末だけで使う準備", exact: true }),
    ).toBeVisible();
    const tampered = structuredClone(saved);
    tampered.local_imports[0].material.items[0].scene.actual = "9s";
    await page
      .getByLabel("記録ファイルから復旧", { exact: true })
      .setInputFiles({
        name: "changed.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(tampered)),
      });
    await expect(page.getByRole("alert")).toContainText(
      "この端末記録ファイルは読み取れません",
      { timeout: 90000 },
    );
    await page
      .getByLabel("記録ファイルから復旧", { exact: true })
      .setInputFiles({
        name: "records.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(saved)),
      });
    await expect(page.getByTestId("offline-status")).toHaveText(
      "オフライン利用可能 · 2問",
      { timeout: 90000 },
    );
    await page
      .getByRole("button", { name: "復習を再開する", exact: false })
      .click();
    await expect(page.getByTestId("real-hand")).toBeVisible();
    // Recompile retained originals through the cached Worker while offline.
    await page.locator(".concealed-hand").first().click();
    await expect(page.locator(".concealed-hand").first()).toHaveAttribute(
      "aria-pressed",
      "true",
      { timeout: 90000 },
    );
    await expect(page.locator(".concealed-hand .tile-art")).not.toHaveCount(0);
    await page
      .getByRole("button", { name: "中断してホームへ", exact: true })
      .click();
    connected = true;
    await context.setOffline(false);
    await expect
      .poll(
        () =>
          backend({ action: "state" }).data.items.reduce(
            (n: number, i: any) => n + i.review_count,
            0,
          ),
        { timeout: 90000, intervals: [1000, 3000] },
      )
      .toBe(1);
    await expect(
      page.getByText("結果 未同期 1件", { exact: true }),
    ).toHaveCount(0, { timeout: 45000 });
    await expect(
      page.getByText("回答 未送信 1件", { exact: true }),
    ).toHaveCount(0, { timeout: 45000 });
    expect(lostAck).toBe(true);
    expect(backend({ action: "state" }).data.reports).toHaveLength(1);
    expect(backend({ action: "state" }).data.items).toHaveLength(2);
  } finally {
    if (!folder.startsWith(resolve("D:/dev-data/kyoku-loop/private")))
      throw Error("invalid fixture directory");
    rmSync(folder, { recursive: true, force: true });
  }
});

test("a concurrent import survives pack replacement while a changed answer rejects an old reply", () => {
  // Upgrade a legacy Windows pack with a pending answer and an active session.
  const oldItem = structuredClone(expected.items[0]);
  let legacy = phoneReduce(freshPhoneState("legacy"), {
    action: "install_pack",
    pack: {
      schema: 1,
      policy: 2,
      source: "existing-windows",
      exported_at: created,
      items: [oldItem],
      histories: {
        [oldItem.id]: {
          id: oldItem.id,
          scene: oldItem.scene,
          events: [],
          legacy_history: [],
        },
      },
    },
  }).state;
  let oldSession = phoneReduce(legacy, {
    action: "study_start",
    mode: "practice",
  });
  const oldQuestion = oldSession.data as any;
  legacy = phoneReduce(oldSession.state, {
    action: "study_choice",
    session: oldQuestion.id,
    choice: "choose",
    answer: oldQuestion.scene.own_hand[0],
  }).state;
  legacy = phoneReduce(legacy, {
    action: "study_choice",
    session: oldQuestion.id,
    choice: "confirm",
  }).state;
  legacy = phoneReduce(legacy, {
    action: "study_rate",
    session: oldQuestion.id,
    item: oldQuestion.item_id,
    rating: "理解した",
    event: "legacy-answer",
  }).state;
  legacy = phoneReduce(legacy, {
    action: "study_start",
    mode: "practice",
  }).state;
  const original = structuredClone(legacy);
  legacy = phoneReduce(legacy, { action: "enable_local" }).state;
  legacy = phoneReduce(legacy, {
    action: "register_local",
    material: expected,
    analysis_id: null,
  }).state;
  expect(legacy.events).toEqual(original.events);
  expect(legacy.session).toEqual(original.session);
  expect(legacy.pack!.items[0]).toEqual(original.pack!.items[0]);
  expect(legacy.pack!.source).toBe("existing-windows");
  expect(legacy.pack!.items).toHaveLength(2);
  validatePhoneBackup(legacy);
  let state = phoneReduce(freshPhoneState("fictional-concurrent"), {
    action: "enable_local",
  }).state;
  state = phoneReduce(state, {
    action: "register_local",
    material: expected,
    analysis_id: null,
  }).state;
  state = phoneReduce(state, {
    action: "bind_source",
    source: "fictional-windows",
  }).state;
  const snapshot = syncPayload(state);
  const reply = {
    protocol: 1,
    source: snapshot.source,
    device: snapshot.device,
    receipts: [],
    pack: {
      ...structuredClone(state.pack!),
      items: [],
      histories: {},
      reveals: {},
    },
  };
  const next = phoneReduce(state, {
    action: "apply_sync",
    snapshot,
    reply,
  }).state;
  expect(next.pack!.items).toEqual(state.pack!.items);
  const q = phoneReduce(next, { action: "study_start", mode: "practice" });
  const session = q.data as any;
  let newer = phoneReduce(q.state, {
    action: "study_choice",
    session: session.id,
    choice: "choose",
    answer: session.scene.own_hand[0],
  }).state;
  newer = phoneReduce(newer, {
    action: "study_choice",
    session: session.id,
    choice: "confirm",
  }).state;
  newer = phoneReduce(newer, {
    action: "study_rate",
    session: session.id,
    item: session.item_id,
    rating: "理解した",
    event: "new-answer",
  }).state;
  expect(() =>
    phoneReduce(newer, { action: "apply_sync", snapshot, reply }),
  ).toThrow("sync_changed");
  expect(newer.events).toHaveLength(1);
});
