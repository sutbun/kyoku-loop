import { SyncConnectionError } from "./import-sync";
import { readPhone, phoneTransaction } from "./store";
import { errors } from "../api";

export async function synchronizeAnalysis(): Promise<void> {
  const entries = (await readPhone())?.analysis_queue ?? [];
  if (!entries.length) return;
  const snapshot = entries.map(({ id, url, created, history }) => ({
    id,
    url,
    created,
    ...(history ? { history } : {}),
  }));
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch("/phone/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "analysis_sync", entries: snapshot }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      if (response.status === 403)
        throw Error(
          "接続が拒否されました。本人用の接続先を確認してください。記録は保持しています。",
        );
      throw new SyncConnectionError();
    }
    const body = await response.json();
    if (!body.ok)
      throw new Error(
        errors[body.error] ??
          "解析待ちを同期できません。URLは端末に残っています。",
      );
    if (!body.data || typeof body.data !== "object")
      throw new Error("invalid_receipt");
    await phoneTransaction({
      action: "analysis_ack",
      snapshot,
      entries: body.data.entries,
      received_at: body.data.received_at,
    });
  } finally {
    clearTimeout(timer);
  }
}
