import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Helper,
  route,
  fingerprint,
} from "../extensions/mortal-helper/core.js";

const source =
  "https://game.mahjongsoul.com/?paipu=261104-fictional-helper_a123456";
const input = `https://mjai.ekyu.moe/ja.html?url=${encodeURIComponent(source)}`;
const task = "0123456789abcdef";
const progress = `https://mjai.ekyu.moe/progress?task=${task}`;
const result = `https://mjai.ekyu.moe/killerducky/?data=/report/${task}.json`;
const snap = () => ({
  source,
  engine: "mortal",
  model: "4.1b",
  player: "",
  ui: "killerducky",
  temperature: "0.1",
  kyokus: "",
  valid: true,
  ready: true,
  error: null,
});
function rig() {
  let data = { jobs: [] };
  let saves = 0;
  const io = {
    read: async () => structuredClone(data),
    write: async (value) => {
      saves++;
      data = structuredClone(value);
    },
  };
  return { helper: new Helper(io), io, data: () => data, saves: () => saves };
}
const start = (h, snapshot = snap()) =>
  h.start({ tabId: 7, documentId: "form-doc", url: input, snapshot }, 1000);
const tick = (h, snapshot = snap(), documentId = "form-doc", url = input) =>
  h.tick({ tabId: 7, documentId, url, snapshot }, 2000);
const nav = (h, url, transitionType = "form_submit") =>
  h.navigate(
    { tabId: 7, frameId: 0, documentId: "result-doc", url, transitionType },
    3000,
  );

test("only known HTTPS entry/result URLs are accepted", () => {
  assert.equal(route(input).kind, "input");
  assert.equal(route(progress).task, task);
  assert.equal(
    route(result).report,
    `https://mjai.ekyu.moe/report/${task}.json`,
  );
  for (const bad of [
    result + "&extra=1",
    result + "#x",
    result.replace("mjai.ekyu.moe", "evil.invalid"),
    result.replace("/report/", "https://evil.invalid/"),
    input.replace("https:", "http:"),
    "https://user@mjai.ekyu.moe/ja.html",
  ])
    assert.equal(route(bad), null);
});
test("readiness wait grants exactly one click, even after worker restart", async () => {
  const r = rig();
  await start(r.helper, { ...snap(), ready: false });
  assert.equal(
    (await tick(r.helper, { ...snap(), ready: false })).action,
    "wait",
  );
  assert.equal((await tick(r.helper)).action, "click");
  assert.equal(r.data().jobs[0].phase, "submitting");
  assert.notEqual((await tick(new Helper(r.io))).action, "click");
});
test("source/model/target changes before click stop without sending", async () => {
  for (const change of [
    { source: source + "x" },
    { model: "3.0" },
    { player: "1" },
    { temperature: "0.2" },
    { ui: "classic" },
  ]) {
    const r = rig();
    await start(r.helper);
    assert.equal(
      (await tick(r.helper, { ...snap(), ...change })).action,
      "stop",
    );
    assert.equal(r.data().jobs[0].phase, "stopped");
  }
});
test("a different document cannot consume the click grant", async () => {
  const r = rig();
  await start(r.helper);
  assert.equal((await tick(r.helper, snap(), "other-doc")).action, "stop");
});
test("form errors and human confirmation stop; no token is required or read", async () => {
  for (const error of [
    "human_confirmation",
    "access_restricted",
    "form_changed",
  ]) {
    const r = rig();
    await start(r.helper);
    assert.equal((await tick(r.helper, { ...snap(), error })).action, "stop");
    assert.equal(r.data().jobs[0].reason, error);
  }
});
test("rejects non-Mortal engines, ambiguous auto target and invalid inputs", async () => {
  for (const change of [
    { engine: "akochan" },
    { valid: false },
    { source: "https://evil.invalid/" },
    { player: "9" },
    { source: source.replace("_a123456", "") },
  ]) {
    const r = rig();
    await assert.rejects(start(r.helper, { ...snap(), ...change }));
    assert.equal(r.data().jobs.length, 0);
  }
});
test("input query and actual source must agree", async () => {
  const r = rig();
  await assert.rejects(start(r.helper, { ...snap(), source: source + "x" }));
});
test("prevents concurrent and duplicate starts including a saved job", async () => {
  const r = rig();
  await start(r.helper);
  await assert.rejects(start(r.helper));
  await tick(r.helper);
  await nav(r.helper, progress);
  await nav(r.helper, result, "link");
  const grant = await tick(
    r.helper,
    { error: null, resultReady: true },
    "result-doc",
    result,
  );
  assert.equal(grant.action, "download");
  await r.helper.downloadStarted(grant.id, 99);
  await r.helper.downloadFinished({
    id: 99,
    state: "complete",
    url: grant.url,
    finalUrl: grant.url,
    mime: "application/json",
    fileSize: 123,
  });
  await assert.rejects(start(r.helper));
});
test("binds only form-submit navigation; a typed or unrelated result is rejected", async () => {
  for (const transition of ["typed", "link", "reload"]) {
    const r = rig();
    await start(r.helper);
    await tick(r.helper);
    await nav(r.helper, progress, transition);
    assert.equal(r.data().jobs[0].phase, "stopped");
  }
});
test("a client redirect is accepted only after a committed form response", async () => {
  const r = rig();
  await start(r.helper);
  await tick(r.helper);
  await nav(r.helper, "https://mjai.ekyu.moe/review");
  await r.helper.navigate(
    {
      tabId: 7,
      frameId: 0,
      documentId: "progress-doc",
      url: progress,
      transitionType: "link",
      transitionQualifiers: ["client_redirect"],
    },
    3100,
  );
  assert.equal(r.data().jobs[0].phase, "analysing");
  const other = rig();
  await start(other.helper);
  await tick(other.helper);
  await other.helper.navigate(
    {
      tabId: 7,
      frameId: 0,
      documentId: "progress-doc",
      url: progress,
      transitionType: "link",
      transitionQualifiers: ["client_redirect"],
    },
    3100,
  );
  assert.equal(other.data().jobs[0].phase, "stopped");
});
test("result from another task or tab cannot be downloaded", async () => {
  const r = rig();
  await start(r.helper);
  await tick(r.helper);
  await nav(r.helper, progress);
  await r.helper.navigate(
    {
      tabId: 8,
      frameId: 0,
      url: result.replace(task, "fedcba9876543210"),
      documentId: "wrong",
      transitionType: "link",
    },
    3100,
  );
  assert.equal(r.data().jobs[0].phase, "analysing");
  await nav(r.helper, result.replace(task, "fedcba9876543210"), "link");
  assert.equal(r.data().jobs[0].phase, "stopped");
});
test("late messages from a prior document cannot cancel or download the next page", async () => {
  const r = rig();
  await start(r.helper);
  await tick(r.helper);
  await nav(r.helper, progress);
  assert.equal(
    (await tick(r.helper, { error: "form_changed" })).action,
    "idle",
  );
  assert.equal(r.data().jobs[0].phase, "analysing");
});
test("does not download while the viewer is still loading", async () => {
  const r = rig();
  await start(r.helper);
  await tick(r.helper);
  await nav(r.helper, progress);
  await nav(r.helper, result, "link");
  assert.equal(
    (
      await tick(
        r.helper,
        { error: null, resultReady: false },
        "result-doc",
        result,
      )
    ).action,
    "wait",
  );
});
test("download grant is durable and cannot repeat on restart", async () => {
  const r = rig();
  await start(r.helper);
  await tick(r.helper);
  await nav(r.helper, progress);
  await nav(r.helper, result, "link");
  assert.equal(
    (
      await tick(
        r.helper,
        { error: null, resultReady: true },
        "result-doc",
        result,
      )
    ).action,
    "download",
  );
  assert.notEqual(
    (
      await tick(
        new Helper(r.io),
        { error: null, resultReady: true },
        "result-doc",
        result,
      )
    ).action,
    "download",
  );
});
test("HTML, redirect, empty/oversize and interrupted downloads are not success", async () => {
  for (const change of [
    { mime: "text/html" },
    { finalUrl: "https://evil.invalid/" },
    { fileSize: 0 },
    { fileSize: undefined },
    { fileSize: NaN },
    { fileSize: 25 * 1024 * 1024 },
    { state: "interrupted" },
  ]) {
    const r = rig();
    await start(r.helper);
    await tick(r.helper);
    await nav(r.helper, result);
    const grant = await tick(
      r.helper,
      { error: null, resultReady: true },
      "result-doc",
      result,
    );
    await r.helper.downloadStarted(grant.id, 2);
    await r.helper.downloadFinished({
      id: 2,
      state: "complete",
      url: grant.url,
      finalUrl: grant.url,
      mime: "application/json",
      fileSize: 100,
      ...change,
    });
    assert.equal(r.data().jobs[0].phase, "stopped");
  }
});
test("timeout, tab close and cancel never submit or restart another job", async () => {
  for (const action of [
    (h) => h.expire(400000),
    (h) => h.stopTab(7, "tab_closed"),
    (h) => h.stopTab(7, "cancelled"),
  ]) {
    const r = rig();
    await start(r.helper);
    await action(r.helper);
    assert.equal((await tick(r.helper)).action, "idle");
    assert.equal(r.data().jobs[0].phase, "stopped");
  }
});
test("storage failure prevents a click permission from escaping", async () => {
  const r = rig();
  await start(r.helper);
  const h = new Helper({
    read: r.io.read,
    write: async () => {
      throw Error("storage_full");
    },
  });
  await assert.rejects(tick(h));
  assert.equal(r.data().jobs[0].phase, "waiting");
});
test("fingerprint covers all selected analysis options", () => {
  assert.notEqual(
    fingerprint(snap()),
    fingerprint({ ...snap(), kyokus: "e1" }),
  );
});
test("the live form's empty temperature uses the site default without editing it", async () => {
  const r = rig();
  const s = { ...snap(), temperature: "" };
  await start(r.helper, s);
  assert.equal((await tick(r.helper, s)).action, "click");
  assert.equal(s.temperature, "");
});
