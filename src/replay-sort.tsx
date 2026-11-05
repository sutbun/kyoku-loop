import type { AnalysisEntry } from "./analysis-queue";

export type ReplayOrder = "added" | "played";

export function sortReplays(entries: AnalysisEntry[], order: ReplayOrder) {
  return [...entries].reverse().sort((a, b) => {
    if (order === "played") {
      if (!!a.history !== !!b.history) return a.history ? -1 : 1;
      if (a.history && b.history) {
        const played = Date.parse(b.history.at) - Date.parse(a.history.at);
        if (played) return played;
      }
    }
    return Date.parse(b.created) - Date.parse(a.created);
  });
}

export function ReplaySort({
  value,
  onChange,
}: {
  value: ReplayOrder;
  onChange: (value: ReplayOrder) => void;
}) {
  return (
    <label className="replay-sort">
      並び順
      <select
        aria-label="牌譜の並び順"
        value={value}
        onChange={(e) => onChange(e.target.value as ReplayOrder)}
      >
        <option value="added">追加順</option>
        <option value="played">対局日時</option>
      </select>
    </label>
  );
}
