import { expect, type Page } from "@playwright/test";
import { test } from "./static-app";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import {
  freshPhoneState,
  phoneReduce,
  type PhoneState,
} from "../src/offline/engine";
import { phoneFixture } from "./phone-fixture";

test.use({ serviceWorkers: "block" });
const raw = execFileSync(
  "python",
  [
    "-c",
    "import sys,json;sys.path.insert(0,'tests');from test_p8_mortal import mortal_fixture;print(json.dumps(mortal_fixture()))",
  ],
  { encoding: "utf8", windowsHide: true },
);
const player = 123,
  actor = 1358437 + ((7 * player + 1117113) ^ 86216345);
const url = `https://game.mahjongsoul.com/?paipu=260101-fictional-management_a${actor}`;
const history = JSON.stringify({
  kind: "kyokuloop-history",
  version: 1,
  player,
  entries: [
    {
      url,
      at: "2026-01-01T00:00:00Z",
      seat: 0,
      mode: 12,
      rank: 1,
      players: [0, 1, 2, 3].map((i) => ({ name: `架空${i}`, score: 25000 })),
    },
  ],
});
async function seedPhone(page: Page, state: PhoneState) {
  await page.evaluate(
    (state) =>
      new Promise<void>((done, fail) => {
        const r = indexedDB.open("kyokuloop-phone-v1", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("local");
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
}

test("unique preview default registers and links the replay without manually choosing a source", async ({
  page,
}) => {
  test.setTimeout(120000);
  const folder = mkdtempSync(
    join(resolve("D:/dev-data/kyoku-loop/private"), "default-source-ui-"),
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
  let registeredAutomatically = false;
  try {
    expect(call({ action: "analysis_bulk", data: history }).ok).toBe(true);
    await page.route("**/phone/api", (route) => {
      const body = route.request().postDataJSON();
      return route.fulfill({
        json:
          body.action === "analysis_sync"
            ? call(body)
            : body.action === "sync"
              ? call({ action: "phone_sync", payload: body.payload })
              : call({ action: "offline_pack" }),
      });
    });
    await page.route("**/phone/mortal", (route) => {
      const body = route.request().postDataJSON();
      if (body.action === "register") {
        // Preserve automatic conflict protection instead of silently turning a default into a manual override.
        expect(body.analysis_id).toBeNull();
        registeredAutomatically = true;
      }
      return route.fulfill({
        json: call({
          ...body,
          action:
            body.action === "inspect"
              ? "phone_mortal_inspect"
              : "phone_mortal_register",
        }),
      });
    });
    await page.goto("/phone/");
    const state = phoneReduce(freshPhoneState("default-source-ui"), {
      action: "install_pack",
      pack: call({ action: "offline_pack" }).data,
    }).state;
    state.analysis_queue = call({ action: "state" }).data.analysis_queue.map(
      (e: object) => ({ ...e, received: "2026-11-04T00:00:00Z" }),
    );
    await seedPhone(page, state);
    await page.reload();
    await page
      .getByRole("navigation", { name: "メイン" })
      .getByRole("button", { name: "牌譜", exact: true })
      .click();
    await page.getByText("解析結果を追加", { exact: true }).click();
    await page
      .getByLabel("Mortal JSON / JSON.gz", { exact: true })
      .setInputFiles({
        name: "fictional-default.json",
        mimeType: "application/json",
        buffer: Buffer.from(raw),
      });
    await expect(
      page.getByRole("combobox", { name: "元牌譜（任意）", exact: true }),
    ).toHaveValue(url.split("paipu=")[1]);
    await expect(
      page.getByRole("status").filter({ hasText: "紐付け先（自動選択）" }),
    ).toContainText("25,000点");
    await page
      .getByRole("button", { name: "Windowsに登録", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Windowsに登録しました" }),
    ).toContainText("元牌譜に紐付け済み");
    expect(registeredAutomatically).toBe(true);
    const saved = call({ action: "state" }).data;
    expect(saved.reports).toHaveLength(1);
    expect(saved.analysis_queue[0].reports).toEqual([saved.reports[0].id]);
    expect(saved.reports[0].source_linked).toBe(true);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

for (const surface of ["desktop", "phone"])
  test(`${surface}: multiple JSONs auto-link, keep successes across retry and delete selection only`, async ({
    page,
  }, info) => {
    test.setTimeout(180000);
    const folder = mkdtempSync(
      join(resolve("D:/dev-data/kyoku-loop/private"), "replay-management-ui-"),
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
    try {
      expect(call({ action: "analysis_bulk", data: history }).ok).toBe(true);
      for (const n of [2, 3])
        expect(
          call({
            action: "analysis_add",
            url: url.replace("management", `management-${n}`),
          }).ok,
        ).toBe(true);
      await page.route("**/api/local", (route) =>
        route.fulfill({ json: call(route.request().postDataJSON()) }),
      );
      await page.route("**/phone/api", (route) => {
        const body = route.request().postDataJSON();
        return route.fulfill({
          json:
            body.action === "analysis_sync"
              ? call(body)
              : body.action === "sync"
                ? call({ action: "phone_sync", payload: body.payload })
                : call({ action: "offline_pack" }),
        });
      });
      await page.route("**/phone/mortal", (route) => {
        const body = route.request().postDataJSON();
        return route.fulfill({
          json: call({
            ...body,
            action:
              body.action === "inspect"
                ? "phone_mortal_inspect"
                : "phone_mortal_register",
          }),
        });
      });
      await page.goto(surface === "desktop" ? "/" : "/phone/");
      if (surface === "phone") {
        await seedPhone(
          page,
          phoneReduce(freshPhoneState("remote-batch"), {
            action: "install_pack",
            pack: call({ action: "offline_pack" }).data,
          }).state,
        );
        await page.reload();
        await page
          .getByRole("navigation", { name: "メイン" })
          .getByRole("button", { name: "牌譜", exact: true })
          .click();
        await page.getByText("解析結果を追加", { exact: true }).click();
      } else {
        await page.getByRole("button", { name: "牌譜", exact: true }).click();
        await page.getByText("解析結果を追加", { exact: true }).click();
      }
      await page
        .locator(".phone-result-import input[type=file]")
        .setInputFiles([
          {
            name: "result.json",
            mimeType: "application/json",
            buffer: Buffer.from(raw),
          },
          {
            name: "duplicate.json.gz",
            mimeType: "application/gzip",
            buffer: gzipSync(raw),
          },
          {
            name: "invalid.json",
            mimeType: "application/json",
            buffer: Buffer.from("invalid"),
          },
        ]);
      await page
        .getByRole("button", { name: "選択した3件をまとめて登録", exact: true })
        .click();
      const results = page.getByRole("list", { name: "一括追加の結果" });
      await expect(results).toContainText("元牌譜に紐付け済み", {
        timeout: 60000,
      });
      await expect(results).toContainText("登録済み（重複）");
      await expect(results).toContainText("JSONを読み取れません");
      const before = call({ action: "state" }).data;
      expect(before.reports).toHaveLength(1);
      expect(before.analysis_queue[0].reports).toEqual([before.reports[0].id]);
      await page
        .getByRole("button", { name: "失敗したファイルを再試行", exact: true })
        .click();
      await expect(
        page.getByRole("button", {
          name: "失敗したファイルを再試行",
          exact: true,
        }),
      ).toBeEnabled({ timeout: 60000 });
      expect(call({ action: "state" }).data.items).toEqual(before.items);
      if (surface === "desktop")
        await page.getByRole("button", { name: "閉じる", exact: true }).click();
      else {
        // Seed a generated local queue/pack to verify the actual offline deletion UI.
        let state = phoneReduce(freshPhoneState("delete-ui"), {
          action: "install_pack",
          pack: phoneFixture(),
        }).state;
        state.analysis_queue = before.analysis_queue;
        await page.evaluate(
          (state) =>
            new Promise<void>((done, fail) => {
              const r = indexedDB.open("kyokuloop-phone-v1", 1);
              r.onupgradeneeded = () => r.result.createObjectStore("local");
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
        await page.addInitScript(() =>
          Object.defineProperty(navigator, "onLine", { get: () => false }),
        );
        await page.reload();
        await page
          .getByRole("navigation", { name: "メイン" })
          .getByRole("button", { name: "牌譜", exact: true })
          .click();
      }
      await page.getByRole("checkbox", { name: "全選択", exact: true }).check();
      await page
        .getByTestId("analysis-row")
        .locator('input[type="checkbox"]')
        .last()
        .uncheck();
      await page.screenshot({
        path: info.outputPath(`${surface}-selected.png`),
        fullPage: true,
      });
      page.once("dialog", (d) => d.dismiss());
      await page
        .getByRole("button", { name: "選択した2件を削除", exact: true })
        .click();
      await expect(page.getByTestId("analysis-row")).toHaveCount(3);
      page.once("dialog", (d) => d.accept());
      await page
        .getByRole("button", { name: "選択した2件を削除", exact: true })
        .click();
      await expect(page.getByTestId("analysis-row")).toHaveCount(1);
      await page.reload();
      if (surface === "phone")
        await page
          .getByRole("navigation", { name: "メイン" })
          .getByRole("button", { name: "牌譜", exact: true })
          .click();
      await expect(page.getByTestId("analysis-row")).toHaveCount(1);
      const after = call({ action: "state" }).data;
      expect(after.reports).toEqual(before.reports);
      expect(after.items).toEqual(before.items);
      await page.screenshot({
        path: info.outputPath(`${surface}-deleted.png`),
        fullPage: true,
      });
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
