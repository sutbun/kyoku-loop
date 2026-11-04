import type { AnalysisHistory } from "./analysis-queue";

export function validFinalScores(scores: unknown): scores is number[] {
  return (
    Array.isArray(scores) &&
    scores.length === 4 &&
    scores.every((s) => Number.isSafeInteger(s) && Math.abs(s) <= 1000000) &&
    scores.reduce((a, b) => a + b, 0) === 100000
  );
}
export function mortalScoreHint(scores: unknown, seat: unknown) {
  if (
    !validFinalScores(scores) ||
    typeof seat !== "number" ||
    !Number.isInteger(seat) ||
    seat < 0 ||
    seat > 3
  )
    return null;
  const order = [0, 1, 2, 3].sort((a, b) => scores[b] - scores[a] || a - b);
  return { scores, own: scores[seat], rank: order.indexOf(seat) + 1 };
}
export function matchesMortalScores(
  history: AnalysisHistory,
  scores: unknown,
  seat: number,
) {
  const hint = mortalScoreHint(scores, seat);
  return (
    !!hint &&
    history.rank === hint.rank &&
    history.players[history.seat].score === hint.own &&
    JSON.stringify(
      history.players.map((p) => p.score).sort((a, b) => a - b),
    ) === JSON.stringify([...hint.scores].sort((a, b) => a - b))
  );
}
