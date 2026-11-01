// THROWAWAY, DEV ONLY. A normal headed browser probe, never a result HTTP client.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Plugin } from "vite";
import { localControlAllowed, trackChild } from "../runtime.ts";
import { sourceURL } from "../../src/analysis-queue.ts";

const ORIGIN = "https://mjai.ekyu.moe";
const root = resolve("D:/dev-data/kyoku-loop/private");
const evidence = join(root, "mortal-browser-20261102");
let busy = false;
const attempted = new Set<string>();

async function inspect(body: Buffer): Promise<object> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.env.KYOKULOOP_PYTHON || "python",
      [
        "-c",
        "import json,sys;from tools.mortal_report import project;s,scenes,steps=project(json.load(sys.stdin));print(json.dumps({'scenes':len(scenes),'steps':len(steps)}))",
      ],
      {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      },
    );
    trackChild(child);
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.resume();
    child.once("error", reject);
    child.stdin.on("error", reject);
    child.once("close", (code) => {
      try {
        if (code) throw Error("invalid_result");
        resolve(JSON.parse(output));
      } catch {
        reject(Error("invalid_result"));
      }
    });
    child.stdin.end(body);
  });
}

async function probe(mode: "input" | "prepare" | "analyse", source?: string) {
  if (busy) return { status: "stopped", reason: "busy" };
  if (mode === "analyse" && (!source || attempted.has(source)))
    return { status: "stopped", reason: "already_attempted" };
  busy = true;
  if (source && mode === "analyse") attempted.add(source);
  mkdirSync(evidence, { recursive: true });
  const id = randomUUID();
  const folder = mkdtempSync(join(root, "mortal-live-probe-"));
  const { chromium, expect } = await import("@playwright/test");
  let context:
    Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  let result: Record<string, unknown> = {
    status: "stopped",
    reason: "browser_unavailable",
  };
  let submitted = false;
  let restricted = false;
  let phase = "opening";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    context = await chromium.launchPersistentContext(folder, {
      channel: "msedge",
      headless: false,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(30000);
    let expected: string | undefined;
    let complete!: (r: { body?: Buffer; error?: string }) => void;
    const received = new Promise<{ body?: Buffer; error?: string }>((r) => {
      complete = r;
    });
    page.on("request", (request) => {
      if (request.url() === ORIGIN + "/review" && request.method() === "POST")
        submitted = true;
    });
    page.on("framenavigated", (frame) => {
      if (frame !== page.mainFrame() || !submitted) return;
      const u = new URL(frame.url());
      if (u.origin !== ORIGIN)
        return complete({ error: "unexpected_navigation" });
      const task =
        u.pathname === "/progress"
          ? u.searchParams.get("task")
          : u.pathname === "/killerducky/"
            ? u.searchParams
                .get("data")
                ?.match(/^\/report\/([a-f0-9]{16})\.json$/)?.[1]
            : null;
      if (task && /^[a-f0-9]{16}$/.test(task))
        expected = ORIGIN + "/report/" + task + ".json";
    });
    page.on("response", async (response) => {
      const u = new URL(response.url());
      if (
        (u.origin === ORIGIN || u.hostname.endsWith(".cloudflare.com")) &&
        [401, 403, 429].includes(response.status())
      ) {
        restricted = true;
        complete({ error: "access_restricted" });
      }
      if (response.url() !== expected) return;
      if (!response.ok()) return complete({ error: "result_failed" });
      try {
        const length = Number(await response.headerValue("content-length"));
        if (length > 20 * 1024 * 1024)
          return complete({ error: "result_large" });
        const body = await response.body(); // Already loaded by the normal official viewer.
        complete(
          body.length > 20 * 1024 * 1024 ? { error: "result_large" } : { body },
        );
      } catch {
        complete({ error: "result_failed" });
      }
    });
    const response = await page.goto(ORIGIN + "/ja.html");
    if (!response || restricted || [401, 403, 429].includes(response.status()))
      throw Error("access_restricted");
    await page.screenshot({ path: join(evidence, id + "-input.png") });
    const form = page.locator('form[action="/review"]');
    if (
      await page
        .getByText(/Verify you are human|Just a moment|人間であることを確認/i)
        .first()
        .isVisible()
    )
      throw Error("human_confirmation");
    if (
      (await form.count()) !== 1 ||
      (await form.locator('input[name="log-url"]').count()) !== 1
    )
      throw Error("form_changed_or_confirmation");
    if (mode === "input") {
      result = { status: "input_ready", formCount: 1, submitted: false };
    } else {
      phase = "input";
      await form.locator('input[name="log-url"]').fill(source!);
      await form.locator('input[name="log-url"]').press("Tab");
      await form.locator('select[name="engine"]').selectOption("mortal");
      await form
        .locator('select[name="mortal-model-tag"]')
        .selectOption("4.1b");
      await form.locator('select[name="ui"]').selectOption("killerducky");
      await form.locator('select[name="lang"]').selectOption("ja");
      if (restricted) throw Error("access_restricted");
      await page.screenshot({
        path: join(evidence, id + "-before-submit.png"),
        fullPage: true,
      });
      const submit = form.getByRole("button", { name: "送信", exact: true });
      if (mode === "prepare") {
        let interactiveCheckboxVisible = false;
        for (const frame of page.frames()) {
          if (
            frame !== page.mainFrame() &&
            (await frame
              .getByRole("checkbox")
              .first()
              .isVisible()
              .catch(() => false))
          )
            interactiveCheckboxVisible = true;
        }
        if (interactiveCheckboxVisible) throw Error("human_confirmation");
        await expect(submit)
          .toBeEnabled({ timeout: 30000 })
          .catch(() => {});
        if (restricted) throw Error("access_restricted");
        await page.screenshot({
          path: join(evidence, id + "-readiness.png"),
          fullPage: true,
        });
        result = {
          status: "prepared_without_submission",
          submitted: false,
          submitEnabled: await submit.isEnabled(),
          submitCount: await submit.count(),
          sourceValid: await form
            .locator('input[name="log-url"]')
            .evaluate((e) => (e as HTMLInputElement).validity.valid),
          interactiveCheckboxVisible,
        };
      } else {
        phase = "submit_click";
        await submit.click();
        phase = "response";
        const captured = await Promise.race([
          received,
          new Promise<{ error: string }>((r) => {
            timer = setTimeout(
              () => r({ error: "result_missing_or_confirmation" }),
              90000,
            );
          }),
        ]);
        if ("error" in captured && captured.error) throw Error(captured.error);
        const body = "body" in captured && captured.body;
        if (!body) throw Error("result_failed");
        phase = "validation";
        const summary = await inspect(body);
        writeFileSync(join(evidence, id + "-result.json"), body);
        await page.screenshot({ path: join(evidence, id + "-result.png") });
        result = { status: "validated", summary, submitted };
      }
    }
  } catch (e) {
    const known = [
      "access_restricted",
      "human_confirmation",
      "form_changed_or_confirmation",
      "unexpected_navigation",
      "result_failed",
      "result_large",
      "invalid_result",
      "result_missing_or_confirmation",
    ];
    result = {
      status: "stopped",
      reason:
        e instanceof Error && known.includes(e.message)
          ? e.message
          : "browser_step_failed",
      submitted,
    };
    writeFileSync(
      join(evidence, id + "-diagnostic.json"),
      JSON.stringify({
        phase,
        error: e instanceof Error ? e.message : "unknown",
      }),
    );
    const page = context?.pages().find((p) => p.url().startsWith(ORIGIN));
    await page
      ?.screenshot({
        path: join(evidence, id + "-stopped.png"),
        fullPage: true,
      })
      .catch(() => {});
  } finally {
    if (timer) clearTimeout(timer);
    await context?.close();
    if (
      dirname(resolve(folder)) !== root ||
      !basename(folder).startsWith("mortal-live-probe-")
    )
      throw Error("unexpected_profile");
    rmSync(folder, { recursive: true });
    writeFileSync(
      join(evidence, id + "-summary.json"),
      JSON.stringify({ ...result, id, mode }),
    );
    busy = false;
  }
  return { ...result, id };
}

export function mortalProbe(): Plugin {
  return {
    name: "throwaway-mortal-browser-probe",
    configureServer(server) {
      if (process.env.KYOKULOOP_MORTAL_PROBE !== "1") return;
      server.middlewares.use((req, res, next) => {
        const ui = req.url === "/mortal-browser-prototype";
        const api =
          req.url === "/api/local" &&
          req.headers["x-kyokuloop-prototype"] === "mortal";
        if (!ui && !api) return next();
        res.setHeader("Cache-Control", "no-store");
        if (!localControlAllowed(req)) {
          res.statusCode = 403;
          res.end("local_only");
          return;
        }
        if (ui && req.method === "GET") {
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(`<!doctype html><meta charset="utf-8"><title>KyokuLoop Mortal技術検証</title><h1>Mortal技術検証 DEV-11.02-7</h1><p>普段使いデータへの登録なし</p><button id="input">入力画面だけ確認</button><p><input id="url" aria-label="雀魂共有URL" type="url" size="70"><button id="prepare">入力を診断（送信なし）</button><button id="analyse">1件だけ解析を検証</button></p><pre id="status">待機中</pre><script>
            async function run(mode){document.querySelectorAll('button').forEach(b=>b.disabled=true);document.querySelector('#status').textContent='検証中';try{const r=await fetch('/api/local',{method:'POST',headers:{'Content-Type':'application/json','x-kyokuloop-prototype':'mortal'},body:JSON.stringify({mode,url:document.querySelector('#url').value})});document.querySelector('#status').textContent=JSON.stringify(await r.json(),null,2)}catch{document.querySelector('#status').textContent='検証失敗'}finally{document.querySelectorAll('button').forEach(b=>b.disabled=false)}}document.querySelector('#input').onclick=()=>run('input');document.querySelector('#analyse').onclick=()=>run('analyse');
          document.querySelector('#prepare').onclick=()=>run('prepare');</script>`);
          return;
        }
        // CLOSED after the observed access restriction. Preserve the probe
        // source for audit, but never rerun the rejected live method.
        res.statusCode = 409;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            status: "stopped",
            reason: "probe_closed_after_access_restriction",
          }),
        );
        return;
        /* Original live request handler, retained for the experiment record:
        if (req.method !== "POST" || !req.headers["content-type"]?.startsWith("application/json")) { res.statusCode = 403; res.end("invalid_probe"); return; }
        let data = "";
        req.on("data", chunk => { data += chunk; });
        req.on("end", async () => {
          res.setHeader("Content-Type", "application/json");
          try {
            if (data.length > 1024) throw Error();
            const input = JSON.parse(data);
            if (!["input", "prepare", "analyse"].includes(input.mode)) throw Error();
            const url = input.mode !== "input" ? sourceURL(input.url) : undefined;
            res.end(JSON.stringify(await probe(input.mode, url)));
          } catch { res.statusCode = 400; res.end(JSON.stringify({ status: "stopped", reason: "invalid_probe" })); }
        });
        */
      });
    },
  };
}
