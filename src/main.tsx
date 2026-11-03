import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  decisions,
  libraryScenes,
  frames,
  frameFor,
  handFor,
  initialState,
  isDemoState,
  newSession,
  tileLabel,
  winds,
  type Frame,
  type Rating,
  type State,
  type StudyStatus,
} from "./demo";
import "./style.css";
import { RealApp } from "./real-app";
import { TableSeat, TableCenter, RealTile as Tile } from "./real-board";

import { VERSION } from "./version";
const KEY = "kyokuloop-fictional-prototype-v2";
function load(): State {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "null");
    // Fixtures only. Never accept arbitrary imported state or personal data.
    if (parsed?.version === 1 && isDemoState(parsed.data)) return parsed.data;
  } catch {
    /* fall back to a fresh fixture */
  }
  return initialState();
}
function Table({
  frame,
  interactive = false,
  selected,
  onSelect,
}: {
  frame: Frame;
  interactive?: boolean;
  selected?: number | null;
  onSelect?: (n: number) => void;
}) {
  const positions = [0, 1, 2, 3];
  return (
    <div className="table-wrap">
      <div
        className="table"
        aria-label={`${frame.round} ${frame.turn}巡目の卓`}
      >
        {positions.map((seat) => (
          <TableSeat
            key={seat}
            position={seat}
            seat={seat}
            river={frame.rivers[seat].map((tile) => ({
              tile,
              called: false,
              reach: false,
            }))}
          />
        ))}
        <TableCenter
          seats={positions.map((seat) => ({
            wind: winds[(seat - (2 - winds.indexOf(frame.ownWind)) + 4) % 4],
            score: frame.scores[seat],
          }))}
        >
          <span className="round-name">{frame.round}</span>
          <strong>
            {frame.turn}
            <small>巡目</small>
          </strong>
          <div>0本場 · 供託0</div>
          <div className="dora">
            ドラ表示 <Tile value={frame.dora} small />
          </div>
        </TableCenter>
      </div>
      <div
        className={`hand ${interactive ? "playable" : ""}`}
        data-testid="hand"
        aria-label="自分の手牌"
      >
        {handFor(frame).map((tile, i) =>
          interactive ? (
            <button
              key={i}
              className={`tile-choice ${selected === i ? "selected" : ""} ${i === 13 ? "drawn" : ""}`}
              onClick={() => onSelect?.(i)}
              aria-label={`${i + 1}枚目 ${tileLabel(tile)}`}
              aria-pressed={selected === i}
            >
              <Tile value={tile} />
            </button>
          ) : (
            <span key={i} className={i === 13 ? "drawn" : ""}>
              <Tile value={tile} />
            </span>
          ),
        )}
      </div>
    </div>
  );
}
function Comparison({ frame, answer }: { frame: Frame; answer?: string }) {
  return (
    <div className="comparison" data-testid="comparison">
      {answer && (
        <div>
          <span>今回の回答</span>
          <Tile value={answer} />
        </div>
      )}
      <div>
        <span>対局時の打牌</span>
        <Tile value={frame.actual} />
      </div>
      <div>
        <span>
          NAGA推奨 <small>架空</small>
        </span>
        <Tile value={frame.suggested} />
      </div>
      <p>
        候補重み差 <b>{frame.gap}pt</b>
        <small>架空の評価値 · 勝率や損失ではありません</small>
      </p>
    </div>
  );
}

function App() {
  const [state, setState] = useState<State>(load);
  const [undo, setUndo] = useState<State | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [allSteps, setAllSteps] = useState(false);
  const [filter, setFilter] = useState<StudyStatus | "今日" | "すべて">("今日");
  const [modal, setModal] = useState<"import" | "queue" | string | null>(null);
  const [notice, setNotice] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  const change = (next: State, reversible = false) => {
    if (reversible) setUndo(state);
    setState(next);
  };
  const restore = () => {
    if (undo) {
      setState(undo);
      setUndo(null);
      setNotice("取り消しました");
    }
  };
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ version: 1, data: state }));
      setSaveError(false);
    } catch {
      setSaveError(true);
    }
  }, [state]);
  useEffect(() => {
    if (modal) {
      lastFocus.current = document.activeElement as HTMLElement;
      dialog.current?.showModal();
    } else {
      dialog.current?.close();
      lastFocus.current?.focus();
    }
  }, [modal]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [state.screen, state.studyView, state.session?.index]);
  const go = (screen: State["screen"]) => {
    setUndo(null);
    change({
      ...state,
      screen,
      ...(screen === "study" ? { studyView: "library" as const } : {}),
    });
  };
  const begin = () => {
    setUndo(null);
    change({
      ...state,
      screen: "study",
      studyView: "quiz",
      session:
        state.session && state.session.index < state.session.ids.length
          ? state.session
          : newSession(state.items),
    });
  };
  const openReview = () => {
    setAllSteps(false);
    change({
      ...state,
      screen: "review",
      reviewIndex: frames.indexOf(decisions[0]),
    });
  };
  const session = state.session;
  const active = state.screen === "study" && state.studyView === "quiz";
  const current =
    active && session && session.index < session.ids.length
      ? frameFor(session.ids[session.index])
      : frames[state.reviewIndex];
  const importantIndex = decisions.findIndex((f) => f.id === current.id);
  const updateSession = (patch: Partial<NonNullable<State["session"]>>) => {
    if (session) change({ ...state, session: { ...session, ...patch } });
  };
  const rate = (rating: Rating) => {
    if (!session || session.selected === null || !session.revealed) return;
    const answer = {
      id: current.id,
      tile: handFor(current)[session.selected],
      rating,
    };
    change(
      {
        ...state,
        items: state.items.map((i) =>
          i.id === current.id
            ? {
                ...i,
                status: rating === "保留" ? "保留" : "復習中",
                due: rating === "保留" ? "—" : "デモ・未計算",
                history: [
                  ...i.history,
                  `今回：${tileLabel(answer.tile)} / ${rating}（自主練習）`,
                ],
              }
            : i,
        ),
        session: {
          ...session,
          index: session.index + 1,
          selected: null,
          revealed: false,
          answers: [...session.answers, answer],
        },
      },
      true,
    );
  };
  const saveDecision = () => {
    if (state.saved.includes(current.id)) {
      change(
        {
          ...state,
          saved: state.saved.filter((id) => id !== current.id),
          items: state.items.filter(
            (i) => i.id !== current.id || i.history.length > 0,
          ),
        },
        true,
      );
    } else
      change(
        {
          ...state,
          saved: [...state.saved, current.id],
          items: state.items.some((i) => i.id === current.id)
            ? state.items
            : [
                ...state.items,
                {
                  id: current.id,
                  status: "未学習",
                  due: "翌日",
                  history: [],
                  saved: true,
                },
              ],
        },
        true,
      );
  };
  const moveImportant = (delta: number) => {
    const index = Math.max(0, Math.min(4, importantIndex + delta));
    change({ ...state, reviewIndex: frames.indexOf(decisions[index]) });
  };
  return (
    <>
      <aside className="sidebar">
        <button
          className="brand"
          onClick={() => go("home")}
          aria-label="KyokuLoop ホーム"
        >
          <span className="brand-icon">局</span>
          <span>
            KyokuLoop<small>局を、学びに。</small>
          </span>
        </button>
        <nav aria-label="メインナビゲーション">
          {(
            [
              ["home", "⌂", "ホーム"],
              ["review", "▤", "牌譜・分析"],
              ["study", "◈", "学習"],
            ] as const
          ).map(([screen, icon, name]) => (
            <button
              key={screen}
              className={state.screen === screen ? "active" : ""}
              onClick={() => go(screen)}
              aria-current={state.screen === screen ? "page" : undefined}
            >
              <span aria-hidden="true">{icon}</span>
              {name}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="demo-tag">P1 · 架空データ</span>
          <small>同期・オフライン未対応</small>
          <span className="version">{VERSION}</span>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span>
            {state.screen === "home"
              ? "ホーム"
              : state.screen === "review"
                ? "牌譜・分析"
                : "学習"}
          </span>
          <span className="local-state">
            <i />
            {saveError ? "保存失敗" : "デモ端末内"}{" "}
            <span className="mobile-version">{VERSION}</span>
          </span>
        </header>
        {saveError && (
          <div className="error" role="alert">
            この端末に保存できません。操作内容は画面を閉じると失われます。
          </div>
        )}
        <div className="content">
          {state.screen === "home" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">YOUR MAHJONG NOTEBOOK</span>
                  <h1>
                    一局の気づきを、
                    <br className="phone-break" />
                    次の一打へ。
                  </h1>
                </div>
                <button
                  className="button secondary"
                  aria-label="牌譜を追加"
                  onClick={() => setModal("import")}
                >
                  ＋ 牌譜を追加
                </button>
              </div>
              <div className="home-grid">
                <section className="review-hero">
                  <div>
                    <span className="eyebrow">DAILY PRACTICE</span>
                    <h2>今日の復習</h2>
                    <p>
                      <strong>
                        {session && session.index < session.ids.length
                          ? session.ids.length
                          : newSession(state.items).ids.length}
                      </strong>
                      問 <span>架空問題で自主練習</span>
                    </p>
                    <button className="button light" onClick={begin}>
                      {session && session.index < session.ids.length
                        ? "復習を再開する"
                        : "今日の復習を始める"}{" "}
                      <span aria-hidden="true">→</span>
                    </button>
                  </div>
                  <div className="hero-tiles" aria-hidden="true">
                    <Tile value="3s" />
                    <Tile value="5m" />
                    <Tile value="7p" />
                  </div>
                </section>
                <section className="panel recent">
                  <span className="eyebrow">RECENT GAME</span>
                  <h2>新しい牌譜</h2>
                  <div className="game-meta">
                    <span className="badge">四麻 · 半荘の抜粋</span>
                    <span>架空対局 01</span>
                  </div>
                  <div className="recent-metrics">
                    <div>
                      <strong>5</strong>
                      <span>重要局面</span>
                    </div>
                    <div>
                      <strong>{state.saved.length}</strong>
                      <span>手動保存</span>
                    </div>
                  </div>
                  <button className="button primary" onClick={openReview}>
                    新しい牌譜を確認 <span aria-hidden="true">→</span>
                  </button>
                </section>
              </div>
              <section className="section">
                <div className="section-title">
                  <h2>解析待ち</h2>
                  <span className="muted">1件 · デモ</span>
                </div>
                <div className="queue-row">
                  <span className="queue-icon">▤</span>
                  <div>
                    <strong>保存した牌譜</strong>
                    <small>対局日時・ルール未取得</small>
                  </div>
                  <span className="badge neutral">保存済み / 未解析</span>
                  <button
                    className="button secondary"
                    onClick={() => setModal("queue")}
                  >
                    NAGAで解析
                  </button>
                  <button
                    className="text-button"
                    onClick={() => setModal("import")}
                  >
                    結果を登録
                  </button>
                </div>
              </section>
              <section className="section">
                <div className="section-title">
                  <h2>学習ライブラリ</h2>
                  <button className="text-button" onClick={() => go("study")}>
                    すべて見る →
                  </button>
                </div>
                <div className="status-grid">
                  {(
                    ["未学習", "復習中", "習得済み", "保留"] as StudyStatus[]
                  ).map((s, i) => (
                    <button
                      className="status-card"
                      key={s}
                      onClick={() => {
                        setFilter(s);
                        go("study");
                      }}
                    >
                      <span className={`status-dot dot-${i}`} />
                      <span>{s}</span>
                      <strong>
                        {state.items.filter((item) => item.status === s).length}
                      </strong>
                      <span aria-hidden="true">↗</span>
                    </button>
                  ))}
                </div>
              </section>
            </>
          )}

          {state.screen === "review" && (
            <>
              <div className="page-heading compact">
                <div>
                  <span className="eyebrow">GAME REVIEW · 架空対局 01</span>
                  <h1>見直したい一打</h1>
                </div>
                <span className="badge">四麻 · 半荘の抜粋</span>
              </div>
              <div className="review-layout">
                <section className="board-panel">
                  <div className="board-title">
                    <h2>
                      {allSteps
                        ? "全手順"
                        : `重要局面 ${importantIndex + 1} / 5`}
                    </h2>
                    <span>
                      {current.round} · {current.turn}巡目
                    </span>
                  </div>
                  <Table frame={current} />
                  <div className="playback">
                    {allSteps ? (
                      <>
                        <button
                          className="button secondary"
                          aria-label="前の手順"
                          disabled={state.reviewIndex === 0}
                          onClick={() =>
                            change({
                              ...state,
                              reviewIndex: state.reviewIndex - 1,
                            })
                          }
                        >
                          ←
                        </button>
                        <span data-testid="event-position">
                          手順 {state.reviewIndex + 1} / {frames.length}
                        </span>
                        <button
                          className="button secondary"
                          aria-label="次の手順"
                          disabled={state.reviewIndex === frames.length - 1}
                          onClick={() =>
                            change({
                              ...state,
                              reviewIndex: state.reviewIndex + 1,
                            })
                          }
                        >
                          →
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="button secondary"
                          aria-label="前の重要局面"
                          disabled={importantIndex <= 0}
                          onClick={() => moveImportant(-1)}
                        >
                          ← 前
                        </button>
                        <span>{importantIndex + 1} / 5</span>
                        <button
                          className="button secondary"
                          aria-label="次の重要局面"
                          disabled={importantIndex >= 4}
                          onClick={() => moveImportant(1)}
                        >
                          次 →
                        </button>
                      </>
                    )}
                  </div>
                  <div className="view-toggle">
                    <button
                      className={!allSteps ? "chosen" : ""}
                      onClick={() => {
                        setAllSteps(false);
                        if (importantIndex < 0) openReview();
                      }}
                    >
                      重要局面
                    </button>
                    <button
                      className={allSteps ? "chosen" : ""}
                      onClick={() => setAllSteps(true)}
                    >
                      全手順
                    </button>
                    <span>収録した架空の打牌手順</span>
                  </div>
                </section>
                <aside className="analysis-panel">
                  <div className="panel">
                    <span className="eyebrow">DECISION NOTE</span>
                    <h2>
                      {current.actor === 2
                        ? "対局時と推奨を比較"
                        : "他家の手番"}
                    </h2>
                    {current.important ? (
                      <>
                        <Comparison frame={current} />
                        <button
                          className={`button ${state.saved.includes(current.id) ? "secondary" : "primary"} full`}
                          onClick={saveDecision}
                        >
                          {state.saved.includes(current.id)
                            ? "保存を取り消す"
                            : "学習に保存"}
                        </button>
                      </>
                    ) : (
                      <p className="muted">
                        {current.actor === 2
                          ? "評価のない手順です。"
                          : "他家の手牌・評価は表示しません。"}
                      </p>
                    )}
                  </div>
                  <div className="panel scene-list">
                    <h2>重要局面</h2>
                    {decisions.map((d, i) => (
                      <button
                        key={d.id}
                        className={d.id === current.id ? "chosen" : ""}
                        onClick={() => {
                          setAllSteps(false);
                          change({ ...state, reviewIndex: frames.indexOf(d) });
                        }}
                      >
                        <span className="scene-number">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span>
                          {d.round}
                          <small>
                            {d.turn}巡目 · {d.ownWind}家
                          </small>
                        </span>
                        <span>
                          {d.gap}
                          <small>重み差pt</small>
                        </span>
                      </button>
                    ))}
                  </div>
                </aside>
              </div>
            </>
          )}

          {state.screen === "study" && (
            <>
              <div className="page-heading compact">
                <div>
                  <span className="eyebrow">STUDY ROOM</span>
                  <h1>
                    {active ? "あなたなら、何を切る？" : "学びのストック"}
                  </h1>
                </div>
                {active ? (
                  <button className="text-button" onClick={() => go("home")}>
                    中断してホームへ
                  </button>
                ) : (
                  <button className="button primary" onClick={begin}>
                    5問を練習する →
                  </button>
                )}
              </div>
              <div className="tabs">
                <button className={active ? "chosen" : ""} onClick={begin}>
                  クイズ
                </button>
                <button
                  className={!active ? "chosen" : ""}
                  onClick={() => change({ ...state, studyView: "library" })}
                >
                  ライブラリ
                </button>
                <span>架空データ · 自主練習</span>
              </div>
              {active &&
                session &&
                (session.index < session.ids.length ? (
                  <div className="quiz-layout">
                    <section className="board-panel">
                      <div className="board-title">
                        <h2>
                          {current.round} · {current.turn}巡目
                        </h2>
                        <span>
                          {session.index + 1} / {session.ids.length} 問
                        </span>
                      </div>
                      <div
                        className="progress"
                        aria-label={`${session.index + 1}問目`}
                      >
                        {session.ids.map((id, i) => (
                          <i
                            key={id}
                            className={i <= session.index ? "filled" : ""}
                          />
                        ))}
                      </div>
                      <Table
                        frame={current}
                        interactive={!session.revealed}
                        selected={session.selected}
                        onSelect={(selected) => updateSession({ selected })}
                      />
                    </section>
                    <aside className="panel quiz-answer">
                      {session.revealed ? (
                        <>
                          <span className="eyebrow">COMPARE & REFLECT</span>
                          <h2>一打を比べる</h2>
                          <Comparison
                            frame={current}
                            answer={handFor(current)[session.selected!]}
                          />
                          <button
                            className="text-button"
                            onClick={() => updateSession({ revealed: false })}
                          >
                            回答を選び直す
                          </button>
                          <h3>今回の理解度</h3>
                          <div className="ratings">
                            {(["理解した", "再復習", "保留"] as Rating[]).map(
                              (r, i) => (
                                <button
                                  key={r}
                                  className={`button ${i === 0 ? "primary" : "secondary"}`}
                                  onClick={() => rate(r)}
                                >
                                  {r}
                                  <span aria-hidden="true">
                                    {i === 0 ? "✓" : i === 1 ? "↻" : "Ⅱ"}
                                  </span>
                                </button>
                              ),
                            )}
                          </div>
                          <small className="muted">
                            自主練習のため、卒業回数は増えません。
                          </small>
                        </>
                      ) : (
                        <>
                          <span className="eyebrow">YOUR CHOICE</span>
                          <h2>切る牌を選択</h2>
                          <div className="chosen-tile">
                            {session.selected !== null ? (
                              <Tile
                                value={handFor(current)[session.selected]}
                              />
                            ) : (
                              <span>？</span>
                            )}
                          </div>
                          <button
                            className="button primary full"
                            disabled={session.selected === null}
                            onClick={() => updateSession({ revealed: true })}
                          >
                            回答する
                          </button>
                          <button
                            className="text-button"
                            disabled={session.selected === null}
                            onClick={() => updateSession({ selected: null })}
                          >
                            選択を取り消す
                          </button>
                        </>
                      )}
                      {undo && (
                        <button className="text-button undo" onClick={restore}>
                          直前の評価を取り消す
                        </button>
                      )}
                    </aside>
                  </div>
                ) : (
                  <section className="panel complete">
                    <span className="complete-icon">✓</span>
                    <h2>
                      {session.ids.length > 0
                        ? `${session.ids.length}問、おつかれさまでした。`
                        : "出題できる問題がありません。"}
                    </h2>
                    {session.ids.length > 0 && (
                      <p>
                        {saveError
                          ? "この端末に保存できていません。"
                          : "架空問題の自主練習を記録しました。"}
                      </p>
                    )}
                    <div className="result-summary">
                      {session.answers.map((a, i) => (
                        <div key={a.id}>
                          <span>
                            {i + 1}. {frameFor(a.id).round}
                          </span>
                          <strong>{a.rating}</strong>
                        </div>
                      ))}
                    </div>
                    <div className="complete-actions">
                      <button
                        className="button primary"
                        onClick={() =>
                          change({ ...state, studyView: "library" })
                        }
                      >
                        ライブラリへ
                      </button>
                      <button
                        className="button secondary"
                        onClick={() => go("home")}
                      >
                        ホームへ
                      </button>
                      {undo && (
                        <button className="text-button" onClick={restore}>
                          直前の評価を取り消す
                        </button>
                      )}
                    </div>
                  </section>
                ))}
              {!active && (
                <>
                  <div className="filters" aria-label="学習状態">
                    {(
                      [
                        "今日",
                        "未学習",
                        "復習中",
                        "習得済み",
                        "保留",
                        "すべて",
                      ] as const
                    ).map((f) => (
                      <button
                        key={f}
                        className={filter === f ? "chosen" : ""}
                        onClick={() => setFilter(f)}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                  <div className="library-list">
                    {state.items
                      .filter(
                        (i) =>
                          filter === "すべて" ||
                          (filter === "今日"
                            ? i.due === "今日"
                            : i.status === filter),
                      )
                      .map((item) => {
                        const f = frameFor(item.id);
                        return (
                          <div
                            className="library-row"
                            data-testid="library-row"
                            key={item.id}
                          >
                            <span className="library-icon">局</span>
                            <div>
                              <strong>
                                {f.round} · {f.turn}巡目
                              </strong>
                              <small>架空対局 01 · {f.ownWind}家</small>
                            </div>
                            <span className="badge neutral">{item.status}</span>
                            <span className="due">
                              次回 <b>{item.due}</b>
                            </span>
                            <button
                              className="text-button"
                              onClick={() => setModal(item.id)}
                            >
                              局面と履歴
                            </button>
                            <button
                              className="button secondary"
                              onClick={() =>
                                change(
                                  {
                                    ...state,
                                    items: state.items.map((i) =>
                                      i.id === item.id
                                        ? {
                                            ...i,
                                            status:
                                              i.status === "保留" ||
                                              i.status === "習得済み"
                                                ? "復習中"
                                                : "保留",
                                            due:
                                              i.status === "保留" ||
                                              i.status === "習得済み"
                                                ? "今日"
                                                : "—",
                                          }
                                        : i,
                                    ),
                                  },
                                  true,
                                )
                              }
                            >
                              {item.status === "保留"
                                ? "再開"
                                : item.status === "習得済み"
                                  ? "再学習"
                                  : "保留"}
                            </button>
                          </div>
                        );
                      })}
                    {state.items.filter(
                      (i) =>
                        filter === "すべて" ||
                        (filter === "今日"
                          ? i.due === "今日"
                          : i.status === filter),
                    ).length === 0 && (
                      <div className="empty">この区分の問題はありません。</div>
                    )}
                  </div>
                  {undo && (
                    <button className="text-button undo" onClick={restore}>
                      変更を取り消す
                    </button>
                  )}
                </>
              )}
            </>
          )}
          <footer>
            <span>KyokuLoop</span>
            <span>架空データの操作試作 · NAGA連携は利用条件を確認中</span>
          </footer>
        </div>
      </main>
      {notice && (
        <div className="toast" role="status">
          {notice}
          <button onClick={() => setNotice("")} aria-label="通知を閉じる">
            ×
          </button>
        </div>
      )}
      <dialog
        ref={dialog}
        onCancel={() => setModal(null)}
        onClick={(e) => {
          if (e.target === dialog.current) setModal(null);
        }}
      >
        <div className="dialog-content">
          <div className="section-title">
            <h2>
              {modal === "import"
                ? "牌譜を追加 / 結果を登録"
                : modal === "queue"
                  ? "NAGAで解析"
                  : "局面と履歴"}
            </h2>
            <button
              className="text-button"
              aria-label="閉じる"
              onClick={() => setModal(null)}
            >
              ×
            </button>
          </div>
          {modal === "import" ? (
            <>
              <p>利用条件を確認中のため、実データの登録はまだできません。</p>
              <label>
                雀魂共有URL / NAGAレポートURL
                <input disabled placeholder="P0検証後に対応" />
              </label>
              <p className="muted">
                JSON手動取り込みも、利用許諾の確認後に対応します。
              </p>
            </>
          ) : modal === "queue" ? (
            <>
              <ol>
                <li>保存した雀魂牌譜をブラウザで開く</li>
                <li>牌譜検討サポーターで対象局を選ぶ</li>
                <li>NAGA公式画面でタイプ・NPを確認して本人が実行</li>
                <li>結果をこの項目に登録</li>
              </ol>
              <p>
                実データ連携は利用条件を確認中です。試作では外部ページを開きません。
              </p>
            </>
          ) : modal && libraryScenes.some((f) => f.id === modal) ? (
            <>
              <Table frame={frameFor(modal)} />
              <Comparison frame={frameFor(modal)} />
              <h3>回答履歴</h3>
              {state.items.find((i) => i.id === modal)?.history.length ? (
                state.items
                  .find((i) => i.id === modal)!
                  .history.map((h, i) => <p key={i}>{h}</p>)
              ) : (
                <p className="muted">まだ回答していません。</p>
              )}
            </>
          ) : null}
        </div>
      </dialog>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  new URLSearchParams(location.search).get("demo") === "1" ? (
    <App />
  ) : (
    <RealApp />
  ),
);
