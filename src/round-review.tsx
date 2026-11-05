import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { api } from "./api";
import { RealTable, eventLabels } from "./real-board";
import { loadReview } from "./round-review-data";
import { useReviewGestures } from "./round-review-gestures";
import { beginStorageOperation } from "./offline/update-lock";
import {
  bookmarkKey,
  candidates,
  changeReview,
  isDiscrepancy,
  navigate,
  newReviewState,
  newRoundSession,
  roundKey,
  type Bookmark,
  type ReviewCatalog,
  type ReviewChange,
  type ReviewState,
  type RoundMaterial,
  type RoundSession,
} from "./round-review-model";
import "./round-review.css";

export type ReviewTarget =
  { report: string; round?: number; event?: number } | "saved";

export function RoundReview({
  target,
  onClose,
  onPending,
}: {
  target: ReviewTarget;
  onClose: () => void;
  onPending?: (pending: boolean) => void;
}) {
  const [catalog, setCatalog] = useState<ReviewCatalog | null>(null);
  const [material, setMaterial] = useState<RoundMaterial | null>(null);
  const [state, setState] = useState<ReviewState>(newReviewState);
  const [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const [drawer, setDrawer] = useState<"saved" | "edit" | null>(
    target === "saved" ? "saved" : null,
  );
  const [editId, setEditId] = useState("");
  const [tagFilter, setTagFilter] = useState("すべて"),
    [managing, setManaging] = useState(false);
  const [tagDraft, setTagDraft] = useState<Record<string, string>>({});
  const data = useRef(state),
    current = useRef(material),
    root = useRef<HTMLDivElement>(null),
    drawerRef = useRef<HTMLDialogElement>(null);
  const epoch = useRef(0),
    queue = useRef<ReviewChange[]>([]),
    draining = useRef<Promise<boolean> | null>(null);
  const alive = useRef(true);
  const storageEnd = useRef<(() => void) | null>(null);
  const initialized = useRef(false),
    attempted = useRef<{
      report: string;
      round?: number;
      event?: number;
    } | null>(null);
  const drain = (): Promise<boolean> => {
    if (draining.current) return draining.current;
    if (!queue.current.length) return Promise.resolve(true);
    storageEnd.current ??= beginStorageOperation();
    onPending?.(true);
    setSaving(true);
    const work = (async () => {
      try {
        while (queue.current.length) {
          await api({ action: "round_review_change", op: queue.current[0] });
          queue.current.shift();
        }
        if (alive.current) setError("");
        return true;
      } catch (e) {
        if (alive.current)
          setError(
            e instanceof Error ? e.message : "レビューを保存できませんでした。",
          );
        return false;
      } finally {
        if (!queue.current.length) {
          storageEnd.current?.();
          storageEnd.current = null;
          onPending?.(false);
        }
        draining.current = null;
        if (alive.current) setSaving(false);
      }
    })();
    draining.current = work;
    return work;
  };
  const change = useCallback((op: ReviewChange) => {
    try {
      const next = changeReview(data.current, op);
      storageEnd.current ??= beginStorageOperation();
      onPending?.(true);
      data.current = next;
      setState(data.current);
      // Intermediate scroll locations need not queue hundreds of disk writes.
      const last = queue.current[queue.current.length - 1];
      if (
        queue.current.length > 1 &&
        op.kind === "session" &&
        last?.kind === "session" &&
        last.key === op.key
      )
        queue.current[queue.current.length - 1] = op;
      else queue.current.push(op);
      void drain();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存できませんでした。");
    }
  }, []);
  const open = async (report: string, round?: number, event?: number) => {
    attempted.current = { report, round, event };
    const generation = ++epoch.current;
    setLoading(true);
    setError("");
    try {
      const c = await loadReview<ReviewCatalog>(report);
      const ri =
        round ?? data.current.last_rounds?.[report] ?? c.rounds[0]?.index;
      if (ri === undefined) throw Error("確認できる局がありません。");
      const m = await loadReview<RoundMaterial>(report, ri);
      if (!alive.current || epoch.current !== generation) return false;
      current.current = m;
      setCatalog(c);
      setMaterial(m);
      const remembered =
        data.current.sessions[roundKey(m)] ?? newRoundSession();
      change({
        kind: "session",
        key: roundKey(m),
        value: {
          ...remembered,
          index: Math.min(remembered.index, m.timeline.length - 1),
        },
      });
      if (event !== undefined) {
        const index = m.timeline.findIndex((s) => s.event_index === event);
        if (index >= 0)
          change({
            kind: "session",
            key: roundKey(m),
            value: {
              ...(data.current.sessions[roundKey(m)] ?? newRoundSession()),
              index,
            },
          });
      }
      return true;
    } catch (e) {
      if (alive.current && epoch.current === generation)
        setError(e instanceof Error ? e.message : "局を開けませんでした。");
      return false;
    } finally {
      if (alive.current && epoch.current === generation) setLoading(false);
    }
  };
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    void api<ReviewState>({ action: "round_review_state" })
      .then(async (s) => {
        if (cancelled) return;
        data.current = s;
        setState(s);
        initialized.current = true;
        if (target !== "saved")
          await open(target.report, target.round, target.event);
        else setLoading(false);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(String(e.message));
          setLoading(false);
        }
      });
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (queue.current.length) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      cancelled = true;
      alive.current = false;
      epoch.current++;
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, []);
  useEffect(() => {
    if (!drawer) return;
    const previous = document.activeElement as HTMLElement | null;
    drawerRef.current?.showModal();
    return () => {
      drawerRef.current?.close();
      previous?.focus();
    };
  }, [drawer]);
  const getSession = (): RoundSession => {
    const m = current.current;
    return m
      ? (data.current.sessions[roundKey(m)] ?? newRoundSession())
      : newRoundSession();
  };
  const move = useCallback(
    (delta: number) => {
      const m = current.current;
      if (!m) return false;
      const s = data.current.sessions[roundKey(m)] ?? newRoundSession();
      const index = navigate(m, s, s.index + delta);
      if (index === s.index) return false;
      change({ kind: "session", key: roundKey(m), value: { ...s, index } });
      return true;
    },
    [change],
  );
  // Changing the loaded round installs gestures on its own table only.
  const gestureMove = useCallback(
    (d: number) => !loading && !drawer && move(d),
    [loading, drawer, move, material],
  );
  useReviewGestures(root, gestureMove);
  useLayoutEffect(() => {
    const host = root.current,
      table = host?.querySelector<HTMLElement>(".table");
    if (!host || !table || loading) return;
    window.scrollTo(0, 0);
    let frame = 0;
    const measure = () => {
      const rect = host.getBoundingClientRect();
      const rest = rect.height - table.getBoundingClientRect().height;
      const app = host.closest<HTMLElement>(".phone-app");
      const bottom = app
        ? parseFloat(getComputedStyle(app).paddingBottom) || 0
        : 0;
      const height = Math.max(
        220,
        Math.floor(
          (window.visualViewport?.height ?? innerHeight) -
            Math.max(0, rect.top) -
            rest -
            bottom -
            8,
        ),
      );
      const value = height + "px";
      if (host.style.getPropertyValue("--review-table-max") !== value)
        host.style.setProperty("--review-table-max", value);
    };
    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
    };
  }, [loading, material]);
  const session = material
    ? (state.sessions[roundKey(material)] ?? newRoundSession())
    : newRoundSession();
  const scene =
    material?.timeline[Math.min(session.index, material.timeline.length - 1)];
  const event = String(scene?.event_index ?? "");
  const answer = session.answers[event],
    chosen = session.selected[event];
  const hidden = session.quiz && !!scene?.is_decision && !answer;
  const marks: Record<
    string,
    { policy?: number; rank?: number; actual?: boolean; answer?: boolean }
  > = {};
  if (scene && !hidden) {
    candidates(scene).forEach((p, rank) => {
      marks[p.tile] = { policy: p.value, rank: rank + 1 };
    });
    if (scene.is_decision && scene.actual)
      marks[scene.actual] = { ...marks[scene.actual], actual: true };
    if (answer) marks[answer] = { ...marks[answer], answer: true };
  }
  const updateSession = (patch: Partial<RoundSession>) => {
    if (material)
      change({
        kind: "session",
        key: roundKey(material),
        value: { ...getSession(), ...patch },
      });
  };
  const jump = (index: number) => {
    if (material && index >= 0)
      updateSession({ index: navigate(material, getSession(), index, true) });
  };
  const previous =
    material?.timeline.reduce(
      (last, s, i) => (i < session.index && isDiscrepancy(s) ? i : last),
      -1,
    ) ?? -1;
  const next =
    material?.timeline.findIndex(
      (s, i) => i > session.index && isDiscrepancy(s),
    ) ?? -1;
  const nextDecision =
    material?.timeline.findIndex(
      (s, i) => i > session.index && s.is_decision,
    ) ?? -1;
  const saved =
    material && scene
      ? state.bookmarks.find((b) => b.id === bookmarkKey(material, scene))
      : undefined;
  const notePending =
    saved &&
    queue.current.some(
      (op) => op.kind === "bookmark" && op.value.id === saved.id,
    );
  const edit = state.bookmarks.find((b) => b.id === editId);
  const save = () => {
    if (!material || !scene) return;
    const b = saved ?? {
      id: bookmarkKey(material, scene),
      report: material.report,
      round_index: material.round_index,
      event_index: scene.event_index,
      label: material.label,
      tag: "",
      memo: "",
    };
    if (!saved) change({ kind: "bookmark", value: b });
    setEditId(b.id);
    setDrawer("edit");
  };
  const close = async () => {
    if (await drain()) onClose();
  };
  const openBookmark = async (b: Bookmark) => {
    if (await open(b.report, b.round_index, b.event_index)) setDrawer(null);
  };
  const retry = async () => {
    if (queue.current.length) {
      await drain();
      return;
    }
    if (!initialized.current) {
      try {
        const s = await api<ReviewState>({ action: "round_review_state" });
        data.current = s;
        setState(s);
        initialized.current = true;
        setError("");
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "記録を読み込めませんでした。",
        );
        return;
      }
    }
    const next =
      attempted.current ??
      (target === "saved"
        ? null
        : { report: target.report, round: target.round, event: target.event });
    if (next) await open(next.report, next.round, next.event);
  };
  return (
    <section className="round-review" ref={root} aria-label="一局レビュー">
      <header className="round-review-header">
        <button className="text-button" onClick={() => void close()}>
          牌譜に戻る
        </button>
        <h1>一局レビュー</h1>
        <span className="review-save-status" role="status">
          {saving ? "保存中…" : queue.current.length ? "未保存" : ""}
        </span>
        <button className="text-button" onClick={() => setDrawer("saved")}>
          保存した場面 {state.bookmarks.length}
        </button>
      </header>
      {error && (
        <div className="error" role="alert">
          {error}{" "}
          <button className="text-button" onClick={() => void retry()}>
            再試行
          </button>
        </div>
      )}
      {loading ? (
        <p role="status">一局を準備中…</p>
      ) : scene && material && catalog ? (
        <>
          <div className="round-review-toolbar">
            <label>
              <span className="visually-hidden">振り返る局</span>
              <select
                aria-label="振り返る局"
                value={material.round_index}
                onChange={(e) =>
                  void open(material.report, Number(e.target.value))
                }
              >
                {catalog.rounds.map((r) => (
                  <option key={r.index} value={r.index}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <span>
              {scene.source_discard_index + 1}打目 · {material.model}
            </span>
            <div className="segmented" aria-label="レビューの進め方">
              {[false, true].map((quiz) => (
                <button
                  key={String(quiz)}
                  className={session.quiz === quiz ? "chosen" : ""}
                  aria-pressed={session.quiz === quiz}
                  onClick={() => updateSession({ quiz })}
                >
                  {quiz ? "クイズあり" : "クイズなし"}
                </button>
              ))}
            </div>
          </div>
          <div className="round-review-board">
            <RealTable
              key={roundKey(material)}
              scene={scene}
              report={material.report}
              annotations={marks}
              reviewHands={material.reveals[event]}
              interactive={hidden}
              selected={hidden ? chosen : null}
              onSelect={(t) =>
                updateSession({
                  selected: { ...getSession().selected, [event]: t },
                })
              }
            />
          </div>
          <div className="round-review-answer">
            <span>
              {scene.is_decision
                ? "自分の打牌前"
                : `${scene.actor === null || scene.actor === undefined ? "" : ["自分", "下家", "対面", "上家"][(scene.actor - scene.seat + 4) % 4] + " · "}${eventLabels[scene.event_type ?? ""] ?? scene.event_type ?? ""}`}
            </span>
            {hidden ? (
              <button
                className="button primary"
                disabled={!chosen}
                onClick={() =>
                  chosen &&
                  updateSession({
                    answers: { ...getSession().answers, [event]: chosen },
                  })
                }
              >
                答え合わせ
              </button>
            ) : (
              session.quiz &&
              scene.is_decision && (
                <button
                  className="button secondary"
                  disabled={nextDecision < 0}
                  onClick={() => jump(nextDecision)}
                >
                  次の判断へ
                </button>
              )
            )}
            <span className="review-event-count" aria-label="現在の手順">
              {session.index + 1} / {material.timeline.length}
            </span>
          </div>
          <nav className="round-review-controls" aria-label="局内の移動">
            <button
              className="button secondary"
              disabled={session.index <= 0}
              onClick={() => move(-1)}
            >
              前の一手
            </button>
            <button
              className="button secondary"
              disabled={session.index >= material.timeline.length - 1 || hidden}
              onClick={() => move(1)}
            >
              次の一手
            </button>
            <button
              className="button secondary"
              disabled={previous < 0}
              onClick={() => jump(previous)}
            >
              前の不一致
            </button>
            <button
              className="button secondary"
              disabled={next < 0}
              onClick={() => jump(next)}
            >
              次の不一致
            </button>
            <button
              className={`button ${saved ? "secondary" : "primary"}`}
              onClick={save}
            >
              {saved
                ? notePending
                  ? "保存待ち…"
                  : "★ 保存済み"
                : "☆ 場面を保存"}
            </button>
          </nav>
        </>
      ) : (
        !error && <p className="empty">保存した場面から一局を開けます。</p>
      )}
      {drawer && (
        <dialog
          ref={drawerRef}
          className="review-drawer-dialog"
          aria-label={drawer === "edit" ? "保存場面の編集" : "保存した場面"}
          onCancel={() => setDrawer(null)}
          onClick={(e) => {
            if (e.target === e.currentTarget) setDrawer(null);
          }}
        >
          <aside className="review-drawer">
            <div className="review-save-status" role="status">
              {saving
                ? "保存中…"
                : queue.current.length
                  ? "未保存の内容があります"
                  : "端末に保存済み"}
            </div>
            {error && (
              <div className="error" role="alert">
                {error}
                <button className="text-button" onClick={() => void retry()}>
                  再試行
                </button>
              </div>
            )}
            <div className="section-title">
              <h2>{drawer === "edit" ? "保存した場面" : "保存した場面"}</h2>
              <button
                className="text-button"
                aria-label="保存欄を閉じる"
                onClick={() => setDrawer(null)}
              >
                ×
              </button>
            </div>
            {drawer === "edit" && edit ? (
              <>
                <p>{edit.label}</p>
                <div className="review-tags" aria-label="場面のタグ">
                  {["", ...state.tags].map((tag) => (
                    <button
                      key={tag}
                      className={`button secondary ${edit.tag === tag ? "chosen" : ""}`}
                      aria-pressed={edit.tag === tag}
                      onClick={() =>
                        change({ kind: "bookmark", value: { ...edit, tag } })
                      }
                    >
                      {tag || "タグなし"}
                    </button>
                  ))}
                </div>
                <label>
                  メモ
                  <textarea
                    aria-label="場面のメモ"
                    maxLength={2000}
                    value={edit.memo}
                    onChange={(e) =>
                      change({
                        kind: "bookmark",
                        value: { ...edit, memo: e.target.value },
                      })
                    }
                  />
                </label>
                <button
                  className="text-button"
                  onClick={() => {
                    change({ kind: "remove", id: edit.id });
                    setDrawer(null);
                  }}
                >
                  保存を取り消す
                </button>
                <button
                  className="text-button"
                  onClick={() => setDrawer("saved")}
                >
                  保存した場面一覧
                </button>
              </>
            ) : (
              <>
                <label>
                  タグで絞る
                  <select
                    aria-label="保存場面のタグで絞る"
                    value={tagFilter}
                    onChange={(e) => setTagFilter(e.target.value)}
                  >
                    {["すべて", "タグなし", ...state.tags].map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </label>
                <div className="review-saved-list">
                  {state.bookmarks
                    .filter(
                      (b) =>
                        tagFilter === "すべて" ||
                        b.tag === (tagFilter === "タグなし" ? "" : tagFilter),
                    )
                    .map((b) => (
                      <article key={b.id}>
                        <button
                          className="text-button"
                          onClick={() => void openBookmark(b)}
                        >
                          {b.label} · 手順{b.event_index + 1}
                          {b.tag && ` · ${b.tag}`}
                        </button>
                        {b.memo && <p>{b.memo}</p>}
                        <button
                          className="text-button"
                          onClick={() => {
                            setEditId(b.id);
                            setDrawer("edit");
                          }}
                        >
                          タグ・メモ
                        </button>
                      </article>
                    ))}
                  {!state.bookmarks.length && <p>保存した場面はありません。</p>}
                </div>
                <button
                  className="text-button"
                  onClick={() => setManaging(!managing)}
                >
                  タグを管理
                </button>
                {managing &&
                  state.tags.map((tag) => (
                    <div className="review-tag-manage" key={tag}>
                      <label>
                        {tag}
                        <input
                          aria-label={`${tag}の名前`}
                          maxLength={20}
                          value={tagDraft[tag] ?? tag}
                          onChange={(e) =>
                            setTagDraft({ ...tagDraft, [tag]: e.target.value })
                          }
                        />
                      </label>
                      <button
                        className="text-button"
                        disabled={!(tagDraft[tag] ?? tag).trim()}
                        onClick={() => {
                          change({
                            kind: "tag",
                            old: tag,
                            new: (tagDraft[tag] ?? tag).trim(),
                          });
                          setTagFilter("すべて");
                        }}
                      >
                        変更・同名は統合
                      </button>
                    </div>
                  ))}
              </>
            )}
          </aside>
        </dialog>
      )}
    </section>
  );
}
