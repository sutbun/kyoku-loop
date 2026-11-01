export type AnalysisEntry = {
  id: string;
  url: string;
  created: string;
  received?: string;
  requested?: boolean;
  reports?: string[];
  ready?: boolean;
};
export const sourceURL = (value: string): string => {
  const url = value.trim();
  if (
    !/^https:\/\/game\.mahjongsoul\.com\/\?paipu=[A-Za-z0-9_-]{10,200}$/.test(
      url,
    )
  )
    throw new Error("invalid_source_url");
  return url;
};
export function validateAnalysisQueue(
  value: unknown,
): asserts value is AnalysisEntry[] {
  if (!Array.isArray(value) || value.length > 1000)
    throw new Error("invalid_queue");
  const ids = new Set();
  for (const e of value) {
    if (
      !e ||
      typeof e.url !== "string" ||
      sourceURL(e.url) !== e.url ||
      e.id !== e.url.split("paipu=")[1] ||
      ids.has(e.id) ||
      typeof e.created !== "string" ||
      !Number.isFinite(Date.parse(e.created)) ||
      !/(?:Z|[+-]\d{2}:\d{2})$/.test(e.created) ||
      (e.received !== undefined &&
        (typeof e.received !== "string" ||
          !Number.isFinite(Date.parse(e.received)))) ||
      (e.requested !== undefined && typeof e.requested !== "boolean") ||
      (e.ready !== undefined && typeof e.ready !== "boolean") ||
      (e.reports !== undefined &&
        (!Array.isArray(e.reports) ||
          e.reports.some(
            (r: unknown) => typeof r !== "string" || !/^[a-f0-9]{64}$/.test(r),
          )))
    )
      throw new Error("invalid_queue");
    ids.add(e.id);
  }
}
export const analysisStatus = (e: AnalysisEntry) =>
  e.reports?.length
    ? e.ready
      ? "学習準備完了"
      : "検証完了（対象問題なし）"
    : e.requested
      ? "解析依頼操作中（本人申告）"
      : "保存済み・未解析";
