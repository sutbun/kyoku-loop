import { PhoneMortalImport } from "./phone-mortal-import";
import { useEffect, useRef, useState } from "react";
import { api, errors } from "./api";
import { RealTable, roundLabel, eventLabels } from "./real-board";
import { StudyPanel, BackupDialog, Compare } from "./study-ui";
import type { Detail, Scene, Stage, Workspace } from "./real-types";
import { AnalysisGuide } from "./analysis-ui";
import { AppHeader, AppNavigation, type AppTab } from "./app-navigation";
import { PhoneStudyHome } from "./phone-study-home";
import { PhoneReplayList } from "./phone-replay-list";
import { PhoneBulkImport } from "./phone-bulk-import";
import { StudyOptions } from "./study-options";
import { MortalSourceSelect } from "./mortal-source-select";
import { MortalRegistrationNotice } from "./mortal-registration-notice";
import type { MortalRegistrationResult } from "./mortal-registration";
import { usePhoneStudyLayout } from "./phone-study-layout";
import historyCode from "../docs/snippets/ipad-history-metadata-shortcut.js?raw";
import { HistoryCollector } from "./bulk-history-ui";
import "./phone.css";
import "./phone-study.css";
import type { AnalysisEntry } from "./analysis-queue";
import {
  encodeReport,
  runMortalBatch,
  validateMortalFiles,
  type MortalBatchItem,
} from "./mortal-batch";
import { MortalBatchResults } from "./mortal-batch-ui";
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
  const [screen, setScreen] = useState<AppTab>("study");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [reportFilter, setReportFilter] = useState<string[] | undefined>();
  const [backups, setBackups] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkPending, setBulkPending] = useState(false);
  const [importPending, setImportPending] = useState(false);
  const [sourceId, setSourceId] = useState("");
  const [registration, setRegistration] =
    useState<MortalRegistrationResult | null>(null);
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
  const [batch, setBatch] = useState<MortalBatchItem[]>([]);
  const [seat, setSeat] = useState("");
  const [model, setModel] = useState("");
  const [filter, setFilter] = useState("今日");
  const [learning, setLearning] = useState(false);
  const studying =
    screen === "study" &&
    learning &&
    !!workspace.session?.scene &&
    !workspace.session.complete &&
    !workspace.session.stale;
  const studyRef = usePhoneStudyLayout(studying, workspace.session?.item_id);
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
    });
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [screen, index, workspace.session?.index]);
  useEffect(() => {
    if (
      busy ||
      adding ||
      bulkBusy ||
      screen === "settings" ||
      (screen === "study" && (learning || libraryOpen)) ||
      (screen === "replays" && reviewOpen)
    )
      return;
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
  }, [screen, busy, adding, bulkBusy, learning, libraryOpen, reviewOpen]);
  useEffect(() => {
    if (adding) {
      focus.current = document.activeElement as HTMLElement;
      dialog.current?.showModal();
    } else {
      dialog.current?.close();
      focus.current?.focus();
    }
  }, [adding]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (bulkPending || importPending || bulkBusy || busy || adding)
        event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [bulkPending, importPending, bulkBusy, busy, adding]);
  const open = async (id: string, decision?: string) => {
    const data = await api<Detail>({ action: "detail", id });
    setDetail(data);
    setAll(false);
    setIndex(Math.max(0, decision ? data.important.indexOf(decision) : 0));
    setScreen("replays");
    setReviewOpen(true);
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
    setSourceId(entry?.id ?? "");
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
  const selectFiles = (files: File[]) => {
    if (!files.length) return;
    try {
      validateMortalFiles(files);
    } catch (e) {
      setError(errors[(e as Error).message] ?? "ファイルを確認してください。");
      return;
    }
    setBatch([]);
    if (files.length === 1) upload(files[0]);
    else {
      setAnalysis(null);
      setStage(null);
      setSource("");
      setError("");
      setBatch(files.map((file) => ({ file })));
    }
  };
  const resultEntry = (entry: AnalysisEntry) => {
    setBatch([]);
    setAnalysis(entry);
    setStage(null);
    setUrl("");
    setSource(entry.url);
    setError("");
    setSourceId(entry.id);
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
    setSourceId("");
    setBatch([]);
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
  const begin = (mode: "scheduled" | "practice") =>
    void run(async () => {
      const session = await api<import("./real-types").StudySession>({
        action: "study_start",
        mode,
      });
      setWorkspace((prev) => ({ ...prev, session }));
      setLearning(true);
      setLibraryOpen(true);
      setScreen("study");
    });
  const problems = (ids: string[]) => {
    setReportFilter(ids);
    setFilter("すべて");
    setLibraryOpen(true);
    setLearning(false);
    setScreen("study");
  };
  return (
    <div
      ref={studyRef}
      className={`phone-app desktop-app${studying ? " is-studying" : ""}${screen === "replays" && reviewOpen ? " is-reviewing" : ""}`}
    >
      <AppHeader>
        <span className="phone-connection" aria-live="polite">
          {busy || bulkBusy ? "処理中…" : ""}
        </span>
        <span className="phone-version">{VERSION}</span>
      </AppHeader>
      <main className="real-main">
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
          {registration && (
            <MortalRegistrationNotice
              result={registration}
              local={false}
              entries={workspace.analysis_queue ?? []}
            />
          )}
          {notice && (
            <div className="inline-notice" role="status">
              {notice}

              <button
                className="text-button"
                aria-label="通知を閉じる"
                onClick={() => setNotice("")}
              >
                ×
              </button>
            </div>
          )}
          <div hidden={screen !== "replays" || reviewOpen}>
            <h1 className="phone-tab-title">牌譜</h1>
            <section className="panel phone-imports" aria-label="牌譜を追加">
              <details className="phone-source-add">
                <summary>URLを追加</summary>
                <PhoneBulkImport
                  historyCode={historyCode}
                  place="Windows"
                  disabled={busy || bulkBusy}
                  onBusy={setBulkBusy}
                  onPendingChange={setBulkPending}
                  onImport={(data) => api({ action: "analysis_bulk", data })}
                  onSaved={refresh}
                  tools={<HistoryCollector />}
                />
              </details>
              <PhoneMortalImport
                desktop
                disabled={busy || bulkBusy}
                online
                local={false}
                entries={workspace.analysis_queue ?? []}
                onBusy={setBulkBusy}
                onPendingChange={setImportPending}
                onRegistered={async () => {
                  await refresh();
                }}
                tools={
                  <details className="desktop-result-add">
                    <summary>レポートURL・NAGA</summary>
                    <button
                      className="button secondary"
                      disabled={busy || bulkBusy}
                      onClick={add}
                    >
                      レポートを追加
                    </button>
                  </details>
                }
              />
            </section>
            <PhoneReplayList
              desktop
              reports={workspace.reports}
              entries={workspace.analysis_queue ?? []}
              disabled={busy || bulkBusy}
              onProblems={problems}
              onReview={(id) => void run(() => open(id))}
              onDelete={(ids) =>
                void run(async () => {
                  await api({ action: "analysis_delete", ids });
                  await refresh();
                  setNotice(`${ids.length}件の牌譜を一覧から削除しました`);
                })
              }
              onDropResult={(entry, files) => {
                resultEntry(entry);
                if (files.length !== 1) {
                  setError(errors.multiple_files);
                  return;
                }
                upload(files[0], entry);
              }}
              onResult={resultEntry}
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
            <details className="panel desktop-reports">
              <summary>解析結果一覧 · {workspace.reports.length}件</summary>
              <div className="section-title">
                <h2 className="visually-hidden">取り込んだ牌譜</h2>
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
                            ? "元対局に紐付け済み"
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
            </details>
          </div>
          <div hidden={screen !== "settings"}>
            <h1 className="phone-tab-title">設定</h1>
            <section className="panel phone-study-options">
              <StudyOptions />
            </section>
            <section className="panel" aria-label="保存と管理">
              <button
                className="button secondary"
                disabled={busy || bulkBusy}
                onClick={() => setBackups(true)}
              >
                バックアップと復元
              </button>
              <MortalInboxSettings
                disabled={busy || bulkBusy}
                onChange={refresh}
              />
            </section>
            <details className="panel phone-tools">
              <summary>このPCの管理</summary>
              <div className="phone-tools-content">
                <a href="/phone/">iPad・スマホ用オフライン版</a>
                <button
                  className="text-button"
                  onClick={() => setGuide((v) => !v)}
                >
                  解析の手順
                </button>
              </div>
              {guide && <AnalysisGuide onClose={() => setGuide(false)} />}
            </details>
          </div>
          {screen === "replays" && reviewOpen && (
            <>
              <button
                className="text-button"
                onClick={() => setReviewOpen(false)}
              >
                牌譜に戻る
              </button>
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
                            <Compare
                              testId="real-comparison"
                              scene={{
                                ...assessment,
                                engine: detail.engine,
                                model_name: detail.model_name,
                              }}
                            />
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
          <div hidden={screen !== "study"}>
            {!learning && !libraryOpen ? (
              <PhoneStudyHome
                workspace={workspace}
                disabled={busy || bulkBusy}
                onBegin={begin}
                onLibrary={() => {
                  setReportFilter(undefined);
                  setLibraryOpen(true);
                }}
                onAdd={() => {
                  setReviewOpen(false);
                  setScreen("replays");
                }}
              />
            ) : (
              <>
                {!learning && (
                  <button
                    className="text-button"
                    onClick={() => {
                      setLibraryOpen(false);
                      setReportFilter(undefined);
                    }}
                  >
                    学習に戻る
                  </button>
                )}
                <StudyPanel
                  workspace={workspace}
                  active={learning}
                  filter={filter}
                  reportFilter={reportFilter}
                  onFilter={setFilter}
                  onActive={setLearning}
                  onRefresh={refresh}
                  onSession={(session) =>
                    setWorkspace((prev) => ({ ...prev, session }))
                  }
                  onHome={() => {
                    setLearning(false);
                    setLibraryOpen(false);
                    void run(refresh);
                  }}
                  onReview={(report, id) => void run(() => open(report, id))}
                />
              </>
            )}
          </div>
        </div>
      </main>
      <AppNavigation
        screen={screen}
        disabled={busy || bulkBusy || adding}
        onChange={(id) => {
          setScreen(id);
          if (id === "replays") setReviewOpen(false);
          void run(refresh);
        }}
      />
      {backups && (
        <BackupDialog onClose={() => setBackups(false)} onRefresh={refresh} />
      )}
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
              selectFiles(Array.from(e.dataTransfer.files));
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
          {!!batch.length && (
            <>
              <MortalBatchResults
                items={batch}
                entries={workspace.analysis_queue ?? []}
              />
              {batch.some((i) => !i.result) && (
                <button
                  className="button primary full"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await runMortalBatch(
                        batch,
                        async (file) => {
                          const stage = await api<Stage>({
                            action: "inspect",
                            data: await encodeReport(file),
                          });
                          if (
                            stage.engine !== "Mortal" ||
                            stage.target_seat === undefined
                          )
                            throw Error("inbox_mortal_only");
                          return api({
                            action: "commit",
                            token: stage.token,
                            seat: stage.target_seat,
                            model: 0,
                            source_url: "",
                          });
                        },
                        setBatch,
                      );
                      await refresh();
                    })
                  }
                >
                  {busy
                    ? "処理中…"
                    : batch.some((i) => i.error)
                      ? "失敗したファイルを再試行"
                      : `選択した${batch.length}件をまとめて登録`}
                </button>
              )}
              <button
                className="text-button"
                disabled={busy}
                onClick={() => setBatch([])}
              >
                選び直す
              </button>
            </>
          )}
          {!stage && !batch.length ? (
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
                  multiple
                  accept=".json,.gz"
                  disabled={busy}
                  onChange={(e) => {
                    selectFiles(Array.from(e.target.files ?? []));
                    e.target.value = "";
                  }}
                />
              </label>
            </>
          ) : stage ? (
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
              {stage.engine === "Mortal" && !analysis ? (
                <>
                  <MortalSourceSelect
                    entries={workspace.analysis_queue ?? []}
                    stage={stage}
                    local
                    value={sourceId}
                    disabled={busy}
                    onChange={(id) => {
                      setSourceId(id);
                      setSource(
                        workspace.analysis_queue?.find((e) => e.id === id)
                          ?.url ?? "",
                      );
                    }}
                  />
                  <details>
                    <summary>元URLを直接指定</summary>{" "}
                    <label>
                      {analysis
                        ? "元の雀魂共有URL（選択済み）"
                        : "元の雀魂共有URL（任意）"}
                      <input
                        value={source}
                        disabled={busy || !!analysis}
                        autoComplete="off"
                        onChange={(e) => {
                          setSourceId("");
                          setSource(e.target.value);
                        }}
                      />
                    </label>
                  </details>
                </>
              ) : (
                <>
                  {" "}
                  <label>
                    {analysis
                      ? "元の雀魂共有URL（選択済み）"
                      : "元の雀魂共有URL（任意）"}
                    <input
                      value={source}
                      disabled={busy || !!analysis}
                      autoComplete="off"
                      onChange={(e) => {
                        setSourceId("");
                        setSource(e.target.value);
                      }}
                    />
                  </label>
                </>
              )}
              <button
                className="button primary full"
                disabled={busy || seat === "" || model === ""}
                onClick={() =>
                  void run(async () => {
                    const result = await api<MortalRegistrationResult>({
                      action: "commit",
                      token: stage.token,
                      seat: Number(seat),
                      model: Number(model),
                      source_url: source.trim(),
                      ...(analysis || sourceId
                        ? { analysis_id: analysis?.id ?? sourceId }
                        : {}),
                    });
                    await refresh();
                    setRegistration(stage.engine === "Mortal" ? result : null);
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
          ) : null}
        </div>
      </dialog>
    </div>
  );
}
