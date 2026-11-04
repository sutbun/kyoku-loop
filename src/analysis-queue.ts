export type AnalysisEntry = {
  id: string;
  url: string;
  created: string;
  received?: string;
  requested?: boolean;
  reports?: string[];
  ready?: boolean;
  history?: {
    at: string;
    rank: number;
    seat: number;
    mode: number;
    players: { name: string; score: number }[];
  };
};
export const sourceURL = (value: string): string => {
  let url = value.trim();
  if (/^雀魂牌譜[:：]/.test(url))
    url = url
      .replace(/^雀魂牌譜[:：]/, "")
      .trim()
      .replace(/^https\\:\/\//, "https://");
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

// Text exported by the iPad Safari shortcut: one public replay URL per line.
export function parseAnalysisText(value: unknown): string[] {
  if (typeof value !== "string") throw Error("invalid_bulk_text");
  if (new TextEncoder().encode(value).length > 2 * 1024 * 1024)
    throw Error("bulk_text_limit");
  const lines = value
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length || lines.length > 500) throw Error("invalid_bulk_text");
  try {
    return [...new Set(lines.map(sourceURL))];
  } catch {
    throw Error("invalid_bulk_text");
  }
}

export async function readAnalysisFile(file: Blob): Promise<string> {
  if (file.size > 2 * 1024 * 1024) throw Error("bulk_text_limit");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(
      await file.arrayBuffer(),
    );
  } catch {
    throw Error("invalid_bulk_text");
  }
  parseAnalysisText(text);
  return text;
}
