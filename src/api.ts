export const errors: Record<string, string> = {
  unsupported_storage:
    "この保存データは別の版で作成されています。対応するアプリで開いてください。",
  study_changed: "学習状態が変更されています。最新の状態を確認してください。",
  event_conflict:
    "同じ送信IDの内容が一致しません。画面を再読み込みしてください。",
  cannot_undo:
    "この操作の後に変更があるため取り消せません。履歴を確認してください。",
  answer_required: "切る牌を選んで回答を確定してください。",
  invalid_backup:
    "このバックアップは読み取れません。対応するファイルを選び直してください。",
  backup_changed:
    "確認後にバックアップが変わりました。もう一度内容を確認してください。",
  backup_conflict:
    "分岐した履歴があるため復元していません。現在のデータは保持しています。",
  backup_download_large:
    "圧縮後20MBを超えるためダウンロードできません。保存先のバックアップを別の場所へコピーしてください。",
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
export async function api<T>(request: object): Promise<T> {
  let response: Response;
  try {
    response = await fetch("/api/local", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch {
    throw new Error(
      "接続が切れ、処理結果を確認できません。同じ操作で再試行できます。",
    );
  }
  if (!response.ok)
    throw new Error("ローカル保存先に接続できません。再試行してください。");
  const result = await response.json();
  if (!result.ok)
    throw new Error(
      errors[result.error] ??
        "処理結果を確認できません。同じ操作で再試行するか、最新の状態を確認してください。",
    );
  return result.data;
}
