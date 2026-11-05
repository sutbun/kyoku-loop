import type { AnalysisEntry } from "./analysis-queue";
import { PhoneReplayList } from "./phone-replay-list";

// Kept for existing report-list consumers; the actual list is shared.
export function AnalysisList({
  entries,
  disabled,
  portable = false,
  ...actions
}: {
  entries: AnalysisEntry[];
  disabled: boolean;
  portable?: boolean;
  onOpen?: (entry: AnalysisEntry) => void;
  onResult?: (entry: AnalysisEntry) => void;
  onRequested?: (entry: AnalysisEntry) => void;
  onDropResult?: (entry: AnalysisEntry, files: File[]) => void;
  onDelete?: (ids: string[]) => void;
}) {
  return (
    <PhoneReplayList
      entries={entries}
      disabled={disabled}
      desktop={!portable}
      onProblems={() => {}}
      {...actions}
    />
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
