import { test, expect } from "@playwright/test";
import {
  freshPhoneState,
  phoneReduce,
  type PhonePack,
} from "../src/offline/engine";

// The production normalizer generates this fixture for existing P2/P3 tests.
import { execFileSync } from "node:child_process";
const pack = JSON.parse(
  execFileSync(
    "python",
    [
      "-c",
      `
import sys,json,tempfile
from pathlib import Path
sys.path.insert(0,'tests')
from test_p3_study import five_fixture
from tools.p2_store import Store
with tempfile.TemporaryDirectory(dir='D:/dev-data/kyoku-loop/private') as temp:
 s=Store(Path(temp)/'test.sqlite3')
 try:
  r=s.commit(s.stage(json.dumps(five_fixture()).encode(),None)['token'],0,0,None)
  for scene in s.detail(r['id'])['decisions'][3:]:s.save(r['id'],scene['id'],True)
  s.db.execute("UPDATE study_items SET due='2026-01-02'");s.db.commit()
  print(json.dumps(s.phone_pack(),ensure_ascii=True))
 finally:s.close()
`,
    ],
    { encoding: "utf8", windowsHide: true },
  ),
) as PhonePack;

test("phone uses the same intervals, redaction, event deduplication and graduation as Windows", () => {
  let state = freshPhoneState("generated-device");
  state = phoneReduce(
    state,
    { action: "install_pack", pack },
    "2026-01-02T01:00:00+09:00",
  ).state;
  let at = "2026-01-02T01:00:00+09:00";
  let seq = 0;
  const call = (r: object) => {
    const result = phoneReduce(state, r, at);
    state = result.state;
    return result.data as any;
  };
  for (const [n, days] of [3, 7, 14, 30, null].entries()) {
    let q = call({ action: "study_start", mode: "scheduled" });
    expect(q.total).toBe(5);
    while (!q.complete) {
      expect(q.scene.actual).toBeUndefined();
      expect(q.scene.suggested).toBeUndefined();
      call({
        action: "study_choice",
        session: q.id,
        choice: "choose",
        answer: q.scene.own_hand[0],
      });
      const revealed = call({
        action: "study_choice",
        session: q.id,
        choice: "confirm",
      });
      expect(revealed.scene.actual).toBeTruthy();
      const request = {
        action: "study_rate",
        session: q.id,
        item: q.item_id,
        rating: "理解した",
        event: `generated-${++seq}`,
      };
      q = call(request);
      expect(call(request)).toEqual(q);
    }
    const items = call({ action: "state" }).items;
    expect(items.every((i: any) => i.streak === n + 1)).toBe(true);
    if (days) {
      const expected = new Date(new Date(at).getTime() + days * 86400000)
        .toISOString()
        .slice(0, 10);
      // at is 01:00 JST, so the ISO date is the preceding UTC date.
      const expectedJst = new Date(
        new Date(expected + "T00:00:00Z").getTime() + 86400000,
      )
        .toISOString()
        .slice(0, 10);
      expect(items.every((i: any) => i.due === expectedJst)).toBe(true);
      at = items[0].due + "T01:00:00+09:00";
    } else expect(items.every((i: any) => i.status === "習得済み")).toBe(true);
  }
  expect(state.events).toHaveLength(25);
});

test("practice, undo and pack replacement preserve unsubmitted history", () => {
  let state = phoneReduce(
    freshPhoneState("device"),
    { action: "install_pack", pack },
    "2026-01-02T01:00:00+09:00",
  ).state;
  const at = "2026-01-02T01:00:00+09:00";
  const call = (r: object) => {
    const x = phoneReduce(state, r, at);
    state = x.state;
    return x.data as any;
  };
  const q = call({ action: "study_start", mode: "practice" });
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
    event: "practice",
  });
  expect(state.pack!.items.every((i) => i.streak === 0)).toBe(true);
  call({ action: "study_undo", session: q.id, event: "undo" });
  expect(state.events).toHaveLength(2);
  expect(call({ action: "study_current" }).revealed).toBe(true);
  expect(() => call({ action: "install_pack", pack })).toThrow();
  expect(state.events).toHaveLength(2);
});

test("JST day boundary, repeat rating, pause/resume and a new graduation cycle match Windows rules", () => {
  const one = structuredClone(pack);
  one.items = one.items.slice(0, 1);
  const i = one.items[0];
  i.status = "復習中";
  i.streak = 4;
  let state = phoneReduce(
    freshPhoneState("generated-device"),
    { action: "install_pack", pack: one },
    "2026-01-01T14:59:59Z",
  ).state;
  let at = "2026-01-01T14:59:59Z";
  const call = (r: object) => {
    const x = phoneReduce(state, r, at);
    state = x.state;
    return x.data as any;
  };
  expect(call({ action: "state" }).due_count).toBe(0);
  at = "2026-01-01T15:00:00Z";
  expect(call({ action: "state" }).due_count).toBe(1);
  const answer = (rating: string, event: string) => {
    const q = call({ action: "study_start", mode: "scheduled" });
    call({
      action: "study_choice",
      session: q.id,
      choice: "choose",
      answer: q.scene.own_hand[0],
    });
    call({ action: "study_choice", session: q.id, choice: "confirm" });
    return call({
      action: "study_rate",
      session: q.id,
      item: q.item_id,
      rating,
      event,
    });
  };
  answer("理解した", "graduate");
  expect(state.pack!.items[0].status).toBe("習得済み");
  const oldCycle = state.pack!.items[0].cycle;
  call({
    action: "study_control",
    item: i.id,
    control: "restart",
    event: "restart",
  });
  expect(state.pack!.items[0].cycle).not.toBe(oldCycle);
  expect(state.pack!.items[0].streak).toBe(0);
  answer("再復習", "again");
  expect(state.pack!.items[0].due).toBe("2026-01-03");
  expect(call({ action: "state" }).due_count).toBe(0);
  call({
    action: "study_control",
    item: i.id,
    control: "pause",
    event: "pause",
  });
  expect(state.pack!.items[0].due).toBe("");
  call({
    action: "study_control",
    item: i.id,
    control: "resume",
    event: "resume",
  });
  expect(state.pack!.items[0].due).toBe("2026-01-03");
  call({
    action: "study_undo_control",
    original: "resume",
    event: "undo-resume",
  });
  expect(state.pack!.items[0].status).toBe("保留");
  expect(state.events).toHaveLength(6);
});
