// Entirely generated fixtures. This is deliberately NOT a NAGA schema or adapter.
export type Tile = string;
export type Frame = {
  id: string;
  round: string;
  turn: number;
  actor: number;
  ownWind: string;
  hand: Tile[];
  revealedHands: Tile[][];
  drawn: Tile;
  rivers: Tile[][];
  dora: Tile;
  scores: number[];
  actual: Tile;
  suggested: Tile;
  gap: number;
  important: boolean;
};
export const winds = ["東", "南", "西", "北"];
export const labels: Record<string, string> = { m: "萬", p: "筒", s: "索" };
export function tileLabel(t: Tile): string {
  if (t.endsWith("z"))
    return ["東", "南", "西", "北", "白", "發", "中"][Number(t[0]) - 1];
  return `${t[0] === "0" ? "赤5" : t[0]}${labels[t[1]]}`;
}
function shuffledDeck(seed: number): Tile[] {
  const deck: Tile[] = [];
  for (const suit of ["m", "p", "s", "z"]) {
    for (let rank = 1; rank <= (suit === "z" ? 7 : 9); rank++) {
      for (let copy = 0; copy < 4; copy++)
        deck.push(
          `${rank === 5 && copy === 0 && suit !== "z" ? 0 : rank}${suit}`,
        );
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
const sortHand = (a: Tile, b: Tile) =>
  "mpsz".indexOf(a[1]) - "mpsz".indexOf(b[1]) ||
  Number(a[0] || 5) - Number(b[0] || 5);
function generateFrames(): Frame[] {
  const result: Frame[] = [];
  for (let round = 0; round < 4; round++) {
    const deck = shuffledDeck(20261101 + round);
    const hands = Array.from({ length: 4 }, () => deck.splice(0, 13));
    const dora = deck.pop()!;
    const rivers: Tile[][] = [[], [], [], []];
    for (let step = 0; step < 32; step++) {
      const actor = (step + round) % 4;
      const drawn = deck.shift()!;
      hands[actor].push(drawn);
      const actualIndex = step % 3 === 0 ? hands[actor].length - 1 : 0;
      const actual = hands[actor][actualIndex];
      const suggested = hands[2].find((t) => t !== actual) ?? actual;
      const important =
        actor === 2 &&
        (Math.floor(step / 4) === 3 ||
          (round === 0 && Math.floor(step / 4) === 5));
      result.push({
        id: `demo-r${round}-e${step}`,
        round: `東${round + 1}局`,
        turn: Math.floor(step / 4) + 1,
        actor,
        ownWind: winds[(2 - round + 4) % 4],
        hand: (actor === 2 ? hands[2].slice(0, -1) : hands[2])
          .slice()
          .sort(sortHand),
        revealedHands: hands.map((hand) => hand.slice()),
        drawn: actor === 2 ? drawn : "",
        rivers: rivers.map((r) => r.slice()),
        dora,
        scores: [25000, 25000, 25000, 25000],
        actual,
        suggested,
        gap: important
          ? round === 0 && Math.floor(step / 4) === 3
            ? 32
            : round === 0
              ? 10
              : 30 - round * 5
          : 0,
        important,
      });
      hands[actor].splice(actualIndex, 1);
      rivers[actor].push(actual);
    }
  }
  return result;
}
export const frames = generateFrames();
export const decisions = frames
  .filter((f) => f.important)
  .sort((a, b) => b.gap - a.gap);
export const libraryScenes = [
  ...decisions,
  ...frames.filter((f) => f.actor === 2 && !f.important).slice(0, 7),
];
export type StudyStatus = "未学習" | "復習中" | "習得済み" | "保留";
export type Item = {
  id: string;
  status: StudyStatus;
  due: string;
  history: string[];
  saved?: boolean;
};
export type Rating = "理解した" | "再復習" | "保留";
export type Session = {
  ids: string[];
  index: number;
  selected: number | null;
  revealed: boolean;
  answers: { id: string; tile: string; rating: Rating }[];
};
export type State = {
  screen: "home" | "review" | "study";
  items: Item[];
  session: Session | null;
  studyView: "quiz" | "library";
  reviewIndex: number;
  saved: string[];
};
export function initialState(): State {
  return {
    screen: "home",
    studyView: "library",
    reviewIndex: frames.indexOf(decisions[0]),
    saved: [],
    session: null,
    items: libraryScenes.slice(5).map((d, i) => ({
      id: d.id,
      status: (
        [
          "復習中",
          "未学習",
          "復習中",
          "未学習",
          "復習中",
          "習得済み",
          "保留",
        ] as StudyStatus[]
      )[i],
      due: i < 5 ? "今日" : "—",
      history: i === 0 ? ["前回：再復習（架空）"] : [],
    })),
  };
}
export const newSession = (items: Item[]): Session => ({
  ids: items
    .filter((i) => i.status !== "保留" && i.status !== "習得済み")
    .slice(0, 5)
    .map((i) => i.id),
  index: 0,
  selected: null,
  revealed: false,
  answers: [],
});
export const frameFor = (id: string) => frames.find((f) => f.id === id)!;
export const handFor = (f: Frame) => [...f.hand, ...(f.drawn ? [f.drawn] : [])];

// Only decode our fictional local UI state; this is not an import format.
export function isDemoState(value: unknown): value is State {
  if (!value || typeof value !== "object") return false;
  const s = value as State;
  const known = (id: unknown) =>
    typeof id === "string" && libraryScenes.some((f) => f.id === id);
  if (
    !["home", "review", "study"].includes(s.screen) ||
    !["quiz", "library"].includes(s.studyView) ||
    !Number.isInteger(s.reviewIndex) ||
    !frames[s.reviewIndex] ||
    !Array.isArray(s.saved) ||
    !s.saved.every((id) => decisions.some((f) => f.id === id)) ||
    !Array.isArray(s.items) ||
    !s.items.every(
      (i) =>
        i &&
        known(i.id) &&
        ["未学習", "復習中", "習得済み", "保留"].includes(i.status) &&
        typeof i.due === "string" &&
        Array.isArray(i.history) &&
        i.history.every((h) => typeof h === "string"),
    ) ||
    new Set(s.items.map((i) => i.id)).size !== s.items.length
  )
    return false;
  const q = s.session;
  if (q === null) return true;
  if (
    !q ||
    !Array.isArray(q.ids) ||
    q.ids.length > 5 ||
    !q.ids.every(known) ||
    !Number.isInteger(q.index) ||
    q.index < 0 ||
    q.index > q.ids.length ||
    typeof q.revealed !== "boolean" ||
    !Array.isArray(q.answers) ||
    q.answers.length !== q.index ||
    !q.answers.every(
      (a) =>
        a &&
        known(a.id) &&
        handFor(frameFor(a.id)).includes(a.tile) &&
        ["理解した", "再復習", "保留"].includes(a.rating),
    )
  )
    return false;
  if (
    q.selected !== null &&
    (!Number.isInteger(q.selected) ||
      q.index >= q.ids.length ||
      q.selected < 0 ||
      q.selected >= handFor(frameFor(q.ids[q.index])).length)
  )
    return false;
  return !q.revealed || q.selected !== null;
}
