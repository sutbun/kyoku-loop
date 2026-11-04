import { test } from "node:test";
import assert from "node:assert/strict";
import { Helper } from "../extensions/mortal-helper/core.js";
import { BatchRunner, choices } from "../extensions/mortal-helper/batch.js";
const source = (n) =>
  `https://game.mahjongsoul.com/?paipu=261104-fictional-batch-${n}_a123456`;
const entry = (n) => ({
  id: source(n).split("paipu=")[1],
  url: source(n),
  requested: false,
  reports: [],
});
const task = (n) => n.toString(16).padStart(16, "0");
const snapshot = (n) => ({
  source: source(n),
  engine: "mortal",
  model: "4.1b",
  player: "",
  ui: "killerducky",
  temperature: "",
  kyokus: "",
  rating: false,
  valid: true,
  ready: true,
  error: null,
});
function rig() {
  let data = { jobs: [] },
    now = 1000,
    payload = null,
    commitLost = false;
  const calls = { open: [], read: 0, register: 0 };
  const rows = [entry(1), entry(2)];
  const io = {
    read: async () => structuredClone(data),
    write: async (x) => {
      data = structuredClone(x);
    },
  };
  const host = {
    now: () => now,
    list: async () => structuredClone(rows),
    open: async (url, previous) => {
      calls.open.push(url);
      return { id: previous || 7 };
    },
    pending: async () => payload,
    get: async (id) =>
      payload?.jobId === id ? structuredClone(payload) : null,
    put: async (x) => {
      if (payload && payload.jobId !== x.jobId)
        throw Error("pending_registration");
      payload = structuredClone(x);
    },
    remove: async (id) => {
      if (payload?.jobId === id) payload = null;
    },
    read: async (job) => {
      calls.read++;
      return {
        jobId: job.id,
        source: job.source,
        task: job.task,
        model: job.model,
        data: "fictional-bytes",
        hash: "a".repeat(64),
      };
    },
    register: async (tab, job) => {
      calls.register++;
      if (commitLost) throw Error("local_unavailable");
      return {
        id: "b".repeat(64),
        duplicate: calls.register > 1,
        source_link: {
          linked: true,
          analysis_id: job.source.split("paipu=")[1],
        },
      };
    },
  };
  const helper = new Helper(io);
  const runner = new BatchRunner(helper, host);
  return {
    helper,
    runner,
    host,
    calls,
    rows,
    data: () => data,
    time: (t) => {
      now = t;
    },
    lost: (x) => {
      commitLost = x;
    },
    payload: () => payload,
  };
}
async function launch(r, n = 1) {
  await r.runner.start([entry(n).id], 10, "4.1b");
  await r.runner.drive();
  const u = `https://mjai.ekyu.moe/ja.html?url=${encodeURIComponent(source(n))}`;
  await r.runner.navigation({
    tabId: 7,
    frameId: 0,
    documentId: "input",
    url: u,
  });
  await r.runner.tick({
    tabId: 7,
    documentId: "input",
    url: u,
    snapshot: snapshot(n),
  });
  await r.helper.tick(
    { tabId: 7, documentId: "input", url: u, snapshot: snapshot(n) },
    2000,
  );
  const detail = {
    tabId: 7,
    frameId: 0,
    documentId: "result",
    url: `https://mjai.ekyu.moe/killerducky/?data=/report/${task(n)}.json`,
    transitionType: "form_submit",
  };
  await r.helper.navigate(detail, 3000);
  await r.runner.navigation(detail);
  const grant = await r.helper.tick(
    { ...detail, snapshot: { resultReady: true } },
    4000,
  );
  await r.helper.downloadStarted(grant.id, n);
  await r.helper.downloadFinished({
    id: n,
    state: "complete",
    url: grant.url,
    finalUrl: grant.url,
    mime: "application/json",
    fileSize: 100,
  });
}
test("only eligible sources are selectable; uncertain submissions never restart", () => {
  const rows = [
    entry(1),
    { ...entry(2), reports: ["b".repeat(64)] },
    { ...entry(3), history: { mode: 8 } },
    { ...entry(4), requested: true },
  ];
  const c = choices(rows, [], "4.1b");
  assert.equal(c[0].available, true);
  assert.deepEqual(
    c.slice(1).map((x) => x.available),
    [false, false, false],
  );
  assert.equal(
    choices(
      [entry(1)],
      [{ source: source(1), model: "4.1b", claimed: true, phase: "stopped" }],
      "4.1b",
    )[0].available,
    false,
  );
});
test("saves, validates registration ACK and only then finishes a source", async () => {
  const r = rig();
  await launch(r);
  await r.runner.drive();
  assert.equal(r.data().batch.phase, "done");
  assert.equal(r.calls.read, 1);
  assert.equal(r.calls.register, 1);
  assert.equal(r.data().jobs[0].phase, "registered");
  assert.equal(r.payload(), null);
});
test("lost local ACK resumes only registration from durable bytes", async () => {
  const r = rig();
  await launch(r);
  r.lost(true);
  await r.runner.drive();
  assert.equal(r.data().batch.phase, "paused");
  assert.ok(r.payload());
  const reads = r.calls.read,
    opens = r.calls.open.length;
  r.lost(false);
  await r.runner.resume(10);
  await r.runner.drive();
  assert.equal(r.data().batch.phase, "done");
  assert.equal(r.calls.read, reads);
  assert.equal(r.calls.open.length, opens);
  assert.equal(r.calls.register, 2);
});
test("an unrelated or unlinked ACK never reports success and retains bytes", async () => {
  const r = rig();
  await launch(r);
  r.host.register = async () => ({
    id: "c".repeat(64),
    source_link: { linked: true, analysis_id: "other" },
  });
  await r.runner.drive();
  assert.equal(r.data().batch.phase, "paused");
  assert.ok(r.payload());
});
test("a deleted queued source is skipped without an external request", async () => {
  const r = rig();
  await r.runner.start([entry(1).id], 10, "4.1b");
  r.rows.shift();
  await r.runner.drive();
  assert.equal(r.calls.open.length, 0);
  assert.equal(r.data().batch.items[0].status, "skipped");
});
test("access restriction stops the whole batch and is not retried on resume", async () => {
  const r = rig();
  await launch(r);
  r.host.read = async () => {
    r.calls.read++;
    throw Error("access_restricted");
  };
  await r.runner.drive();
  assert.equal(r.data().batch.phase, "paused");
  await assert.rejects(r.runner.resume(10));
  assert.equal(r.calls.read, 1);
});
test("restart after a read grant with no cached payload never re-fetches", async () => {
  const r = rig();
  await launch(r);
  const d = r.data();
  d.jobs[0].transferAttempted = true;
  await r.runner.drive();
  assert.equal(r.calls.read, 0);
  assert.equal(r.data().batch.reason, "payload_missing");
});
test("an unclaimed page can be paused and resumed without submitting", async () => {
  const r = rig();
  await r.runner.start([entry(1).id, entry(2).id], 10, "4.1b");
  await r.runner.drive();
  assert.equal(r.calls.open.length, 1);
  await r.runner.stop();
  assert.equal(r.data().batch.phase, "paused");
  await r.runner.resume(10);
  await r.runner.drive();
  assert.equal(r.calls.open.length, 2); // Only the first unsent page is reopened; no submit grant existed.
});

test("cannot end a list while unacknowledged bytes exist; can release an unsent list", async () => {
  const r = rig();
  await launch(r);
  r.lost(true);
  await r.runner.drive();
  await assert.rejects(r.runner.end(), /pending_registration/);
  assert.ok(r.payload());
  const s = rig();
  await s.runner.start([entry(1).id], 10, "4.1b");
  await s.runner.stop();
  await s.runner.end();
  assert.equal(s.data().batch.phase, "ended");
  await s.runner.start([entry(1).id], 10, "4.1b");
});
test("a previous saved result is reused instead of asking for a new analysis", async () => {
  const r = rig();
  await launch(r);
  const old = r.data().jobs[0];
  r.data().batch = null;
  await r.runner.start([entry(1).id], 10, "4.1b");
  await r.runner.drive();
  assert.ok(r.calls.open.at(-1).includes("/killerducky/"));
  assert.equal(r.data().batch.items[0].jobId, old.id);
  old.player = "1";
  old.key = "different public form settings";
  assert.equal(choices([entry(1)], [old], "4.1b")[0].available, false);
});

test("stop after a claimed source finishes its registration and leaves the next source unsent", async () => {
  const r = rig();
  await launch(r);
  r.data().batch.items.push({ ...entry(2), status: "queued" });
  await r.runner.stop();
  assert.equal(r.data().batch.stopAfterCurrent, true);
  await r.runner.drive();
  assert.equal(r.data().batch.phase, "paused");
  assert.equal(r.data().batch.index, 1);
  assert.equal(r.data().batch.items[0].status, "done");
  assert.equal(r.calls.open.length, 1);
  assert.equal(r.calls.register, 1);
});

test("a restriction before any submit remains blocked after ending the list and restarting", async () => {
  const r = rig();
  await r.runner.start([entry(1).id], 10, "4.1b");
  await r.runner.pause("access_restricted");
  await r.runner.pause("browser_restarted");
  assert.equal(r.data().batch.reason, "access_restricted");
  await r.runner.end();
  await r.runner.pause("browser_restarted");
  assert.equal(r.data().batch.phase, "ended");
  await assert.rejects(
    r.runner.start([entry(1).id], 10, "4.1b"),
    /queue_changed/,
  );
  assert.equal(r.calls.open.length, 0);
});

test("a manual submit before the helper has a job is never sent again by the batch", async () => {
  const r = rig();
  await r.runner.start([entry(1).id], 10, "4.1b");
  await r.runner.pause("manual_submission");
  await assert.rejects(r.runner.resume(10), /manual_submission/);
  await r.runner.end();
  await assert.rejects(
    r.runner.start([entry(1).id], 10, "4.1b"),
    /queue_changed/,
  );
  assert.equal(r.data().jobs.length, 0);
  assert.equal(r.calls.open.length, 0);
});
