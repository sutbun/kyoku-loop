import { useEffect, useRef, useState } from "react";
import { tileLabel } from "./demo";
import type { Detail, Scene, Stage, Workspace } from "./real-types";

export const VERSION = "DEV-11.01-2";
const errors: Record<string, string> = {
  invalid_url: "NAGAのレポートURLまたはreport_idを入力してください。",
  invalid_source_url: "雀魂の共有URLを確認してください。",
  invalid_json: "JSONを読み取れません。ファイルを確認してください。",
  size_limit: "ファイルが大きすぎます。上限は20MBです。",
  unsupported_format: "このレポート形式にはまだ対応していません。",
  unsupported_model: "このモデル形式にはまだ対応していません。",
  unsupported_rule: "四人麻雀のレポートを選択してください。",
  access_denied:
    "アクセスが拒否されました。本人が利用できるJSONファイルを選択してください。",
  access_redirect:
    "取得先で転送が要求されました。公式画面で確認し、取得済みJSONを選択してください。",
  report_not_ready:
    "レポートが見つかりません。解析完了とURLを確認してください。",
  network_error: "接続できませんでした。再試行するかJSONを選択してください。",
  upstream_error:
    "NAGAから取得できませんでした。時間をおいて再試行してください。",
  reconstruction_failed: "局面の整合性を確認できないため、登録していません。",
  stage_expired: "確認の有効時間が切れました。もう一度読み込んでください。",
  source_conflict:
    "このレポートには別の元対局が登録されています。元対局URLを確認してください。",
};
async function api<T>(request: object): Promise<T> {
  const response = await fetch("/api/local", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok)
    throw new Error("ローカル保存先に接続できません。再試行してください。");
  const result = await response.json();
  if (!result.ok)
    throw new Error(
      errors[result.error] ??
        "読み込み・保存に失敗しました。データは置き換えていません。再試行してください。",
    );
  return result.data;
}
export const uiTile = (value: string) => {
  const honor = ["E", "S", "W", "N", "P", "F", "C"].indexOf(value);
  return honor >= 0
    ? `${honor + 1}z`
    : value.endsWith("r")
      ? `0${value[1]}`
      : value;
};
const wind = (value: string) =>
  ({ E: "東", S: "南", W: "西", N: "北" })[value] ?? value;
export const roundLabel = (scene: Scene) =>
  `${wind(scene.bakaze)}${scene.kyoku}局 ${scene.honba}本場`;
function RealTile({
  value,
  small = false,
}: {
  value: string;
  small?: boolean;
}) {
  const tile = uiTile(value);
  return (
    <span
      className={`tile ${small ? "small" : ""} suit-${tile[1]} ${tile[0] === "0" ? "red" : ""}`}
      aria-label={tileLabel(tile)}
    >
      {tile.endsWith("z") ? (
        <b>{tileLabel(tile)}</b>
      ) : (
        <>
          <b>{tile[0] === "0" ? "5" : tile[0]}</b>
          <small>{tileLabel(tile).slice(-1)}</small>
        </>
      )}
      {tile[0] === "0" && <i />}
    </span>
  );
}
const eventLabels: Record<string, string> = {
  start_kyoku: "配牌",
  tsumo: "ツモ",
  dahai: "打牌",
  chi: "チー",
  pon: "ポン",
  daiminkan: "大明槓",
  ankan: "暗槓",
  kakan: "加槓",
  reach: "リーチ宣言",
  reach_accepted: "リーチ成立",
  dora: "ドラ追加",
};

export function RealTable({ scene }: { scene: Scene }) {
  const hand = [...scene.own_hand];
  if (scene.drawn) hand.splice(hand.lastIndexOf(scene.drawn), 1);
  const order = (t: string) => {
    const v = uiTile(t);
    return "mpsz".indexOf(v[1]) * 10 + (v[0] === "0" ? 5 : Number(v[0]));
  };
  hand.sort((a, b) => order(a) - order(b));
  const own = scene.seat;
  return (
    <div className="table-wrap real-board">
      <div className="table" aria-label={`${roundLabel(scene)}の卓`}>
        {[0, 1, 2, 3].map((position) => {
          const seat = (own + position - 2 + 4) % 4;
          const label = ["対面", "上家", "あなた", "下家"][position];
          const seatWind = ["東", "南", "西", "北"][
            (seat - (scene.kyoku - 1) + 4) % 4
          ];
          return (
            <div
              className={`player player-${position}`}
              key={seat}
              data-seat={seat}
            >
              <div className="player-label">
                <b>
                  {label} · {seatWind}
                </b>
                <span>
                  {scene.scores[seat].toLocaleString()}
                  {scene.reach_declared[seat] ? " · リーチ" : ""}
                </span>
              </div>
              <div
                className="river"
                aria-label={`${position === 2 ? "自分" : label}の河`}
              >
                {scene.rivers[seat].map((r, i) => (
                  <span
                    key={i}
                    className={`${r.called ? "called" : ""} ${r.reach ? "reach-tile" : ""}`}
                    title={
                      r.called
                        ? "副露された牌"
                        : r.reach
                          ? "リーチ宣言牌"
                          : undefined
                    }
                  >
                    <RealTile value={r.tile} small />
                  </span>
                ))}
              </div>
            </div>
          );
        })}
        <div className="table-center">
          <span>
            {wind(scene.bakaze)}
            {scene.kyoku}局
          </span>
          <strong>
            {scene.source_discard_index + (scene.actual ? 1 : 0)}
            <small>打目</small>
          </strong>
          <div>
            {scene.honba}本場 · 供託{scene.kyotaku}
          </div>
          <div className="dora">
            ドラ表示{" "}
            {scene.dora_markers.map((t, i) => (
              <RealTile value={t} small key={i} />
            ))}
          </div>
        </div>
      </div>
      {scene.melds.some((m) => m.length > 0) && (
        <div className="public-melds" aria-label="公開された副露">
          {[0, 1, 2, 3].map((position) => {
            const seat = (own + position - 2 + 4) % 4;
            const label = ["対面", "上家", "あなた", "下家"][position];
            return (
              scene.melds[seat].length > 0 && (
                <div className="public-meld-row" key={seat}>
                  <b>{label}</b>
                  <div className="melds" aria-label={`${label}の副露`}>
                    {scene.melds[seat].map((m, i) => (
                      <div className="meld" key={i}>
                        <small>
                          {eventLabels[m.type]}
                          {m.target !== undefined
                            ? `・${(m.target - seat + 4) % 4 === 1 ? "下家" : (m.target - seat + 4) % 4 === 2 ? "対面" : "上家"}から`
                            : ""}
                        </small>
                        <span>
                          {[
                            ...m.consumed,
                            ...(m.tile ? [m.tile] : []),
                            ...(m.added ? [m.added] : []),
                          ].map((t, n) => (
                            <RealTile key={n} value={t} small />
                          ))}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            );
          })}
        </div>
      )}
      <div className="hand-head">
        <span>あなた · {wind(scene.own_wind)}家</span>
        <span>
          {scene.melds[own].length
            ? `${scene.melds[own].length}副露`
            : "副露なし"}{" "}
          · {scene.reach_declared[own] ? "リーチ" : "リーチなし"}
        </span>
      </div>
      <div className="hand" data-testid="real-hand" aria-label="自分の手牌">
        {hand.map((t, i) => (
          <span key={i}>
            <RealTile value={t} />
          </span>
        ))}
        {scene.drawn && (
          <span className="drawn">
            <RealTile value={scene.drawn} />
          </span>
        )}
      </div>
    </div>
  );
}

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
  const [filter, setFilter] = useState("すべて");
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
    void run(refresh);
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [screen, index]);
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
  const inspect = async (data: object) => {
    const result = await api<Stage>({ action: "inspect", ...data });
    setStage(result);
    setSource("");
    setSeat("");
    setModel(result.models.length === 1 ? String(result.models[0].index) : "");
  };
  const upload = (file: File | undefined) => {
    if (!file) return;
    void run(async () => {
      if (file.size > 20 * 1024 * 1024) throw new Error(errors.size_limit);
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let n = 0; n < bytes.length; n += 8192)
        binary += String.fromCharCode(...bytes.subarray(n, n + 8192));
      await inspect({ data: btoa(binary) });
    });
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
          onClick={() => setScreen("home")}
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
          ).map(([key, icon, label]) => (
            <button
              className={screen === key ? "active" : ""}
              key={key}
              onClick={() =>
                key === "review" && !detail && workspace.reports[0]
                  ? void run(() => open(workspace.reports[0].id))
                  : setScreen(key)
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
          <small>同期・オフライン未対応</small>
          <span className="version">{VERSION}</span>
        </div>
      </aside>
      <main>
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
          {screen === "home" && (
            <>
              <div className="page-heading">
                <h1>一局の気づきを、次の一打へ。</h1>
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={add}
                >
                  ＋ 牌譜を追加
                </button>
              </div>
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
                        <RealTable scene={scene} />
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
                                <span>NAGA推奨 · {detail.model_name}</span>
                                <RealTile value={assessment.suggested!} />
                              </div>
                              <p>
                                候補重み差 <b>{assessment.gap!.toFixed(2)}pt</b>
                                <small>
                                  分布合計を100に換算 · 勝率や損失ではありません
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
            <>
              <div className="page-heading">
                <h1>学習ライブラリ</h1>
                <span className="muted">復習機能は準備中</span>
              </div>
              <div className="filters" aria-label="学習状態">
                {["未学習", "復習中", "習得済み", "保留", "すべて"].map((s) => (
                  <button
                    className={filter === s ? "chosen" : ""}
                    key={s}
                    onClick={() => setFilter(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <div className="library-list">
                {workspace.items
                  .filter(
                    (item) => filter === "すべて" || item.status === filter,
                  )
                  .map((item) => (
                    <div
                      className="library-row"
                      data-testid="real-library-row"
                      key={item.id}
                    >
                      <div>
                        <strong>
                          {roundLabel(item.scene)} ·{" "}
                          {item.scene.source_discard_index + 1}打目
                        </strong>
                        <small>
                          {item.automatic ? "自動登録" : "手動保存"}
                        </small>
                      </div>
                      <span className="badge neutral">{item.status}</span>
                      <span className="due">
                        次回 <b>{item.due}</b>
                      </span>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() =>
                          void run(() => open(item.report, item.id))
                        }
                      >
                        局面を確認
                      </button>
                    </div>
                  ))}
              </div>
              {workspace.items.length === 0 && (
                <div className="empty">登録された問題はありません。</div>
              )}
            </>
          )}
          <footer>
            <span>KyokuLoop</span>
            <span>{VERSION}</span>
          </footer>
        </div>
      </main>
      {notice && (
        <div className="toast" role="status">
          {notice}
          <button aria-label="通知を閉じる" onClick={() => setNotice("")}>
            ×
          </button>
        </div>
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
            if (!busy) upload(e.dataTransfer.files[0]);
          }}
        >
          <div className="section-title">
            <h2>牌譜を追加</h2>
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
          {!stage ? (
            <>
              <label>
                NAGAレポートURL / report_id
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
                あなたのプレイヤー
                <select
                  value={seat}
                  disabled={busy}
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
              <label>
                元の雀魂共有URL（任意）
                <input
                  value={source}
                  disabled={busy}
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
