import { useState } from "react";
import {
  analysisStatus,
  sourceURL,
  type AnalysisEntry,
} from "./analysis-queue";

export function SourceInput({
  disabled,
  onSave,
}: {
  disabled: boolean;
  onSave: (url: string) => Promise<void>;
}) {
  const [url, setURL] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      className="source-input"
      onSubmit={(e) => {
        e.preventDefault();
        setSaving(true);
        setError("");
        void onSave(url)
          .then(() => {
            setURL("");
            setNotice("解析待ちに追加しました");
          })
          .catch((e) =>
            setError(
              e instanceof Error
                ? e.message
                : "保存できませんでした。同じURLで再試行できます。",
            ),
          )
          .finally(() => setSaving(false));
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
        className="button primary"
        disabled={disabled || saving || !url.trim()}
      >
        保存
      </button>
      {notice && <span role="status">{notice}</span>}
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
  return (
    <div className="analysis-list">
      {[...entries].reverse().map((e, i) => (
        <div className="analysis-row" key={e.id} data-testid="analysis-row">
          <div>
            <strong>保存牌譜 {entries.length - i}</strong>
            <small>保存：{new Date(e.created).toLocaleString("ja-JP")}</small>
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
                disabled={disabled}
                onClick={() => onOpen?.(e)}
              >
                NAGAで解析
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
    </div>
  );
}

export function AnalysisGuide({ onClose }: { onClose: () => void }) {
  return (
    <section className="panel analysis-guide" aria-label="解析の手順">
      <h2>解析の手順</h2>
      <ol>
        <li>「NAGAで解析」で雀魂の牌譜を開き、必要ならログインします。</li>
        <li>
          本人が用意した変換手段で、必要な局を天鳳牌譜エディタ形式にします。例として
          <a
            href="https://chromewebstore.google.com/detail/kdmfnkdgpialmejpgflfllkjakolamcc"
            target="_blank"
            rel="noreferrer"
          >
            雀魂牌譜検討サポーター
          </a>
          があります。利用する拡張の権限・対応環境は提供元で確認してください。
        </li>
        <li>
          <a
            href="https://naga.dmv.nico/naga_report/top/"
            target="_blank"
            rel="noreferrer"
          >
            NAGA公式
          </a>
          のカスタム牌譜解析で、対象局・タイプ・消費ポイントを確認し、本人が実行します。
        </li>
        <li>
          完了したレポートURLを、この牌譜の「結果を登録」へ貼り付けます。取得済みJSONファイルも使えます。
        </li>
      </ol>
      <button className="button secondary" onClick={onClose}>
        確認しました
      </button>
    </section>
  );
}
