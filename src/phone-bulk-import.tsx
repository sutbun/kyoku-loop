import { readAnalysisFile } from "./analysis-queue";
import { useEffect, useState } from "react";
import { errors } from "./api";
export function PhoneBulkImport({
  disabled,
  historyCode,
  onBusy,
  onPendingChange,
  onImport,
  onSaved,
}: {
  disabled: boolean;
  historyCode: string;
  onBusy: (busy: boolean) => void;
  onPendingChange: (pending: boolean) => void;
  onImport: (
    value: string,
  ) => Promise<{ added: number; existing: number; updated?: number }>;
  onSaved: () => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [codeNotice, setCodeNotice] = useState("");
  useEffect(() => {
    onPendingChange(!!value || working);
  }, [value, working, onPendingChange]);
  useEffect(() => () => onPendingChange(false), [onPendingChange]);
  const work = async (operation: () => Promise<void>) => {
    setWorking(true);
    onBusy(true);
    setError("");
    setNotice("");
    try {
      await operation();
    } catch (e) {
      setError(
        e instanceof Error
          ? (errors[e.message] ?? e.message)
          : "読み込めませんでした。入力と保存済みの記録は保持しています。",
      );
    } finally {
      setWorking(false);
      onBusy(false);
    }
  };
  return (
    <details className="bulk-history">
      <summary>牌譜URLをまとめて追加</summary>
      <label>
        URL一覧
        <textarea
          value={value}
          rows={3}
          maxLength={2 * 1024 * 1024}
          placeholder="1行に1件の雀魂URL、または情報付きデータ"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled || working}
          onChange={(e) => {
            setValue(e.target.value);
            setError("");
            setNotice("");
          }}
        />
      </label>
      <label>
        URL一覧のテキストファイル
        <input
          type="file"
          accept=".txt,text/plain"
          disabled={disabled || working}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            void work(async () => {
              setValue(await readAnalysisFile(file));
            });
          }}
        />
      </label>
      <div className="bulk-history-actions">
        <button
          className="button primary"
          disabled={disabled || working || !value.trim()}
          onClick={() =>
            void work(async () => {
              const result = await onImport(value);
              setValue("");
              setNotice(
                `この端末に${result.added}件追加 · 重複${result.existing}件${result.updated !== undefined ? ` · 情報${result.updated}件補完` : ""}`,
              );
              try {
                await onSaved();
              } catch {
                setError(
                  "端末への保存は完了しました。画面を更新できませんでした。ホームを開き直してください。",
                );
              }
            })
          }
        >
          {working ? "処理中…" : "まとめて追加"}
        </button>
        <button
          className="text-button"
          disabled={disabled || working || !value}
          onClick={() => {
            setValue("");
            setError("");
            setNotice("");
          }}
        >
          入力を取り消す
        </button>
      </div>
      <details>
        <summary>情報付き取得コード</summary>
        <label>
          ショートカット用JavaScript
          <textarea readOnly rows={6} value={historyCode} spellCheck={false} />
        </label>
        <button
          className="button secondary"
          type="button"
          onClick={() => {
            setCodeNotice("");
            const failed = () =>
              setCodeNotice(
                "コピーできませんでした。上のコードを選択してコピーしてください。",
              );
            try {
              void navigator.clipboard
                .writeText(historyCode)
                .then(() => setCodeNotice("コードをコピーしました"), failed);
            } catch {
              failed();
            }
          }}
        >
          コードをコピー
        </button>
        {codeNotice && <small role="status">{codeNotice}</small>}
      </details>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
    </details>
  );
}
