import type { LocalMaterial } from "./mortal-compiler";
import { validFinalScores } from "../mortal-source-match";
import { reconcileLocalSources } from "./source-links";
import type {
  HistoryEvent,
  ItemHistory,
  LibraryItem,
  Scene,
  StudySession,
  Workspace,
} from "../real-types";
import {
  sourceURL,
  parseAnalysisBatch,
  normalizeAnalysisHistory,
  sameAnalysisHistory,
  validateAnalysisQueue,
  type AnalysisEntry,
} from "../analysis-queue";

export type ItemState = {
  status: string;
  due: string;
  streak: number;
  cycle: string;
  last_credit_day: string;
  revision: number;
};
export type PhoneItem = LibraryItem & ItemState;
export type PhonePack = {
  schema: 1;
  policy: 1 | 2;
  source: string;
  exported_at: string;
  items: PhoneItem[];
  histories: Record<string, ItemHistory>;
  reveals?: Record<string, string[][]>;
};
type QueueEntry = { id: string; cycle: string; revision: number };
type LocalSession = {
  id: string;
  mode: "scheduled" | "practice";
  index: number;
  selected: string | null;
  revealed: boolean;
  queue: QueueEntry[];
  answers: { event: string; index: number }[];
};
export type PhoneEvent = Omit<HistoryEvent, "undone"> & {
  item: string;
  session: string | null;
  before_state: ItemState;
  after_state: ItemState;
  request: string;
  mode?: "scheduled" | "practice";
};
export type Receipt = {
  id: string;
  hash: string;
  credited: number;
  before_state: ItemState;
  after_state: ItemState;
  reason: string;
};
export type LocalImport = {
  material: LocalMaterial;
  item_ids: string[];
  analysis_id: string | null;
  final_scores?: number[] | null;
  source_link_kind?: "scores" | "identity";
  synced_source?: string;
};
export type PhoneState = {
  schema: 1 | 2;
  local_imports?: LocalImport[];
  local_source?: string;
  device: string;
  pack: PhonePack | null;
  events: PhoneEvent[];
  session: LocalSession | null;
  sequence: number;
  receipts?: Record<string, Receipt>;
  last_sync?: string;
  analysis_queue?: AnalysisEntry[];
};
type Request = Record<string, any>;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
export const freshPhoneState = (
  device: string = crypto.randomUUID(),
): PhoneState => ({
  schema: 1,
  device,
  pack: null,
  events: [],
  session: null,
  sequence: 0,
});
const fail = (code: string): never => {
  throw new Error(code);
};
export const jstDay = (at: string) =>
  new Date(new Date(at).getTime() + 9 * 3600000).toISOString().slice(0, 10);
const addDays = (day: string, n: number) =>
  new Date(Date.parse(day + "T00:00:00Z") + n * 86400000)
    .toISOString()
    .slice(0, 10);
const statuses = ["未学習", "復習中", "習得済み", "保留"];
const tile = (t: unknown) =>
  typeof t === "string" && /^(?:[1-9][mps]|5[mps]r|[ESWNPFC])$/.test(t);
const int = (n: unknown, min: number, max = Number.MAX_SAFE_INTEGER) =>
  Number.isInteger(n) && Number(n) >= min && Number(n) <= max;
const date = (s: unknown) =>
  typeof s === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
export function validatePack(value: unknown): asserts value is PhonePack {
  const p = value as PhonePack;
  try {
    if (
      !p ||
      p.schema !== 1 ||
      ![1, 2].includes(p.policy) ||
      typeof p.source !== "string" ||
      !p.source ||
      !Number.isFinite(Date.parse(p.exported_at)) ||
      !Array.isArray(p.items) ||
      p.items.length > 5000 ||
      typeof p.histories !== "object" ||
      !p.histories
    )
      fail("invalid_pack");
    if (new TextEncoder().encode(JSON.stringify(p)).length > 20 * 1024 * 1024)
      fail("pack_large");
    const ids = new Set<string>();
    for (const i of p.items) {
      if (
        typeof i.id !== "string" ||
        !i.id ||
        ids.has(i.id) ||
        !statuses.includes(i.status) ||
        !int(i.streak, 0, 5) ||
        !int(i.revision, 0) ||
        !i.cycle ||
        (i.due !== "" && !date(i.due)) ||
        (i.last_credit_day !== "" && !date(i.last_credit_day))
      )
        fail("invalid_pack");
      ids.add(i.id);
      const s = i.scene;
      if (s?.engine !== undefined && !["NAGA", "Mortal"].includes(s.engine))
        fail("invalid_pack");
      if (s?.engine === "Mortal" && p.policy !== 2) fail("invalid_pack");
      if (
        !s ||
        s.id !== i.id ||
        !int(s.seat, 0, 3) ||
        !int(s.kyoku, 1, 4) ||
        !int(s.honba, 0) ||
        !int(s.kyotaku, 0) ||
        !Array.isArray(s.own_hand) ||
        s.own_hand.length !== 14 - 3 * s.melds[s.seat].length ||
        !s.own_hand.every(tile) ||
        !s.own_hand.includes(s.actual!) ||
        !s.own_hand.includes(s.suggested!) ||
        !Number.isFinite(s.gap) ||
        s.gap! < 0 ||
        s.gap! > 100 ||
        (s.drawn !== null && !s.own_hand.includes(s.drawn))
      )
        fail("invalid_pack");
      if (
        !Array.isArray(s.scores) ||
        s.scores.length !== 4 ||
        !s.scores.every((n) => int(n, -1000000, 1000000)) ||
        !Array.isArray(s.rivers) ||
        s.rivers.length !== 4 ||
        !Array.isArray(s.melds) ||
        s.melds.length !== 4 ||
        !s.dora_markers.length ||
        !s.dora_markers.every(tile)
      )
        fail("invalid_pack");
      if (
        s.reach_declared.length !== 4 ||
        s.reach_accepted.length !== 4 ||
        ![...s.reach_declared, ...s.reach_accepted].every(
          (v) => typeof v === "boolean",
        )
      )
        fail("invalid_pack");
      if (
        !s.weights_percent ||
        s.weights_percent.length !== 34 ||
        !s.weights_percent.every(
          (w) => Number.isFinite(w) && w >= 0 && w <= 100,
        ) ||
        Math.abs(s.weights_percent.reduce((a, b) => a + b, 0) - 100) > 0.001
      )
        fail("invalid_pack");
      if (
        s.policy_percent !== undefined &&
        (s.engine !== "Mortal" ||
          !Array.isArray(s.policy_percent) ||
          s.policy_percent.length !== 37 ||
          !s.policy_percent.every(
            (w) => Number.isFinite(w) && w >= 0 && w <= 100,
          ) ||
          Math.abs(s.policy_percent.reduce((a, b) => a + b, 0) - 100) > 0.001)
      )
        fail("invalid_pack");
      const visible = [...s.own_hand, ...s.dora_markers];
      for (const river of s.rivers)
        for (const r of river) {
          if (
            !tile(r.tile) ||
            typeof r.called !== "boolean" ||
            typeof r.reach !== "boolean"
          )
            fail("invalid_pack");
          if (!r.called) visible.push(r.tile);
        }
      for (const melds of s.melds)
        for (const m of melds) {
          if (
            !["chi", "pon", "daiminkan", "ankan", "kakan"].includes(m.type) ||
            !m.consumed.every(tile)
          )
            fail("invalid_pack");
          visible.push(
            ...m.consumed,
            ...(m.tile ? [m.tile] : []),
            ...(m.added ? [m.added] : []),
          );
        }
      const counts: Record<string, number> = {};
      if (p.reveals && Object.hasOwn(p.reveals, i.id)) {
        const hands = p.reveals[i.id];
        if (
          !Array.isArray(hands) ||
          hands.length !== 4 ||
          hands.some(
            (hand) =>
              !Array.isArray(hand) || hand.length > 14 || !hand.every(tile),
          ) ||
          JSON.stringify([...hands[s.seat]].sort()) !==
            JSON.stringify([...s.own_hand].sort())
        )
          fail("invalid_pack");
        hands.forEach((hand, seat) => {
          if (seat !== s.seat) visible.push(...hand);
        });
      }
      for (const t of visible) {
        const k = t.replace(/r$/, "");
        counts[k] = (counts[k] ?? 0) + 1;
        if (counts[k] > 4) fail("invalid_pack");
      }
      if (
        "tehais" in s ||
        "hands" in s ||
        "wall" in s ||
        !p.histories[i.id] ||
        p.histories[i.id].id !== i.id ||
        !Array.isArray(p.histories[i.id].events)
      )
        fail("invalid_pack");
    }
    if (
      p.reveals !== undefined &&
      (!p.reveals ||
        typeof p.reveals !== "object" ||
        Array.isArray(p.reveals) ||
        Object.keys(p.reveals).some((id) => !ids.has(id)))
    )
      fail("invalid_pack");
  } catch (e) {
    if (
      e instanceof Error &&
      ["invalid_pack", "pack_large"].includes(e.message)
    )
      throw e;
    fail("invalid_pack");
  }
}
export function validateMaterial(
  value: unknown,
): asserts value is LocalMaterial {
  const m = value as LocalMaterial;
  try {
    if (
      !m ||
      !/^[a-f0-9]{64}$/.test(m.id) ||
      !/^[a-f0-9]{64}$/.test(m.game) ||
      !int(m.seat, 0, 3) ||
      typeof m.model !== "string" ||
      !int(m.rounds, 1, 256) ||
      !Number.isFinite(Date.parse(m.created)) ||
      !Array.isArray(m.players) ||
      m.players.length !== 4 ||
      !m.players.every((n) => typeof n === "string" && n.length <= 100) ||
      !Array.isArray(m.family_ids) ||
      m.family_ids.length > 100000 ||
      !m.family_ids.every((id) => /^[a-f0-9]{64}$/.test(id)) ||
      !Array.isArray(m.items) ||
      m.items.length > 3 ||
      typeof m.payload !== "string" ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(m.payload)
    )
      fail("invalid_phone_backup");
    const histories = Object.fromEntries(
      m.items.map((i) => [i.id, { id: i.id, events: [] }]),
    );
    validatePack({
      schema: 1,
      policy: 2,
      source: "material",
      exported_at: m.created,
      items: m.items,
      histories,
      reveals: m.reveals,
    });
    for (const i of m.items)
      if (
        i.report !== m.id ||
        !m.family_ids.includes(i.id) ||
        i.scene.seat !== m.seat ||
        i.revision !== 0 ||
        i.status !== "未学習" ||
        i.cycle !== "initial" ||
        i.streak !== 0 ||
        i.last_credit_day !== "" ||
        i.automatic !== 1 ||
        i.manual !== 0 ||
        i.due !== addDays(jstDay(m.created), 1)
      )
        fail("invalid_phone_backup");
  } catch {
    fail("invalid_phone_backup");
  }
}
const receiptFor = (state: PhoneState, id: string) =>
  state.receipts && Object.hasOwn(state.receipts, id)
    ? state.receipts[id]
    : undefined;
export const pendingEvents = (state: PhoneState) =>
  state.events.filter((e) => !receiptFor(state, e.id));
export function isItemState(value: unknown): value is ItemState {
  const i = value as ItemState;
  return (
    !!i &&
    typeof i === "object" &&
    Object.keys(i).length === 6 &&
    statuses.includes(i.status) &&
    int(i.streak, 0, 5) &&
    int(i.revision, 0) &&
    typeof i.cycle === "string" &&
    !!i.cycle &&
    (i.due === "" || date(i.due)) &&
    (i.last_credit_day === "" || date(i.last_credit_day))
  );
}
export function validatePhoneBackup(
  value: unknown,
): asserts value is PhoneState {
  const s = value as PhoneState;
  try {
    if (
      !s ||
      ![1, 2].includes(s.schema) ||
      typeof s.device !== "string" ||
      !s.device ||
      !Array.isArray(s.events) ||
      !int(s.sequence, 0)
    )
      fail("invalid_phone_backup");
    if (new TextEncoder().encode(JSON.stringify(s)).length > 20 * 1024 * 1024)
      fail("invalid_phone_backup");
    if (s.schema === 1 && (s.local_imports || s.local_source))
      fail("invalid_phone_backup");
    if (s.schema === 2) {
      if (!Array.isArray(s.local_imports) || s.local_imports.length > 1000)
        fail("invalid_phone_backup");
      if (
        s.local_source !== undefined &&
        (!s.local_source.startsWith("local:") ||
          s.pack?.source !== s.local_source)
      )
        fail("invalid_phone_backup");
      const reports = new Set<string>();
      for (const entry of s.local_imports!) {
        validateMaterial(entry.material);
        if (
          entry.final_scores !== undefined &&
          entry.final_scores !== null &&
          !validFinalScores(entry.final_scores)
        )
          fail("invalid_phone_backup");
        if (
          entry.source_link_kind !== undefined &&
          (!entry.analysis_id ||
            !["scores", "identity"].includes(entry.source_link_kind))
        )
          fail("invalid_phone_backup");
        if (
          reports.has(entry.material.id) ||
          !Array.isArray(entry.item_ids) ||
          entry.item_ids.length > 3 ||
          new Set(entry.item_ids).size !== entry.item_ids.length ||
          entry.item_ids.some(
            (id) =>
              !entry.material.items.some((i) => i.id === id) ||
              !s.pack?.items.some((i) => i.id === id),
          ) ||
          (entry.analysis_id !== null &&
            typeof entry.analysis_id !== "string") ||
          (entry.synced_source !== undefined &&
            entry.synced_source !== s.pack?.source)
        )
          fail("invalid_phone_backup");
        reports.add(entry.material.id);
      }
    }
    if (s.analysis_queue !== undefined) validateAnalysisQueue(s.analysis_queue);
    if (!s.pack) {
      if (s.events.length || s.session) fail("invalid_phone_backup");
      return;
    }
    validatePack(s.pack);
    const ids = new Set<string>();
    const validState = isItemState;
    for (const e of s.events) {
      const item = s.pack.items.find((i) => i.id === e.item);
      if (
        !item ||
        typeof e.id !== "string" ||
        !e.id ||
        ids.has(e.id) ||
        !["answer", "undo", "pause", "resume", "restart"].includes(e.kind) ||
        !Number.isFinite(Date.parse(e.at)) ||
        jstDay(e.at) !== e.day ||
        typeof e.device !== "string" ||
        !e.device ||
        typeof e.request !== "string" ||
        !validState(e.before_state) ||
        !validState(e.after_state) ||
        e.after_state.revision !== e.before_state.revision + 1 ||
        e.cycle !== e.before_state.cycle ||
        ![0, 1].includes(e.credited)
      )
        fail("invalid_phone_backup");
      if (
        e.kind === "answer" &&
        (!item!.scene.own_hand.includes(e.answer!) ||
          !["理解した", "再復習", "保留"].includes(e.rating!))
      )
        fail("invalid_phone_backup");
      if (e.kind === "undo" && (typeof e.undo_of !== "string" || !e.undo_of))
        fail("invalid_phone_backup");
      ids.add(e.id);
    }
    if (
      s.receipts &&
      (typeof s.receipts !== "object" ||
        Object.entries(s.receipts).some(
          ([id, r]) =>
            !ids.has(id) ||
            r.id !== id ||
            !/^[a-f0-9]{64}$/.test(r.hash) ||
            !validState(r.before_state) ||
            !validState(r.after_state),
        ))
    )
      fail("invalid_phone_backup");
    if (s.session) {
      const q = s.session;
      if (
        !["practice", "scheduled"].includes(q.mode) ||
        typeof q.id !== "string" ||
        !int(q.index, 0, q.queue.length) ||
        q.queue.length > 5 ||
        typeof q.revealed !== "boolean" ||
        !q.queue.every(
          (x) =>
            s.pack!.items.some((i) => i.id === x.id) &&
            int(x.revision, 0) &&
            !!x.cycle,
        ) ||
        !q.answers.every(
          (x) => ids.has(x.event) && int(x.index, 0, q.index - 1),
        )
      )
        fail("invalid_phone_backup");
      if (
        q.selected !== null &&
        (!q.queue[q.index] ||
          !s.pack.items
            .find((i) => i.id === q.queue[q.index].id)!
            .scene.own_hand.includes(q.selected))
      )
        fail("invalid_phone_backup");
      if (q.revealed && q.selected === null) fail("invalid_phone_backup");
    }
  } catch (e) {
    if (e instanceof Error && e.message === "unsupported_storage") throw e;
    fail("invalid_phone_backup");
  }
}
const itemState = (i: PhoneItem): ItemState => ({
  status: i.status,
  due: i.due,
  streak: i.streak,
  cycle: i.cycle,
  last_credit_day: i.last_credit_day,
  revision: i.revision,
});
const publicScene = (s: Scene): Scene => {
  const {
    actual,
    suggested,
    gap,
    weights_percent,
    policy_percent,
    model_name,
    ...publicValue
  } = s;
  return clone(publicValue);
};
const signature = (r: Request) =>
  JSON.stringify(
    Object.fromEntries(
      Object.keys(r)
        .filter((k) => k !== "event")
        .sort()
        .map((k) => [k, r[k]]),
    ),
  );
export function phoneReduce(
  input: PhoneState,
  request: Request,
  at = new Date().toISOString(),
): { state: PhoneState; data: unknown } {
  if (![1, 2].includes(input.schema)) fail("unsupported_storage");
  const state = clone(input);
  const r = request;
  const day = jstDay(at);
  const item = (id: string): PhoneItem =>
    state.pack?.items.find((i) => i.id === id) ?? fail("item_not_found");
  const active = (s = state.session): PhoneItem => {
    if (!s || s.index >= s.queue.length) fail("session_complete");
    const q = s!.queue[s!.index];
    const i = item(q.id);
    if (
      i.revision !== q.revision ||
      i.cycle !== q.cycle ||
      !["未学習", "復習中"].includes(i.status)
    )
      fail("study_changed");
    return i;
  };
  const event = (id: string) => {
    const raw = state.events.find((e) => e.id === id) ?? fail("cannot_undo");
    return { ...raw, ...receiptFor(state, id) };
  };
  const reviewCount = (i: PhoneItem) =>
    (i.review_count ?? 0) +
    state.events.filter(
      (e) =>
        e.item === i.id &&
        e.kind === "answer" &&
        !state.pack!.histories[i.id]?.events.some((h) => h.id === e.id),
    ).length;
  const queue = (mode: string) =>
    [...(state.pack?.items ?? [])]
      .filter(
        (i) =>
          ["未学習", "復習中"].includes(i.status) &&
          (mode === "practice" ||
            (!!i.due && i.due <= day && i.last_credit_day !== day)),
      )
      .sort(
        (a, b) =>
          (mode === "practice" ? reviewCount(a) - reviewCount(b) : 0) ||
          (a.status === "復習中" ? 0 : a.manual ? 1 : 2) -
            (b.status === "復習中" ? 0 : b.manual ? 1 : 2) ||
          a.due.localeCompare(b.due) ||
          a.id.localeCompare(b.id),
      )
      .slice(0, 5);
  const view = (): StudySession | null => {
    const s = state.session;
    if (!s) return null;
    const complete = s.index >= s.queue.length;
    const v: StudySession = {
      id: s.id,
      mode: s.mode,
      index: s.index,
      total: s.queue.length,
      selected: s.selected,
      revealed: s.revealed,
      complete,
      scene: null,
      stale: false,
      can_undo: !!s.answers.length && s.answers.at(-1)!.index === s.index - 1,
      answers: s.answers.map((a) => {
        const e = event(a.event);
        return {
          id: e.id,
          item: e.item,
          rating: e.rating!,
          credited: e.credited,
          day: e.day,
        };
      }),
    };
    if (!complete) {
      try {
        const i = active();
        v.item_id = i.id;
        v.scene = s.revealed ? clone(i.scene) : publicScene(i.scene);
      } catch {
        v.stale = true;
        v.selected = null;
        v.revealed = false;
      }
    }
    return v;
  };
  const push = (
    ident: string,
    kind: string,
    before: ItemState,
    after: ItemState,
    extras: Partial<PhoneEvent> = {},
  ) => {
    if (typeof r.event !== "string" || !r.event || r.event.length > 100)
      fail("event_id_required");
    const e: PhoneEvent = {
      id: r.event,
      item: ident,
      kind,
      at: new Date(at).toISOString(),
      day,
      device: state.device,
      cycle: before.cycle,
      session: null,
      answer: null,
      rating: null,
      credited: 0,
      undo_of: null,
      before_state: before,
      after_state: after,
      request: signature(r),
      ...(kind === "answer" ? { mode: state.session!.mode } : {}),
      ...extras,
    };
    state.events.push(e);
    Object.assign(item(ident), after);
  };
  const undo = (original: string) => {
    const e = event(original);
    const i = item(e.item);
    if (
      state.events.some((x) => x.undo_of === e.id) ||
      Object.keys(itemState(i)).some(
        (k) =>
          itemState(i)[k as keyof ItemState] !==
          e.after_state[k as keyof ItemState],
      )
    )
      fail("study_changed");
    const restored = { ...e.before_state, revision: i.revision + 1 };
    push(i.id, "undo", itemState(i), restored, { undo_of: original });
    return { e, restored };
  };
  let data: unknown;
  if (r.event) {
    const e = state.events.find((e) => e.id === r.event);
    if (e) {
      if (e.request !== signature(r)) fail("event_conflict");
      return {
        state: input,
        data: ["study_rate", "study_undo"].includes(r.action)
          ? view()
          : { event: e.id },
      };
    }
  }
  switch (r.action) {
    case "enable_local": {
      state.schema = 2;
      state.local_imports ??= [];
      data = { enabled: true };
      break;
    }
    case "register_local": {
      if (state.schema !== 2) fail("runtime_missing");
      validateMaterial(r.material);
      const material = r.material as LocalMaterial;
      if (
        r.final_scores !== undefined &&
        r.final_scores !== null &&
        !validFinalScores(r.final_scores)
      )
        fail("invalid_receipt");
      const existing = state.local_imports!.find(
        (e) => e.material.id === material.id,
      );
      if (existing) {
        if (r.analysis_id && r.analysis_id !== existing.analysis_id) {
          if (existing.analysis_id) fail("source_conflict");
          if (!state.analysis_queue?.some((e) => e.id === r.analysis_id))
            fail("queue_not_found");
          existing.analysis_id = r.analysis_id;
          delete existing.source_link_kind;
          delete existing.synced_source;
          data = { id: material.id, duplicate: true };
          break;
        }
        if (existing.final_scores === undefined && r.final_scores !== undefined)
          existing.final_scores = clone(r.final_scores);
        reconcileLocalSources(state);
        data = { id: material.id, duplicate: true };
        break;
      }
      if (
        r.analysis_id !== null &&
        !state.analysis_queue?.some((e) => e.id === r.analysis_id)
      )
        fail("queue_not_found");
      if (!state.pack) {
        state.local_source = "local:" + state.device;
        state.pack = {
          schema: 1,
          policy: 2,
          source: state.local_source,
          exported_at: at,
          items: [],
          histories: {},
        };
      }
      const ids: string[] = [];
      let count = state.pack.items.filter(
        (i) => i.automatic && material.family_ids.includes(i.id),
      ).length;
      for (const initial of material.items) {
        if (state.pack.items.some((i) => i.id === initial.id)) {
          ids.push(initial.id);
          continue;
        }
        if (count >= 3) continue;
        state.pack.items.push(clone(initial));
        state.pack.histories[initial.id] = {
          id: initial.id,
          scene: clone(initial.scene),
          events: [],
          legacy_history: [],
        };
        ids.push(initial.id);
        count++;
      }
      state.pack.policy = 2;
      if (material.reveals)
        for (const id of ids)
          if (Object.hasOwn(material.reveals, id)) {
            state.pack.reveals ??= {};
            state.pack.reveals[id] = clone(material.reveals[id]);
          }
      state.local_imports!.push({
        material: clone(material),
        item_ids: ids,
        analysis_id: r.analysis_id,
        ...(r.final_scores !== undefined
          ? { final_scores: clone(r.final_scores) }
          : {}),
      });
      reconcileLocalSources(state);
      validatePhoneBackup(state);
      data = { id: material.id, duplicate: false };
      break;
    }
    case "source_scores": {
      if (!Array.isArray(r.entries) || r.entries.length > 1000)
        fail("invalid_receipt");
      for (const hint of r.entries) {
        const own = state.local_imports?.find((e) => e.material.id === hint.id);
        if (
          !own ||
          (hint.final_scores !== null && !validFinalScores(hint.final_scores))
        )
          fail("invalid_receipt");
        if (own!.final_scores === undefined)
          own!.final_scores = clone(hint.final_scores);
        else if (
          JSON.stringify(own!.final_scores) !==
          JSON.stringify(hint.final_scores)
        )
          fail("invalid_receipt");
      }
      data = { linked: reconcileLocalSources(state) };
      break;
    }
    case "cache_reveals": {
      if (!state.pack || state.pack.source !== r.source)
        fail("different_source");
      const entry = state.local_imports?.find(
        (e) => e.material.id === r.material,
      );
      if (!entry) fail("hand_data_missing");
      for (const id of entry!.item_ids)
        if (r.reveals && Object.hasOwn(r.reveals, id)) {
          state.pack!.reveals ??= {};
          state.pack!.reveals[id] = clone(r.reveals[id]);
        }
      validatePhoneBackup(state);
      data = { saved: true };
      break;
    }
    case "bind_source": {
      if (
        !state.local_source ||
        state.pack?.source !== state.local_source ||
        typeof r.source !== "string" ||
        !r.source ||
        r.source.startsWith("local:")
      )
        fail("different_source");
      state.pack!.source = r.source;
      delete state.local_source;
      data = { bound: true };
      break;
    }
    case "import_ack": {
      const own = state.local_imports?.find((e) => e.material.id === r.id);
      if (!own || state.local_source || r.source !== state.pack?.source)
        fail("invalid_receipt");
      if (own!.analysis_id !== r.analysis_id) fail("sync_changed");
      own!.synced_source = r.source;
      data = { saved: true };
      break;
    }
    case "install_pack": {
      validatePack(r.pack);
      if (
        pendingEvents(state).length ||
        (state.session && state.session.index < state.session.queue.length)
      )
        fail("pending_records");
      if (state.pack && state.pack.source !== r.pack.source)
        fail("different_source");
      if (state.schema === 2 && state.local_imports?.length)
        fail("pending_records");
      state.pack = clone(r.pack);
      state.session = null;
      data = { saved: true };
      break;
    }
    case "apply_sync": {
      const snapshot = r.snapshot,
        reply = r.reply;
      if (
        !state.pack ||
        snapshot.source !== state.pack.source ||
        snapshot.device !== state.device ||
        JSON.stringify(snapshot.events) !== JSON.stringify(state.events)
      )
        fail("sync_changed");
      validatePack(reply.pack);
      if (
        reply.protocol !== 1 ||
        reply.source !== snapshot.source ||
        reply.device !== snapshot.device ||
        reply.pack.source !== snapshot.source ||
        !Array.isArray(reply.receipts) ||
        reply.receipts.length !== state.events.length
      )
        fail("invalid_receipt");
      const receipts: Record<string, Receipt> = Object.create(null);
      for (const receipt of reply.receipts) {
        if (
          receipts[receipt.id] ||
          !state.events.some((e) => e.id === receipt.id) ||
          !/^[a-f0-9]{64}$/.test(receipt.hash)
        )
          fail("invalid_receipt");
        receipts[receipt.id] = clone(receipt);
      }
      const next = clone(reply.pack) as PhonePack;
      // Imports may be added while the server is preparing this reply.
      for (const entry of state.local_imports ?? [])
        for (const id of entry.item_ids) {
          if (!next.items.some((i) => i.id === id)) {
            if (entry.synced_source) fail("invalid_receipt");
            next.items.push(clone(item(id)));
            next.histories[id] = clone(state.pack!.histories[id]);
          }
        }
      for (const id of Object.keys(state.pack!.reveals ?? {}))
        if (
          next.items.some((i) => i.id === id) &&
          !Object.hasOwn(next.reveals ?? {}, id)
        ) {
          next.reveals ??= {};
          next.reveals[id] = clone(state.pack!.reveals![id]);
        }
      validatePack(next);
      state.pack = next;
      state.receipts = receipts;
      state.last_sync = reply.pack.exported_at;
      data = { synced: true };
      break;
    }
    case "analysis_bulk": {
      const batch = parseAnalysisBatch(r.data);
      state.analysis_queue ??= [];
      const existing = new Map(state.analysis_queue.map((e) => [e.url, e]));
      const added = batch.filter((e) => !existing.has(e.url));
      if (existing.size + added.length > 1000) fail("queue_full");
      let updated = 0;
      for (const entry of batch) {
        const own = existing.get(entry.url);
        if (own) {
          if (entry.history) {
            if (
              own.history &&
              !sameAnalysisHistory(own.history, entry.history, entry.url)
            )
              fail("history_conflict");
            if (!own.history) {
              own.history = entry.history;
              updated++;
            }
          }
        } else
          state.analysis_queue.push({
            id: entry.url.split("paipu=")[1],
            url: entry.url,
            created: at,
            ...(entry.history ? { history: entry.history } : {}),
          });
      }
      validateAnalysisQueue(state.analysis_queue);
      reconcileLocalSources(state);
      data = {
        added: added.length,
        existing: batch.length - added.length,
        ...(typeof r.data === "string" && r.data.trimStart().startsWith("{")
          ? { updated }
          : {}),
      };
      break;
    }
    case "analysis_add": {
      if (typeof r.url !== "string") fail("invalid_source_url");
      const url = sourceURL(r.url),
        id = url.split("paipu=")[1];
      state.analysis_queue ??= [];
      const existing = state.analysis_queue.find((e) => e.id === id);
      if (!existing) {
        if (state.analysis_queue.length >= 1000) fail("queue_full");
        state.analysis_queue.push({ id, url, created: at });
      }
      data = { duplicate: !!existing };
      break;
    }
    case "analysis_ack": {
      validateAnalysisQueue(r.entries);
      validateAnalysisQueue(r.snapshot);
      if (
        r.entries.length !== r.snapshot.length ||
        typeof r.received_at !== "string" ||
        !Number.isFinite(Date.parse(r.received_at))
      )
        fail("invalid_receipt");
      for (const sent of r.snapshot as AnalysisEntry[]) {
        const receipt = (r.entries as AnalysisEntry[]).find(
          (e) => e.id === sent.id,
        );
        const own = state.analysis_queue?.find((e) => e.id === sent.id);
        if (
          !receipt ||
          !own ||
          receipt.url !== sent.url ||
          own.url !== sent.url ||
          typeof receipt.requested !== "boolean" ||
          !Array.isArray(receipt.reports)
        )
          fail("invalid_receipt");
        if (
          sent.history &&
          (!receipt!.history ||
            !sameAnalysisHistory(sent.history, receipt!.history, sent.url))
        )
          fail("invalid_receipt");
        if (receipt!.history) {
          if (
            own!.history &&
            !sameAnalysisHistory(own!.history, receipt!.history, own!.url)
          )
            fail("history_conflict");
          if (!own!.history)
            own!.history = normalizeAnalysisHistory(receipt!.history, own!.url);
        }
        Object.assign(own!, {
          received: r.received_at,
          requested: receipt!.requested,
          reports: clone(receipt!.reports),
          ready: receipt!.ready,
        });
      }
      data = { synced: true };
      break;
    }
    case "restore_phone": {
      validatePhoneBackup(r.backup);
      if (
        state.events.length ||
        state.local_imports?.length ||
        (state.session && state.session.index < state.session.queue.length)
      )
        fail("phone_restore_exists");
      if (!r.backup.pack && !r.backup.analysis_queue?.length)
        fail("invalid_phone_backup");
      if (
        state.pack &&
        r.backup.pack &&
        state.pack.source !== r.backup.pack.source
      )
        fail("different_source");
      state.schema = r.backup.schema;
      if (r.backup.schema === 2) {
        state.local_imports = clone(r.backup.local_imports);
        if (r.backup.local_source) state.local_source = r.backup.local_source;
        else delete state.local_source;
        // Reconfirm registration after restoration rather than trusting old ACKs.
        for (const entry of state.local_imports!) delete entry.synced_source;
      }
      if (r.backup.pack) state.pack = clone(r.backup.pack);
      state.events = clone(r.backup.events);
      state.session = clone(r.backup.session);
      state.receipts = {};
      delete state.last_sync;
      // Add missing URLs; never replace a newer local receipt/status.
      state.analysis_queue ??= [];
      for (const entry of (r.backup.analysis_queue ?? []) as AnalysisEntry[]) {
        if (!state.analysis_queue.some((e) => e.id === entry.id))
          state.analysis_queue.push({
            id: entry.id,
            url: entry.url,
            created: entry.created,
            ...(entry.history
              ? { history: normalizeAnalysisHistory(entry.history, entry.url) }
              : {}),
          });
        else if (entry.history) {
          const own = state.analysis_queue.find((e) => e.id === entry.id)!;
          if (!own.history)
            own.history = normalizeAnalysisHistory(entry.history, entry.url);
        }
      }
      validateAnalysisQueue(state.analysis_queue);
      data = { restored: true };
      break;
    }
    case "state": {
      const items = (state.pack?.items ?? []).map((i) => ({
        ...i,
        scene: publicScene(i.scene),
        review_count: reviewCount(i),
      }));
      data = {
        reports: [],
        items,
        today: day,
        due_count: queue("scheduled").length,
        practice_count: queue("practice").length,
        session: view(),
      } satisfies Workspace;
      break;
    }
    case "study_current":
      data = view();
      break;
    case "study_start": {
      if (!["scheduled", "practice"].includes(r.mode)) fail("invalid_mode");
      if (!state.session || state.session.index >= state.session.queue.length)
        state.session = {
          id: crypto.randomUUID(),
          mode: r.mode,
          index: 0,
          selected: null,
          revealed: false,
          answers: [],
          queue: queue(r.mode).map((i) => ({
            id: i.id,
            cycle: i.cycle,
            revision: i.revision,
          })),
        };
      data = view();
      break;
    }
    case "study_choice": {
      const i = active();
      const s = state.session!;
      if (s.id !== r.session) fail("study_changed");
      if (r.choice === "choose") {
        if (s.revealed || !i.scene.own_hand.includes(r.answer))
          fail("invalid_answer");
        s.selected = r.answer;
      } else if (r.choice === "clear") {
        if (s.revealed) fail("invalid_answer");
        s.selected = null;
      } else if (r.choice === "confirm") {
        if (!s.selected) fail("answer_required");
        s.revealed = true;
      } else if (r.choice === "rechoose") s.revealed = false;
      else fail("invalid_request");
      data = view();
      break;
    }
    case "study_rate": {
      const i = active();
      const s = state.session!;
      if (s.id !== r.session || i.id !== r.item || !s.revealed || !s.selected)
        fail("answer_required");
      if (!["理解した", "再復習", "保留"].includes(r.rating))
        fail("invalid_rating");
      const before = itemState(i);
      const after = { ...before, revision: i.revision + 1 };
      const credit =
        s.mode === "scheduled" &&
        !!i.due &&
        i.due <= day &&
        i.last_credit_day !== day &&
        r.rating !== "保留";
      if (r.rating === "保留") {
        after.status = "保留";
        after.due = "";
      } else if (credit) {
        after.streak = r.rating === "理解した" ? i.streak + 1 : 0;
        after.last_credit_day = day;
        after.status = after.streak >= 5 ? "習得済み" : "復習中";
        after.due =
          after.streak >= 5
            ? ""
            : addDays(day, after.streak ? [3, 7, 14, 30][after.streak - 1] : 1);
      }
      push(i.id, "answer", before, after, {
        session: s.id,
        answer: s.selected,
        rating: r.rating,
        credited: Number(credit),
      });
      s.answers.push({ event: r.event, index: s.index });
      s.index++;
      s.selected = null;
      s.revealed = false;
      data = view();
      break;
    }
    case "study_undo": {
      const s = state.session;
      if (!s || s.id !== r.session || s.answers.at(-1)?.index !== s.index - 1)
        fail("cannot_undo");
      const { e, restored } = undo(s!.answers.at(-1)!.event);
      s!.answers.pop();
      s!.index--;
      s!.selected = e.answer;
      s!.revealed = true;
      s!.queue[s!.index].revision = restored.revision;
      data = view();
      break;
    }
    case "study_skip": {
      const s = state.session;
      if (!s || s.id !== r.session || s.index >= s.queue.length)
        fail("session_complete");
      let stale = false;
      try {
        active();
      } catch {
        stale = true;
      }
      if (!stale) fail("not_stale");
      s!.index++;
      s!.selected = null;
      s!.revealed = false;
      data = view();
      break;
    }
    case "study_control": {
      const i = item(r.item);
      const before = itemState(i);
      const after = { ...before, revision: i.revision + 1 };
      if (r.control === "pause" && ["未学習", "復習中"].includes(i.status)) {
        after.status = "保留";
        after.due = "";
      } else if (r.control === "resume" && i.status === "保留") {
        after.status = "復習中";
        after.due = addDays(day, Number(i.last_credit_day === day));
      } else if (r.control === "restart" && i.status === "習得済み") {
        after.status = "復習中";
        after.due = day;
        after.streak = 0;
        after.last_credit_day = "";
        after.cycle = crypto.randomUUID();
      } else fail("study_changed");
      push(i.id, r.control, before, after);
      data = { event: r.event };
      break;
    }
    case "study_undo_control": {
      if (!["pause", "resume", "restart"].includes(event(r.original).kind))
        fail("cannot_undo");
      const { e, restored } = undo(r.original);
      const s = state.session;
      const q = s?.queue[s.index];
      if (q && q.id === e.item && q.revision === e.before_state.revision)
        q.revision = restored.revision;
      data = { event: r.event };
      break;
    }
    case "item_history": {
      const i = item(r.item);
      const original = state.pack!.histories[i.id];
      const events = [
        ...clone(original.events),
        ...state.events.filter(
          (e) => e.item === i.id && !original.events.some((h) => h.id === e.id),
        ),
      ];
      const undone = new Set(events.map((e) => e.undo_of).filter(Boolean));
      data = {
        ...original,
        scene: clone(i.scene),
        events: events.map((e) => ({ ...e, undone: undone.has(e.id) })),
      };
      break;
    }
    default:
      fail("phone_only");
  }
  if (
    [
      "analysis_bulk",
      "analysis_add",
      "analysis_ack",
      "restore_phone",
      "register_local",
      "source_scores",
    ].includes(r.action)
  )
    reconcileLocalSources(state);
  if (!["state", "study_current", "item_history"].includes(r.action))
    state.sequence++;
  return { state, data };
}
