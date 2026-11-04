import type { AnalysisEntry } from "./analysis-queue";
import {
  storedSourceReceipt,
  type MortalRegistrationResult,
} from "./mortal-registration";

export function MortalRegistrationNotice({
  result,
  local,
  entries,
}: {
  result: MortalRegistrationResult;
  local: boolean;
  entries: AnalysisEntry[];
}) {
  const references = entries.filter((e) => e.reports?.includes(result.id));
  // An exact stored report reference can confirm a later JSON-first link.
  const link =
    references.length === 1
      ? storedSourceReceipt(references[0].id, references[0].history)
      : result.source_link;
  const target = [
    link?.at && Number.isFinite(Date.parse(link.at))
      ? new Date(link.at).toLocaleString("ja-JP", {
          timeZone: "Asia/Tokyo",
          year: "numeric",
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "",
    link?.rank ? `${link.rank}位` : "",
    link?.score !== undefined ? `${link.score.toLocaleString("ja-JP")}点` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const place = local ? "この端末" : "Windows";
  return (
    <p role="status" style={{ overflowWrap: "anywhere" }}>
      <span>
        {place}
        {result.duplicate ? "に登録済みの結果です" : "に登録しました"}
      </span>
      <br />
      <strong>
        {link?.linked
          ? "元牌譜に紐付け済み"
          : link
            ? "元牌譜は未紐付けです"
            : "元牌譜との紐付けは未確認です"}
      </strong>
      {link?.linked && target && (
        <>
          <br />
          {target}
        </>
      )}
    </p>
  );
}
