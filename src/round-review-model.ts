import type { Scene } from "./real-types";

export type ReviewCatalog = {
  report: string;
  model: string;
  rounds: { index: number; label: string }[];
};
export type RoundMaterial = {
  report: string;
  game: string;
  seat: number;
  round_index: number;
  label: string;
  model: string;
  timeline: Scene[];
  reveals: Record<string, string[][]>;
};
export type RoundSession = {
  index: number;
  quiz: boolean;
  selected: Record<string, string>;
  answers: Record<string, string>;
};
export type Bookmark = {
  id: string;
  report: string;
  round_index: number;
  event_index: number;
  label: string;
  tag: string;
  memo: string;
};
export type ReviewState = {
  schema: 1;
  sessions: Record<string, RoundSession>;
  bookmarks: Bookmark[];
  tags: string[];
  last_rounds?: Record<string, number>;
};
export type ReviewCache = {
  state: ReviewState;
  catalogs: ReviewCatalog[];
  materials: RoundMaterial[];
};
export type ReviewChange =
  | { kind: "session"; key: string; value: RoundSession }
  | { kind: "bookmark"; value: Bookmark }
  | { kind: "remove"; id: string }
  | { kind: "tag"; old: string; new: string };
export const newReviewState = (): ReviewState => ({
  schema: 1,
  sessions: {},
  bookmarks: [],
  tags: ["手作り", "押し引き", "鳴き・リーチ"],
  last_rounds: {},
});
export const roundKey = (m: Pick<RoundMaterial, "report" | "round_index">) =>
  `${m.report}:${m.round_index}`;
export const bookmarkKey = (m: RoundMaterial, s: Scene) =>
  `${m.game}:${m.seat}:${m.round_index}:${s.event_index}`;
export const newRoundSession = (): RoundSession => ({
  index: 0,
  quiz: false,
  selected: {},
  answers: {},
});
const tile = (v: unknown) =>
  typeof v === "string" && /^(?:[1-9][mps]|5[mps]r|[ESWNPFC])$/.test(v);
const record = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const int = (v: unknown) =>
  Number.isInteger(v) && Number(v) >= 0 && Number(v) < 2000;
export function validateReviewState(v: unknown): asserts v is ReviewState {
  if (
    !record(v) ||
    v.schema !== 1 ||
    !record(v.sessions) ||
    !Array.isArray(v.bookmarks) ||
    !Array.isArray(v.tags) ||
    v.tags.length < 1 ||
    v.tags.length > 3 ||
    new Set(v.tags).size !== v.tags.length ||
    v.tags.some(
      (t: unknown) => typeof t !== "string" || !t.trim() || t.length > 20,
    )
  )
    throw Error("invalid_review");
  if (
    v.last_rounds !== undefined &&
    (!record(v.last_rounds) ||
      Object.entries(v.last_rounds).some(
        ([key, ri]) => !/^[a-f0-9]{64}$/.test(key) || !int(ri),
      ))
  )
    throw Error("invalid_review");
  for (const [key, s] of Object.entries(v.sessions)) {
    if (
      !/^[a-f0-9]{64}:\d+$/.test(key) ||
      !record(s) ||
      !int(s.index) ||
      typeof s.quiz !== "boolean"
    )
      throw Error("invalid_review");
    for (const name of ["selected", "answers"])
      if (
        !record(s[name]) ||
        Object.entries(s[name]).some(([k, t]) => !/^\d+$/.test(k) || !tile(t))
      )
        throw Error("invalid_review");
  }
  const seen = new Set<string>();
  for (const b of v.bookmarks) {
    if (
      !record(b) ||
      typeof b.id !== "string" ||
      !/^[a-f0-9]{64}:[0-3]:\d+:\d+$/.test(b.id) ||
      seen.has(b.id) ||
      typeof b.report !== "string" ||
      !/^[a-f0-9]{64}$/.test(b.report) ||
      !int(b.round_index) ||
      !int(b.event_index) ||
      !["", ...v.tags].includes(b.tag) ||
      typeof b.label !== "string" ||
      b.label.length > 100 ||
      typeof b.memo !== "string" ||
      b.memo.length > 2000
    )
      throw Error("invalid_review");
    seen.add(b.id);
  }
}
export function changeReview(
  input: ReviewState,
  op: ReviewChange,
): ReviewState {
  const v: ReviewState = structuredClone(input);
  if (op.kind === "session") {
    if (!/^[a-f0-9]{64}:\d+$/.test(op.key)) throw Error("invalid_review");
    v.sessions[op.key] = structuredClone(op.value);
    const [report, ri] = op.key.split(":");
    (v.last_rounds ??= {})[report] = Number(ri);
  } else if (op.kind === "bookmark")
    v.bookmarks = [
      ...v.bookmarks.filter((b) => b.id !== op.value.id),
      structuredClone(op.value),
    ];
  else if (op.kind === "remove")
    v.bookmarks = v.bookmarks.filter((b) => b.id !== op.id);
  else if (op.kind === "tag") {
    if (!v.tags.includes(op.old)) throw Error("invalid_review");
    v.tags = [...new Set(v.tags.map((t) => (t === op.old ? op.new : t)))];
    v.bookmarks.forEach((b) => {
      if (b.tag === op.old) b.tag = op.new;
    });
  } else throw Error("invalid_review");
  validateReviewState(v);
  return v;
}
export function mergeReview(
  current: ReviewState,
  incoming: ReviewState,
): ReviewState {
  validateReviewState(incoming);
  const result = structuredClone(current);
  for (const [key, ri] of Object.entries(incoming.last_rounds ?? {}))
    (result.last_rounds ??= {})[key] ??= ri;
  for (const [key, s] of Object.entries(incoming.sessions))
    result.sessions[key] ??= s;
  for (const b of incoming.bookmarks)
    if (!result.bookmarks.some((x) => x.id === b.id)) {
      if (b.tag && !result.tags.includes(b.tag)) {
        if (result.tags.length >= 3) throw Error("invalid_review");
        result.tags.push(b.tag);
      }
      result.bookmarks.push({ ...b });
    }
  return result;
}
export function validateRoundMaterial(v: unknown): asserts v is RoundMaterial {
  if (
    !record(v) ||
    !/^[a-f0-9]{64}$/.test(v.report) ||
    !/^[a-f0-9]{64}$/.test(v.game) ||
    !Number.isInteger(v.seat) ||
    v.seat < 0 ||
    v.seat > 3 ||
    !int(v.round_index) ||
    typeof v.label !== "string" ||
    typeof v.model !== "string" ||
    !Array.isArray(v.timeline) ||
    !v.timeline.length ||
    v.timeline.length > 2000 ||
    !record(v.reveals)
  )
    throw Error("invalid_review");
  let previous = -1;
  for (const s of v.timeline) {
    if (
      !record(s) ||
      s.round_index !== v.round_index ||
      s.seat !== v.seat ||
      !int(s.event_index) ||
      s.event_index <= previous ||
      !Array.isArray(s.own_hand) ||
      s.own_hand.length > 14 ||
      s.own_hand.some((t: unknown) => !tile(t)) ||
      !Array.isArray(s.rivers) ||
      s.rivers.length !== 4 ||
      !Array.isArray(s.melds) ||
      s.melds.length !== 4 ||
      !Array.isArray(s.scores) ||
      s.scores.length !== 4 ||
      !Array.isArray(s.dora_markers) ||
      !Array.isArray(s.reach_declared) ||
      !Array.isArray(s.reach_accepted)
    )
      throw Error("invalid_review");
    if (
      !["E", "S", "W", "N"].includes(s.bakaze) ||
      !Number.isInteger(s.kyoku) ||
      s.kyoku < 1 ||
      s.kyoku > 4 ||
      !int(s.honba) ||
      !int(s.kyotaku) ||
      !int(s.source_discard_index) ||
      s.scores.some((n: unknown) => !Number.isSafeInteger(n)) ||
      s.dora_markers.length > 5 ||
      s.dora_markers.some((t: unknown) => !tile(t)) ||
      [s.reach_declared, s.reach_accepted].some(
        (a) => a.length !== 4 || a.some((b: unknown) => typeof b !== "boolean"),
      ) ||
      s.rivers.some(
        (r: unknown) =>
          !Array.isArray(r) ||
          r.length > 200 ||
          r.some(
            (d: unknown) =>
              !record(d) ||
              !tile(d.tile) ||
              typeof d.called !== "boolean" ||
              typeof d.reach !== "boolean",
          ),
      ) ||
      s.melds.some(
        (groups: unknown) =>
          !Array.isArray(groups) ||
          groups.length > 4 ||
          groups.some(
            (m: unknown) =>
              !record(m) ||
              typeof m.type !== "string" ||
              !Array.isArray(m.consumed) ||
              m.consumed.length > 4 ||
              m.consumed.some((t: unknown) => !tile(t)) ||
              (m.tile !== undefined && !tile(m.tile)) ||
              (m.added !== undefined && !tile(m.added)),
          ),
      ) ||
      typeof s.is_decision !== "boolean" ||
      (s.drawn !== null && (!tile(s.drawn) || !s.own_hand.includes(s.drawn))) ||
      (s.is_decision &&
        (!tile(s.actual) ||
          !tile(s.suggested) ||
          !s.own_hand.includes(s.actual) ||
          !s.own_hand.includes(s.suggested)))
    )
      throw Error("invalid_review");
    for (const p of [s.policy_percent, s.weights_percent])
      if (
        p !== undefined &&
        (!Array.isArray(p) ||
          ![34, 37].includes(p.length) ||
          p.some(
            (n: unknown) =>
              typeof n !== "number" ||
              !Number.isFinite(n) ||
              n < 0 ||
              n > 100.0001,
          ))
      )
        throw Error("invalid_review");
    const hands = v.reveals[String(s.event_index)];
    if (
      hands !== undefined &&
      (!Array.isArray(hands) ||
        hands.length !== 4 ||
        hands.some(
          (h) =>
            !Array.isArray(h) ||
            h.length > 14 ||
            h.some((t: unknown) => !tile(t)),
        ))
    )
      throw Error("invalid_review");
    if (
      hands &&
      JSON.stringify([...hands[s.seat]].sort()) !==
        JSON.stringify([...s.own_hand].sort())
    )
      throw Error("invalid_review");
    previous = s.event_index;
  }
}
const tiles = [..."mps"]
  .flatMap((s) => Array.from({ length: 9 }, (_, i) => `${i + 1}${s}`))
  .concat(["E", "S", "W", "N", "P", "F", "C"]);
export function recommendation(s: Scene, t: string): number | undefined {
  const index =
    s.engine === "Mortal" && t.endsWith("r")
      ? 34 + "mps".indexOf(t[1])
      : tiles.indexOf(t.replace(/r$/, ""));
  return (s.engine === "Mortal" ? s.policy_percent : s.weights_percent)?.[
    index
  ];
}
export function candidates(s: Scene): { tile: string; value: number }[] {
  if (!s.is_decision) return [];
  const available = [...new Set(s.own_hand)];
  // NAGA evaluates red/non-red together; show a single candidate for that kind.
  const seen = new Set<string>();
  return available
    .map((tile) => ({ tile, value: recommendation(s, tile) }))
    .filter(
      (p): p is { tile: string; value: number } =>
        p.value !== undefined && Number.isFinite(p.value) && p.value > 0,
    )
    .sort((a, b) => b.value - a.value)
    .filter((p) => {
      const k = s.engine === "Mortal" ? p.tile : p.tile.replace(/r$/, "");
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 3);
}
export function isDiscrepancy(s: Scene): boolean {
  if (!s.is_decision || !s.actual) return false;
  const actual = recommendation(s, s.actual),
    top = candidates(s)[0]?.value;
  return actual !== undefined && top !== undefined && top - actual > 1e-8;
}
export function navigate(
  m: RoundMaterial,
  session: RoundSession,
  target: number,
  explicit = false,
): number {
  target = Math.max(0, Math.min(m.timeline.length - 1, target));
  if (explicit || target <= session.index || !session.quiz) return target;
  for (let i = session.index; i < target; i++)
    if (
      m.timeline[i].is_decision &&
      !session.answers[String(m.timeline[i].event_index)]
    )
      return i;
  return target;
}
