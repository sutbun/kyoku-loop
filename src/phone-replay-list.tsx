import { useState } from "react";
import { analysisStatus, type AnalysisEntry } from "./analysis-queue";
import { openMortal } from "./mortal-handoff";

export function PhoneReplayList({
  entries,
  disabled,
  onProblems,
}: {
  entries: AnalysisEntry[];
  disabled: boolean;
  onProblems: (reports: string[]) => void;
}) {
  const [filter, setFilter] = useState("すべて");
  const [limit, setLimit] = useState(10);
  const ordered = [...entries].sort(
    (a, b) =>
      Date.parse(b.history?.at ?? b.created) -
      Date.parse(a.history?.at ?? a.created),
  );
  const filtered = ordered.filter(
    (e) =>
      filter === "すべて" ||
      (filter === "未解析"
        ? !e.reports?.length
        : e.ready && !!e.reports?.length),
  );
  return (
    <section className="panel phone-replays" aria-label="保存牌譜">
      <h2>
        保存牌譜 <span className="phone-count">{entries.length}件</span>
      </h2>
      <div className="filters" aria-label="牌譜の状態">
        {["すべて", "未解析", "学習準備完了"].map((name) => (
          <button
            key={name}
            className={filter === name ? "chosen" : ""}
            aria-pressed={filter === name}
            onClick={() => {
              setFilter(name);
              setLimit(10);
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="analysis-list">
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
            >
              <div className="phone-replay-summary">
                <strong>{title}</strong>
                <span className="badge">{analysisStatus(e)}</span>
              </div>
              <div className="phone-replay-actions">
                <details>
                  <summary>詳細</summary>
                  <div className="phone-replay-detail">
                    {e.history && (
                      <p>
                        {e.history.players
                          .filter((_, seat) => seat !== e.history!.seat)
                          .map((p) => p.name)
                          .join(" / ")}
                      </p>
                    )}
                    <small>
                      保存：{new Date(e.created).toLocaleString("ja-JP")}
                    </small>
                    <small>
                      {e.received
                        ? "Windows受信済み"
                        : "この端末に保存済み・未同期"}
                    </small>
                    {e.ready && (
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
                {e.ready && e.reports?.length ? (
                  <button
                    className="button secondary"
                    disabled={disabled}
                    onClick={() => onProblems(e.reports!)}
                  >
                    問題を見る
                  </button>
                ) : (
                  <button
                    className="button secondary"
                    disabled={disabled || unsupported}
                    onClick={() => openMortal(e.url)}
                  >
                    {unsupported ? "東風は対象外" : "Mortalへ"}
                  </button>
                )}
              </div>
              {!e.received && (
                <small className="phone-replay-pending">未同期</small>
              )}
            </article>
          );
        })}
      </div>
      {!filtered.length && (
        <p className="empty">
          {entries.length
            ? "この区分の牌譜はありません。"
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
