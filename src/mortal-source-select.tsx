import { mortalScoreHint, matchesMortalScores } from "./mortal-source-match";
import type { Stage } from "./real-types";
import type { AnalysisEntry } from "./analysis-queue";

const points = (score: number) => `${score.toLocaleString("ja-JP")}点`;

export function mortalSourceOptions(
  entries: AnalysisEntry[],
  stage: Stage,
  local: boolean,
) {
  const seat = stage.target_seat;
  const target = seat !== undefined ? stage.players[seat] : undefined;
  const hint = mortalScoreHint(stage.final_scores, stage.target_seat);
  const names = (players: string[]) =>
    JSON.stringify(players.map((n) => n.trim()).sort());
  return entries
    .map((entry, index) => {
      const h = entry.history;
      const opponents = h?.players
        .filter((_, i) => i !== h.seat)
        .map((p) => p.name)
        .join(" / ");
      const label = h
        ? `${new Date(h.at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} · ${h.rank}位 · ${points(h.players[h.seat].score)} · ${opponents}`
        : `保存牌譜 ${index + 1} · ${entry.url.split("paipu=")[1]}`;
      const matches =
        !!h &&
        stage.players.length === 4 &&
        h.players.length === 4 &&
        typeof target === "string" &&
        h.players[h.seat].name.trim() === target.trim() &&
        names(h.players.map((p) => p.name)) === names(stage.players);
      const scoreMatches =
        !!h &&
        seat !== undefined &&
        matchesMortalScores(h, stage.final_scores, seat);
      return { entry, label, matches, scoreMatches, index };
    })
    .filter((o) => local || o.entry.received)
    .sort(
      (a, b) =>
        Number(b.scoreMatches) - Number(a.scoreMatches) ||
        (hint ? 0 : Number(b.matches) - Number(a.matches)) ||
        Number(!!b.entry.history) - Number(!!a.entry.history) ||
        (a.entry.history && b.entry.history
          ? Date.parse(b.entry.history.at) - Date.parse(a.entry.history.at)
          : 0) ||
        a.index - b.index,
    );
}

export function MortalSourceSelect({
  entries,
  stage,
  local,
  value,
  disabled,
  onChange,
}: {
  entries: AnalysisEntry[];
  stage: Stage;
  local: boolean;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const options = mortalSourceOptions(entries, stage, local);
  const hint = mortalScoreHint(stage.final_scores, stage.target_seat);
  const scored = options.filter((o) => o.scoreMatches);
  // Known conflicting scores must not be elevated by identical/anonymized names.
  const matched = options.filter((o) => !o.scoreMatches && o.matches && !hint),
    other = options.filter((o) => !scored.includes(o) && !matched.includes(o));
  // Empty value retains automatic registration and its existing conflict guards.
  // Show the unique automatic target as selected without turning it into a manual override.
  const automatic = !value && scored.length === 1 ? scored[0] : undefined;
  const selected = options.find((o) => o.entry.id === value) ?? automatic;
  const render = (list: typeof options) =>
    list.map((o) => (
      <option key={o.entry.id} value={o.entry.id}>
        {o.label}
      </option>
    ));
  return (
    <>
      {hint && (
        <p>
          JSONの最終点数：自分 {points(hint.own)} · {hint.rank}位
          <br />
          <small>4人：{hint.scores.map(points).join(" / ")}</small>
        </p>
      )}
      <p>
        JSONの対戦相手：
        {stage.players.filter((_, i) => i !== stage.target_seat).join(" / ")}
      </p>
      <label>
        元牌譜（任意）
        <select
          value={selected?.entry.id ?? value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          style={{ maxWidth: "100%", minWidth: 0 }}
        >
          <option value="">自動で紐付け（候補が1件の場合）</option>
          {scored.length > 0 && (
            <optgroup label={`点数・順位が一致（${scored.length}件の候補）`}>
              {render(scored)}
            </optgroup>
          )}
          {matched.length > 0 ? (
            <>
              <optgroup label="4人の名前が一致">{render(matched)}</optgroup>
            </>
          ) : null}
          {other.length > 0 && (matched.length > 0 || scored.length > 0) ? (
            <optgroup label="ほかの保存牌譜">{render(other)}</optgroup>
          ) : (
            render(other)
          )}
        </select>
      </label>
      {!value && scored.length > 0 && (
        <p className="source-context" role="status">
          <strong>
            {scored.length === 1
              ? "紐付け先（自動選択）"
              : `自動紐付けの候補（${scored.length}件）`}
          </strong>
          {scored.map((o) => (
            <span key={o.entry.id} style={{ display: "block" }}>
              {o.label}
            </span>
          ))}
          {scored.length > 1 && (
            <span>候補が複数あるため、元牌譜を選んでください。</span>
          )}
        </p>
      )}
      {hint && scored.length === 0 && (
        <small>点数・順位が一致する候補はありません。</small>
      )}
      {stage.final_scores === null && (
        <small>このJSONは最終点数を照合できません。</small>
      )}
      {value && selected && (
        <small style={{ display: "block", overflowWrap: "anywhere" }}>
          選択した牌譜：{selected.label}
        </small>
      )}
    </>
  );
}
