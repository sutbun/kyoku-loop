import { PhoneBulkImport } from "./phone-bulk-import";
import { VersionUpdate } from "./version-update";
import { updateLocked } from "./offline/update-lock";
import { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import { api, errors } from "./api";
import { PracticeCard, StudyPanel } from "./study-ui";
import { StudyOptions } from "./study-options";
import type { StudySession, Workspace } from "./real-types";
import { readPhone } from "./offline/store";
import { saveShell, verifyShell } from "./offline/shell";
import { pendingEvents } from "./offline/engine";
import { synchronizePhone, downloadPhonePack } from "./offline/sync";
import { synchronizeAnalysis } from "./offline/analysis-sync";
import { SourceInput, AnalysisList } from "./analysis-ui";
import type { AnalysisEntry } from "./analysis-queue";
import { PhoneMortalImport } from "./phone-mortal-import";
import {
  synchronizeLocalImports,
  SyncConnectionError,
} from "./offline/import-sync";
import {
  compilerReady,
  saveCompiler,
  verifyLocalBackup,
} from "./offline/mortal-compiler";
import "./style.css";
import "./phone.css";
import "./phone-study.css";
import { usePhoneStudyLayout } from "./phone-study-layout";

function PhoneApp() {
  const [updateLock, setUpdateLock] = useState(false);
  const [importPending, setImportPending] = useState(false);
  const [sourcePending, setSourcePending] = useState(false);
  const [bulkPending, setBulkPending] = useState(false);
  const busyRef = useRef(0),
    importBusyRef = useRef(false);
  const [workspace, setWorkspace] = useState<Workspace>({
    reports: [],
    items: [],
  });
  const [screen, setScreen] = useState<"home" | "study">("home");
  const [active, setActive] = useState(false);
  const studying =
    screen === "study" &&
    active &&
    !!workspace.session &&
    !workspace.session.complete &&
    !workspace.session.stale &&
    !!workspace.session.scene;
  const studyRef = usePhoneStudyLayout(studying, workspace.session?.item_id);
  const [filter, setFilter] = useState("今日");
  const [busy, setBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [local, setLocal] = useState(false);
  const [resultPending, setResultPending] = useState(0);
  const [compilerSaved, setCompilerSaved] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(0);
  const [analysisQueue, setAnalysisQueue] = useState<AnalysisEntry[]>([]);
  const urlPending = analysisQueue.filter((e) => !e.received).length;
  const [capacity, setCapacity] = useState("");
  const [persistent, setPersistent] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [saved, setSaved] = useState("");
  const [syncNoticeOpen, setSyncNoticeOpen] = useState(false);
  const [syncing, setSyncing] = useState(false),
    [syncError, setSyncError] = useState(""),
    [lastSync, setLastSync] = useState("");
  const syncRunning = useRef(false),
    syncCompletion = useRef<Promise<void> | null>(null),
    retry = useRef<ReturnType<typeof setTimeout> | null>(null),
    delay = useRef(1000),
    mounted = useRef(true);
  const refresh = async () => {
    setWorkspace(await api<Workspace>({ action: "state" }));
    const state = await readPhone();
    setLocal(state?.schema === 2);
    setResultPending(
      state?.local_imports?.filter((e) => !e.synced_source).length ?? 0,
    );
    setAnalysisQueue(state?.analysis_queue ?? []);
    setPending(state ? pendingEvents(state).length : 0);
    setLastSync(state?.last_sync ?? "");
    setSaved(state?.pack?.exported_at ?? "");
    setCompilerSaved(await compilerReady());
    try {
      await verifyShell();
      setReady(!!state?.pack?.items.length);
    } catch {
      setReady(false);
    }
    const estimate = await navigator.storage
      ?.estimate?.()
      .catch(() => undefined);
    setCapacity(
      estimate?.quota !== undefined
        ? `保存領域の目安：残り ${Math.max(0, (estimate.quota - (estimate.usage ?? 0)) / 1048576).toFixed(0)}MB · 使用 ${((estimate.usage ?? 0) / 1048576).toFixed(1)}MB`
        : "容量情報を取得できません",
    );
    setPersistent(
      (await navigator.storage?.persisted?.().catch(() => false)) ?? false,
    );
    setLoaded(true);
  };
  const run = async (work: () => Promise<void>) => {
    if (updateLocked()) return;
    busyRef.current++;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setReady(false);
      setError(
        e instanceof Error
          ? (errors[e.message] ?? e.message)
          : "保存できませんでした。",
      );
    } finally {
      busyRef.current--;
      setBusy(busyRef.current > 0);
    }
  };
  const syncRecords = async (fresh = false, manual = false): Promise<void> => {
    if (updateLocked()) return;
    if (syncRunning.current) {
      if (fresh) {
        await syncCompletion.current;
        await syncRecords(true);
      }
      return;
    }
    if (!navigator.onLine) {
      if (fresh) throw new Error("offline");
      return;
    }
    let finishSync: () => void = () => {};
    syncCompletion.current = new Promise<void>((resolve) => {
      finishSync = resolve;
    });
    if (retry.current) clearTimeout(retry.current);
    syncRunning.current = true;
    setSyncing(true);
    try {
      const before = await readPhone();
      if (before?.schema === 2) {
        await synchronizeAnalysis();
        await synchronizeLocalImports();
        if (!(await readPhone())?.local_source) await synchronizePhone();
      } else {
        const results = await Promise.allSettled([
          synchronizePhone(),
          synchronizeAnalysis(),
        ]);
        const failed = results.find(
          (r): r is PromiseRejectedResult => r.status === "rejected",
        );
        if (failed) throw failed.reason;
      }
      const savedState = await readPhone();
      if (
        !savedState?.pack &&
        (manual ||
          savedState?.schema === 2 ||
          savedState?.analysis_queue?.some((e) => e.ready))
      ) {
        await saveShell();
        await api({ action: "install_pack", pack: await downloadPhonePack() });
      }
      delay.current = 1000;
      if (mounted.current) {
        await refresh();
        setSyncError("");
      }
    } catch (e) {
      const state = await readPhone();
      const network =
        e instanceof SyncConnectionError ||
        e instanceof TypeError ||
        (e instanceof DOMException && e.name === "AbortError") ||
        (e instanceof Error && e.message.startsWith("Windowsに接続できません"));
      if (
        mounted.current &&
        !fresh &&
        !(state?.schema === 2 && network && !manual)
      )
        setSyncError(
          e instanceof DOMException && e.name === "QuotaExceededError"
            ? "空き容量不足で受信確認を保存できません。未送信の記録を保持しています。"
            : e instanceof Error
              ? (errors[e.message] ?? e.message)
              : "同期できませんでした。記録は端末に残っています。",
        );
      if (mounted.current && navigator.onLine) {
        retry.current = setTimeout(() => void syncRecords(), delay.current);
        delay.current = Math.min(delay.current * 3, 60000);
      }
      if (fresh) throw e;
    } finally {
      syncRunning.current = false;
      syncCompletion.current = null;
      finishSync();
      if (mounted.current) setSyncing(false);
    }
  };
  useEffect(() => {
    if (loaded && online) {
      void readPhone()
        .then((s) => {
          if (
            s?.local_imports?.length ||
            s?.analysis_queue?.length ||
            (s?.pack && (s.events.length || s.last_sync))
          )
            void syncRecords();
        })
        .catch(() => {});
    }
  }, [loaded, online]);
  useEffect(() => {
    if (!loaded || !online || (!pending && !urlPending && !resultPending))
      return;
    const timer = setTimeout(() => void syncRecords(), 500);
    return () => clearTimeout(timer);
  }, [loaded, online, pending, urlPending, resultPending]);
  useEffect(() => {
    mounted.current = true;
    if (navigator.serviceWorker?.controller)
      void navigator.serviceWorker
        .register("/phone/sw.js", { scope: "/phone/", updateViaCache: "none" })
        .catch(() => {});
    void run(async () => {
      await refresh();
      setLoaded(true);
    });
    const net = () => {
      setOnline(navigator.onLine);
    };
    const focus = () => {
      void run(refresh);
      if (navigator.onLine) void syncRecords();
    };
    window.addEventListener("online", net);
    window.addEventListener("offline", net);
    window.addEventListener("focus", focus);
    const visibility = () => {
      if (document.visibilityState === "visible") focus();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      mounted.current = false;
      if (retry.current) clearTimeout(retry.current);
      window.removeEventListener("online", net);
      window.removeEventListener("offline", net);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  const download = () =>
    void run(async () => {
      setReady(false);
      await saveShell();
      const old = await readPhone();
      if (old?.schema === 2) {
        await saveCompiler();
        if (navigator.onLine) await syncRecords(true);
        await refresh();
        return;
      }
      if (
        (!old || !pendingEvents(old).length) &&
        !(old?.session && old.session.index < old.session.queue.length)
      ) {
        const pack = await downloadPhonePack();
        await api({ action: "install_pack", pack });
        const readback = await readPhone();
        if (
          !readback?.pack ||
          JSON.stringify(readback.pack) !== JSON.stringify(pack)
        )
          throw new Error("保存した問題を確認できません。");
      }
      await navigator.storage?.persist?.().catch(() => false);
      await refresh();
      await verifyShell();
      if (navigator.onLine) void syncRecords();
    });
  const begin = (mode: "scheduled" | "practice") =>
    void run(async () => {
      const session = await api<StudySession>({ action: "study_start", mode });
      setWorkspace((w) => ({ ...w, session }));
      setScreen("study");
      setActive(true);
    });
  const exportRecords = () =>
    void run(async () => {
      const state = await readPhone();
      if (!state) throw new Error("保存された記録がありません。");
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(state)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "kyokuloop-phone-records.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    });
  const connectionDetail = [
    !online && "オフライン",
    syncing && "同期中…",
    pending > 0 && `回答 未送信 ${pending}件`,
    resultPending > 0 && `結果 未同期 ${resultPending}件`,
    urlPending > 0 && `URL 未同期 ${urlPending}件`,
  ]
    .filter(Boolean)
    .join(" / ");
  return (
    <div
      ref={studyRef}
      className={`phone-app${studying ? " is-studying" : ""}`}
    >
      <header className="phone-header">
        <b>KyokuLoop</b>
        <div
          className="phone-connection"
          onKeyDown={(e) => {
            if (e.key === "Escape") setSyncNoticeOpen(false);
          }}
        >
          <button
            className={`phone-sync-button${syncError ? " has-warning" : ""}`}
            aria-label="同期の状態を確認"
            aria-expanded={syncNoticeOpen}
            onClick={() => setSyncNoticeOpen(!syncNoticeOpen)}
          >
            <span
              role="status"
              aria-live="polite"
              aria-atomic="true"
              title={syncError || connectionDetail}
            >
              {syncError ? (
                <span>同期を確認</span>
              ) : (
                <>
                  {!online && <span>オフライン</span>}
                  {syncing ? (
                    <span>同期中…</span>
                  ) : (
                    pending > 0 && <span>回答 未送信 {pending}件</span>
                  )}
                  {!!resultPending && (
                    <span>結果 未同期 {resultPending}件</span>
                  )}
                  {!!urlPending && <span>URL 未同期 {urlPending}件</span>}
                </>
              )}
            </span>
          </button>
          {syncNoticeOpen && (
            <div
              className="phone-sync-popover"
              role="dialog"
              aria-label="同期の状態"
            >
              <button
                className="text-button"
                aria-label="同期の詳細を閉じる"
                onClick={() => setSyncNoticeOpen(false)}
              >
                閉じる
              </button>
              <p>
                {syncError || connectionDetail || "同期の問題はありません。"}
              </p>
              <button
                className="button secondary"
                disabled={syncing || !online}
                onClick={() => void syncRecords(false, true)}
              >
                同期を再試行
              </button>
            </div>
          )}
        </div>
        <VersionUpdate
          enabled={loaded}
          onLock={setUpdateLock}
          guard={() => {
            if (
              !loaded ||
              busyRef.current ||
              importBusyRef.current ||
              syncRunning.current ||
              updateLocked()
            )
              return "処理後に再試行";
            if (sourcePending || importPending || bulkPending)
              return "入力を完了";
            if (screen !== "home") return "ホームで更新";
            return null;
          }}
        />
      </header>
      <main inert={updateLock}>
        <div className="content">
          {error && (
            <div className="error" role="alert">
              {error}
              <button className="text-button" onClick={() => void run(refresh)}>
                保存状態を確認
              </button>
            </div>
          )}
          {screen === "home" ? (
            <>
              <PracticeCard
                workspace={workspace}
                disabled={busy || importBusy || !loaded}
                onBegin={begin}
              />
              <section className="panel">
                <h2>牌譜を追加</h2>
                <SourceInput
                  mortal
                  disabled={busy || importBusy || !loaded}
                  onPendingChange={setSourcePending}
                  onSave={async (url) => {
                    await api({ action: "analysis_add", url });
                    await refresh();
                    // Keep the saved URL even if offline shell repair fails.
                    void saveShell().catch(() => {
                      setError(
                        "URLは保存済みです。アプリ本体の保存を確認できないため、通信復帰後に保存を確認してください。",
                      );
                    });
                    if (navigator.onLine) void syncRecords();
                  }}
                />
                <PhoneBulkImport
                  disabled={busy || importBusy || !loaded}
                  onPendingChange={setBulkPending}
                  onBusy={(value) => {
                    importBusyRef.current = value;
                    setImportBusy(value);
                  }}
                  onImport={(data) => api({ action: "analysis_bulk", data })}
                  onSaved={async () => {
                    await refresh();
                    void saveShell().catch(() =>
                      setError(
                        "URLは保存済みです。アプリ本体を保存できませんでした。通信復帰後に保存を確認してください。",
                      ),
                    );
                    if (navigator.onLine) void syncRecords();
                  }}
                />
                <PhoneMortalImport
                  disabled={busy || (!local && syncing) || !loaded}
                  online={online}
                  local={local}
                  entries={analysisQueue}
                  onPendingChange={setImportPending}
                  onBusy={(value) => {
                    importBusyRef.current = value;
                    setImportBusy(value);
                  }}
                  onRegistered={async (registeredLocal) => {
                    if (registeredLocal) {
                      await refresh();
                      return;
                    }
                    await syncRecords(true);
                    const state = await readPhone();
                    if (!state?.pack) {
                      await saveShell();
                      await api({
                        action: "install_pack",
                        pack: await downloadPhonePack(),
                      });
                    }
                    await refresh();
                  }}
                />
                <AnalysisList
                  entries={analysisQueue}
                  portable
                  disabled={busy || importBusy}
                />
              </section>
              <section className="panel phone-download" aria-label="保存と同期">
                <p data-testid="offline-status">
                  {ready
                    ? `オフライン利用可能 · ${workspace.items.length}問`
                    : "オフライン保存の確認が必要です"}
                </p>
                <div className="phone-storage-actions">
                  <button
                    className="button secondary"
                    disabled={
                      busy || syncing || importBusy || !loaded || !online
                    }
                    onClick={() =>
                      void run(async () => {
                        await saveShell();
                        await saveCompiler();
                        await api({ action: "enable_local" });
                        await navigator.storage?.persist?.().catch(() => false);
                        await refresh();
                      })
                    }
                  >
                    {compilerSaved && local
                      ? "端末用の保存を確認"
                      : "端末だけで使う準備"}
                  </button>
                  <button
                    className="button primary"
                    disabled={busy || importBusy || !loaded}
                    onClick={download}
                  >
                    {busy
                      ? "保存を確認中…"
                      : pending ||
                          (workspace.session && !workspace.session.complete)
                        ? "アプリ本体の保存を確認"
                        : "問題を端末に保存"}
                  </button>
                  <button
                    className="button secondary"
                    disabled={
                      busy || importBusy || syncing || !loaded || !online
                    }
                    onClick={() => {
                      setError("");
                      void syncRecords(false, true);
                    }}
                  >
                    今すぐ同期
                  </button>
                </div>
                {compilerSaved && local && (
                  <small data-testid="compiler-ready">
                    端末内の取り込み準備完了
                  </small>
                )}
                {!matchMedia("(display-mode: standalone)").matches &&
                  !ready && (
                    <p className="install-hint">
                      Safariの共有 →「ホーム画面に追加」
                    </p>
                  )}
              </section>
              <details className="panel phone-tools">
                <summary>端末の管理</summary>
                <div className="phone-tools-content">
                  <StudyOptions />
                  <small>
                    {lastSync
                      ? `最終同期：${new Date(lastSync).toLocaleString("ja-JP")}`
                      : "同期はまだ完了していません"}
                  </small>
                  {saved && (
                    <small>
                      取得：{new Date(saved).toLocaleString("ja-JP")}
                    </small>
                  )}
                  <small>{capacity}</small>
                  <a
                    href="/phone/licenses/NOTICE.txt"
                    target="_blank"
                    rel="noreferrer"
                  >
                    利用ライセンス
                  </a>
                  <small>
                    {persistent
                      ? "保存の保護を要求済み"
                      : "自動消去からの保護は未確認"}{" "}
                    · 容量不足やサイトデータ消去に備え、記録を保存できます。
                  </small>
                  <button
                    className="button secondary"
                    disabled={busy || !loaded}
                    onClick={exportRecords}
                  >
                    記録をファイルに保存
                  </button>
                  <label className="file-drop">
                    記録ファイルから復旧
                    <input
                      type="file"
                      accept=".json,application/json"
                      disabled={busy || syncing || !loaded}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (!file) return;
                        void run(async () => {
                          if (file.size > 20 * 1024 * 1024)
                            throw new Error(
                              "20MB以下の記録ファイルを選択してください。",
                            );
                          const backup = JSON.parse(await file.text());
                          await verifyLocalBackup(backup);
                          await api({ action: "restore_phone", backup });
                          await refresh();
                          if (navigator.onLine) void syncRecords();
                        });
                      }}
                    />
                  </label>
                </div>
              </details>
            </>
          ) : (
            <StudyPanel
              portable
              workspace={workspace}
              active={active}
              filter={filter}
              onFilter={setFilter}
              onActive={setActive}
              onRefresh={refresh}
              onSession={(session) => setWorkspace((w) => ({ ...w, session }))}
              onHome={() => {
                setScreen("home");
                setActive(false);
                void run(refresh);
              }}
              onReview={() => {}}
            />
          )}
        </div>
      </main>
      <nav inert={updateLock} className="phone-nav" aria-label="メイン">
        <button
          disabled={importBusy}
          aria-current={screen === "home" ? "page" : undefined}
          onClick={() => {
            setScreen("home");
            setActive(false);
            void run(refresh);
          }}
        >
          ホーム
        </button>
        <button
          disabled={importBusy}
          aria-current={screen === "study" ? "page" : undefined}
          onClick={() => {
            setScreen("study");
            setActive(false);
            void run(refresh);
          }}
        >
          学習
        </button>
      </nav>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<PhoneApp />);
