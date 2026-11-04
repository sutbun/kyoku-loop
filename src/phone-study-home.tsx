import type { Workspace } from "./real-types";

export function PhoneStudyHome({
  workspace,
  disabled,
  onBegin,
  onLibrary,
  onAdd,
}: {
  workspace: Workspace;
  disabled: boolean;
  onBegin: (mode: "scheduled" | "practice") => void;
  onLibrary: () => void;
  onAdd: () => void;
}) {
  const resume = workspace.session && !workspace.session.complete;
  const due = workspace.due_count ?? 0;
  const practice =
    workspace.practice_count ??
    workspace.items.filter((i) => !["保留", "習得済み"].includes(i.status))
      .length;
  return (
    <div className="phone-study-home">
      <h1 className="visually-hidden">学習</h1>
      {resume || due > 0 ? (
        <section className="phone-review-card">
          <div className="phone-card-heading">
            <h2>{resume ? "学習の続き" : "今日の復習"}</h2>
            <span>
              <b>
                {resume
                  ? workspace.session!.total - workspace.session!.index
                  : due}
              </b>{" "}
              問
            </span>
          </div>
          <button
            className="button light"
            disabled={disabled}
            onClick={() =>
              onBegin(resume ? workspace.session!.mode : "scheduled")
            }
          >
            {resume ? "続きから再開" : "今日の復習を始める"} →
          </button>
        </section>
      ) : (
        <p className="phone-review-done">
          {workspace.items.length
            ? "今日の復習は完了"
            : "学習する問題がありません"}
        </p>
      )}
      {!resume && practice > 0 && (
        <section className="panel phone-practice-card">
          <h2>自主練習</h2>
          <button
            className={`button ${due ? "secondary" : "primary"}`}
            disabled={disabled}
            onClick={() => onBegin("practice")}
          >
            {Math.min(5, practice)}問練習する
          </button>
        </section>
      )}
      {!workspace.items.length && (
        <button className="button primary" disabled={disabled} onClick={onAdd}>
          牌譜を追加
        </button>
      )}
      <button
        className="panel phone-library-link"
        disabled={disabled}
        onClick={onLibrary}
      >
        問題一覧を見る <span aria-hidden="true">›</span>
      </button>
    </div>
  );
}
