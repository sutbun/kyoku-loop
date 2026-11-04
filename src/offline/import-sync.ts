import { readPhone, phoneTransaction } from "./store";
import { errors } from "../api";

export class SyncConnectionError extends Error {
  constructor() {
    super("Windowsに接続できません。結果と記録は端末に残っています。");
  }
}
export async function mortalRequest<T>(body: object): Promise<T> {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 45000);
  try {
    let response: Response;
    try {
      response = await fetch("/phone/mortal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
        signal: controller.signal,
      });
    } catch {
      throw new SyncConnectionError();
    }
    if (!response.ok) {
      if (response.status === 403)
        throw Error(
          "接続が拒否されました。本人用の接続先を確認してください。記録は保持しています。",
        );
      throw new SyncConnectionError();
    }
    const value = await response.json();
    if (!value.ok)
      throw Error(
        errors[value.error] ??
          "結果を同期できません。端末の記録を保持しています。",
      );
    return value.data;
  } finally {
    clearTimeout(timer);
  }
}
export async function synchronizeLocalImports() {
  await (await import("./source-reconcile")).hydrateLocalSources();
  const state = await readPhone();
  if (state?.schema !== 2) return;
  for (const entry of state.local_imports ?? []) {
    const current = await readPhone();
    if (entry.synced_source === current?.pack?.source && !current?.local_source)
      continue;
    const stage = await mortalRequest<{
      source: string;
      token: string;
      target_seat: number;
      models: { name: string }[];
      rounds: number;
    }>({
      action: "inspect",
      data: entry.material.payload,
      source: current?.local_source ? null : (current?.pack?.source ?? null),
    });
    if (
      stage.target_seat !== entry.material.seat ||
      stage.models[0]?.name !== entry.material.model ||
      stage.rounds !== entry.material.rounds
    )
      throw Error("invalid_receipt");
    if (current?.local_source)
      await phoneTransaction({ action: "bind_source", source: stage.source });
    const bound = await readPhone();
    if (bound?.pack?.source !== stage.source) throw Error("different_source");
    const result = await mortalRequest<{ id: string; source: string }>({
      action: "register",
      token: stage.token,
      source: stage.source,
      analysis_id: entry.analysis_id,
      created_at: entry.material.created,
      item_ids: entry.item_ids,
    });
    if (result.id !== entry.material.id || result.source !== stage.source)
      throw Error("invalid_receipt");
    await phoneTransaction({
      action: "import_ack",
      id: result.id,
      analysis_id: entry.analysis_id,
      source: result.source,
    });
  }
}
