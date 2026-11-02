import { useEffect, useRef, useState } from "react";
import collector from "../public/history-collector.js?raw";

export const HISTORY_BOOKMARKLET = `javascript:${encodeURIComponent(collector.trim())}`;

export function BulkHistoryInput({
  disabled,
  onImport,
}: {
  disabled: boolean;
  onImport: (value: string) => Promise<{ added: number; existing: number }>;
}) {
  const link = useRef<HTMLAnchorElement>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    // Fixed bundled code only; never interpolate user input into a JS URL.
    if (link.current) link.current.href = HISTORY_BOOKMARKLET;
  }, []);
  return (
    <details className="bulk-history">
      <summary>牌譜屋から一括追加</summary>
      <ol className="bookmark-steps">
        <li>
          <a
            ref={link}
            draggable
            onClick={(e) => e.preventDefault()}
            title="ブックマークバーへドラッグ"
          >
            牌譜URLを一括取得
          </a>
          をブックマークバーへドラッグ（初回のみ）。
        </li>
        <li>
          牌譜屋の履歴でそのブックマークを実行し、必要な範囲をスクロールして「KyokuLoopへコピー」。
        </li>
        <li>下の欄へ貼り付けて追加。</li>
      </ol>
      <label>
        一括データ
        <textarea
          value={value}
          rows={3}
          maxLength={2 * 1024 * 1024}
          placeholder="コピーしたデータ、または1行に1件の雀魂URL"
          disabled={disabled || busy}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            setValue(e.target.value);
            setError("");
            setNotice("");
          }}
        />
      </label>
      <div className="bulk-history-actions">
        <button
          className="button secondary"
          disabled={disabled || busy || !value.trim()}
          onClick={() => {
            setBusy(true);
            setError("");
            setNotice("");
            void onImport(value)
              .then((result) => {
                setValue("");
                setNotice(`${result.added}件追加 · 重複${result.existing}件`);
              })
              .catch((e) =>
                setError(
                  e instanceof Error ? e.message : "追加できませんでした。",
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "追加中…" : "まとめて追加"}
        </button>
        {notice && <span role="status">{notice}</span>}
        {error && <span role="alert">{error}</span>}
      </div>
    </details>
  );
}
