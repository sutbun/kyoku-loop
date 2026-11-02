import { useState } from "react";
import {
  openMortal,
  MORTAL_COPIED,
  MORTAL_COPY_FAILED,
  MORTAL_PAGE,
} from "./mortal-handoff";
import {
  analysisStatus,
  sourceURL,
  type AnalysisEntry,
} from "./analysis-queue";

export function SourceInput({
  disabled,
  onSave,
  mortal,
}: {
  disabled: boolean;
  onSave: (url: string) => Promise<void>;
  mortal?: boolean;
}) {
  const [url, setURL] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const submit = (analyse: boolean) => {
    let canonical: string;
    try {
      canonical = sourceURL(url);
    } catch {
      setError("雀魂の共有URLを確認してください。");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    let handoff: Promise<boolean | null>;
    try {
      handoff = analyse ? openMortal(canonical) : Promise.resolve(null);
    } catch {
      setSaving(false);
      setError("Mortal画面を開けませんでした。もう一度操作してください。");
      return;
    }
    const saved = Promise.resolve().then(() => onSave(canonical));
    void Promise.all([saved, handoff])
      .then(([, copied]) => {
        if (copied === false) {
          setNotice("解析待ちに追加しました");
          setError(MORTAL_COPY_FAILED);
        } else {
          setURL("");
          setNotice(copied ? MORTAL_COPIED : "解析待ちに追加しました");
        }
      })
      .catch((e) =>
        setError(
          e instanceof Error
            ? e.message
            : "保存できませんでした。同じURLで再試行できます。",
        ),
      )
      .finally(() => setSaving(false));
  };
  return (
    <form
      className="source-input"
      onSubmit={(e) => {
        e.preventDefault();
        submit(!!mortal);
      }}
    >
      <label>
        雀魂共有URL
        <input
          type="url"
          value={url}
          onChange={(e) => {
            const value = e.target.value;
            try {
              setURL(sourceURL(value));
            } catch {
              setURL(value);
            }
            setNotice("");
          }}
          disabled={disabled || saving}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          required
        />
      </label>
      <button
        className={`button ${mortal ? "secondary" : "primary"}`}
        type={mortal ? "button" : "submit"}
        onClick={mortal ? () => submit(false) : undefined}
        disabled={disabled || saving || !url.trim()}
      >
        保存
      </button>
      {mortal && (
        <button
          type="submit"
          className="button primary"
          disabled={disabled || saving || !url.trim()}
        >
          コピーしてMortalへ
        </button>
      )}
      {notice && (
        <span role="status">
          {notice}
          {mortal && (
            <a href={MORTAL_PAGE} target="_blank" rel="noopener noreferrer">
              Mortalを開く
            </a>
          )}
        </span>
      )}
      {error && <span role="alert">{error}</span>}
    </form>
  );
}

export function AnalysisList({
  entries,
  portable,
  disabled,
  onOpen,
  onResult,
  onRequested,
}: {
  entries: AnalysisEntry[];
  portable?: boolean;
  disabled: boolean;
  onOpen?: (entry: AnalysisEntry) => void;
  onResult?: (entry: AnalysisEntry) => void;
  onRequested?: (entry: AnalysisEntry) => void;
}) {
  const [limit, setLimit] = useState(10);
  const ordered = [...entries].reverse();
  return (
    <div className="analysis-list">
      {(portable ? ordered : ordered.slice(0, limit)).map((e, i) => (
        <div className="analysis-row" key={e.id} data-testid="analysis-row">
          <div>
            <strong>
              {!portable && e.history
                ? `${new Date(e.history.at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} · ${e.history.rank}位`
                : `保存牌譜 ${entries.length - i}`}
            </strong>
            <small>
              {!portable && e.history
                ? e.history.players
                    .filter((_, seat) => seat !== e.history!.seat)
                    .map((p) => p.name)
                    .join(" / ")
                : `保存：${new Date(e.created).toLocaleString("ja-JP")}`}
            </small>
          </div>
          <span className="badge">{analysisStatus(e)}</span>
          {portable ? (
            <small>
              {e.received ? "Windows受信済み" : "この端末に保存済み・未同期"}
            </small>
          ) : (
            <div className="analysis-actions">
              <button
                className="button secondary"
                disabled={
                  disabled ||
                  (!!e.history && ![9, 12, 16].includes(e.history.mode))
                }
                onClick={() => onOpen?.(e)}
              >
                {e.history && ![9, 12, 16].includes(e.history.mode)
                  ? "東風は対象外"
                  : "Mortalへ"}
              </button>
              <button
                className="button secondary"
                disabled={disabled}
                onClick={() => onResult?.(e)}
              >
                結果を登録
              </button>
              {!e.reports?.length && (
                <button
                  className="text-button"
                  disabled={disabled}
                  onClick={() => onRequested?.(e)}
                >
                  {e.requested ? "依頼中を取り消す" : "解析を依頼した"}
                </button>
              )}
            </div>
          )}
        </div>
      ))}
      {!portable && ordered.length > limit && (
        <button className="text-button" onClick={() => setLimit((n) => n + 10)}>
          さらに10件表示（残り{ordered.length - limit}件）
        </button>
      )}
    </div>
  );
}

export function AnalysisGuide({ onClose }: { onClose: () => void }) {
  return (
    <section className="panel analysis-guide" aria-label="解析の手順">
      <h2>解析の手順</h2>
      <ol>
        <li>雀魂の共有URLを貼り、「コピーしてMortalへ」を押します。</li>
        <li>
          <a
            href="https://mjai.ekyu.moe/ja.html"
            target="_blank"
            rel="noreferrer"
          >
            Mortal
          </a>
          の牌譜URL欄に貼り付け、使用するAIがMortalであることを確認して「送信」。雀魂へのログイン・拡張は不要です。四麻半荘が対象です。
        </li>
        <li>
          解析後、この牌譜の「結果を登録」へ結果URLまたは取得済みJSONを渡します。URL取得が拒否された場合はJSONを使います。
        </li>
      </ol>
      <button className="button secondary" onClick={onClose}>
        確認しました
      </button>
    </section>
  );
}
