import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { indexedDB, IDBObjectStore } from "fake-indexeddb";
import {
  freshPhoneState,
  phoneReduce,
  validatePhoneBackup,
  type PhoneState,
} from "../src/offline/engine";
import { phoneTransaction, readPhone } from "../src/offline/store";

const materials = JSON.parse(
  execFileSync(
    "python",
    [
      "-c",
      `
import sys,json,base64,copy
sys.path.insert(0,'tests')
from test_p8_mortal import mortal_fixture
from tools.mortal_material import compile_upload
a=mortal_fixture();b=mortal_fixture(True);c=copy.deepcopy(a);c['review']['model_tag']='fictional-model-two'
print(json.dumps([compile_upload(base64.b64encode(json.dumps(r).encode()).decode(),'2026-11-04T01:00:00.000Z') for r in [a,b,c]]))
`,
    ],
    { encoding: "utf8", windowsHide: true },
  ),
);
const material = materials[0],
  scores = [25000, 25000, 25000, 25000];
const player = 123,
  actor = 1358437 + ((7 * player + 1117113) ^ 86216345);
const history = (n = 1) => ({
  url: `https://game.mahjongsoul.com/?paipu=260101-fictional-auto-${n}_a${actor}`,
  at: "2026-01-01T00:00:00+09:00",
  seat: 0,
  mode: 12,
  rank: 1,
  players: scores.map((score, i) => ({ name: `匿名でない架空${i}`, score })),
});
const id = (n = 1) => history(n).url.split("paipu=")[1];
const batch = (ns = [1]) =>
  JSON.stringify({
    kind: "kyokuloop-history",
    version: 1,
    player,
    entries: ns.map(history),
  });
const start = () =>
  phoneReduce(freshPhoneState("auto-device"), { action: "enable_local" }).state;
const register = (
  state: PhoneState,
  index = 0,
  hints = true,
  source: string | null = null,
) =>
  phoneReduce(state, {
    action: "register_local",
    material: materials[index],
    analysis_id: source,
    ...(hints ? { final_scores: scores } : {}),
  }).state;

for (const first of ["json", "history"])
  test(`${first} first auto-links without changing questions, answers, due or session`, () => {
    let state = start();
    if (first === "history")
      state = phoneReduce(state, {
        action: "analysis_bulk",
        data: batch(),
      }).state;
    state = register(state);
    const before = structuredClone({
      pack: state.pack,
      events: state.events,
      session: state.session,
    });
    state = phoneReduce(state, {
      action: "analysis_bulk",
      data: batch(),
    }).state;
    expect(state.local_imports![0]).toMatchObject({
      analysis_id: id(),
      source_link_kind: "scores",
    });
    expect(state.analysis_queue![0]).toMatchObject({
      reports: [material.id],
      ready: true,
    });
    expect({
      pack: state.pack,
      events: state.events,
      session: state.session,
    }).toEqual(before);
    expect(register(state).pack).toEqual(state.pack);
    validatePhoneBackup(state);
  });

test("ambiguity, used URLs and different games stay unlinked; same game models can share one URL", () => {
  let ambiguous = register(start());
  ambiguous = phoneReduce(ambiguous, {
    action: "analysis_bulk",
    data: batch([1, 2]),
  }).state;
  expect(ambiguous.local_imports![0].analysis_id).toBeNull();
  let games = register(register(start()), 1);
  games = phoneReduce(games, { action: "analysis_bulk", data: batch() }).state;
  expect(games.local_imports!.map((e) => e.analysis_id)).toEqual([null, null]);
  let used = phoneReduce(start(), {
    action: "analysis_bulk",
    data: batch(),
  }).state;
  used = register(register(used), 1);
  expect(used.local_imports!.map((e) => e.analysis_id)).toEqual([id(), null]);
  let models = register(register(start()), 2);
  models = phoneReduce(models, {
    action: "analysis_bulk",
    data: batch(),
  }).state;
  expect(models.local_imports!.map((e) => e.analysis_id)).toEqual([id(), id()]);
  expect(models.pack!.items).toHaveLength(material.items.length);
});

test("manual links win, old imports gain hints, and restored unlinked backups reconcile", () => {
  let old = register(start(), 0, false);
  old = phoneReduce(old, { action: "analysis_bulk", data: batch() }).state;
  expect(old.local_imports![0].analysis_id).toBeNull();
  const hints = {
    action: "source_scores",
    entries: [{ id: material.id, final_scores: scores }],
  };
  old = phoneReduce(old, hints).state;
  expect(old.local_imports![0].analysis_id).toBe(id());
  const before = structuredClone(old);
  expect(() =>
    phoneReduce(old, {
      action: "source_scores",
      entries: [
        { id: material.id, final_scores: [30000, 20000, 25000, 25000] },
      ],
    }),
  ).toThrow("invalid_receipt");
  expect(old).toEqual(before);
  let manual = phoneReduce(start(), {
    action: "analysis_bulk",
    data: batch([1, 2]),
  }).state;
  manual = register(manual, 0, true, id(2));
  expect(phoneReduce(manual, hints).state.local_imports![0].analysis_id).toBe(
    id(2),
  );
  const backup = register(start());
  const restored = phoneReduce(
    phoneReduce(freshPhoneState("restored"), {
      action: "analysis_bulk",
      data: batch(),
    }).state,
    { action: "restore_phone", backup },
  ).state;
  expect(restored.local_imports![0].analysis_id).toBe(id());
  validatePhoneBackup(restored);
});

test("a delayed receipt preserves local source tags; linking an acknowledged import requires resync", () => {
  let state = register(start());
  state = phoneReduce(state, {
    action: "bind_source",
    source: "fictional-windows",
  }).state;
  state = phoneReduce(state, {
    action: "import_ack",
    id: material.id,
    analysis_id: null,
    source: "fictional-windows",
  }).state;
  state = phoneReduce(state, {
    action: "analysis_add",
    url: history().url,
  }).state;
  const snapshot = structuredClone(state.analysis_queue!);
  state = phoneReduce(state, { action: "analysis_bulk", data: batch() }).state;
  expect(state.local_imports![0].synced_source).toBeUndefined();
  state = phoneReduce(state, {
    action: "analysis_ack",
    snapshot,
    entries: snapshot.map((e) => ({
      ...e,
      requested: false,
      reports: [],
      ready: false,
    })),
    received_at: "2026-11-04T01:00:00Z",
  }).state;
  expect(state.analysis_queue![0].reports).toEqual([material.id]);
  expect(state.analysis_queue![0].ready).toBe(true);
  expect(state.local_imports![0].analysis_id).toBe(id());
  expect(() =>
    phoneReduce(state, {
      action: "import_ack",
      id: material.id,
      analysis_id: null,
      source: "fictional-windows",
    }),
  ).toThrow("sync_changed");
});

test("IndexedDB commits metadata and reverse linking atomically, retaining all previous state on failure", async () => {
  Object.defineProperty(globalThis, "indexedDB", {
    value: indexedDB,
    configurable: true,
    writable: true,
  });
  await new Promise<void>((resolve, reject) => {
    const r = indexedDB.deleteDatabase("kyokuloop-phone-v1");
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
  await phoneTransaction({ action: "enable_local" });
  await phoneTransaction({
    action: "register_local",
    material,
    analysis_id: null,
    final_scores: scores,
  });
  const before = await readPhone();
  const original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function () {
    throw Error("fictional disk full");
  };
  try {
    await expect(
      phoneTransaction({ action: "analysis_bulk", data: batch() }),
    ).rejects.toThrow("full");
  } finally {
    IDBObjectStore.prototype.put = original;
  }
  expect(await readPhone()).toEqual(before);
  await phoneTransaction({ action: "analysis_bulk", data: batch() });
  expect((await readPhone())!.local_imports![0].analysis_id).toBe(id());
});

test("JSON-first delayed Windows sync and lost ACKs keep the same source and question IDs", () => {
  const folder = mkdtempSync("D:/dev-data/kyoku-loop/private/auto-link-sync-");
  try {
    const cli = (request: object) => {
      const reply = JSON.parse(
        execFileSync("python", ["tools/p2_store.py"], {
          input: JSON.stringify(request),
          encoding: "utf8",
          windowsHide: true,
          env: { ...process.env, KYOKULOOP_DB: join(folder, "test.sqlite3") },
        }),
      );
      expect(reply.ok).toBe(true);
      return reply.data;
    };
    let state = register(start());
    let stage = cli({
      action: "phone_mortal_inspect",
      data: material.payload,
      source: null,
    });
    state = phoneReduce(state, {
      action: "bind_source",
      source: stage.source,
    }).state;
    const req = {
      action: "phone_mortal_register",
      token: stage.token,
      source: stage.source,
      analysis_id: null,
      created_at: material.created,
      item_ids: state.local_imports![0].item_ids,
    };
    cli(req);
    state = phoneReduce(state, {
      action: "import_ack",
      id: material.id,
      analysis_id: null,
      source: stage.source,
    }).state;
    state = phoneReduce(state, {
      action: "analysis_bulk",
      data: batch(),
    }).state;
    const snapshot = state.analysis_queue!.map(
      ({ id, url, created, history }) => ({ id, url, created, history }),
    );
    const receipt = cli({ action: "analysis_sync", entries: snapshot });
    state = phoneReduce(state, {
      action: "analysis_ack",
      snapshot,
      ...receipt,
    }).state;
    stage = cli({
      action: "phone_mortal_inspect",
      data: material.payload,
      source: stage.source,
    });
    const retry = { ...req, token: stage.token, analysis_id: id() };
    expect(cli(retry).duplicate).toBe(true);
    expect(cli(retry).duplicate).toBe(true);
    state = phoneReduce(state, {
      action: "import_ack",
      id: material.id,
      analysis_id: id(),
      source: stage.source,
    }).state;
    const server = cli({ action: "state" });
    expect(server.reports).toHaveLength(1);
    expect(server.items.map((i: any) => i.id)).toEqual(
      state.pack!.items.map((i) => i.id),
    );
    expect(server.analysis_queue[0].reports).toEqual([material.id]);
    expect(state.local_imports![0]).toMatchObject({
      analysis_id: id(),
      synced_source: stage.source,
    });
  } finally {
    if (
      !resolve(folder).startsWith(
        resolve("D:/dev-data/kyoku-loop/private") + sep,
      )
    )
      throw Error("Unsafe cleanup");
    rmSync(folder, { recursive: true });
  }
});
