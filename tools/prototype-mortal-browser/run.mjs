// THROWAWAY. Fixture page requests use only a reserved .invalid host.
// There is deliberately no live flag, HTTP fetch, real URL input or DB write.
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { resolve, dirname, basename, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { initial, step } from "./state.mjs";

const origin = "https://mortal-fixture.invalid";
const task = "0123456789abcdef"; // Fictional only.
const source = "https://game.mahjongsoul.com/?paipu=260101-fictional-browser_a123";
const scenarios = ["success", "denied_before_submit", "confirmation", "changed_markup", "denied_result", "invalid_result", "foreign_result"];
const python = (code, input) => JSON.parse(execFileSync("python", ["-c", code], {
  input: input && JSON.stringify(input), encoding: "utf8", windowsHide: true, stdio: ["pipe", "pipe", "ignore"],
  maxBuffer: 5 * 1024 * 1024,
}));
const fixture = python("import sys,json;sys.path.insert(0,'tests');from test_p8_mortal import mortal_fixture;print(json.dumps(mortal_fixture(True)))");
const formHTML = (duplicate) => `<!doctype html><meta charset="utf-8"><title>PROTOTYPE — fictional Mortal form</title>
<h1>PROTOTYPE — fictional Mortal form</h1><form method="post" action="/review">
<input type="radio" name="input-method" value="log-url" checked>
<input type="url" name="log-url" required>${duplicate ? '<input name="log-url">' : ''}
<select name="player-id"><option value="">自動</option></select>
<select name="engine"><option value="mortal">Mortal</option></select>
<select name="mortal-model-tag"><option value="4.1b">4.1b</option></select>
<select name="ui"><option value="killerducky">KillerDucky</option></select>
<select name="lang"><option value="ja">日本語</option></select>
<button type="submit">送信</button></form>
<form method="post" action="/dispatch-bot"><button>送信</button></form>`;

async function run(scenario) {
  let state = initial(), posts = 0, forbiddenPosts = 0, result, observed = [];
  const emit = event => { state = step(state, event); console.log(JSON.stringify({ scenario, ...state })); };
  const root = resolve("D:/dev-data/kyoku-loop/private");
  const profile = mkdtempSync(join(root, "mortal-prototype-"));
  const context = await chromium.launchPersistentContext(profile, { channel: "msedge", headless: true });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  let finish;
  const received = new Promise(resolve => { finish = resolve; });
  let reportURL;
  page.on("request", request => {
    if (request.url() === origin + "/review" && request.method() === "POST" && state.phase === "ready") emit({ type: "submit" });
  });
  page.on("framenavigated", frame => {
    if (frame !== page.mainFrame() || state.phase !== "submitted") return;
    const u = new URL(frame.url());
    const id = u.origin === origin && (u.pathname === "/progress" ? u.searchParams.get("task") : u.pathname === "/killerducky/" ? u.searchParams.get("data")?.match(/^\/report\/([a-f0-9]{16})\.json$/)?.[1] : null);
    if (id && /^[a-f0-9]{16}$/.test(id)) {
      reportURL = `${origin}/report/${id}.json`;
      emit({ type: "task" });
    }
  });
  page.on("response", async response => {
    if (response.url() !== reportURL) return;
    if ([401, 403, 429].includes(response.status())) return finish({ error: "access_restricted" });
    if (!response.ok()) return finish({ error: "result_failed" });
    try { finish({ body: await response.body() }); } catch { finish({ error: "result_failed" }); }
  });
  await context.route("**/*", async route => {
    const request = route.request(), u = new URL(request.url());
    observed.push({ path: u.pathname, method: request.method() });
    if (request.method() === "POST" && u.pathname !== "/review") forbiddenPosts++;
    if (u.origin !== origin) return route.abort();
    if (u.pathname === "/ja.html") return route.fulfill({
      status: scenario === "denied_before_submit" ? 403 : 200,
      contentType: "text/html", body: scenario === "confirmation" ? "<h1>Verify you are human</h1>" : formHTML(scenario === "changed_markup"),
    });
    if (u.pathname === "/review" && request.method() === "POST") {
      posts++;
      const values = new URLSearchParams(request.postData());
      if (values.get("log-url") !== source || values.get("engine") !== "mortal") return route.abort();
      // Mock redirects as fresh document navigations: Playwright's redirect
      // chain can bypass route callbacks. Never point fixtures at a real host.
      return route.fulfill({ contentType: "text/html", body: `<script>location.href='/progress?task=${task}'</script>` });
    }
    if (u.pathname === "/progress") return route.fulfill({ contentType: "text/html", body: `<title>PROTOTYPE — progress</title><script>location.href='/killerducky/?data=/report/${task}.json'</script>` });
    if (u.pathname === "/killerducky/") return route.fulfill({ contentType: "text/html", body: `<h1>PROTOTYPE — viewer</h1><script>fetch('/report/${scenario === 'foreign_result' ? 'fedcba9876543210' : task}.json').then(r=>r.json()).then(()=>document.title='PROTOTYPE — loaded')</script>` });
    if (u.pathname.startsWith("/report/")) return route.fulfill({
      status: scenario === "denied_result" ? 403 : 200,
      contentType: "application/json", body: JSON.stringify(scenario === "invalid_result" ? { engine: "Mortal" } : fixture),
    });
    return route.abort();
  });
  try {
    emit({ type: "open" });
    const response = await page.goto(origin + "/ja.html");
    if ([401, 403, 429].includes(response.status())) throw Error("access_restricted");
    if (await page.getByText("Verify you are human", { exact: true }).isVisible()) throw Error("human_confirmation");
    const form = page.locator('form[action="/review"]');
    if (await form.count() !== 1 || await form.locator('input[name="log-url"]').count() !== 1) throw Error("form_changed");
    await form.locator('input[name="log-url"]').fill(source);
    await form.locator('select[name="engine"]').selectOption("mortal");
    await form.locator('select[name="mortal-model-tag"]').selectOption("4.1b");
    await form.locator('select[name="ui"]').selectOption("killerducky");
    await form.locator('select[name="lang"]').selectOption("ja");
    emit({ type: "ready" });
    await form.getByRole("button", { name: "送信", exact: true }).click();
    let timer;
    result = await Promise.race([received, new Promise(resolve => { timer = setTimeout(() => resolve({ error: "result_missing" }), 15000); })]);
    clearTimeout(timer);
    if (result.error) throw Error(result.error);
    emit({ type: "capture" });
    const summary = python("import json,sys;from tools.mortal_report import project;s,scenes,timeline=project(json.load(sys.stdin));print(json.dumps({'scenes':len(scenes),'events':len(timeline)}))", JSON.parse(result.body.toString()));
    emit({ type: "validated", summary });
  } catch (e) {
    // Fictional-only diagnostics; this runner cannot accept real input.
    console.error("fixture diagnostic:", e.message);
    console.error(JSON.stringify({ fixturePage: page.url(), title: await page.title(), text: await page.locator("body").innerText() }));
    const known = ["access_restricted", "human_confirmation", "form_changed", "result_failed", "result_missing"];
    emit({ type: "stop", reason: result?.body ? "invalid_result" : known.includes(e.message) ? e.message : "browser_step_failed" });
  } finally {
    await context.close();
    if (dirname(resolve(profile)) !== root || !basename(profile).startsWith("mortal-prototype-")) throw Error("unexpected_profile");
    rmSync(profile, { recursive: true });
  }
  console.log(JSON.stringify({ scenario, final: state.phase, reason: state.reason, formPosts: posts, forbiddenPosts, fixtureOnly: true, databaseWrites: 0, observed }));
}

if (process.argv.includes("--interactive")) {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  console.log("THROWAWAY / FIXTURES ONLY", scenarios.join(", "));
  for (;;) {
    const selected = await terminal.question("scenario (q to quit)> ");
    if (selected === "q") break;
    if (scenarios.includes(selected)) await run(selected);
  }
  terminal.close();
} else {
  const selected = process.argv[2];
  if (selected && !scenarios.includes(selected)) throw Error("fixture_only_no_live_mode");
  for (const scenario of selected ? [selected] : scenarios) await run(scenario);
}
