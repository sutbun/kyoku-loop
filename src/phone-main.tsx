import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, errors } from "./api";
import { PracticeCard, StudyPanel } from "./study-ui";
import type { StudySession, Workspace } from "./real-types";
import { readPhone } from "./offline/store";
import { saveShell, verifyShell } from "./offline/shell";
import type { PhonePack } from "./offline/engine";
import "./style.css";
import "./phone.css";

const VERSION = "DEV-11.01-4";
function PhoneApp() {
  const [workspace, setWorkspace] = useState<Workspace>({
    reports: [],
    items: [],
  });
  const [screen, setScreen] = useState<"home" | "study">("home");
  const [active, setActive] = useState(false);
  const [filter, setFilter] = useState("すべて");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(0);
  const [capacity, setCapacity] = useState("");
  const [persistent, setPersistent] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [saved, setSaved] = useState("");
  const refresh = async () => {
    setWorkspace(await api<Workspace>({ action: "state" }));
    const state = await readPhone();
    setPending(state?.events.length ?? 0);
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
  useEffect(() => {
    void run(async () => {
      await refresh();
      setLoaded(true);
    });
    const net = () => {
      setOnline(navigator.onLine);
    };
    const focus = () => {
      void run(refresh);
    };
    window.addEventListener("online", net);
    window.addEventListener("offline", net);
    window.addEventListener("focus", focus);
    const visibility = () => {
      if (document.visibilityState === "visible") focus();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
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
        !old?.events.length &&
        !(old?.session && old.session.index < old.session.queue.length)
      ) {
        const response = await fetch("/phone/api", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: '{"action":"download"}',
          cache: "no-store",
        });
        if (!response.ok)
          throw new Error(
            "Windowsに接続できません。TailscaleとWindows版の起動を確認してください。",
          );
        const value = await response.json();
        if (!value.ok)
          throw new Error(
            errors[value.error] ?? "問題を取得できませんでした。",
          );
        const pack = value.data as PhonePack;
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
            <span>未送信 {pending}件</span>
          </div>
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
                  Windowsへの送信は次の段階で対応します。現在の記録はこの端末に残ります。
                </p>
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
