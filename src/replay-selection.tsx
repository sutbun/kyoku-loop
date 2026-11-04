import { useEffect, useState } from "react";
import type { AnalysisEntry } from "./analysis-queue";

export function useReplaySelection(entries: AnalysisEntry[]) {
  const [ids, setIds] = useState<string[]>([]);
  const available = JSON.stringify(entries.map((e) => e.id));
  useEffect(() => {
    const current: string[] = JSON.parse(available);
    setIds((old) =>
      old.every((id) => current.includes(id))
        ? old
        : old.filter((id) => current.includes(id)),
    );
  }, [available]);
  const selected = ids.filter((id) => entries.some((e) => e.id === id));
  return {
    selected,
    setIds,
    toggle: (id: string) =>
      setIds((old) =>
        old.includes(id) ? old.filter((i) => i !== id) : [...old, id],
      ),
  };
}
export function ReplaySelection({
  entries,
  selected,
  disabled,
  onSelect,
  onDelete,
}: {
  entries: AnalysisEntry[];
  selected: string[];
  disabled: boolean;
  onSelect: (ids: string[]) => void;
  onDelete?: (ids: string[]) => void;
}) {
  if (!onDelete || !entries.length) return null;
  return (
    <div className="replay-selection">
      <label>
        <input
          type="checkbox"
          disabled={disabled}
          checked={selected.length === entries.length}
          onChange={(e) =>
            onSelect(e.target.checked ? entries.map((i) => i.id) : [])
          }
        />
        全選択
      </label>
      <button
        className="text-button"
        disabled={disabled || !selected.length}
        onClick={() => {
          if (
            window.confirm(
              `${selected.length}件の牌譜を一覧から削除しますか？\n解析結果・復習問題・学習履歴は残ります。`,
            )
          )
            onDelete(selected);
        }}
      >
        選択した{selected.length}件を削除
      </button>
    </div>
  );
}
