export type AnalysisHistory = {
  at: string;
  rank: number;
  seat: number;
  mode: number;
  players: { name: string; score: number }[];
  player: number;
  url: string;
};
export type AnalysisEntry = {
  id: string;
  url: string;
  created: string;
  received?: string;
  requested?: boolean;
  reports?: string[];
  ready?: boolean;
  history?: AnalysisHistory;
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
    if (e.history !== undefined) normalizeAnalysisHistory(e.history, e.url);
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
  parseAnalysisBatch(text);
  return text;
}

export function normalizeAnalysisHistory(
  value: unknown,
  url: string,
): AnalysisHistory {
  const v = value as AnalysisHistory;
  const bad = () => {
    throw Error("invalid_history");
  };
  if (
    !v ||
    !Number.isInteger(v.player) ||
    v.player < 1 ||
    v.player > 2147483647 ||
    ![8, 9, 11, 12, 15, 16].includes(v.mode) ||
    !Number.isInteger(v.seat) ||
    v.seat < 0 ||
    v.seat > 3 ||
    (v.url !== undefined && v.url !== url) ||
    !Array.isArray(v.players) ||
    v.players.length !== 4
  )
    bad();
  const actor = 1358437 + ((7 * v.player + 1117113) ^ 86216345);
  if (!url.endsWith("_a" + actor)) bad();
  const date =
    typeof v.at === "string" &&
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.exec(
      v.at,
    );
  if (!date || !Number.isFinite(Date.parse(v.at))) bad();
  const d = date as RegExpExecArray;
  const [y, m, day, h, min, sec] = d.slice(1, 7).map(Number);
  const calendar = new Date(Date.UTC(y, m - 1, day));
  if (
    y < 2019 ||
    y > 2100 ||
    h > 23 ||
    min > 59 ||
    sec > 59 ||
    calendar.getUTCFullYear() !== y ||
    calendar.getUTCMonth() !== m - 1 ||
    calendar.getUTCDate() !== day
  )
    bad();
  const players = v.players.map((p) => {
    if (
      !p ||
      typeof p.name !== "string" ||
      !p.name.trim() ||
      [...p.name.trim()].length > 100 ||
      /[\u0000-\u001f]/.test(p.name) ||
      !Number.isInteger(p.score) ||
      Math.abs(p.score) > 1000000
    )
      bad();
    return { name: p.name.trim(), score: p.score };
  });
  const rank =
    [0, 1, 2, 3]
      .sort((a, b) => players[b].score - players[a].score || a - b)
      .indexOf(v.seat) + 1;
  if (v.rank !== undefined && v.rank !== rank) bad();
  return {
    at: v.at,
    rank,
    seat: v.seat,
    mode: v.mode,
    players,
    player: v.player,
    url,
  };
}
export const sameAnalysisHistory = (
  a: AnalysisHistory,
  b: AnalysisHistory,
  url: string,
) =>
  JSON.stringify({
    ...normalizeAnalysisHistory(a, url),
    at: new Date(a.at).toISOString(),
  }) ===
  JSON.stringify({
    ...normalizeAnalysisHistory(b, url),
    at: new Date(b.at).toISOString(),
  });

export function parseAnalysisBatch(
  value: unknown,
): { url: string; history?: AnalysisHistory }[] {
  if (typeof value !== "string") throw Error("invalid_bulk_text");
  if (new TextEncoder().encode(value).length > 2 * 1024 * 1024)
    throw Error("bulk_text_limit");
  if (!value.trimStart().startsWith("{"))
    return parseAnalysisText(value).map((url) => ({ url }));
  let data;
  try {
    data = JSON.parse(value.replace(/^\uFEFF/, ""));
  } catch {
    throw Error("invalid_bulk_text");
  }
  if (
    !data ||
    data.kind !== "kyokuloop-history" ||
    data.version !== 1 ||
    !Array.isArray(data.entries) ||
    !data.entries.length ||
    data.entries.length > 500
  )
    throw Error("invalid_bulk_text");
  const result = new Map<string, { url: string; history?: AnalysisHistory }>();
  for (const entry of data.entries) {
    if (!entry || typeof entry.url !== "string")
      throw Error("invalid_bulk_text");
    const url = sourceURL(entry.url);
    const history = ["at", "players", "seat", "mode"].some((k) =>
      Object.hasOwn(entry, k),
    )
      ? normalizeAnalysisHistory({ ...entry, player: data.player, url }, url)
      : undefined;
    const old = result.get(url);
    if (
      old?.history &&
      history &&
      !sameAnalysisHistory(old.history, history, url)
    )
      throw Error("history_conflict");
    result.set(url, {
      url,
      ...(history || old?.history ? { history: history ?? old!.history } : {}),
    });
  }
  return [...result.values()];
}
