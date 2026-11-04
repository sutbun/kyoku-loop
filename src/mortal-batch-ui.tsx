import type { AnalysisEntry } from "./analysis-queue";
import type { MortalBatchItem } from "./mortal-batch";
import { errors } from "./api";

export function MortalBatchResults({
  items,
  entries,
}: {
  items: MortalBatchItem[];
  entries: AnalysisEntry[];
}) {
  return (
    <ul className="inbox-files" aria-label="一括追加の結果" aria-live="polite">
      {items.map((item, i) => {
        const linked =
          item.result &&
          entries.some((e) => e.reports?.includes(item.result!.id));
        return (
          <li key={i}>
            <span style={{ overflowWrap: "anywhere" }}>{item.file.name}</span>
            <span>
              {item.result
                ? `${item.result.duplicate ? "登録済み（重複）" : "登録しました"} · ${linked || item.result.linked ? "元牌譜に紐付け済み" : "元牌譜は未紐付け"}`
                : item.error
                  ? (errors[item.error] ?? item.error)
                  : "登録待ち"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
