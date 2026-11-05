import { useEffect, useState } from "react";
import { ReplaySelection, useReplaySelection } from "./replay-selection";
import { ReplaySort, sortReplays, type ReplayOrder } from "./replay-sort";
import { openMortal, MORTAL_READY, mortalLink } from "./mortal-handoff";
import {
  analysisStatus,
  visibleAnalysis,
  sourceURL,
  type AnalysisEntry,
} from "./analysis-queue";

export function SourceInput({
  disabled,
  onSave,
  mortal,
  onPendingChange,
}: {
  disabled: boolean;
  onSave: (url: string) => Promise<void>;
  mortal?: boolean;
  onPendingChange?: (pending: boolean) => void;
}) {
  const [url, setURL] = useState("");
  const [openedURL, setOpenedURL] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    onPendingChange?.(!!url || saving);
  }, [url, saving, onPendingChange]);
  useEffect(() => () => onPendingChange?.(false), [onPendingChange]);
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
    setOpenedURL(analyse ? canonical : "");
    try {
      if (analyse) {
        openMortal(canonical);
      }
    } catch {
      setSaving(false);
      setError("Mortal画面を開けませんでした。もう一度操作してください。");
      return;
    }
    void Promise.resolve()
      .then(() => onSave(canonical))
      .then(() => {
        setURL("");
        setNotice(analyse ? MORTAL_READY : "解析待ちに追加しました");
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
          Mortalへ
        </button>
      )}
      {notice && (
        <span role="status">
          {notice}
          {mortal && openedURL && (
            <a
              href={mortalLink(openedURL)}
              target="_blank"
              rel="noopener noreferrer"
            >
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
  onDropResult,
  onDelete,
}: {
  entries: AnalysisEntry[];
  portable?: boolean;
  disabled: boolean;
  onOpen?: (entry: AnalysisEntry) => void;
  onResult?: (entry: AnalysisEntry) => void;
  onRequested?: (entry: AnalysisEntry) => void;
  onDropResult?: (entry: AnalysisEntry, files: File[]) => void;
  onDelete?: (ids: string[]) => void;
}) {
  const [limit, setLimit] = useState(10);
  const [filter, setFilter] = useState("すべて");
  const [order, setOrder] = useState<ReplayOrder>("added");
  const [dragged, setDragged] = useState<string | null>(null);
  const visible = entries.filter(visibleAnalysis);
  const analysed = visible.filter((e) => e.reports?.length).length;
  const filtered = sortReplays(visible, order).filter(
    (e) =>
      portable ||
      filter === "すべて" ||
      (filter === "解析済み" ? !!e.reports?.length : !e.reports?.length),
  );
  const selection = useReplaySelection(filtered);
  return (
    <div className="analysis-list">
      {!portable && (
        <div
          className="filters replay-filters"
          role="group"
          aria-label="牌譜の状態"
        >
          {Object.entries({
            すべて: visible.length,
            未解析: visible.length - analysed,
            解析済み: analysed,
          }).map(([name, count]) => (
            <button
              key={name}
              className={filter === name ? "chosen" : ""}
              aria-pressed={filter === name}
              onClick={() => {
                setFilter(name);
                setLimit(10);
                selection.setIds([]);
              }}
            >
              {name} {count}件
            </button>
          ))}
        </div>
      )}
      <ReplaySort
        value={order}
        onChange={(value) => {
          setOrder(value);
          setLimit(10);
        }}
      />
      <ReplaySelection
        entries={filtered}
        selected={selection.selected}
        disabled={disabled}
        onSelect={selection.setIds}
        onDelete={onDelete}
      />
      {(portable ? filtered : filtered.slice(0, limit)).map((e) => (
        <div
          className={`analysis-row${dragged === e.id ? " drop-active" : ""}`}
          key={e.id}
          data-testid="analysis-row"
          onDragOver={(event) => {
            if (
              portable ||
              !onDropResult ||
              !event.dataTransfer.types.includes("Files")
            )
              return;
            event.preventDefault();
            event.dataTransfer.dropEffect = disabled ? "none" : "copy";
            if (!disabled) setDragged(e.id);
          }}
          onDragLeave={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            )
              setDragged(null);
          }}
          onDrop={(event) => {
            if (portable || !onDropResult) return;
            event.preventDefault();
            setDragged(null);
            if (!disabled)
              onDropResult(e, Array.from(event.dataTransfer.files));
          }}
        >
          {onDelete && (
            <input
              className="replay-checkbox"
              type="checkbox"
              aria-label={`保存牌譜 ${visible.indexOf(e) + 1}を選択`}
              disabled={disabled}
              checked={selection.selected.includes(e.id)}
              onChange={() => selection.toggle(e.id)}
            />
          )}
          <div className="analysis-row-title">
            <strong>
              {e.history
                ? `${new Date(e.history.at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} · ${e.history.rank}位`
                : `保存牌譜 ${visible.indexOf(e) + 1}`}
            </strong>
            <small>
              {e.history
                ? e.history.players
                    .filter((_, seat) => seat !== e.history!.seat)
                    .map((p) => p.name)
                    .join(" / ")
                : `保存：${new Date(e.created).toLocaleString("ja-JP")}`}
            </small>
          </div>
          <span className="badge">{analysisStatus(e)}</span>
          {portable ? (
            <div className="analysis-actions">
              <small>
                {e.received ? "Windows受信済み" : "この端末に保存済み・未同期"}
              </small>
              <button
                className="button secondary"
                disabled={
                  disabled ||
                  (!!e.history && ![9, 12, 16].includes(e.history.mode))
                }
                onClick={() => openMortal(e.url)}
              >
                {e.history && ![9, 12, 16].includes(e.history.mode)
                  ? "東風は対象外"
                  : "Mortalへ"}
              </button>
            </div>
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
      {!portable && filtered.length === 0 && (
        <div className="empty">
          {visible.length
            ? "該当する牌譜はありません。"
            : "保存した牌譜はありません。"}
        </div>
      )}
      {!portable && filtered.length > limit && (
        <button className="text-button" onClick={() => setLimit((n) => n + 10)}>
          さらに10件表示（残り{filtered.length - limit}件）
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
        <li>雀魂の共有URLを貼り、「Mortalへ」を押します。</li>
        <li>
          <a
            href="https://mjai.ekyu.moe/ja.html"
            target="_blank"
            rel="noreferrer"
          >
            Mortal
          </a>
          の入力済みURLと対象プレイヤー、使用するAIがMortalであることを確認して「送信」。雀魂へのログイン・拡張は不要です。四麻半荘が対象です。
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
