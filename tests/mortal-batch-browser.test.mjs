import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { chromium } from "playwright";

const SITE = "https://mortal-fixture.invalid",
  APP = "http://kyoku-fixture.invalid";
const player = 123,
  actor = 1358437 + ((7 * player + 1117113) ^ 86216345);
const source = (n) =>
  `https://game.mahjongsoul.com/?paipu=261104-fictional-batch-${n}_a${actor}`;
const id = (n) => source(n).split("paipu=")[1];
const task = (n) => n.toString(16).padStart(16, "0");
const resultURL = (n) => `${SITE}/killerducky/?data=/report/${task(n)}.json`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(read, check, label) {
  const end = Date.now() + 30000;
  let value;
  while (Date.now() < end) {
    value = await read();
    if (check(value)) return value;
    await wait(150);
  }
  throw Error(label + ": " + JSON.stringify(value));
}
const form = `<!doctype html><meta charset="utf-8"><form action="/review" method="post"><input type="radio" name="input-method" value="log-url" checked><input type="url" name="log-url" required><select name="engine"><option value="mortal">Mortal</option></select><select name="mortal-model-tag"><option>4.1b</option></select><select name="player-id"><option value="">自動</option></select><select name="ui"><option value="killerducky">Killerducky</option></select><input type="number" name="temperature" value="1.5"><input name="kyokus"><input type="checkbox" name="show-rating" checked><button type="submit">送信</button></form><script>document.querySelector('[name="log-url"]').value=new URL(location.href).searchParams.get('url')</script>`;

async function fixture(label, lostACK = false) {
  const root = resolve(".local/mortal-batch-test/" + Date.now() + "-" + label),
    ext = join(root, "extension"),
    downloads = join(root, "downloads"),
    profile = join(root, "profile");
  const privateDir = `D:/dev-data/kyoku-loop/private/mortal-batch-20261104/tests/${Date.now()}-${label}`;
  await mkdir(ext, { recursive: true });
  await mkdir(downloads, { recursive: true });
  await mkdir(join(profile, "Default"), { recursive: true });
  await mkdir(privateDir, { recursive: true });
  const env = {
    ...process.env,
    PYTHONUTF8: "1",
    KYOKULOOP_DB: privateDir + "/test.sqlite3",
  };
  const python = (code) =>
    execFileSync("python", ["-c", code], {
      encoding: "utf8",
      env,
      windowsHide: true,
    });
  const reports = JSON.parse(
    python(
      `import sys,json;sys.path.insert(0,'tests');from test_p8_mortal import mortal_fixture\na=mortal_fixture();b=mortal_fixture(True)\nfor r in [a,b]:r['review']['model_tag']='4.1b'\nprint(json.dumps([a,b]))`,
    ),
  );
  python(
    `import sys,json,os;sys.path.insert(0,'tests');from test_p0_verify import fixture;from tools.p2_store import Store\ns=Store(os.environ['KYOKULOOP_DB']);p=s.stage(json.dumps(fixture()).encode(),None);s.commit(p['token'],0,0,None);a=s.study_start('practice');s.study_choice(a['id'],'5pr','choose');s.study_choice(a['id'],None,'confirm');s.study_rate(a['id'],s.state()['items'][0]['id'],'再復習','fictional-old-answer');s.study_start('practice')\nfor u in ${JSON.stringify([source(1), source(2)])}:s.analysis_add(u)\ns.close()`,
  );
  // One source carries real-shaped history metadata, the other has only a URL.
  // Exercise the app bridge's score/rank/target check as well as URL-only import.
  const history = {
    at: "2026-11-04T09:00:00+09:00",
    rank: 1,
    seat: 0,
    mode: 12,
    player,
    url: source(1),
    players: [0, 1, 2, 3].map((n) => ({ name: `架空${n}`, score: 25000 })),
  };
  python(
    `from tools.p2_store import Store;import os;s=Store(os.environ['KYOKULOOP_DB']);s._receive_analysis_history({'id':${JSON.stringify(id(1))},'history':${JSON.stringify(history)}});s.db.commit();s.close()`,
  );
  const prior = python(
    `import sqlite3,json,os;c=sqlite3.connect(os.environ['KYOKULOOP_DB']);print(json.dumps({t:c.execute('select * from '+t+' order by rowid').fetchall() for t in ['study_items','review_events','study_sessions']}))`,
  );
  const api = (body) =>
    JSON.parse(
      execFileSync("python", ["tools/p2_store.py"], {
        input: JSON.stringify(body),
        encoding: "utf8",
        env,
        windowsHide: true,
        maxBuffer: 5 * 1024 * 1024,
      }),
    );
  for (const name of await readdir("extensions/mortal-helper"))
    await writeFile(
      join(ext, name),
      (await readFile("extensions/mortal-helper/" + name, "utf8"))
        .replaceAll("https://mjai.ekyu.moe", SITE)
        .replaceAll("http://127.0.0.1:1460", APP),
    );
  await writeFile(
    join(profile, "Default/Preferences"),
    JSON.stringify({
      download: { default_directory: downloads, prompt_for_download: false },
    }),
  );
  const launchOptions = {
    channel: "chromium",
    headless: true,
    acceptDownloads: true,
    downloadsPath: downloads,
    args: [
      `--load-extension=${ext}`,
      `--disable-extensions-except=${ext}`,
      "--host-resolver-rules=MAP mortal-fixture.invalid ~NOTFOUND, MAP kyoku-fixture.invalid ~NOTFOUND",
    ],
  };
  let context = await chromium.launchPersistentContext(profile, launchOptions);
  try {
    let worker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent("serviceworker"));
    const extensionId = await worker.evaluate(() => chrome.runtime.id);
    const calls = { posts: [], reads: [], api: [] };
    let drop = lostACK;
    const routeHandler = async (route) => {
      const req = route.request(),
        u = new URL(req.url());
      if (u.protocol === "chrome-extension:" && u.host === extensionId)
        return route.continue();
      if (u.origin === APP) {
        if (u.pathname === "/")
          return route.fulfill({
            contentType: "text/html",
            body: '<meta charset="utf-8"><title>架空のKyokuLoop</title><h1>KyokuLoop</h1><input id="unsaved" value="保持する未保存入力">',
          });
        if (u.pathname === "/api/local") {
          const headers = await req.allHeaders();
          assert.equal(headers.origin, APP);
          assert.notEqual(headers["sec-fetch-site"], "cross-site");
          const body = JSON.parse(req.postData());
          calls.api.push(body.action);
          assert.ok(["state", "inspect", "commit"].includes(body.action));
          assert.equal(body.url, undefined);
          const response = api(body);
          if (body.action === "commit" && drop) {
            drop = false;
            return route.abort();
          }
          return route.fulfill({
            contentType: "application/json",
            body: JSON.stringify(response),
          });
        }
      }
      if (u.origin === SITE) {
        if (u.pathname === "/ja.html")
          return route.fulfill({ contentType: "text/html", body: form });
        if (u.pathname === "/review") {
          const body = new URLSearchParams(req.postData()),
            n = [1, 2].find((n) => source(n) === body.get("log-url"));
          assert.ok(n);
          assert.equal(body.get("temperature"), "");
          assert.equal(body.get("show-rating"), null);
          assert.equal(body.get("player-id"), "");
          assert.equal(body.get("mortal-model-tag"), "4.1b");
          assert.equal(body.get("ui"), "killerducky");
          calls.posts.push(n);
          return route.fulfill({
            contentType: "text/html",
            body: `<script>location.replace(${JSON.stringify(SITE + "/progress?task=" + task(n))})</script>`,
          });
        }
        if (u.pathname === "/progress") {
          const n = Number.parseInt(u.searchParams.get("task"), 16);
          return route.fulfill({
            contentType: "text/html",
            body: `<p>解析中</p><script>setTimeout(()=>location.replace(${JSON.stringify(resultURL(n))}),100)</script>`,
          });
        }
        if (u.pathname === "/killerducky/")
          return route.fulfill({
            contentType: "text/html",
            body: '<button class="info-round">東1局</button>',
          });
        if (/^\/report\/[a-f0-9]{16}\.json$/.test(u.pathname)) {
          const n = Number.parseInt(u.pathname.match(/[a-f0-9]{16}/)[0], 16);
          calls.reads.push(n);
          return route.fulfill({
            contentType: "application/json",
            body: JSON.stringify(reports[n - 1]),
          });
        }
      }
      return route.abort();
    };
    await context.route("**/*", routeHandler);
    await worker.evaluate(
      ({ site, reports }) => {
        const download = chrome.downloads.download.bind(chrome.downloads),
          search = chrome.downloads.search.bind(chrome.downloads),
          urls = new Map();
        chrome.downloads.download = async (options) => {
          if (options.url.startsWith(site + "/report/")) {
            const n = Number.parseInt(options.url.match(/[a-f0-9]{16}/)[0], 16);
            const id = await download({
              ...options,
              url:
                "data:application/json;charset=utf-8," +
                encodeURIComponent(JSON.stringify(reports[n - 1])),
            });
            urls.set(id, options.url);
            return id;
          }
          return download(options);
        };
        chrome.downloads.search = async (query) =>
          (await search(query)).map((i) =>
            urls.has(i.id)
              ? { ...i, url: urls.get(i.id), finalUrl: urls.get(i.id) }
              : i,
          );
      },
      { site: SITE, reports },
    );
    const appPage = await context.newPage();
    await appPage.goto(APP + "/");
    // Playwright cannot intercept the initial navigation of a tab created by the
    // extension API. Pre-attach a blank tab; keep all subsequent navigation real.
    const mortalPage = await context.newPage();
    await mortalPage.goto(SITE + "/ja.html");
    const mortalTabId = await worker.evaluate(
      async (site) =>
        (await chrome.tabs.query({})).find((t) => t.url?.startsWith(site)).id,
      SITE,
    );
    await worker.evaluate(
      ({ site, tabId }) => {
        const create = chrome.tabs.create.bind(chrome.tabs);
        chrome.tabs.create = (options) =>
          options.url?.startsWith(site + "/")
            ? chrome.tabs.update(tabId, options)
            : create(options);
      },
      { site: SITE, tabId: mortalTabId },
    );
    let appTabId = await worker.evaluate(
      async (url) =>
        (await chrome.tabs.query({})).find((t) => t.url === url).id,
      APP + "/",
    );
    let popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    const message = async (body) => {
      await worker.evaluate(
        (id) => chrome.tabs.update(id, { active: true }),
        appTabId,
      );
      return popup.evaluate((body) => chrome.runtime.sendMessage(body), body);
    };
    const state = () =>
      worker.evaluate(
        async () =>
          (await chrome.storage.local.get("state")).state || { jobs: [] },
      );
    return {
      get context() {
        return context;
      },
      calls,
      appPage,
      popup,
      message,
      state,
      root,
      api,
      prior,
      python,
      async speedCooldown() {
        await worker.evaluate(() => {
          const original = Date.now;
          Date.now = () => original() + 31000;
        });
        await message({ type: "STATUS" });
      },
      async reload() {
        // Command-line unpacked extensions in this Chromium build cannot reload
        // through runtime.reload. Restart the browser with the identical profile
        // and extension path, exercising actual durable state and IndexedDB.
        await context.close();
        context = await chromium.launchPersistentContext(
          profile,
          launchOptions,
        );
        await context.route("**/*", routeHandler);
        worker =
          context.serviceWorkers()[0] ||
          (await context.waitForEvent("serviceworker"));
        const reopenedApp = await context.newPage();
        await reopenedApp.goto(APP + "/");
        appTabId = await worker.evaluate(
          async (url) =>
            (await chrome.tabs.query({})).find((t) => t.url === url).id,
          APP + "/",
        );
        popup = await context.newPage();
        await popup.goto(`chrome-extension://${extensionId}/popup.html`);
        assert.equal(
          await worker.evaluate(() => chrome.runtime.id),
          extensionId,
        );
      },
    };
  } catch (error) {
    await context.close();
    throw error;
  }
}

test(
  "two fictional games run sequentially through actual parser/SQLite and preserve prior study",
  { timeout: 150000 },
  async () => {
    const f = await fixture("two");
    try {
      await f.popup.locator("#batch-load").click();
      await until(
        () => f.popup.locator("#batch-list input").count(),
        (n) => n === 2,
        "queue controls",
      );
      assert.equal(
        await f.popup.locator("#batch-list input:checked").count(),
        0,
      );
      for (const input of await f.popup.locator("#batch-list input").all())
        await input.check();
      assert.equal(
        await f.popup.locator("#batch-start").innerText(),
        "選択した2件を解析・登録",
      );
      await f.popup
        .locator("body")
        .screenshot({ path: join(f.root, "popup-selected.png") });
      await f.popup.locator("#batch-start").click();
      await until(
        f.state,
        (s) => s.batch?.index === 1 || s.batch?.phase === "paused",
        "first registration",
      );
      assert.equal(
        (await f.state()).batch.phase,
        "running",
        JSON.stringify(await f.state()),
      );
      assert.deepEqual(f.calls.posts, [1]);
      await f.speedCooldown();
      const finished = await until(
        f.state,
        (s) => s.batch?.phase === "done" || s.batch?.phase === "paused",
        "second registration",
      );
      assert.equal(finished.batch.phase, "done", JSON.stringify(finished));
      assert.deepEqual(f.calls.posts, [1, 2]);
      assert.deepEqual(f.calls.reads, [1, 2]);
      const stored = f.api({ action: "state" });
      assert.ok(stored.ok);
      assert.ok(
        stored.data.analysis_queue.every((e) => e.reports.length === 1),
      );
      const after = JSON.parse(
        f.python(
          `import sqlite3,json,os;c=sqlite3.connect(os.environ['KYOKULOOP_DB']);print(json.dumps({t:c.execute('select * from '+t+' order by rowid').fetchall() for t in ['study_items','review_events','study_sessions']}))`,
        ),
      );
      for (const [table, rows] of Object.entries(JSON.parse(f.prior)))
        for (const row of rows)
          assert.ok(
            after[table].some((r) => JSON.stringify(r) === JSON.stringify(row)),
            table,
          );
      assert.equal(
        await f.appPage.locator("#unsaved").inputValue(),
        "保持する未保存入力",
      );
      await writeFile(
        join(f.root, "summary.json"),
        JSON.stringify({
          posts: f.calls.posts,
          reads: f.calls.reads,
          registered: 2,
          oldStudyRetained: true,
          actualSiteRequests: 0,
          liveDBWrites: 0,
        }),
      );
      console.log("ARTIFACTS " + f.root);
    } finally {
      await f.context.close();
    }
  },
);
test(
  "lost commit ACK plus browser restart retries only retained local registration",
  { timeout: 150000 },
  async () => {
    const f = await fixture("lost-ack", true);
    try {
      await f.message({ type: "BATCH_START", ids: [id(1)], model: "4.1b" });
      await until(f.state, (s) => s.batch?.phase === "paused", "lost receipt");
      assert.deepEqual(f.calls.posts, [1]);
      assert.deepEqual(f.calls.reads, [1]);
      await f.popup.evaluate(() => {
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            writeText: async (text) => {
              window.copiedDiagnostic = {
                text,
                active: navigator.userActivation.isActive,
              };
            },
          },
        });
      });
      await f.popup.locator("#copy-diagnostics").click();
      const copied = await until(
        () => f.popup.evaluate(() => window.copiedDiagnostic),
        (v) => !!v,
        "copied diagnostics",
      );
      assert.equal(copied.active, true);
      for (const text of [
        "登録 0件 ／ 全1件",
        "[local_unavailable]",
        id(1),
        task(1),
        "保持JSON：あり",
      ])
        assert.ok(copied.text.includes(text), text);
      await f.popup
        .locator("body")
        .screenshot({ path: join(f.root, "popup-diagnostics.png") });
      await f.popup.evaluate(() => {
        navigator.clipboard.writeText = async () => {
          throw Error("fixture denied");
        };
      });
      await f.popup.locator("#copy-diagnostics").click();
      await f.popup.locator("#diagnostics-text").waitFor({ state: "visible" });
      assert.equal(
        await f.popup.locator("#diagnostics-text").inputValue(),
        copied.text,
      );
      assert.equal(
        await f.popup
          .locator("#diagnostics-text")
          .evaluate(
            (e) => e.selectionEnd - e.selectionStart === e.value.length,
          ),
        true,
      );
      await f.reload();
      const resumed = await f.message({ type: "BATCH_RESUME" });
      assert.equal(resumed.ok, true, JSON.stringify(resumed));
      const finished = await until(
        f.state,
        (s) => s.batch?.phase === "done",
        "resumed receipt",
      );
      assert.equal(finished.batch.items[0].result.duplicate, true);
      assert.deepEqual(f.calls.posts, [1]);
      assert.deepEqual(f.calls.reads, [1]);
      assert.equal(f.calls.api.filter((a) => a === "commit").length, 2);
      console.log("ARTIFACTS " + f.root);
    } finally {
      await f.context.close();
    }
  },
);
