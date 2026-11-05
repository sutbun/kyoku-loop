import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, extname, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { freshPhoneState, phoneReduce } from "../src/offline/engine";

test("retained original generates a full round offline in the shipped Worker and UI", async ({
  browser,
}) => {
  test.setTimeout(180000);
  const fixture = JSON.parse(
    execFileSync(
      "python",
      [
        "-c",
        `
import sys,json,base64
sys.path.insert(0,'tests')
from test_p13_shortcut_json import two_rounds
from tools.mortal_material import compile_upload,review_upload
encoded=base64.b64encode(json.dumps(two_rounds()).encode()).decode()
created='2026-01-01T00:00:00Z'
print(json.dumps(dict(material=compile_upload(encoded,created),review=review_upload(encoded,created,0))))
`,
      ],
      { encoding: "utf8", windowsHide: true },
    ),
  );
  const root = resolve("dist");
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method !== "GET") {
      res.writeHead(404);
      res.end();
      return;
    }
    const path = url.pathname.startsWith("/phone/assets/")
      ? url.pathname.slice(6)
      : url.pathname;
    const file = resolve(
      root,
      "." + (path === "/phone/" ? "/phone/index.html" : path),
    );
    if (!file.startsWith(root + sep) || !existsSync(file)) {
      res.writeHead(404);
      res.end();
      return;
    }
    const types: Record<string, string> = {
      ".html": "text/html",
      ".js": "text/javascript",
      ".mjs": "text/javascript",
      ".css": "text/css",
      ".json": "application/json",
      ".wasm": "application/wasm",
      ".webmanifest": "application/manifest+json",
      ".png": "image/png",
    };
    res.setHeader(
      "Content-Type",
      types[extname(file)] ?? "application/octet-stream",
    );
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    );
    res.end(readFileSync(file));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string")
    throw Error("fixture server missing");
  const context = await browser.newContext({ serviceWorkers: "allow" });
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${address.port}/phone/`);
    await page.getByRole("button", { name: "設定", exact: true }).click();
    await page
      .getByRole("button", { name: "端末だけで使う準備", exact: true })
      .click();
    await expect(page.getByTestId("compiler-ready")).toBeVisible({
      timeout: 120000,
    });
    let state = phoneReduce(freshPhoneState("round-worker"), {
      action: "enable_local",
    }).state;
    state = phoneReduce(state, {
      action: "register_local",
      material: fixture.material,
      analysis_id: null,
    }).state;
    await page.evaluate(
      (state) =>
        new Promise<void>((done, fail) => {
          const r = indexedDB.open("kyokuloop-phone-v1", 1);
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
    await context.setOffline(true);
    const file = readdirSync(resolve("dist/assets")).find((n) =>
      /^mortal-compiler\.worker-.*\.js$/.test(n),
    )!;
    const result = await page.evaluate(
      ({ file, material }) =>
        new Promise<any>((done, fail) => {
          const worker = new Worker("/phone/assets/" + file, {
            type: "module",
          });
          worker.onmessage = (e) => {
            worker.terminate();
            done(e.data);
          };
          worker.onerror = () => {
            worker.terminate();
            fail(Error("worker failure"));
          };
          worker.postMessage({
            id: 1,
            data: material.payload,
            created: material.created,
            review: true,
            round_index: 0,
          });
        }),
      { file, material: fixture.material },
    );
    expect(result.ok).toBe(true);
    expect(result.data).toEqual(fixture.review);
    await page.reload();
    await page.getByRole("button", { name: "牌譜", exact: true }).click();
    await page.getByText("解析結果から一局を選ぶ", { exact: true }).click();
    await page
      .getByRole("button", { name: "解析結果 1 · 一局レビュー", exact: true })
      .click();
    await expect(page.getByLabel("現在の手順")).toBeVisible({ timeout: 90000 });
    await page.getByRole("button", { name: "次の不一致", exact: true }).click();
    await expect(page.locator(".review-policy")).toHaveCount(3);
    await page
      .getByRole("button", { name: "☆ 場面を保存", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "保存欄を閉じる" })
      .click();
    await page.getByRole("button", { name: "牌譜に戻る", exact: true }).click();
    await page.reload();
    await page
      .getByRole("button", { name: "保存した場面", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toContainText(fixture.review.label);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await new Promise<void>((done) => server.close(() => done()));
  }
});
