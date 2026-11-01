import { test, expect } from "@playwright/test";
import { phoneFixture } from "./phone-fixture";
import {
  freshPhoneState,
  phoneReduce,
  pendingEvents,
} from "../src/offline/engine";
import {
  syncPayload,
  hashEvent,
  validateSyncReply,
} from "../src/offline/protocol";

test("ACK validation preserves raw events, rejects missing or changed receipts and refuses a newer answer overwrite", async () => {
  let state = phoneReduce(freshPhoneState("generated"), {
    action: "install_pack",
    pack: phoneFixture(),
  }).state;
  let q = phoneReduce(state, { action: "study_start", mode: "practice" });
  state = q.state;
  const session = q.data as any;
  state = phoneReduce(state, {
    action: "study_choice",
    session: session.id,
    choice: "choose",
    answer: session.scene.own_hand[0],
  }).state;
  state = phoneReduce(state, {
    action: "study_choice",
    session: session.id,
    choice: "confirm",
  }).state;
  state = phoneReduce(state, {
    action: "study_rate",
    session: session.id,
    item: session.item_id,
    rating: "理解した",
    event: "one",
  }).state;
  const raw = structuredClone(state.events[0]);
  const payload = syncPayload(state);
  const pack = structuredClone(state.pack!);
  pack.histories[raw.item].events.push({ ...raw, undone: false });
  pack.items.find((i) => i.id === raw.item)!.review_count = 1;
  const receipt = {
    id: raw.id,
    hash: await hashEvent(raw),
    credited: raw.credited,
    before_state: Object.fromEntries(
      Object.entries(raw.before_state).reverse(),
    ) as typeof raw.before_state,
    after_state: Object.fromEntries(
      Object.entries(raw.after_state).reverse(),
    ) as typeof raw.after_state,
    reason: "practice",
  };
  const reply = {
    protocol: 1 as const,
    source: payload.source,
    device: payload.device,
    receipts: [receipt],
    pack,
  };
  await validateSyncReply(payload, reply);
  const applied = phoneReduce(state, {
    action: "apply_sync",
    snapshot: payload,
    reply,
  }).state;
  expect(applied.events[0]).toEqual(raw);
  expect(Object.keys(applied.receipts ?? {})).toEqual(["one"]);
  const undone = phoneReduce(applied, {
    action: "study_undo",
    session: session.id,
    event: "undo-one",
  }).state;
  expect(undone.events.at(-1)!.undo_of).toBe("one");
  expect(
    pendingEvents({
      ...state,
      events: [{ ...raw, id: "toString" }],
      receipts: {},
    }),
  ).toHaveLength(1);
  const view = phoneReduce(applied, { action: "state" }).data as any;
  expect(view.items.find((i: any) => i.id === raw.item).review_count).toBe(1);
  const broken = structuredClone(reply);
  broken.receipts[0].hash = "0".repeat(64);
  await expect(validateSyncReply(payload, broken)).rejects.toThrow();
  await expect(
    validateSyncReply(payload, { ...reply, receipts: [] }),
  ).rejects.toThrow();
  const newer = structuredClone(state);
  newer.events.push({ ...raw, id: "newer" });
  expect(() =>
    phoneReduce(newer, { action: "apply_sync", snapshot: payload, reply }),
  ).toThrow("sync_changed");
});

test("phone backup recovery preserves progress and event IDs, and cannot overwrite existing local records", () => {
  const pack = phoneFixture();
  let backup = phoneReduce(freshPhoneState("old-device"), {
    action: "install_pack",
    pack,
  }).state;
  const started = phoneReduce(backup, {
    action: "study_start",
    mode: "practice",
  });
  backup = started.state;
  const q = started.data as any;
  backup = phoneReduce(backup, {
    action: "study_choice",
    session: q.id,
    choice: "choose",
    answer: q.scene.own_hand[0],
  }).state;
  const restored = phoneReduce(freshPhoneState("new-device"), {
    action: "restore_phone",
    backup,
  }).state;
  expect(restored.device).toBe("new-device");
  expect(restored.session!.selected).toBe(q.scene.own_hand[0]);
  const busy = structuredClone(restored);
  busy.events.push({ id: "existing" } as any);
  expect(() => phoneReduce(busy, { action: "restore_phone", backup })).toThrow(
    "phone_restore_exists",
  );
});
