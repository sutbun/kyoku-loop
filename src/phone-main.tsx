import { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import { api, errors } from "./api";
import { PracticeCard, StudyPanel } from "./study-ui";
import type { StudySession, Workspace } from "./real-types";
import { readPhone } from "./offline/store";
import { saveShell, verifyShell } from "./offline/shell";
import { pendingEvents } from "./offline/engine";
import { synchronizePhone, downloadPhonePack } from "./offline/sync";
import { synchronizeAnalysis } from "./offline/analysis-sync";
import { SourceInput, AnalysisList } from "./analysis-ui";
import type { AnalysisEntry } from "./analysis-queue";
import "./style.css";
import "./phone.css";

import { VERSION } from "./version";
function PhoneApp() {
  const [workspace, setWorkspace] = useState<Workspace>({
    reports: [],
    items: [],
  });
  const [screen, setScreen] = useState<"home" | "study">("home");
  const [active, setActive] = useState(false);
  const [filter, setFilter] = useState("今日");
  const [busy, setBusy] = useState(false);
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
  const [syncing, setSyncing] = useState(false),
    [syncError, setSyncError] = useState(""),
    [lastSync, setLastSync] = useState("");
  const syncRunning = useRef(false),
    retry = useRef<ReturnType<typeof setTimeout> | null>(null),
    delay = useRef(1000),
    mounted = useRef(true);
  const refresh = async () => {
    setWorkspace(await api<Workspace>({ action: "state" }));
    const state = await readPhone();
    setAnalysisQueue(state?.analysis_queue ?? []);
    setPending(state ? pendingEvents(state).length : 0);
    setLastSync(state?.last_sync ?? "");
    setSaved(state?.pack?.exported_at ?? "");
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
      setBusy(false);
    }
  };
  const syncRecords = async () => {
    if (syncRunning.current || !navigator.onLine) return;
    if (retry.current) clearTimeout(retry.current);
    syncRunning.current = true;
    setSyncing(true);
    setSyncError("");
    try {
      const results = await Promise.allSettled([
        synchronizePhone(),
        synchronizeAnalysis(),
      ]);
      if (mounted.current) await refresh();
      const failed = results.filter(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      );
      if (failed.length === 1) throw failed[0].reason;
      if (failed.length)
        throw new Error(
          failed
            .map((r) =>
              r.reason instanceof DOMException &&
              r.reason.name === "QuotaExceededError"
                ? "空き容量不足で受信確認を保存できません。未送信の記録を保持しています。"
                : r.reason instanceof Error
                  ? (errors[r.reason.message] ?? r.reason.message)
                  : "同期できませんでした。記録は端末に残っています。",
            )
            .join(" "),
        );
      const savedState = await readPhone();
      if (
        !savedState?.pack &&
        savedState?.analysis_queue?.some((e) => e.ready)
      ) {
        await saveShell();
        await api({ action: "install_pack", pack: await downloadPhonePack() });
      }
      delay.current = 1000;
      if (mounted.current) await refresh();
    } catch (e) {
      if (mounted.current)
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
    } finally {
      syncRunning.current = false;
      if (mounted.current) setSyncing(false);
    }
  };
  useEffect(() => {
    if (loaded && online) {
      void readPhone()
        .then((s) => {
          if (
            s?.analysis_queue?.length ||
            (s?.pack && (s.events.length || s.last_sync))
          )
            void syncRecords();
        })
        .catch(() => {});
    }
  }, [loaded, online]);
  useEffect(() => {
    if (!loaded || !online || (!pending && !urlPending)) return;
    const timer = setTimeout(() => void syncRecords(), 500);
    return () => clearTimeout(timer);
  }, [loaded, online, pending, urlPending]);
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
  return (
    <div className="phone-app">
      <header className="phone-header">
        <b>KyokuLoop</b>
        <span>{VERSION}</span>
      </header>
      <main>
        <div className="content">
          <div className="phone-status" role="status">
            <span>{online ? "通信あり" : "オフライン"}</span>
            <span>{syncing ? "同期中…" : `回答 未送信 ${pending}件`}</span>
            {!!urlPending && <span>URL 未同期 {urlPending}件</span>}
          </div>
          {syncError && (
            <div className="error" role="alert">
              {syncError}
              <button
                className="text-button"
                disabled={syncing}
                onClick={() => void syncRecords()}
              >
                同期を再試行
              </button>
            </div>
          )}
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
              <div className="page-heading">
                <h1>今日の一打を、確かめる。</h1>
              </div>
              <PracticeCard
                workspace={workspace}
                disabled={busy || !loaded}
                onBegin={begin}
              />
              <section className="panel">
                <h2>牌譜を追加</h2>
                <SourceInput
                  disabled={busy || !loaded}
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
                <AnalysisList
                  entries={analysisQueue}
                  portable
                  disabled={busy}
                />
              </section>
              <section className="panel phone-download">
                <h2>持ち歩く問題</h2>
                <p data-testid="offline-status">
                  {ready
                    ? `オフライン利用可能 · ${workspace.items.length}問`
                    : "オフライン保存の確認が必要です"}
                </p>
                <button
                  className="button primary"
                  disabled={busy || !loaded}
                  onClick={download}
                >
                  {busy
                    ? "保存を確認中…"
                    : pending ||
                        (workspace.session && !workspace.session.complete)
                      ? "アプリ本体の保存を確認"
                      : "問題を端末に保存"}
                </button>
                {saved && (
                  <small>取得：{new Date(saved).toLocaleString("ja-JP")}</small>
                )}
                <small>{capacity}</small>
                {!matchMedia("(display-mode: standalone)").matches && (
                  <p>
                    Safariの共有から「ホーム画面に追加」し、追加したアイコンで開いて保存してください。
                  </p>
                )}
              </section>
              <section className="panel">
                <h2>端末の記録</h2>
                <p>
                  {lastSync
                    ? `最終同期：${new Date(lastSync).toLocaleString("ja-JP")}`
                    : "復習記録の同期はまだ完了していません。"}
                </p>
                <button
                  className="button primary"
                  disabled={
                    busy ||
                    syncing ||
                    !loaded ||
                    (!workspace.items.length && !analysisQueue.length) ||
                    !online
                  }
                  onClick={() => void syncRecords()}
                >
                  {syncing ? "同期中…" : "今すぐ同期"}
                </button>
                <p>
                  {persistent
                    ? "保存の保護を要求済みです。"
                    : "自動消去からの保護は確認できていません。"}
                  端末の容量不足やサイトデータの消去で失われることがあるため、記録をファイルにも保存できます。
                </p>
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
                        await api({ action: "restore_phone", backup });
                        await refresh();
                        if (navigator.onLine) void syncRecords();
                      });
                    }}
                  />
                </label>
              </section>
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
      <nav className="phone-nav" aria-label="メイン">
        <button
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
