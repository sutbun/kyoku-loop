import { phoneFixture } from "./phone-fixture";
import { test, expect } from "@playwright/test";
import {
  freshPhoneState,
  phoneReduce,
  validatePhoneBackup,
} from "../src/offline/engine";
const url = (n: number) =>
  `https://game.mahjongsoul.com/?paipu=260101-fictional-bulk-${n}_a123`;
test("bulk saves all URL lines atomically and preserves duplicate metadata, answers and sessions", () => {
  let s = phoneReduce(freshPhoneState("bulk-device"), {
    action: "install_pack",
    pack: phoneFixture(),
  }).state;
  const call = (request: Record<string, unknown>) => {
    const result = phoneReduce(s, request);
    s = result.state;
    return result.data as any;
  };
  let q = call({ action: "study_start", mode: "practice" });
  call({
    action: "study_choice",
    session: q.id,
    choice: "choose",
    answer: q.scene.own_hand[0],
  });
  call({ action: "study_choice", session: q.id, choice: "confirm" });
  call({
    action: "study_rate",
    session: q.id,
    item: q.item_id,
    rating: "理解した",
    event: "bulk-unsubmitted-answer",
  });
  call({ action: "enable_local" });
  call({ action: "analysis_add", url: url(1) });
  expect(s.events).toHaveLength(1);
  expect(s.session!.index).toBe(1);
  Object.assign(s.analysis_queue![0], {
    requested: true,
    received: "2026-11-04T00:00:00Z",
    reports: ["a".repeat(64)],
    ready: true,
  });
  const original = structuredClone(s);
  const r = phoneReduce(s, {
    action: "analysis_bulk",
    data: `\ufeff${url(1)}\r\n雀魂牌譜:${url(2)}\n${url(2)}\n`,
  });
  expect(r.data).toEqual({ added: 1, existing: 1 });
  expect(r.state.analysis_queue).toHaveLength(2);
  expect(r.state.analysis_queue![0]).toEqual(original.analysis_queue![0]);
  expect(r.state.pack).toEqual(original.pack);
  expect(r.state.events).toEqual(original.events);
  expect(r.state.session).toEqual(original.session);
  expect(s).toEqual(original);
  validatePhoneBackup(r.state);
  expect(
    phoneReduce(r.state, {
      action: "analysis_bulk",
      data: `${url(1)}\n${url(2)}`,
    }).data,
  ).toEqual({ added: 0, existing: 2 });
});
test("bad line, empty input, size and count limits never partially change caller state", () => {
  const s = freshPhoneState("bulk-errors"),
    original = structuredClone(s);
  for (const data of [
    "",
    `${url(1)}\nhttps://example.invalid/`,
    Array.from({ length: 501 }, (_, i) => url(i)).join("\n"),
    "x".repeat(2 * 1024 * 1024 + 1),
  ]) {
    expect(() => phoneReduce(s, { action: "analysis_bulk", data })).toThrow();
    expect(s).toEqual(original);
  }
});
test("capacity is checked on distinct new URLs before saving the batch", () => {
  let s = freshPhoneState("capacity");
  s.analysis_queue = Array.from({ length: 999 }, (_, n) => ({
    id: url(n).split("paipu=")[1],
    url: url(n),
    created: "2026-11-04T00:00:00Z",
  }));
  const before = structuredClone(s);
  expect(() =>
    phoneReduce(s, {
      action: "analysis_bulk",
      data: `${url(1001)}\n${url(1002)}`,
    }),
  ).toThrow("queue_full");
  expect(s).toEqual(before);
  const r = phoneReduce(s, {
    action: "analysis_bulk",
    data: `${url(1)}\n${url(1001)}`,
  });
  expect(r.state.analysis_queue).toHaveLength(1000);
  expect(r.data).toEqual({ added: 1, existing: 1 });
});
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { phoneTransaction, readPhone } from "../src/offline/store";
import { lockUpdate, unlockUpdate } from "../src/offline/update-lock";
import { readAnalysisFile } from "../src/analysis-queue";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve, sep } from "node:path";
test("text file supports UTF-8 BOM/CRLF and rejects bad encoding and oversized or invalid files", async () => {
  expect(
    await readAnalysisFile(new Blob(["\ufeff" + url(1) + "\r\n" + url(2)])),
  ).toBe(url(1) + "\r\n" + url(2));
  await expect(
    readAnalysisFile(new Blob([new Uint8Array([0xff, 0xfe, 0x00])])),
  ).rejects.toThrow("invalid_bulk_text");
  await expect(readAnalysisFile(new Blob(["not replay URLs"]))).rejects.toThrow(
    "invalid_bulk_text",
  );
  await expect(
    readAnalysisFile(new Blob(["x".repeat(2 * 1024 * 1024 + 1)])),
  ).rejects.toThrow("bulk_text_limit");
});
test("IndexedDB commits complete batch; failed put and update locks preserve the previous state", async () => {
  globalThis.indexedDB = new IDBFactory();
  await phoneTransaction({ action: "analysis_add", url: url(1) });
  const before = await readPhone();
  const descriptor = Object.getOwnPropertyDescriptor(
    IDBObjectStore.prototype,
    "put",
  )!;
  Object.defineProperty(IDBObjectStore.prototype, "put", {
    ...descriptor,
    value() {
      throw new DOMException("full", "QuotaExceededError");
    },
  });
  try {
    await expect(
      phoneTransaction({
        action: "analysis_bulk",
        data: url(2) + "\n" + url(3),
      }),
    ).rejects.toThrow("full");
  } finally {
    Object.defineProperty(IDBObjectStore.prototype, "put", descriptor);
  }
  expect(await readPhone()).toEqual(before);
  expect(lockUpdate("bulk-test")).toBe(true);
  try {
    await expect(
      phoneTransaction({ action: "analysis_bulk", data: url(2) }),
    ).rejects.toThrow("update_in_progress");
  } finally {
    unlockUpdate("bulk-test");
  }
  await phoneTransaction({
    action: "analysis_bulk",
    data: url(2) + "\n" + url(3),
  });
  expect((await readPhone())!.analysis_queue).toHaveLength(3);
});
test("bulk URL queue synchronizes to isolated Windows storage, retries without duplicates and restores from backup", () => {
  const folder = mkdtempSync("D:/dev-data/kyoku-loop/private/bulk-sync-");
  try {
    const before = freshPhoneState("bulk-sync-device");
    const saved = phoneReduce(before, {
      action: "analysis_bulk",
      data: [url(1), url(2), url(3)].join("\n"),
    }).state;
    const snapshot = saved.analysis_queue!;
    const python = `import sys,json\nfrom tools.p2_store import Store\ns=Store(sys.argv[1])\nr=json.loads(sys.stdin.read())\na=s.analysis_receive(r)\nb=s.analysis_receive(r)\nassert len(s.analysis_entries())==3\nassert a['entries']==b['entries']\nprint(json.dumps(b))\ns.close()`;
    const reply = JSON.parse(
      execFileSync("python", ["-c", python, join(folder, "test.sqlite3")], {
        input: JSON.stringify(snapshot),
        encoding: "utf8",
        windowsHide: true,
      }),
    );
    const received = phoneReduce(saved, {
      action: "analysis_ack",
      snapshot,
      entries: reply.entries,
      received_at: reply.received_at,
    }).state;
    expect(received.analysis_queue!.every((e) => e.received)).toBe(true);
    expect(received.analysis_queue!.map((e) => e.url)).toEqual(
      snapshot.map((e) => e.url),
    );
    const restored = phoneReduce(freshPhoneState("restored"), {
      action: "restore_phone",
      backup: received,
    }).state;
    expect(restored.analysis_queue).toHaveLength(3);
  } finally {
    if (
      !resolve(folder).startsWith(
        resolve("D:/dev-data/kyoku-loop/private") + sep,
      )
    )
      throw Error("Unsafe cleanup target");
    rmSync(folder, { recursive: true });
  }
});
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
test("Safari export returns only deduplicated own URLs and stops for zero or wrong pages", () => {
  const script = readFileSync("docs/snippets/ipad-history-shortcut.js", "utf8");
  const actor = 1358437 + ((7 * 12345 + 1117113) ^ 86216345);
  const own = (n: number) =>
    `https://game.mahjongsoul.com/?paipu=260101-fictional-test-${n}_a${actor}`;
  const run = (
    links: string[],
    page = "https://saki.sapk.ch/player/12345/12",
  ) => {
    let value: any;
    runInNewContext(script, {
      URL,
      location: { href: page },
      document: {
        querySelectorAll: () =>
          links.map((href) => ({ getAttribute: () => href })),
      },
      completion: (v: any) => {
        expect(value).toBeUndefined();
        value = v;
      },
    });
    return value;
  };
  expect(
    run([
      own(1),
      own(1),
      "https://mjai.ekyu.moe/ja.html?url=" + encodeURIComponent(own(2)),
      url(3),
    ]),
  ).toBe(own(1) + "\n" + own(2));
  expect(() => run([])).toThrow("対象URL");
  expect(() => run([own(1)], "https://example.invalid/")).toThrow("牌譜屋");
  expect(
    run(Array.from({ length: 25 }, (_, n) => own(n))).split("\n"),
  ).toHaveLength(25);
  expect(
    run(Array.from({ length: 501 }, (_, n) => own(n))).split("\n"),
  ).toHaveLength(500);
});
test("bulk refuses a result beyond the device backup size boundary without making existing storage unreadable", async () => {
  globalThis.indexedDB = new IDBFactory();
  await phoneTransaction({ action: "state" });
  const state = freshPhoneState("padding");
  const overhead =
    new TextEncoder().encode(JSON.stringify(state)).length - "padding".length;
  state.device = "x".repeat(20 * 1024 * 1024 - overhead - 10);
  validatePhoneBackup(state);
  await new Promise<void>((resolve, reject) => {
    const open = indexedDB.open("kyokuloop-phone-v1", 1);
    open.onsuccess = () => {
      const db = open.result,
        tx = db.transaction("local", "readwrite");
      tx.objectStore("local").put(state, "state");
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error);
      };
    };
    open.onerror = () => reject(open.error);
  });
  await expect(
    phoneTransaction({ action: "analysis_bulk", data: url(1) }),
  ).rejects.toThrow("invalid_phone_backup");
  expect(await readPhone()).toEqual(state);
});
