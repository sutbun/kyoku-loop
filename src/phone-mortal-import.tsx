import { useState } from "react";
import { errors } from "./api";
import { compileMortal, type LocalMaterial } from "./offline/mortal-compiler";
import { phoneTransaction, readPhone } from "./offline/store";
import type { Stage } from "./real-types";
import type { AnalysisEntry } from "./analysis-queue";

type ImportStage = Stage & { source: string };
async function request<T>(body: object): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch("/phone/mortal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok)
      throw new Error(
        response.status === 403
          ? "接続が拒否されました。本人用のTailscale接続と接続先を確認してください。"
          : "Windowsに接続できません。TailscaleとWindows側KyokuLoopの起動を確認してください。",
      );
    const value = await response.json();
    if (!value.ok)
      throw new Error(
        errors[value.error] ??
          "取り込めませんでした。現在の記録は保持しています。",
      );
    return value.data;
  } catch (e) {
    if (
      e instanceof TypeError ||
      (e instanceof DOMException && e.name === "AbortError")
    )
      throw new Error(
        "登録結果を確認できません。TailscaleとWindows側の起動を確認して再試行してください。同じ結果は重複登録しません。",
      );
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export function PhoneMortalImport({
  disabled,
  online,
  local,
  entries,
  onBusy,
  onRegistered,
}: {
  disabled: boolean;
  online: boolean;
  local: boolean;
  entries: AnalysisEntry[];
  onBusy: (value: boolean) => void;
  onRegistered: (local?: boolean) => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [material, setMaterial] = useState<LocalMaterial | null>(null);
  const [stage, setStage] = useState<ImportStage | null>(null);
  const [entry, setEntry] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [updateError, setUpdateError] = useState("");
  const work = async (operation: () => Promise<void>) => {
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      await operation();
    } catch (e) {
      setError(
        e instanceof Error
          ? (errors[e.message] ?? e.message)
          : "取り込めませんでした。",
      );
    } finally {
      setBusy(false);
      onBusy(false);
    }
  };
  const updatePack = async () => {
    setUpdateError("");
    try {
      await onRegistered();
    } catch {
      setUpdateError("Windows登録済みです。端末の問題を更新できませんでした。");
    }
  };
  const inspect = (selected: File) =>
    void work(async () => {
      setStage(null);
      setMaterial(null);
      setNotice("");
      setUpdateError("");
      setEntry("");
      if (selected.size > 20 * 1024 * 1024) throw new Error(errors.size_limit);
      if (local) {
        const compiled = await compileMortal(selected);
        setMaterial(compiled);
        setStage({
          source: "local",
          token: "",
          engine: "Mortal",
          target_seat: compiled.seat,
          players: compiled.players,
          rounds: compiled.rounds,
          models: [{ index: 0, name: compiled.model }],
        });
        return;
      }
      const bytes = new Uint8Array(await selected.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 8192)
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      const state = await readPhone();
      setStage(
        await request<ImportStage>({
          action: "inspect",
          data: btoa(binary),
          source: state?.pack?.source ?? null,
        }),
      );
    });
  return (
    <details className="phone-result-import">
      <summary>解析結果を追加</summary>
      {!online && !local && (
        <p>通信を戻し、TailscaleとWindows側KyokuLoopに接続してください。</p>
      )}
      <label className="file-drop">
        Mortal JSON / JSON.gz
        <input
          type="file"
          accept=".json,.gz,application/json,application/gzip"
          disabled={disabled || busy || (!online && !local)}
          onChange={(e) => {
            const selected = e.target.files?.[0];
            e.target.value = "";
            if (selected) {
              setFile(selected);
              inspect(selected);
            }
          }}
        />
      </label>
      {file && <small className="import-file-name">{file.name}</small>}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {stage ? (
        <>
          <p>
            {stage.rounds}局 · Mortal {stage.models[0].name}
            <br />
            解析対象：席{stage.target_seat! + 1} ·{" "}
            {stage.players[stage.target_seat!]}
          </p>
          <label>
            元牌譜（任意）
            <select
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
              disabled={disabled || busy}
            >
              <option value="">指定せず登録</option>
              {entries
                .filter((e) => local || e.received)
                .map((e, i) => (
                  <option key={e.id} value={e.id}>
                    保存牌譜 {i + 1} · {e.url.split("paipu=")[1]}
                  </option>
                ))}
            </select>
          </label>
          <button
            className="button primary"
            disabled={disabled || busy || (!online && !local)}
            onClick={() =>
              void work(async () => {
                if (material) {
                  const result = await phoneTransaction<{ duplicate: boolean }>(
                    {
                      action: "register_local",
                      material,
                      analysis_id: entry || null,
                    },
                  );
                  setNotice(
                    result.duplicate
                      ? "この端末に登録済みの結果です"
                      : "この端末に登録しました",
                  );
                  setStage(null);
                  setMaterial(null);
                  await onRegistered(true);
                  return;
                }
                const result = await request<{
                  id: string;
                  duplicate: boolean;
                  source: string;
                }>({
                  action: "register",
                  token: stage.token,
                  source: stage.source,
                  analysis_id: entry || null,
                });
                setNotice(
                  result.duplicate
                    ? "Windowsに登録済みの結果です"
                    : "Windowsに登録しました",
                );
                setStage(null);
                // The registration acknowledgement is durable even if pack refresh fails.
                await updatePack();
              })
            }
          >
            {busy ? "処理中…" : local ? "この端末に登録" : "Windowsに登録"}
          </button>
        </>
      ) : (
        !notice &&
        file && (
          <button
            className="button secondary"
            disabled={disabled || busy || (!online && !local)}
            onClick={() => inspect(file)}
          >
            {busy ? "読み込み中…" : "読み込みを再試行"}
          </button>
        )
      )}
      {stage && file && (
        <button
          className="text-button"
          disabled={disabled || busy || (!online && !local)}
          onClick={() => inspect(file)}
        >
          読み直す
        </button>
      )}
      {stage && (
        <button
          className="text-button"
          disabled={busy || disabled}
          onClick={() => {
            setStage(null);
            setFile(null);
            setMaterial(null);
            setError("");
          }}
        >
          取り消す
        </button>
      )}
      {notice && <p role="status">{notice}</p>}
      {updateError && (
        <div className="error" role="alert">
          {updateError}
          <button
            className="button secondary"
            disabled={disabled || busy || (!online && !local)}
            onClick={() => void work(updatePack)}
          >
            問題の更新を再試行
          </button>
        </div>
      )}
    </details>
  );
}
