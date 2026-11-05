import { useEffect, useRef } from "react";
import collector from "../public/history-collector.js?raw";
import { VERSION } from "./version";
export const HISTORY_BOOKMARKLET = `javascript:${encodeURIComponent(collector.trim().replaceAll("__KYOKULOOP_VERSION__", VERSION))}`;

export function HistoryCollector() {
  const link = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (link.current) link.current.href = HISTORY_BOOKMARKLET;
  }, []);
  return (
    <details>
      <summary>PCで牌譜URLを取得</summary>
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
        <li>牌譜屋でそのブックマークを実行し、「KyokuLoopへコピー」。</li>
        <li>上の欄へ貼り付けて追加。</li>
      </ol>
    </details>
  );
}
