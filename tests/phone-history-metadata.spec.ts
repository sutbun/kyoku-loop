import { test, expect } from "@playwright/test";
import {
  freshPhoneState,
  phoneReduce,
  validatePhoneBackup,
} from "../src/offline/engine";
const player = 123456,
  actor = 1358437 + ((7 * player + 1117113) ^ 86216345);
const url = `https://game.mahjongsoul.com/?paipu=260101-fictional-meta_a${actor}`;
const row = {
  url,
  at: "2026-01-01T12:30:00+09:00",
  mode: 12,
  seat: 1,
  players: [
    { name: "架空A", score: 25000 },
    { name: "架空B", score: 30000 },
    { name: "架空C", score: 30000 },
    { name: "架空D", score: 15000 },
  ],
};
const batch = (entries: any[] = [row]) =>
  JSON.stringify({ kind: "kyokuloop-history", version: 1, player, entries });
test("metadata backfills an existing URL without replacing queue status and rejects conflicting batches atomically", () => {
  let state = phoneReduce(freshPhoneState("meta"), {
    action: "analysis_add",
    url,
  }).state;
  Object.assign(state.analysis_queue![0], {
    requested: true,
    reports: ["a".repeat(64)],
    ready: true,
  });
  const result = phoneReduce(state, { action: "analysis_bulk", data: batch() });
  expect(result.data).toMatchObject({ added: 0, existing: 1, updated: 1 });
  expect(result.state.analysis_queue![0]).toMatchObject({
    requested: true,
    reports: ["a".repeat(64)],
    ready: true,
    history: { rank: 1, seat: 1, mode: 12, players: row.players },
  });
  validatePhoneBackup(result.state);
  expect(
    phoneReduce(result.state, { action: "analysis_bulk", data: batch() }).data,
  ).toMatchObject({ added: 0, updated: 0 });
  const before = structuredClone(result.state);
  expect(() =>
    phoneReduce(before, {
      action: "analysis_bulk",
      data: batch([
        { url: url.replace("fictional-meta", "fictional-new") },
        {
          ...row,
          players: row.players.map((p, i) =>
            i === 0 ? { ...p, name: "異なる名前" } : p,
          ),
        },
      ]),
    }),
  ).toThrow("history_conflict");
  expect(before).toEqual(result.state);
});
test("metadata validates target player, dates, seats, names and scores without partial writes", () => {
  const state = freshPhoneState("bad-meta");
  for (const mutation of [
    { ...row, seat: true },
    { ...row, at: "2026-02-30T00:00:00Z" },
    { ...row, players: [] },
    { ...row, url: url.replace("_a" + actor, "_a1") },
    {
      ...row,
      players: row.players.map((p, i) =>
        i === 0 ? { ...p, name: "bad\nname" } : p,
      ),
    },
  ]) {
    expect(() =>
      phoneReduce(state, { action: "analysis_bulk", data: batch([mutation]) }),
    ).toThrow();
    expect(state.analysis_queue).toBeUndefined();
  }
});
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { resolve, join, sep } from "node:path";
import { runInNewContext } from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AnalysisList } from "../src/analysis-ui";
import { normalizeAnalysisHistory } from "../src/analysis-queue";
test("metadata survives sync receipt and device restore; old receipt cannot erase a concurrent enrichment", () => {
  const initial = phoneReduce(freshPhoneState("meta-ack"), {
    action: "analysis_add",
    url,
  }).state;
  const enriched = phoneReduce(initial, {
    action: "analysis_bulk",
    data: batch(),
  }).state;
  const snapshot = initial.analysis_queue!;
  const oldReceipt = snapshot.map((e) => ({
    ...e,
    requested: false,
    reports: [],
  }));
  const delayed = phoneReduce(enriched, {
    action: "analysis_ack",
    snapshot,
    entries: oldReceipt,
    received_at: "2026-11-04T00:00:00Z",
  }).state;
  expect(delayed.analysis_queue![0].history).toEqual(
    enriched.analysis_queue![0].history,
  );
  const restored = phoneReduce(freshPhoneState("restore-meta"), {
    action: "restore_phone",
    backup: delayed,
  }).state;
  expect(restored.analysis_queue![0].history).toEqual(
    enriched.analysis_queue![0].history,
  );
  const withHistory = enriched.analysis_queue!;
  expect(() =>
    phoneReduce(enriched, {
      action: "analysis_ack",
      snapshot: withHistory,
      entries: oldReceipt,
      received_at: "2026-11-04T00:00:00Z",
    }),
  ).toThrow("invalid_receipt");
});
test("isolated Windows roundtrip backfills metadata and detects conflicts without losing earlier status", () => {
  const folder = mkdtempSync("D:/dev-data/kyoku-loop/private/history-sync-");
  try {
    const local = phoneReduce(freshPhoneState("sync-meta"), {
      action: "analysis_bulk",
      data: batch(),
    }).state;
    const program = `import sys,json,copy\nfrom tools.p2_store import Store\nfrom tools.study import StudyFailure\ns=Store(sys.argv[1])\ne=json.loads(sys.stdin.read())\ns.analysis_add(e[0]['url'])\ns.analysis_requested(e[0]['id'],True)\na=s.analysis_receive(e)\nb=s.analysis_receive(e)\nassert a['entries']==b['entries'] and b['entries'][0]['requested']\nbad=copy.deepcopy(e);bad[0]['history']['players'][0]['name']='different';new=copy.deepcopy(e[0]);new.pop('history');new['url']=new['url'].replace('fictional-meta','fictional-new');new['id']=new['url'].split('paipu=')[1];bad.insert(0,new)\ntry:s.analysis_receive(bad);raise AssertionError('conflict accepted')\nexcept StudyFailure as error:assert str(error)=='history_conflict'\nassert s.analysis_entry(e[0]['id'])==b['entries'][0] and len(s.analysis_entries())==1\nprint(json.dumps(b))\ns.close()`;
    const reply = JSON.parse(
      execFileSync("python", ["-c", program, join(folder, "test.sqlite3")], {
        input: JSON.stringify(local.analysis_queue),
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
        encoding: "utf8",
        windowsHide: true,
      }),
    );
    expect(reply.entries[0].history).toBeDefined();
    expect(normalizeAnalysisHistory(reply.entries[0].history, url)).toEqual(
      local.analysis_queue![0].history,
    );
    const ack = phoneReduce(local, {
      action: "analysis_ack",
      snapshot: local.analysis_queue,
      entries: reply.entries,
      received_at: reply.received_at,
    }).state;
    expect(ack.analysis_queue![0].history).toEqual(
      local.analysis_queue![0].history,
    );
    expect(ack.analysis_queue![0].requested).toBe(true);
  } finally {
    if (
      !resolve(folder).startsWith(
        resolve("D:/dev-data/kyoku-loop/private") + sep,
      )
    )
      throw Error("unsafe cleanup");
    rmSync(folder, { recursive: true });
  }
});
test("iPad list renders rank and opponents with HTML escaping and hides own name", () => {
  const history = normalizeAnalysisHistory({ ...row, player }, url);
  history.players[0].name = "<script>other</script>";
  const html = renderToStaticMarkup(
    createElement(AnalysisList, {
      portable: true,
      disabled: false,
      entries: [
        {
          id: url.split("paipu=")[1],
          url,
          created: "2026-01-01T00:00:00Z",
          history,
        },
      ],
    }),
  );
  expect(html).toContain("1位");
  expect(html).toContain("架空C");
  expect(html).not.toContain("架空B");
  expect(html).toContain("&lt;script&gt;other&lt;/script&gt;");
  expect(html).not.toContain("<script>");
  const east = renderToStaticMarkup(
    createElement(AnalysisList, {
      portable: true,
      disabled: false,
      entries: [
        {
          id: url.split("paipu=")[1],
          url,
          created: "2026-01-01T00:00:00Z",
          history: { ...history, mode: 11 },
        },
      ],
    }),
  );
  expect(east).toContain("東風は対象外");
  expect(east).toContain('disabled=""');
});
test("Safari metadata export reads a complete row and falls back to URL only for missing fields", () => {
  const script = readFileSync(
    "docs/snippets/ipad-history-metadata-shortcut.js",
    "utf8",
  );
  const cells = [
    { textContent: "玉" },
    { textContent: "一" },
    {
      textContent: "",
      querySelectorAll: () =>
        row.players.map((p, i) => ({
          textContent: `[架空] ${p.name} [${p.score}]`,
          getAttribute: () =>
            i === 1 ? url : url.replace("_a" + actor, "_a" + (i + 1)),
        })),
    },
    { textContent: "2026/1/1 12:30" },
  ];
  const completeRow = { querySelectorAll: () => cells };
  const run = (hasRow: boolean) => {
    let result = "";
    runInNewContext(script, {
      URL,
      location: { href: `https://saki.sapk.ch/player/${player}/12` },
      document: {
        querySelectorAll: () => [
          {
            getAttribute: () => url,
            closest: () => (hasRow ? completeRow : null),
          },
        ],
      },
      completion: (v: string) => (result = v),
    });
    return JSON.parse(result);
  };
  const data = run(true);
  expect(data.entries[0]).toMatchObject(row);
  expect(data.entries[0].rank).toBe(1);
  const saved = phoneReduce(freshPhoneState("dom-meta"), {
    action: "analysis_bulk",
    data: JSON.stringify(data),
  }).state;
  expect(saved.analysis_queue![0].history!.rank).toBe(1);
  expect(run(false).entries).toEqual([{ url }]);
  cells[1].textContent = "二";
  expect(run(true).entries).toEqual([{ url }]);
});
import { IDBFactory } from "fake-indexeddb";
import { phoneTransaction, readPhone } from "../src/offline/store";
import { synchronizeAnalysis } from "../src/offline/analysis-sync";
test("real sync transport retains metadata after a lost receipt and retries the UTF-8 CLI without duplicates", async () => {
  const folder = mkdtempSync("D:/dev-data/kyoku-loop/private/meta-transport-");
  const original = globalThis.fetch;
  globalThis.indexedDB = new IDBFactory();
  try {
    await phoneTransaction({ action: "analysis_bulk", data: batch() });
    let lost = true;
    globalThis.fetch = async (_input, options) => {
      const reply = JSON.parse(
        execFileSync("python", ["tools/p2_store.py"], {
          input: String(options!.body),
          env: { ...process.env, KYOKULOOP_DB: join(folder, "cli.sqlite3") },
          encoding: "utf8",
          windowsHide: true,
        }),
      );
      expect(reply.ok).toBe(true);
      expect(reply.data.entries[0].history.players[1].name).toBe("架空B");
      if (lost) {
        lost = false;
        throw new TypeError("simulated lost receipt");
      }
      return new Response(JSON.stringify(reply), {
        headers: { "Content-Type": "application/json" },
      });
    };
    await expect(synchronizeAnalysis()).rejects.toThrow(
      "simulated lost receipt",
    );
    expect(
      (await readPhone())!.analysis_queue![0].history!.players[1].name,
    ).toBe("架空B");
    await synchronizeAnalysis();
    await synchronizeAnalysis();
    const saved = (await readPhone())!;
    expect(saved.analysis_queue).toHaveLength(1);
    expect(saved.analysis_queue![0].received).toBeTruthy();
    expect(saved.analysis_queue![0].history!.players[1].name).toBe("架空B");
  } finally {
    globalThis.fetch = original;
    if (
      !resolve(folder).startsWith(
        resolve("D:/dev-data/kyoku-loop/private") + sep,
      )
    )
      throw Error("unsafe cleanup");
    rmSync(folder, { recursive: true });
  }
});
test("equivalent time zones do not conflict and explicit wrong rank is rejected", () => {
  const state = phoneReduce(freshPhoneState("tz"), {
    action: "analysis_bulk",
    data: batch(),
  }).state;
  expect(
    phoneReduce(state, {
      action: "analysis_bulk",
      data: batch([{ ...row, at: "2026-01-01T03:30:00.000Z" }]),
    }).data,
  ).toMatchObject({ updated: 0 });
  expect(() =>
    phoneReduce(state, {
      action: "analysis_bulk",
      data: batch([{ ...row, rank: 2 }]),
    }),
  ).toThrow();
  const restored = phoneReduce(
    phoneReduce(freshPhoneState("old"), { action: "analysis_add", url }).state,
    { action: "restore_phone", backup: state },
  ).state;
  expect(restored.analysis_queue![0].history).toEqual(
    state.analysis_queue![0].history,
  );
});

import { PhoneBulkImport } from "../src/phone-bulk-import";
test("the complete validated Safari code is available in the iPad import panel", () => {
  const code = readFileSync(
    "docs/snippets/ipad-history-metadata-shortcut.js",
    "utf8",
  );
  const html = renderToStaticMarkup(
    createElement(PhoneBulkImport, {
      disabled: false,
      historyCode: code,
      onBusy: () => {},
      onPendingChange: () => {},
      onImport: async () => ({ added: 0, existing: 0 }),
      onSaved: async () => {},
    }),
  );
  expect(html).toContain("情報付き取得コード");
  expect(html).toContain("コードをコピー");
  expect(html).toContain("kyokuloop-history");
  expect(html).toContain("readOnly");
});
