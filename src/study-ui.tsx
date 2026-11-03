import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "./api";
import { RealTable, RealTile, roundLabel, uiTile } from "./real-board";
import { tileLabel } from "./demo";
import type { ItemHistory, Scene, StudySession, Workspace } from "./real-types";

export function PracticeCard({
  workspace,
  disabled,
  onBegin,
}: {
  workspace: Workspace;
  disabled: boolean;
  onBegin: (mode: "scheduled" | "practice") => void;
}) {
  const resume = workspace.session && !workspace.session.complete;
  return (
    <section className="review-hero study-hero">
      <div>
        <h2>今日の復習</h2>
        <p>
          <strong>
            {resume
              ? workspace.session!.total - workspace.session!.index
              : (workspace.due_count ?? 0)}
          </strong>
          問
        </p>
        <button
          className="button light"
          disabled={disabled || (!resume && !workspace.due_count)}
          onClick={() =>
            onBegin(resume ? workspace.session!.mode : "scheduled")
          }
        >
          {resume ? "復習を再開する" : "今日の復習を始める"} →
        </button>
      </div>
      <button
        className="button light"
        disabled={
          disabled ||
          !!resume ||
          !(
            workspace.practice_count ??
            workspace.items.filter(
              (i) => !["保留", "習得済み"].includes(i.status),
            ).length
          )
        }
        onClick={() => onBegin("practice")}
      >
        今すぐ学ぶ
      </button>
    </section>
  );
}
function Modal({
  title,
  busy,
  onClose,
  children,
}: {
  title: string;
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.showModal();
    return () => {
      ref.current?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else onClose();
      }}
      onClick={(e) => {
        if (!busy && e.target === ref.current) onClose();
      }}
    >
      <div className="dialog-content">
        <div className="section-title">
          <h2>{title}</h2>
          <button
            className="text-button"
            aria-label="閉じる"
            disabled={busy}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
function Compare({
  scene,
  answer,
  onRechoose,
  busy,
}: {
  scene: Scene;
  answer?: string | null;
  onRechoose?: () => void;
  busy?: boolean;
}) {
  return (
    <div className="comparison" data-testid="study-comparison">
      {answer && (
        <div>
          <span>今回の回答</span>
          <RealTile value={answer} />
        </div>
      )}
      <div>
        <span>対局時の打牌</span>
        <RealTile value={scene.actual!} />
      </div>
      <div>
        <span>
          {scene.engine ?? "NAGA"}推奨 · {scene.model_name}
        </span>
        <RealTile value={scene.suggested!} />
      </div>
      <div className="comparison-tools">
        <details className="comparison-weight">
          <summary>
            候補重み差 <b>{scene.gap?.toFixed(2)}pt</b>
          </summary>
          <small>
            {scene.engine === "Mortal"
              ? "モデルの選択傾向"
              : "分布合計を100に換算"}{" "}
            · 勝率や損失ではありません
          </small>
        </details>
        {onRechoose && (
          <button className="text-button" disabled={busy} onClick={onRechoose}>
            回答を選び直す
          </button>
        )}
      </div>
    </div>
  );
}
type BackupList = {
  folder: string;
  mirror_folder?: string;
  mirror_error?: boolean;
  files: { name: string; bytes: number; created: string }[];
};
type BackupPlan = {
  name: string;
  hash: string;
  reports: number;
  items: number;
  events: number;
  conflicts: number;
};
const syncReasons: Record<string, string> = {
  same_day: "同じ日の定期復習は1回として集計",
  old_cycle: "以前の学習サイクルの記録として保存",
  inactive: "現在の出題状態へは反映せず記録を保存",
  undo_conflict: "後続の記録があるため取消を反映せず保存",
  not_due: "期限前の記録として保存",
};
const jstTime = (at: string) =>
  new Date(at).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour12: false,
  });
function BackupDialog({
  onClose,
  onRefresh,
}: {
  onClose: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [list, setList] = useState<BackupList>({ folder: "", files: [] });
  const [plan, setPlan] = useState<BackupPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [phonePlan, setPhonePlan] = useState<{
    hash: string;
    events: number;
    duplicates: number;
    urls?: number;
    new: number;
    backup: unknown;
  } | null>(null);
  const load = async () =>
    setList(await api<BackupList>({ action: "backup_list" }));
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
    void run(load);
  }, []);
  return (
    <Modal title="バックアップと復元" busy={busy} onClose={onClose}>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      <button
        className="button primary full"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const saved = await api<{ mirror?: { state: string } }>({
              action: "backup_create",
            });
            await load();
            setNotice(
              saved.mirror?.state === "saved"
                ? "バックアップを保存しました。追加コピーも確認済みです。"
                : "バックアップを保存しました。",
            );
            if (saved.mirror?.state === "failed")
              setError(
                "元の保存先には保存済みですが、追加コピーは完了していません。コピー先の空き容量と接続を確認して再試行してください。",
              );
          })
        }
      >
        バックアップを作成
      </button>
      <small className="backup-path">保存先：{list.folder}</small>
      {list.mirror_folder && (
        <small className="backup-path">
          追加コピー先：{list.mirror_folder}
        </small>
      )}
      {list.mirror_error && (
        <p role="alert">
          追加コピー先の設定を読み取れません。元の保存先は保持しています。
        </p>
      )}
      <label className="file-drop">
        バックアップファイルを選択
        <input
          type="file"
          accept=".sqlite3,.gz"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            void run(async () => {
              if (file.size > 20 * 1024 * 1024)
                throw new Error(
                  "20MB以下の圧縮バックアップを選択してください。",
                );
              const bytes = new Uint8Array(await file.arrayBuffer());
              let binary = "";
              for (let n = 0; n < bytes.length; n += 8192)
                binary += String.fromCharCode(...bytes.subarray(n, n + 8192));
              setPlan(
                await api<BackupPlan>({
                  action: "backup_upload",
                  data: btoa(binary),
                }),
              );
              await load();
            });
          }}
        />
      </label>
      {plan && (
        <section className="restore-plan">
          <h3>復元する内容</h3>
          <p>
            牌譜 {plan.reports}件 · 問題 {plan.items}件 · 履歴 {plan.events}件
          </p>
          <p>現在のデータを残し、不足分を追加します。</p>
          {plan.conflicts > 0 ? (
            <p role="alert">分岐した履歴があるため復元できません。</p>
          ) : (
            <button
              className="button primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api({
                    action: "backup_restore",
                    name: plan.name,
                    hash: plan.hash,
                  });
                  setPlan(null);
                  await onRefresh();
                  setNotice("復元しました。現在の追加データも保持しています。");
                })
              }
            >
              この内容を復元
            </button>
          )}
          <button
            className="text-button"
            disabled={busy}
            onClick={() => setPlan(null)}
          >
            取り消す
          </button>
        </section>
      )}
      <label className="file-drop">
        端末の記録ファイルを選択
        <input
          type="file"
          accept=".json,application/json"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            setPhonePlan(null);
            if (!file) return;
            void run(async () => {
              if (file.size > 20 * 1024 * 1024)
                throw new Error("20MB以下の端末記録を選択してください。");
              const backup = JSON.parse(await file.text());
              const plan = await api<{
                hash: string;
                events: number;
                duplicates: number;
                new: number;
              }>({ action: "phone_backup_inspect", backup });
              setPhonePlan({ ...plan, backup });
            });
          }}
        />
      </label>
      {phonePlan && (
        <section className="restore-plan">
          <h3>端末の回答記録を追加</h3>
          <p>
            追加 {phonePlan.new}件 · 登録済み {phonePlan.duplicates}件
            {!!phonePlan.urls && <> · 解析待ちURL {phonePlan.urls}件</>}
          </p>
          <button
            className="button primary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api({
                  action: "phone_backup_restore",
                  backup: phonePlan.backup,
                  hash: phonePlan.hash,
                });
                setPhonePlan(null);
                await onRefresh();
                setNotice(
                  "端末の回答記録を追加しました。現在の記録も保持しています。",
                );
              })
            }
          >
            この記録を追加
          </button>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => setPhonePlan(null)}
          >
            取り消す
          </button>
        </section>
      )}
      <div className="backup-list">
        {list.files.map((file) => (
          <div key={file.name}>
            <div>
              <strong>{jstTime(file.created)}</strong>
              <small>{(file.bytes / 1024 / 1024).toFixed(1)}MB</small>
            </div>
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void run(async () =>
                  setPlan(
                    await api<BackupPlan>({
                      action: "backup_inspect",
                      name: file.name,
                    }),
                  ),
                )
              }
            >
              内容を確認
            </button>
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const exported = await api<{ name: string; data: string }>({
                    action: "backup_export",
                    name: file.name,
                  });
                  const bytes = Uint8Array.from(atob(exported.data), (c) =>
                    c.charCodeAt(0),
                  );
                  const url = URL.createObjectURL(
                    new Blob([bytes], { type: "application/gzip" }),
                  );
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = exported.name;
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                })
              }
            >
              ダウンロード
            </button>
          </div>
        ))}
      </div>
    </Modal>
  );
}
export function StudyPanel({
  portable = false,
  workspace,
  active,
  filter,
  onFilter,
  onActive,
  onRefresh,
  onSession,
  onHome,
  onReview,
}: {
  portable?: boolean;
  workspace: Workspace;
  active: boolean;
  filter: string;
  onFilter: (s: string) => void;
  onActive: (v: boolean) => void;
  onRefresh: () => Promise<void>;
  onSession: (s: StudySession | null) => void;
  onHome: () => void;
  onReview: (r: string, id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<ItemHistory | null>(null);
  const [backups, setBackups] = useState(false);
  const [undoControl, setUndoControl] = useState<string | null>(null);
  const pending = useRef<{ key: string; id: string } | null>(null);
  const session = workspace.session;
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
  const operation = async <T,>(request: object): Promise<T> => {
    const key = JSON.stringify(request);
    if (pending.current?.key !== key)
      pending.current = { key, id: crypto.randomUUID() };
    const result = await api<T>({ ...request, event: pending.current.id });
    pending.current = null;
    return result;
  };
  const begin = (mode: "scheduled" | "practice") =>
    void run(async () => {
      onSession(await api<StudySession>({ action: "study_start", mode }));
      onActive(true);
    });
  const choice = (choice: string, answer?: string) =>
    void run(async () => {
      onSession(
        await api<StudySession>({
          action: "study_choice",
          session: session!.id,
          choice,
          answer,
        }),
      );
    });
  const grade = (rating: string) =>
    void run(async () => {
      onSession(
        await operation<StudySession>({
          action: "study_rate",
          session: session!.id,
          item: session!.item_id,
          rating,
        }),
      );
      await onRefresh();
    });
  const undo = () =>
    void run(async () => {
      onSession(
        await operation<StudySession>({
          action: "study_undo",
          session: session!.id,
        }),
      );
      await onRefresh();
    });
  const items = workspace.items.filter(
    (i) =>
      filter === "すべて" ||
      (filter === "今日"
        ? !["保留", "習得済み"].includes(i.status) &&
          !!i.due &&
          i.due <= (workspace.today ?? "")
        : i.status === filter),
  );
  return (
    <>
      {error && (
        <div className="error" role="alert">
          {error}
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void run(onRefresh)}
          >
            最新の状態を確認
          </button>
        </div>
      )}
      {active && session ? (
        <>
          <div className="page-heading compact study-heading">
            <h1>{session.mode === "practice" ? "自主練習" : "今日の復習"}</h1>
            {!session.complete && (
              <span className="study-progress">
                {session.index + 1} / {session.total} 問
              </span>
            )}
            {portable && session.can_undo && (
              <button
                className="text-button study-undo"
                aria-label="直前の評価を取り消す"
                title="直前の評価を取り消す"
                disabled={busy}
                onClick={undo}
              >
                ↶
              </button>
            )}
            <button
              className="text-button"
              aria-label="中断してホームへ"
              disabled={busy}
              onClick={onHome}
            >
              中断
            </button>
          </div>
          {!session.complete ? (
            <>
              {session.stale || !session.scene ? (
                <div className="panel">
                  <p>この問題の学習状態が変更されました。</p>
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() =>
                      void run(async () =>
                        onSession(
                          await api<StudySession>({
                            action: "study_skip",
                            session: session.id,
                          }),
                        ),
                      )
                    }
                  >
                    この問題をスキップ
                  </button>
                </div>
              ) : (
                <div
                  className={`quiz-layout ${session.revealed ? "is-revealed" : ""}`}
                >
                  <section className="board-panel">
                    <div className="board-title">
                      <h2>{roundLabel(session.scene)}</h2>
                    </div>
                    <fieldset className="quiz-board" disabled={busy}>
                      <RealTable
                        key={session.item_id}
                        scene={session.scene}
                        interactive={!session.revealed}
                        selected={session.selected}
                        onSelect={(answer) => choice("choose", answer)}
                      />
                    </fieldset>
                  </section>
                  <aside
                    className={`panel quiz-answer ${session.revealed ? "revealed" : "choosing"}`}
                  >
                    {session.revealed ? (
                      <>
                        <h2>答え合わせ</h2>
                        <Compare
                          scene={session.scene}
                          answer={session.selected}
                          onRechoose={() => choice("rechoose")}
                          busy={busy}
                        />
                        <h3 className="rating-heading">今回の理解度</h3>
                        <div
                          className="ratings"
                          role="group"
                          aria-label="今回の理解度"
                        >
                          {["理解した", "再復習", "保留"].map((rating, i) => (
                            <button
                              className={`button ${i === 0 ? "primary" : "secondary"}`}
                              key={rating}
                              disabled={busy}
                              onClick={() => grade(rating)}
                            >
                              {rating}
                            </button>
                          ))}
                        </div>
                        {session.mode === "practice" && (
                          <small className="muted">
                            自主練習は卒業回数に加算しません。
                          </small>
                        )}
                      </>
                    ) : (
                      <>
                        <h2 className="answer-prompt">切る牌を選択</h2>
                        <div className="chosen-tile">
                          {session.selected ? (
                            <RealTile value={session.selected} />
                          ) : (
                            <span>？</span>
                          )}
                        </div>
                        <button
                          className="button primary full"
                          disabled={busy || !session.selected}
                          onClick={() => choice("confirm")}
                        >
                          回答する
                        </button>
                        <button
                          className="text-button"
                          aria-label="選択を取り消す"
                          disabled={busy || !session.selected}
                          onClick={() => choice("clear")}
                        >
                          取消
                        </button>
                      </>
                    )}
                    {!portable && session.can_undo && (
                      <button
                        className="text-button undo"
                        disabled={busy}
                        onClick={undo}
                      >
                        直前の評価を取り消す
                      </button>
                    )}
                  </aside>
                </div>
              )}
            </>
          ) : (
            <section className="panel complete">
              <span className="complete-icon">✓</span>
              <h2>
                {session.total
                  ? `${session.total}問、おつかれさまでした。`
                  : "今日の復習対象はありません。"}
              </h2>
              <div className="result-summary">
                {session.answers.map((answer, i) => (
                  <div key={answer.id}>
                    <span>
                      {i + 1}. {answer.credited ? "定期復習" : "自主練習・保留"}
                    </span>
                    <strong>{answer.rating}</strong>
                  </div>
                ))}
              </div>
              <div className="complete-actions">
                <button
                  className="button primary"
                  onClick={() => {
                    onActive(false);
                    onFilter("すべて");
                  }}
                >
                  ライブラリへ
                </button>
                <button className="button secondary" onClick={onHome}>
                  ホームへ
                </button>
                {session.can_undo && (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={undo}
                  >
                    直前の評価を取り消す
                  </button>
                )}
              </div>
            </section>
          )}
        </>
      ) : (
        <>
          <div className="page-heading">
            <h1>学習ライブラリ</h1>
            {!portable && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => setBackups(true)}
              >
                バックアップと復元
              </button>
            )}
          </div>
          <PracticeCard workspace={workspace} disabled={busy} onBegin={begin} />
          <div className="filters" aria-label="学習状態">
            {["今日", "未学習", "復習中", "習得済み", "保留", "すべて"].map(
              (s) => (
                <button
                  className={filter === s ? "chosen" : ""}
                  key={s}
                  onClick={() => onFilter(s)}
                >
                  {s}
                </button>
              ),
            )}
          </div>
          <div className="library-list">
            {items.map((item) => (
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
                    {item.automatic ? "自動登録" : "手動保存"} · 連続理解{" "}
                    {item.streak ?? 0}/5
                  </small>
                </div>
                <span className="badge neutral">{item.status}</span>
                <span className="due">
                  次回 <b>{item.due || "—"}</b>
                </span>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () =>
                      setHistory(
                        await api<ItemHistory>({
                          action: "item_history",
                          item: item.id,
                        }),
                      ),
                    )
                  }
                >
                  局面と履歴
                </button>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const r = await operation<{ event: string }>({
                        action: "study_control",
                        item: item.id,
                        control:
                          item.status === "保留"
                            ? "resume"
                            : item.status === "習得済み"
                              ? "restart"
                              : "pause",
                      });
                      setUndoControl(r.event);
                      await onRefresh();
                    })
                  }
                >
                  {item.status === "保留"
                    ? "再開"
                    : item.status === "習得済み"
                      ? "再学習"
                      : "保留"}
                </button>
              </div>
            ))}
          </div>
          {items.length === 0 && (
            <div className="empty">この区分の問題はありません。</div>
          )}
          {undoControl && (
            <button
              className="text-button undo"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await operation({
                    action: "study_undo_control",
                    original: undoControl,
                  });
                  setUndoControl(null);
                  await onRefresh();
                })
              }
            >
              変更を取り消す
            </button>
          )}
        </>
      )}
      {history && (
        <Modal title="局面と履歴" busy={busy} onClose={() => setHistory(null)}>
          <h3>{roundLabel(history.scene)}</h3>
          <RealTable scene={history.scene} />
          <Compare scene={history.scene} />
          {!portable && (
            <button
              className="text-button"
              onClick={() => {
                onReview(
                  workspace.items.find((i) => i.id === history.id)!.report,
                  history.id,
                );
                setHistory(null);
              }}
            >
              元の牌譜を確認
            </button>
          )}
          <h3>回答履歴</h3>
          <div className="answer-history">
            {history.events.map((event) => (
              <article className={event.undone ? "undone" : ""} key={event.id}>
                <div>
                  <time>{jstTime(event.at)}</time>
                  <strong>
                    {event.undone ? "取消済み · " : ""}
                    {event.kind === "undo"
                      ? "取消"
                      : (event.rating ??
                        (
                          {
                            pause: "保留",
                            resume: "再開",
                            restart: "再学習",
                          } as Record<string, string>
                        )[event.kind])}
                  </strong>
                </div>
                {event.answer && (
                  <p>
                    回答：{tileLabel(uiTile(event.answer))} ·{" "}
                    {event.credited ? "定期復習" : "自主練習・保留"} ·
                    {history.scene.engine ?? "NAGA"}同牌種：
                    {event.answer.replace(/r$/, "") ===
                    history.scene.suggested!.replace(/r$/, "")
                      ? "一致"
                      : "不一致"}
                  </p>
                )}
                {event.sync_reason && syncReasons[event.sync_reason] && (
                  <small>{syncReasons[event.sync_reason]}</small>
                )}
              </article>
            ))}
            {history.legacy_history.map((h, i) => (
              <p key={i}>{h}</p>
            ))}
            {history.events.length === 0 &&
              history.legacy_history.length === 0 && (
                <p>まだ回答していません。</p>
              )}
          </div>
        </Modal>
      )}
      {backups && (
        <BackupDialog onClose={() => setBackups(false)} onRefresh={onRefresh} />
      )}
    </>
  );
}
