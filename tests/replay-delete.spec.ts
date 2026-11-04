import { test, expect } from "@playwright/test";
import {
  freshPhoneState,
  phoneReduce,
  validatePhoneBackup,
} from "../src/offline/engine";
import { phoneFixture } from "./phone-fixture";
const url = (n: number) =>
  `https://game.mahjongsoul.com/?paipu=260101-fictional-delete-${n}`;

test("bulk deletion changes only list visibility and survives stale receipt, restore and explicit re-add", () => {
  let s = phoneReduce(freshPhoneState("delete-device"), {
    action: "install_pack",
    pack: phoneFixture(),
  }).state;
  s = phoneReduce(s, {
    action: "analysis_bulk",
    data: url(1) + "\n" + url(2),
  }).state;
  const before = structuredClone(s);
  const ids = s.analysis_queue!.map((e) => e.id);
  s = phoneReduce(s, { action: "analysis_delete", ids }).state;
  expect(s.analysis_queue!.every((e) => e.visibility?.deleted)).toBe(true);
  expect(s.pack).toEqual(before.pack);
  expect(s.events).toEqual(before.events);
  expect(s.session).toEqual(before.session);
  validatePhoneBackup(s);
  const stale = before.analysis_queue!.map((e) => ({
    ...e,
    requested: false,
    reports: [],
  }));
  s = phoneReduce(s, {
    action: "analysis_ack",
    entries: stale,
    snapshot: before.analysis_queue,
    received_at: "2026-11-04T01:00:00Z",
  }).state;
  expect(s.analysis_queue!.every((e) => e.visibility?.deleted)).toBe(true);
  s = phoneReduce(s, { action: "analysis_add", url: url(1) }).state;
  expect(s.analysis_queue![0].visibility).toEqual({
    revision: 2,
    deleted: false,
  });
  expect(s.analysis_queue![1].visibility?.deleted).toBe(true);
  const restored = phoneReduce(freshPhoneState("restored"), {
    action: "restore_phone",
    backup: s,
  }).state;
  expect(restored.analysis_queue).toEqual(
    s.analysis_queue!.map(({ received, requested, reports, ready, ...e }) => e),
  );
});

test("unknown IDs or malformed delete batches never partially change state", () => {
  const s = phoneReduce(freshPhoneState(), {
    action: "analysis_add",
    url: url(1),
  }).state;
  const before = structuredClone(s);
  for (const ids of [
    [],
    [s.analysis_queue![0].id, "missing"],
    [s.analysis_queue![0].id, s.analysis_queue![0].id],
    "bad",
  ])
    expect(() => phoneReduce(s, { action: "analysis_delete", ids })).toThrow();
  expect(s).toEqual(before);
});
