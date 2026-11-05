import type { Report } from "./real-types";
import { useState } from "react";
import {
  analysisStatus,
  visibleAnalysis,
  type AnalysisEntry,
} from "./analysis-queue";
import { openMortal } from "./mortal-handoff";
import { ReplaySelection, useReplaySelection } from "./replay-selection";
import { ReplaySort, sortReplays, type ReplayOrder } from "./replay-sort";

export function PhoneReplayList({
  entries,
  disabled,
  onProblems,
  onDelete,
  desktop = false,
  reports = [],
  onReview,
  onResult,
  onRequested,
  onDropResult,
}: {
  entries: AnalysisEntry[];
  disabled: boolean;
  onProblems: (reports: string[]) => void;
  onDelete?: (ids: string[]) => void;
  desktop?: boolean;
  reports?: Report[];
  onReview?: (report: string) => void;
  onResult?: (entry: AnalysisEntry) => void;
  onRequested?: (entry: AnalysisEntry) => void;
  onDropResult?: (entry: AnalysisEntry, files: File[]) => void;
}) {
  const [filter, setFilter] = useState("すべて");
  const [limit, setLimit] = useState(10);
  const [order, setOrder] = useState<ReplayOrder>("added");
  const ordered = sortReplays(entries.filter(visibleAnalysis), order);
  const filtered = ordered.filter(
    (e) =>
      filter === "すべて" ||
      (filter === "未解析" ? !e.reports?.length : !!e.reports?.length),
  );
  const selection = useReplaySelection(filtered);
  const analysed = ordered.filter((e) => e.reports?.length).length;
  return (
    <section className="panel phone-replays" aria-label="保存牌譜">
      <h2>
        保存牌譜 <span className="phone-count">{ordered.length}件</span>
      </h2>
      <div
        className="filters replay-filters"
        role="group"
        aria-label="牌譜の状態"
      >
        {Object.entries({
          すべて: ordered.length,
          未解析: ordered.length - analysed,
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
      <ReplaySort
        value={order}
        onChange={(value) => {
          setOrder(value);
          setLimit(10);
        }}
      />
      <div className="analysis-list">
        <ReplaySelection
          entries={filtered}
          selected={selection.selected}
          disabled={disabled}
          onSelect={selection.setIds}
          onDelete={onDelete}
        />
        {filtered.slice(0, limit).map((e) => {
          const unsupported =
            !!e.history && ![9, 12, 16].includes(e.history.mode);
          const title = e.history
            ? `${new Date(e.history.at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} · ${e.history.rank}位`
            : `保存牌譜 ${entries.indexOf(e) + 1}`;
          return (
            <article
              className="phone-replay-row"
              key={e.id}
              data-testid="analysis-row"
              onDragOver={(event) => {
                if (
                  !onDropResult ||
                  !event.dataTransfer.types.includes("Files")
                )
                  return;
                event.preventDefault();
                event.dataTransfer.dropEffect = disabled ? "none" : "copy";
              }}
              onDrop={(event) => {
                if (!onDropResult) return;
                event.preventDefault();
                if (!disabled)
                  onDropResult(e, Array.from(event.dataTransfer.files));
              }}
            >
              <div className="phone-replay-info">
                <div className="phone-replay-summary">
                  {onDelete && (
                    <input
                      className="replay-checkbox"
                      type="checkbox"
                      aria-label={`${title}を選択`}
                      disabled={disabled}
                      checked={selection.selected.includes(e.id)}
                      onChange={() => selection.toggle(e.id)}
                    />
                  )}
                  <strong>{title}</strong>
                  <span className="badge">
                    {e.reports?.length
                      ? e.ready
                        ? "学習可"
                        : "解析済み・問題なし"
                      : "未解析"}
                  </span>
                </div>
                {e.history && (
                  <p className="phone-replay-opponents">
                    {e.history.players
                      .filter((_, seat) => seat !== e.history!.seat)
                      .map((p) => p.name)
                      .join(" / ")}
                  </p>
                )}
              </div>
              {e.ready && e.reports?.length ? (
                <button
                  className="button secondary phone-replay-primary"
                  disabled={disabled}
                  onClick={() => onProblems(e.reports!)}
                >
                  問題を見る
                </button>
              ) : !e.reports?.length ? (
                <button
                  className="button secondary phone-replay-primary"
                  disabled={disabled || unsupported}
                  onClick={() => openMortal(e.url)}
                >
                  {unsupported ? "東風は対象外" : "Mortalへ"}
                </button>
              ) : null}
              <details className="phone-replay-details">
                <summary>詳細</summary>
                <div className="phone-replay-detail">
                  <small>
                    保存：{new Date(e.created).toLocaleString("ja-JP")}
                  </small>
                  {!desktop && (
                    <small>
                      {e.received
                        ? "Windows受信済み"
                        : "この端末に保存済み・未同期"}
                    </small>
                  )}
                  {e.requested && !e.reports?.length && (
                    <small>{analysisStatus(e)}</small>
                  )}
                  {e.reports?.map(
                    (id) =>
                      onReview && (
                        <button
                          key={id}
                          className="text-button"
                          disabled={disabled}
                          onClick={() => onReview(id)}
                        >
                          {reports.find((r) => r.id === id)?.model_name ??
                            "解析結果"}{" "}
                          · 牌譜を確認
                        </button>
                      ),
                  )}
                  {onResult && (
                    <button
                      className="text-button"
                      disabled={disabled}
                      onClick={() => onResult(e)}
                    >
                      結果を登録
                    </button>
                  )}
                  {onRequested && !e.reports?.length && (
                    <button
                      className="text-button"
                      disabled={disabled}
                      onClick={() => onRequested(e)}
                    >
                      {e.requested ? "依頼の申告を取り消す" : "解析を依頼した"}
                    </button>
                  )}
                  {!!e.reports?.length && (
                    <button
                      className="text-button"
                      disabled={disabled || unsupported}
                      onClick={() => openMortal(e.url)}
                    >
                      {unsupported ? "東風は対象外" : "Mortalへ"}
                    </button>
                  )}
                </div>
              </details>
              {!desktop && !e.received && (
                <small className="phone-replay-pending">未同期</small>
              )}
            </article>
          );
        })}
      </div>
      {!filtered.length && (
        <p className="empty">
          {entries.length
            ? "該当する牌譜はありません。"
            : "保存した牌譜はありません。"}
        </p>
      )}
      {filtered.length > limit && (
        <button className="text-button" onClick={() => setLimit((n) => n + 10)}>
          さらに10件表示（残り{filtered.length - limit}件）
        </button>
      )}
    </section>
  );
}
