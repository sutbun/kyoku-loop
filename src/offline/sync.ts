import { readPhone, phoneTransaction } from "./store";
import { syncPayload, validateSyncReply } from "./protocol";
import { errors } from "../api";

export async function synchronizePhone(): Promise<void> {
  const state = await readPhone();
  if (!state?.pack) return;
  const payload = syncPayload(state);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  let body: { ok: boolean; error?: string; data?: unknown };
  try {
    const response = await fetch("/phone/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sync", payload }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("sync_network");
    body = await response.json();
  } catch {
    throw new Error(
      "Windowsに接続できません。記録を端末に残して再試行します。",
    );
  } finally {
    clearTimeout(timer);
  }
  if (!body.ok)
    throw new Error(
      errors[body.error ?? ""] ??
        "同期できませんでした。記録は端末に残っています。",
    );
  const reply = await validateSyncReply(payload, body.data);
  await phoneTransaction({ action: "apply_sync", snapshot: payload, reply });
}
