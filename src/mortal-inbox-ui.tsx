import { useEffect, useState } from "react";
import { api, errors } from "./api";
import type { AnalysisEntry } from "./analysis-queue";

type Inbox = {
  enabled: boolean;
  folder: string;
  error?: string;
  files: {
    name: string;
    status: string;
    report: string | null;
    error: string | null;
  }[];
};
export const entryLabel = (e: AnalysisEntry, index?: number) =>
  e.history
    ? `${new Date(e.history.at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })} · ${e.history.rank}位 · ${e.history.players
        .filter((_, i) => i !== e.history!.seat)
        .map((p) => p.name)
        .join(" / ")}`
    : `保存牌譜${index == null ? "" : ` ${index + 1}`} · ${e.url.split("paipu=")[1]}`;

export function MortalInboxSettings({
  disabled,
  onChange,
}: {
  disabled: boolean;
  onChange: () => Promise<void>;
}) {
  const [state, setState] = useState<Inbox | null>(null);
  const [folder, setFolder] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [requested, setRequested] = useState(false);
  useEffect(() => {
    if (!requested) return;
    let disposed = false;
    let loading = false;
    const update = async (initial = false) => {
      if (loading) return;
      loading = true;
      try {
        const data = await api<Inbox>({ action: "inbox_status" });
        if (disposed) return;
        setState(data);
        if (initial) {
          setFolder(data.folder);
          setEnabled(data.enabled);
        }
        if (initial) setError("");
      } catch (e) {
        if (!disposed)
          setError(
            e instanceof Error ? e.message : "状態を取得できませんでした。",
          );
      } finally {
        loading = false;
      }
    };
    void update(true);
    const timer = setInterval(() => void update(), 5000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [requested]);
  return (
    <details
      className="mortal-inbox"
      onToggle={(e) => {
        if (e.currentTarget.open) setRequested(true);
      }}
    >
      <summary>
        Mortal 自動取り込み
        {state
          ? ` · ${state.error ? "停止中・要確認" : state.enabled ? "有効" : "停止中"}`
          : ""}
      </summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          void (async () => {
            try {
              setState(
                await api<Inbox>({ action: "inbox_config", enabled, folder }),
              );
              await onChange();
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "保存できませんでした。",
              );
            } finally {
              setBusy(false);
            }
          })();
        }}
      >
        <label>
          取り込みフォルダ
          <input
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            disabled={busy || disabled || !state}
            autoComplete="off"
          />
        </label>
        <label className="inbox-toggle">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            disabled={busy || disabled || !state}
          />
          このフォルダのMortal JSONを自動登録
        </label>
        <button
          className="button secondary"
          disabled={busy || disabled || !state}
        >
          {busy ? "保存中…" : "設定を保存"}
        </button>
      </form>
      {(error || state?.error) && (
        <p className="error" role="alert">
          {error || errors[state!.error!] || "取り込み先を確認してください。"}
        </p>
      )}
      {!!state?.files.length && (
        <ul className="inbox-files">
          {state.files.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              <span>{f.name}</span>
              <span>
                {f.status === "imported"
                  ? "登録済み"
                  : f.status === "duplicate"
                    ? "登録済み（重複）"
                    : f.status === "waiting"
                      ? "保存完了待ち"
                      : errors[f.error ?? ""] || "読み込めませんでした"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

export function ReportSourceLink({
  report,
  entries,
  disabled,
  onLink,
}: {
  report: string;
  entries: AnalysisEntry[];
  disabled: boolean;
  onLink: (report: string, entry: string) => void;
}) {
  const [entry, setEntry] = useState("");
  return (
    <details className="report-source-link">
      <summary>元牌譜を選ぶ</summary>
      <label>
        紐付け先の対局
        <select
          value={entry}
          onChange={(e) => setEntry(e.target.value)}
          disabled={disabled}
        >
          <option value="">選択してください</option>
          {entries.map((e, i) => (
            <option key={e.id} value={e.id}>
              {entryLabel(e, i)}
            </option>
          ))}
        </select>
      </label>
      <button
        className="button secondary"
        disabled={disabled || !entry}
        onClick={() => onLink(report, entry)}
      >
        この対局へ紐付ける
      </button>
    </details>
  );
}
