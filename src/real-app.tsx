import { useEffect, useRef, useState } from "react";
import { api, errors } from "./api";
import { RealTable, RealTile, roundLabel, eventLabels } from "./real-board";
import { StudyPanel, PracticeCard } from "./study-ui";
import type { Detail, Scene, Stage, Workspace } from "./real-types";
import { SourceInput, AnalysisList, AnalysisGuide } from "./analysis-ui";
import type { AnalysisEntry } from "./analysis-queue";
import { mortalLink, MORTAL_PAGE } from "./mortal-handoff";
import { BulkHistoryInput } from "./bulk-history-ui";
import {
  MortalInboxSettings,
  ReportSourceLink,
  entryLabel,
} from "./mortal-inbox-ui";

import { VERSION } from "./version";
export { VERSION };
export function RealApp() {
  const [workspace, setWorkspace] = useState<Workspace>({
    reports: [],
    items: [],
  });
  const [screen, setScreen] = useState<"home" | "review" | "study">("home");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [index, setIndex] = useState(0);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [source, setSource] = useState("");
  const [stage, setStage] = useState<Stage | null>(null);
  const [seat, setSeat] = useState("");
  const [model, setModel] = useState("");
  const [filter, setFilter] = useState("今日");
  const [learning, setLearning] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisEntry | null>(null);
  const [guide, setGuide] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const focus = useRef<HTMLElement | null>(null);
  const refresh = async () =>
    setWorkspace(await api<Workspace>({ action: "state" }));
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "処理できませんでした。");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void run(async () => {
      const data = await api<Workspace>({ action: "state" });
      setWorkspace(data);
      if (data.session && !data.session.complete) {
        setScreen("study");
        setLearning(true);
      }
    });
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [screen, index, workspace.session?.index]);
  useEffect(() => {
    if (screen !== "home" || busy || adding) return;
    let cancelled = false,
      loading = false;
    const update = async () => {
      if (document.hidden || loading) return;
      loading = true;
      try {
        const data = await api<Workspace>({ action: "state" });
        if (!cancelled) setWorkspace(data);
      } catch {
        /* A background refresh keeps the last saved view; explicit actions report connection failures. */
      } finally {
        loading = false;
      }
    };
    const timer = setInterval(() => void update(), 10000);
    window.addEventListener("focus", update);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, [screen, busy, adding]);
  useEffect(() => {
    if (adding) {
      focus.current = document.activeElement as HTMLElement;
      dialog.current?.showModal();
    } else {
      dialog.current?.close();
      focus.current?.focus();
    }
  }, [adding]);
  const open = async (id: string, decision?: string) => {
    const data = await api<Detail>({ action: "detail", id });
    setDetail(data);
    setAll(false);
    setIndex(Math.max(0, decision ? data.important.indexOf(decision) : 0));
    setScreen("review");
    if (decision && !data.important.includes(decision)) {
      setAll(true);
      const s = data.decisions.find((s) => s.id === decision);
      setIndex(
        Math.max(
          0,
          data.timeline.findIndex(
            (t) =>
              t.round_index === s?.round_index &&
              t.event_index === s?.event_index,
          ),
        ),
      );
    }
  };
  const inspect = async (data: object, entry = analysis) => {
    const result = await api<Stage>({ action: "inspect", ...data });
    setStage(result);
    setSource(entry?.url ?? "");
    setSeat(result.target_seat != null ? String(result.target_seat) : "");
    setModel(
      result.preferred_model != null &&
        result.models.some((m) => m.index === result.preferred_model)
        ? String(result.preferred_model)
        : "",
    );
  };
  const upload = (file: File | undefined, entry = analysis) => {
    if (!file) return;
    setStage(null);
    void run(async () => {
      if (file.size > 20 * 1024 * 1024) throw new Error(errors.size_limit);
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let n = 0; n < bytes.length; n += 8192)
        binary += String.fromCharCode(...bytes.subarray(n, n + 8192));
      await inspect({ data: btoa(binary) }, entry);
    });
  };
  const resultEntry = (entry: AnalysisEntry) => {
    setAnalysis(entry);
    setStage(null);
    setUrl("");
    setSource(entry.url);
    setError("");
    setAdding(true);
  };
  const important =
    detail?.important
      .map((id) => detail.decisions.find((s) => s.id === id)!)
      .filter(Boolean) ?? [];
  const scene = detail && (all ? detail.timeline[index] : important[index]);
  const matchingAssessment =
    scene &&
    detail?.decisions.find(
      (s) =>
        s.round_index === scene.round_index &&
        s.event_index === scene.event_index,
    );
  // A draw event can precede a kan-dora update included in the later
  // pre-discard decision. Do not attach that later evaluation to an older
  // public snapshot. Its complete decision remains in important scenes.
  const assessment =
    matchingAssessment &&
    scene &&
    JSON.stringify(matchingAssessment.dora_markers) ===
      JSON.stringify(scene.dora_markers)
      ? matchingAssessment
      : undefined;
  const count = detail ? (all ? detail.timeline.length : important.length) : 0;
  const selectAll = (value: boolean) => {
    if (!detail) return;
    if (value && scene)
      setIndex(
        Math.max(
          0,
          detail.timeline.findIndex(
            (s) =>
              s.round_index === scene.round_index &&
              s.event_index === scene.event_index,
          ),
        ),
      );
    else setIndex(0);
    setAll(value);
  };
  const add = () => {
    setAnalysis(null);
    setStage(null);
    setUrl("");
    setSource("");
    setError("");
    setAdding(true);
  };
  const save = () =>
    void run(async () => {
      if (!detail || !assessment?.id) return;
      const saved = !detail.manual.includes(assessment.id);
      setDetail(
        await api<Detail>({
          action: "save",
          report: detail.id,
          id: assessment.id,
          saved,
        }),
      );
      await refresh();
      setNotice(saved ? "学習に保存しました" : "手動保存を取り消しました");
    });
  return (
    <>
      <aside className="sidebar">
        <button
          className="brand"
          onClick={() => {
            setLearning(false);
            setScreen("home");
          }}
          aria-label="KyokuLoop ホーム"
        >
          <span className="brand-icon">局</span>
          <span>KyokuLoop</span>
        </button>
        <nav aria-label="メインナビゲーション">
          {(
            [
              ["home", "⌂", "ホーム"],
              ["review", "▤", "牌譜・分析"],
              ["study", "◈", "学習"],
            ] as const
          ).map(([key, icon, label]) => (
            <button
              className={screen === key ? "active" : ""}
              key={key}
              onClick={() =>
                key === "review" && !detail && workspace.reports[0]
                  ? void run(() => open(workspace.reports[0].id))
                  : (setLearning(false), setScreen(key))
              }
              aria-current={screen === key ? "page" : undefined}
            >
              <span aria-hidden="true">{icon}</span>
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="demo-tag">Windows · ローカル保存</span>
          <a href="/phone/">iPhone用オフライン版</a>
          <span className="version">{VERSION}</span>
        </div>
      </aside>
      <main className="real-main">
        <header className="topbar">
          <span>
            {screen === "home"
              ? "ホーム"
              : screen === "review"
                ? "牌譜・分析"
                : "学習"}
          </span>
          <span className="local-state">
            {busy ? "処理中…" : "Windows内"}
            <span className="mobile-version">{VERSION}</span>
          </span>
        </header>
        {error && !adding && (
          <div className="error" role="alert">
            {error}{" "}
            <button
              className="text-button"
              disabled={busy}
              onClick={() => void run(refresh)}
            >
              再試行
            </button>
          </div>
        )}
        <div className="content">
          {notice && (
            <div className="inline-notice" role="status">
              {notice}
              {notice.startsWith("URLをコピー") && (
                <a href={MORTAL_PAGE} target="_blank" rel="noopener noreferrer">
                  Mortalを開く
                </a>
              )}
              <button
                className="text-button"
                aria-label="通知を閉じる"
                onClick={() => setNotice("")}
              >
                ×
              </button>
            </div>
          )}
          {screen === "home" && (
            <>
              <div className="page-heading home-actions">
                <h1 className="visually-hidden">ホーム</h1>
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={add}
                >
                  ＋ 牌譜を追加
                </button>
              </div>
              <PracticeCard
                workspace={workspace}
                disabled={busy}
                onBegin={(mode) =>
                  void run(async () => {
                    const session = await api<
                      import("./real-types").StudySession
                    >({ action: "study_start", mode });
                    setWorkspace((prev) => ({ ...prev, session }));
                    setLearning(true);
                    setScreen("study");
                  })
                }
              />
              <section className="panel">
                <div className="section-title">
                  <h2>解析待ち</h2>
                  <button
                    className="text-button"
                    onClick={() => setGuide((v) => !v)}
                  >
                    解析の手順
                  </button>
                </div>
                <SourceInput
                  mortal
                  disabled={busy}
                  onSave={async (url) => {
                    await api({ action: "analysis_add", url });
                    await refresh();
                  }}
                />
                <BulkHistoryInput
                  disabled={busy}
                  onImport={async (value) => {
                    const result = await api<{
                      added: number;
                      existing: number;
                    }>({ action: "analysis_bulk", data: value });
                    await refresh();
                    return result;
                  }}
                />
                <AnalysisList
                  entries={workspace.analysis_queue ?? []}
                  disabled={busy}
                  onDropResult={(entry, files) => {
                    resultEntry(entry);
                    if (files.length !== 1) {
                      setError(errors.multiple_files);
                      return;
                    }
                    upload(files[0], entry);
                  }}
                  onOpen={(entry) => {
                    window.open(
                      mortalLink(entry.url),
                      "_blank",
                      "noopener,noreferrer",
                    );
                  }}
                  onResult={(entry) => {
                    resultEntry(entry);
                  }}
                  onRequested={(entry) =>
                    void run(async () => {
                      await api({
                        action: "analysis_requested",
                        id: entry.id,
                        requested: !entry.requested,
                      });
                      await refresh();
                    })
                  }
                />
                <MortalInboxSettings disabled={busy} onChange={refresh} />
              </section>
              {guide && (
                <AnalysisGuide
                  onClose={() =>
                    void run(async () => {
                      await api({ action: "analysis_setup", seen: true });
                      await refresh();
                      setGuide(false);
                    })
                  }
                />
              )}
              <section className="panel">
                <div className="section-title">
                  <h2>取り込んだ牌譜</h2>
                  <span>{workspace.reports.length}件</span>
                </div>
                {workspace.reports.length === 0 ? (
                  <div className="empty">
                    NAGAレポートURLまたはJSONファイルを登録
                  </div>
                ) : (
                  <div className="report-list">
                    {workspace.reports.map((r, i) => (
                      <div className="queue-row" key={r.id}>
                        <div>
                          <strong>
                            牌譜 {workspace.reports.length - i} · {r.rounds}局
                          </strong>
                          <small>
                            {r.model_name} · 席{r.seat + 1} ·{" "}
                            {r.source_linked
                              ? "元対局を手動登録済み"
                              : "元対局未登録"}
                          </small>
                        </div>
                        <span className="badge">
                          重要局面 {r.important_count}
                        </span>
                        {r.engine === "Mortal" && !r.source_linked && (
                          <ReportSourceLink
                            report={r.id}
                            entries={workspace.analysis_queue ?? []}
                            disabled={busy}
                            onLink={(report, analysis_id) =>
                              void run(async () => {
                                setWorkspace(
                                  await api<Workspace>({
                                    action: "report_link",
                                    report,
                                    analysis_id,
                                  }),
                                );
                              })
                            }
                          />
                        )}
                        <button
                          className="button secondary"
                          disabled={busy}
                          onClick={() => void run(() => open(r.id))}
                        >
                          牌譜を確認
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
              <section className="section">
                <div className="section-title">
                  <h2>学習ライブラリ</h2>
                  <button
                    className="text-button"
                    onClick={() => setScreen("study")}
                  >
                    すべて見る →
                  </button>
                </div>
                <div className="status-grid">
                  {["未学習", "復習中", "習得済み", "保留"].map((s, i) => (
                    <button
                      className="status-card"
                      key={s}
                      onClick={() => {
                        setFilter(s);
                        setScreen("study");
                      }}
                    >
                      <span className={`status-dot dot-${i}`} />
                      <span>{s}</span>
                      <strong>
                        {
                          workspace.items.filter((item) => item.status === s)
                            .length
                        }
                      </strong>
                    </button>
                  ))}
                </div>
              </section>
            </>
          )}
          {screen === "review" && (
            <>
              <div className="page-heading compact">
                <h1>見直したい一打</h1>
                {detail && (
                  <span className="badge">
                    {detail.model_name} · 席{detail.seat + 1} · {detail.rounds}
                    局
                  </span>
                )}
              </div>
              {!detail ? (
                <div className="empty">
                  牌譜を追加してください。
                  <button className="button primary" onClick={add}>
                    牌譜を追加
                  </button>
                </div>
              ) : (
                <>
                  <div className="segmented">
                    <button
                      className={!all ? "chosen" : ""}
                      onClick={() => selectAll(false)}
                    >
                      重要局面
                    </button>
                    <button
                      className={all ? "chosen" : ""}
                      onClick={() => selectAll(true)}
                    >
                      収録手順
                    </button>
                  </div>
                  {scene ? (
                    <div className="review-layout">
                      <section className="board-panel">
                        <div className="board-title">
                          <h2>
                            {all
                              ? `収録手順 ${index + 1} / ${count}`
                              : `重要局面 ${index + 1} / ${count}`}
                          </h2>
                          <span>
                            {roundLabel(scene)}
                            {all
                              ? ` · ${eventLabels[scene.event_type ?? ""] ?? ""}`
                              : ""}
                          </span>
                        </div>
                        <RealTable scene={scene} report={detail.id} />
                        <div className="playback">
                          <button
                            className="button secondary"
                            aria-label={all ? "前の手順" : "前の重要局面"}
                            disabled={index <= 0 || busy}
                            onClick={() => setIndex(index - 1)}
                          >
                            ← 前
                          </button>
                          <span>
                            {index + 1} / {count}
                          </span>
                          <button
                            className="button secondary"
                            aria-label={all ? "次の手順" : "次の重要局面"}
                            disabled={index >= count - 1 || busy}
                            onClick={() => setIndex(index + 1)}
                          >
                            次 →
                          </button>
                        </div>
                      </section>
                      <aside className="panel analysis-panel">
                        {assessment ? (
                          <>
                            <h2>打牌の比較</h2>
                            <div
                              className="comparison"
                              data-testid="real-comparison"
                            >
                              <div>
                                <span>対局時の打牌</span>
                                <RealTile value={assessment.actual!} />
                              </div>
                              <div>
                                <span>
                                  {detail.engine ?? "NAGA"}推奨 ·{" "}
                                  {detail.model_name}
                                </span>
                                <RealTile value={assessment.suggested!} />
                              </div>
                              <p>
                                候補重み差 <b>{assessment.gap!.toFixed(2)}pt</b>
                                <small>
                                  {detail.engine === "Mortal"
                                    ? "モデルの選択傾向"
                                    : "分布合計を100に換算"}{" "}
                                  · 勝率や損失ではありません
                                </small>
                              </p>
                            </div>
                            <button
                              className="button primary full"
                              disabled={busy}
                              onClick={save}
                            >
                              {detail.manual.includes(assessment.id!)
                                ? "手動保存を取り消す"
                                : "学習に保存"}
                            </button>
                            {detail.registered.includes(assessment.id!) && (
                              <p className="muted">学習登録済み</p>
                            )}
                          </>
                        ) : (
                          <div className="empty">
                            この手順は比較・学習の対象外です。
                          </div>
                        )}
                      </aside>
                    </div>
                  ) : (
                    <div className="empty">
                      評価を確認できる重要局面はありません。収録手順を確認できます。
                    </div>
                  )}
                  {!all && important.length > 0 && (
                    <section className="section important-list">
                      <h2>重要局面</h2>
                      {important.map((s, i) => (
                        <button
                          className={`important-row ${i === index ? "current" : ""}`}
                          key={s.id}
                          onClick={() => setIndex(i)}
                        >
                          <b>{i + 1}</b>
                          <span>
                            {roundLabel(s)} · {s.source_discard_index + 1}打目
                          </span>
                          <span>{s.gap!.toFixed(2)}pt</span>
                        </button>
                      ))}
                    </section>
                  )}
                  {(detail.unknown_weights > 0 ||
                    Object.values(detail.excluded).some((n) => n > 0)) && (
                    <p className="muted">
                      評価が不明・対応しない判断は学習候補から除外しています。
                    </p>
                  )}
                </>
              )}
            </>
          )}
          {screen === "study" && (
            <StudyPanel
              workspace={workspace}
              active={learning}
              filter={filter}
              onFilter={setFilter}
              onActive={setLearning}
              onRefresh={refresh}
              onSession={(session) =>
                setWorkspace((prev) => ({ ...prev, session }))
              }
              onHome={() => {
                setLearning(false);
                setScreen("home");
              }}
              onReview={(report, id) => void run(() => open(report, id))}
            />
          )}
        </div>
      </main>
      <dialog
        ref={dialog}
        onCancel={(e) => {
          if (busy) e.preventDefault();
          else setAdding(false);
        }}
        onClick={(e) => {
          if (!busy && e.target === dialog.current) setAdding(false);
        }}
      >
        <div
          className="dialog-content"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (!busy) {
              if (e.dataTransfer.files.length !== 1)
                setError(errors.multiple_files);
              else upload(e.dataTransfer.files[0]);
            }
          }}
        >
          <div className="section-title">
            <h2>{analysis ? "解析待ちへ結果を登録" : "牌譜を追加"}</h2>
            <button
              className="text-button"
              aria-label="閉じる"
              disabled={busy}
              onClick={() => setAdding(false)}
            >
              ×
            </button>
          </div>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          {analysis && (
            <p className="source-context" data-testid="result-source-context">
              {entryLabel(analysis)}
            </p>
          )}
          {!stage ? (
            <>
              <label>
                NAGA / Mortal レポートURL
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={busy}
                  autoComplete="off"
                />
              </label>
              <button
                className="button primary full"
                disabled={busy || !url.trim()}
                onClick={() => void run(() => inspect({ url }))}
              >
                {busy ? "読み込み中…" : "レポートを読み込む"}
              </button>
              <label className="file-drop">
                JSON / JSON.gz ファイル
                <input
                  type="file"
                  accept=".json,.gz"
                  disabled={busy}
                  onChange={(e) => upload(e.target.files?.[0])}
                />
              </label>
            </>
          ) : (
            <>
              <p>{stage.rounds}局を読み込みました。</p>
              <label>
                {stage.engine === "Mortal"
                  ? "解析対象プレイヤー"
                  : "あなたのプレイヤー"}
                <select
                  value={seat}
                  disabled={busy || stage.engine === "Mortal"}
                  onChange={(e) => setSeat(e.target.value)}
                >
                  <option value="">選択してください</option>
                  {stage.players.map((name, i) => (
                    <option key={i} value={i}>
                      席{i + 1} · {name}
                    </option>
                  ))}
                </select>
              </label>
              {stage.engine === "Mortal" ? (
                <p>Mortal · {stage.models[0].name}</p>
              ) : (
                <label>
                  基準NAGAタイプ
                  <select
                    value={model}
                    disabled={busy}
                    onChange={(e) => setModel(e.target.value)}
                  >
                    <option value="">選択してください</option>
                    {stage.models.map((m) => (
                      <option key={m.index} value={m.index}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                {analysis
                  ? "元の雀魂共有URL（選択済み）"
                  : "元の雀魂共有URL（任意）"}
                <input
                  value={source}
                  disabled={busy || !!analysis}
                  autoComplete="off"
                  onChange={(e) => setSource(e.target.value)}
                />
              </label>
              <button
                className="button primary full"
                disabled={busy || seat === "" || model === ""}
                onClick={() =>
                  void run(async () => {
                    const result = await api<{
                      id: string;
                      duplicate: boolean;
                    }>({
                      action: "commit",
                      token: stage.token,
                      seat: Number(seat),
                      model: Number(model),
                      source_url: source.trim(),
                      ...(analysis ? { analysis_id: analysis.id } : {}),
                    });
                    await refresh();
                    await open(result.id);
                    setAdding(false);
                    setNotice(
                      result.duplicate
                        ? "登録済みの牌譜を開きました"
                        : "牌譜を保存しました",
                    );
                  })
                }
              >
                {busy ? "保存中…" : "このプレイヤーで登録"}
              </button>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => {
                  setStage(null);
                  setError("");
                }}
              >
                選び直す
              </button>
            </>
          )}
        </div>
      </dialog>
    </>
  );
}
