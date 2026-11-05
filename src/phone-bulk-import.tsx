import { readAnalysisFile, parseAnalysisBatch } from "./analysis-queue";
import { openMortal, mortalLink, MORTAL_READY } from "./mortal-handoff";
import { useEffect, useState, type ReactNode } from "react";
import { errors } from "./api";
import { PaipuyaLink } from "./paipuya-link";
export function PhoneBulkImport({
  disabled,
  historyCode,
  onBusy,
  onPendingChange,
  onImport,
  onSaved,
  place = "この端末",
  tools,
}: {
  disabled: boolean;
  historyCode: string;
  onBusy: (busy: boolean) => void;
  onPendingChange: (pending: boolean) => void;
  onImport: (
    value: string,
  ) => Promise<{ added: number; existing: number; updated?: number }>;
  onSaved: () => Promise<void>;
  place?: string;
  tools?: ReactNode;
}) {
  const [value, setValue] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [codeNotice, setCodeNotice] = useState("");
  const [openedURL, setOpenedURL] = useState("");
  let singleURL = "";
  try {
    const entries = parseAnalysisBatch(value);
    if (entries.length === 1) singleURL = entries[0].url;
  } catch {
    /* Keep incomplete input editable; validate on submit. */
  }
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
  const submit = (analyse: boolean) =>
    void work(async () => {
      // Validate the complete batch before opening anything or saving any URL.
      const entries = parseAnalysisBatch(value);
      if (analyse && entries.length !== 1) throw Error("invalid_bulk_text");
      if (analyse) openMortal(entries[0].url);
      const result = await onImport(value);
      setOpenedURL(analyse ? entries[0].url : "");
      setValue("");
      setNotice(
        `${place}に${result.added}件追加 · 重複${result.existing}件${result.updated !== undefined ? ` · 情報${result.updated}件補完` : ""}${analyse ? ` · ${MORTAL_READY}` : ""}`,
      );
      try {
        await onSaved();
      } catch {
        setError(
          "保存は完了しました。画面を更新できませんでした。牌譜タブを開き直してください。",
        );
      }
    });
  return (
    <div className="bulk-history">
      <PaipuyaLink />
      <label>
        雀魂共有URL
        <textarea
          value={value}
          rows={3}
          maxLength={2 * 1024 * 1024}
          placeholder="URLを1件、または改行して複数件貼り付け"
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled || working}
          onChange={(e) => {
            setValue(e.target.value);
            setError("");
            setNotice("");
            setOpenedURL("");
          }}
        />
      </label>
      <div className="bulk-history-actions">
        <button
          className="button primary"
          disabled={disabled || working || !value.trim()}
          onClick={() => submit(false)}
        >
          {working ? "処理中…" : "追加"}
        </button>
        {singleURL && (
          <button
            className="button secondary"
            disabled={disabled || working}
            onClick={() => submit(true)}
          >
            Mortalへ
          </button>
        )}
        <button
          className="text-button"
          disabled={disabled || working || !value}
          onClick={() => {
            setValue("");
            setError("");
            setNotice("");
            setOpenedURL("");
          }}
        >
          入力を取り消す
        </button>
      </div>
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
      {tools}
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
      {notice && (
        <p role="status">
          {notice}
          {openedURL && (
            <a
              href={mortalLink(openedURL)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Mortalを開く
            </a>
          )}
        </p>
      )}
    </div>
  );
}
