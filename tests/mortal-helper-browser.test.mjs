import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";

const root = resolve(".local/mortal-helper-test/" + Date.now());
const fixture = "https://mortal-fixture.invalid";
const source =
  "https://game.mahjongsoul.com/?paipu=261104-fictional-helper_a123456";
const input = fixture + "/ja.html?url=" + encodeURIComponent(source);
const task = "0123456789abcdef";
const result = fixture + "/killerducky/?data=/report/" + task + ".json";
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, predicate, label) {
  const deadline = Date.now() + 15000;
  let value;
  while (Date.now() < deadline) {
    value = await fn();
    if (predicate(value)) return value;
    await pause(150);
  }
  throw Error(label + ": " + JSON.stringify(value));
}
const form = `<!doctype html><html lang="ja"><meta charset="utf-8"><title>架空のMortal入力</title><form action="/review" method="post">
<input type="radio" name="input-method" value="log-url" checked><label>牌譜URL<input type="url" name="log-url" required></label>
<input type="radio" name="input-method" value="riichi-city-log-id"><input type="text" name="riichi-city-log-id">
<select name="engine"><option value="mortal">Mortal</option><option value="akochan">akochan</option></select>
<select name="mortal-model-tag"><option>4.1b</option><option>3.0</option></select>
<select name="player-id"><option value="">自動</option><option value="0">東家</option></select>
<select name="ui"><option value="killerducky">Killerducky</option></select>
<input type="number" name="temperature" placeholder="0.1"><input name="kyokus"><input type="checkbox" name="show-rating">
<button type="submit" disabled>送信</button></form><script>document.querySelector('[name="log-url"]').value=new URL(location.href).searchParams.get('url');</script></html>`;

test(
  "isolated extension: readiness, form navigation, real file save, export and stop paths",
  { timeout: 120000 },
  async (t) => {
    const ext = join(root, "extension");
    const downloads = join(root, "downloads");
    const profile = join(root, "profile");
    await mkdir(ext, { recursive: true });
    await mkdir(downloads, { recursive: true });
    await mkdir(join(profile, "Default"), { recursive: true });
    for (const name of await readdir("extensions/mortal-helper")) {
      const text = await readFile("extensions/mortal-helper/" + name, "utf8");
      // Fail closed: the test extension has no production host permissions/URLs.
      await writeFile(
        join(ext, name),
        text.replaceAll("https://mjai.ekyu.moe", fixture),
      );
    }
    await writeFile(
      join(profile, "Default/Preferences"),
      JSON.stringify({
        download: { default_directory: downloads, prompt_for_download: false },
      }),
    );
    const context = await chromium.launchPersistentContext(profile, {
      channel: "chromium",
      headless: true,
      acceptDownloads: true,
      downloadsPath: downloads,
      args: [
        `--disable-extensions-except=${ext}`,
        `--load-extension=${ext}`,
        "--host-resolver-rules=MAP mortal-fixture.invalid ~NOTFOUND",
      ],
    });
    let posts = 0;
    let extensionId;
    const network = [];
    try {
      const worker =
        context.serviceWorkers()[0] ||
        (await context.waitForEvent("serviceworker"));
      extensionId = await worker.evaluate(() => chrome.runtime.id);
      await context.route("**/*", async (r) => {
        const u = new URL(r.request().url());
        if (u.protocol === "chrome-extension:" && u.host === extensionId) {
          await r.continue();
          return;
        }
        network.push({ path: u.pathname, method: r.request().method() });
        if (u.origin !== fixture) {
          await r.abort();
          return;
        }
        if (u.pathname === "/ja.html")
          await r.fulfill({ contentType: "text/html", body: form });
        else if (u.pathname === "/review") {
          posts++;
          await r.fulfill({
            contentType: "text/html",
            body: `<p>架空の受付</p><script>location.replace(${JSON.stringify(fixture + "/progress?task=" + task)})</script>`,
          });
        } else if (u.pathname === "/progress")
          await r.fulfill({
            contentType: "text/html",
            body: `<p>架空の解析中</p><script>setTimeout(()=>location.replace(${JSON.stringify(result)}),300)</script>`,
          });
        else if (u.pathname === "/killerducky/")
          await r.fulfill({
            contentType: "text/html",
            body: '<title>架空のMortal結果</title><button class="info-round">東1局</button>',
          });
        else await r.abort();
      });
      await worker.evaluate(() => {
        globalThis.testNavigation = [];
        chrome.webNavigation.onCommitted.addListener((d) =>
          globalThis.testNavigation.push({
            url: d.url,
            type: d.transitionType,
            qualifiers: d.transitionQualifiers,
          }),
        );
        chrome.webNavigation.onErrorOccurred.addListener((d) =>
          globalThis.testNavigation.push({ url: d.url, error: d.error }),
        );
        const originalDownload = chrome.downloads.download.bind(
          chrome.downloads,
        );
        const originalSearch = chrome.downloads.search.bind(chrome.downloads);
        const reports = new Map();
        // Only the external report transport is doubled. Browser saving, events,
        // MIME/size checks and the actual disk file still use chrome.downloads.
        chrome.downloads.download = async (options) => {
          if (
            options.url.startsWith("https://mortal-fixture.invalid/report/")
          ) {
            const id = await originalDownload({
              ...options,
              url:
                "data:application/json;charset=utf-8," +
                encodeURIComponent(
                  JSON.stringify({ engine: "Mortal", fictional: true }),
                ),
            });
            reports.set(id, options.url);
            return id;
          }
          return originalDownload(options);
        };
        chrome.downloads.search = async (query) =>
          (await originalSearch(query)).map((item) =>
            reports.has(item.id)
              ? {
                  ...item,
                  url: reports.get(item.id),
                  finalUrl: reports.get(item.id),
                }
              : item,
          );
      });
      const target = await context.newPage();
      await target.goto(input);
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/popup.html`);
      const targetId = await worker.evaluate(
        async (url) =>
          (await chrome.tabs.query({})).find((t) => t.url === url).id,
        input,
      );
      const selectTarget = () =>
        worker.evaluate(
          (id) => chrome.tabs.update(id, { active: true }),
          targetId,
        );
      const message = async (type) => {
        await selectTarget();
        return popup.evaluate(
          (type) => chrome.runtime.sendMessage({ type }),
          type,
        );
      };
      const state = () =>
        worker.evaluate(
          async () =>
            (await chrome.storage.local.get("state")).state || { jobs: [] },
        );
      const clear = () =>
        worker.evaluate(() =>
          chrome.storage.local.set({ state: { jobs: [] } }),
        );

      await t.test(
        "waits for enabled button, submits once and saves JSON bytes",
        async () => {
          const started = await message("START");
          assert.equal(started.ok, true, JSON.stringify(started));
          await pause(1100);
          assert.equal(posts, 0);
          assert.equal((await state()).jobs[0].phase, "waiting");
          await target.evaluate(() => {
            document.querySelector("button").disabled = false;
          });
          const data = await until(
            state,
            (x) => ["saved", "stopped"].includes(x.jobs[0]?.phase),
            "save result",
          );
          assert.equal(
            data.jobs[0].phase,
            "saved",
            JSON.stringify({
              reason: data.jobs[0].reason,
              network,
              navigation: await worker.evaluate(
                () => globalThis.testNavigation,
              ),
            }),
          );
          assert.equal(posts, 1);
          assert.equal(data.jobs[0].task, task);
          assert.equal(data.jobs[0].source, source);
          const bytes = await readFile(data.jobs[0].filename, "utf8");
          assert.deepEqual(JSON.parse(bytes), {
            engine: "Mortal",
            fictional: true,
          });
          await selectTarget();
          await popup.evaluate(async () =>
            (await import("./popup.js")).refresh(),
          );
          assert.match(
            await popup.locator("#notice").innerText(),
            /ファイルを保存しました/,
          );
          await popup.locator("#tools > summary").click();
          await popup.locator("#single > summary").click();
          await popup.locator("#notice").waitFor({ state: "visible" });
          await popup
            .locator("body")
            .screenshot({ path: join(root, "popup-saved.png") });
        },
      );
      await t.test(
        "exports the source/result correspondence as a separate text file",
        async () => {
          assert.equal((await message("EXPORT")).ok, true);
          const items = await until(
            () => worker.evaluate(() => chrome.downloads.search({})),
            (xs) =>
              xs.some((x) => x.state === "complete" && x.mime === "text/plain"),
            "correspondence download",
          );
          const item = items.find((x) => x.mime === "text/plain");
          const exported = JSON.parse(await readFile(item.filename, "utf8"));
          assert.equal(exported.jobs[0].source, source);
          assert.equal(exported.jobs[0].task, task);
        },
      );
      await t.test(
        "saved operation is not resubmitted when input is reopened",
        async () => {
          await target.goto(input);
          assert.equal((await message("START")).error, "already_attempted");
          assert.equal(posts, 1);
        },
      );
      await t.test("changed model stops before any POST", async () => {
        await clear();
        await target.goto(input);
        assert.equal((await message("START")).ok, true);
        await target.selectOption('[name="mortal-model-tag"]', "3.0");
        await until(
          state,
          (x) => x.jobs[0]?.phase === "stopped",
          "changed model",
        );
        assert.equal(posts, 1);
      });
      await t.test(
        "human confirmation and access restriction stop with no submission",
        async () => {
          for (const text of ["Verify you are human", "Access denied"]) {
            await clear();
            await target.goto(input);
            assert.equal((await message("START")).ok, true);
            await target.evaluate(
              (text) => document.body.append(document.createTextNode(text)),
              text,
            );
            const s = await until(
              state,
              (x) => x.jobs[0]?.phase === "stopped",
              "restriction",
            );
            assert.equal(
              s.jobs[0].reason,
              text.startsWith("Verify")
                ? "human_confirmation"
                : "access_restricted",
            );
          }
          assert.equal(posts, 1);
        },
      );
      await t.test(
        "unrelated typed result and cancellation never download or submit",
        async () => {
          await clear();
          await target.goto(input);
          assert.equal((await message("START")).ok, true);
          await target.goto(result.replace(task, "fedcba9876543210"));
          await until(
            state,
            (x) => x.jobs[0]?.phase === "stopped",
            "unrelated navigation",
          );
          await clear();
          await target.goto(input);
          await message("START");
          await message("CANCEL");
          await target.evaluate(() => {
            document.querySelector("button").disabled = false;
          });
          await pause(1000);
          assert.equal(posts, 1);
          assert.equal((await state()).jobs[0].reason, "cancelled");
        },
      );
      await t.test(
        "ambiguous forms, other input modes and alternate submit targets are refused",
        async () => {
          for (const kind of ["duplicate", "radio", "target", "engine"]) {
            await clear();
            await target.goto(input);
            await target.evaluate((kind) => {
              const form = document.querySelector("form");
              if (kind === "duplicate")
                form.append(form.querySelector('[name="log-url"]').cloneNode());
              if (kind === "radio") {
                const r = document.createElement("input");
                r.type = "radio";
                r.value = "json";
                r.checked = true;
                form.append(r);
              }
              if (kind === "target")
                form
                  .querySelector("button")
                  .setAttribute("formaction", "/other");
              if (kind === "engine")
                form.querySelector('[name="engine"]').value = "akochan";
            }, kind);
            assert.ok((await message("START")).error);
            assert.equal(posts, 1);
          }
        },
      );
      await writeFile(
        join(root, "summary.json"),
        JSON.stringify(
          {
            tests: 7,
            posts,
            transport:
              "reserved .invalid page routes and data-URL report double",
            realSiteRequests: 0,
            userDataWrites: 0,
          },
          null,
          2,
        ),
      );
      console.log("ARTIFACTS " + root);
    } finally {
      await context.close();
    }
  },
);
