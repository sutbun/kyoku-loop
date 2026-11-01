export const errors: Record<string, string> = {
  invalid_queue:
    "解析待ちの記録を確認できません。保存済みのURLを保持しています。",
  queue_not_found: "解析待ちが見つかりません。一覧を更新してください。",
  queue_full:
    "端末の解析待ちの保存上限に達しました。保存済みのURLを保持しています。",
  phone_restore_exists:
    "この端末には記録や途中の復習があるため上書きできません。Windowsのバックアップ画面から、ファイルの回答記録を追加できます。",
  invalid_sync:
    "同期する記録の整合性を確認できません。端末の記録は保持しています。",
  invalid_receipt:
    "Windowsの受信確認を検証できません。未送信のまま保持しています。",
  sync_dependency:
    "先行する記録が不足しています。記録を保持して再試行してください。",
  sync_changed:
    "同期中に新しい回答が追加されました。記録を保持して再試行します。",
  sync_base_conflict:
    "学習の開始状態が一致しません。現在の記録を保持しています。",
  clock_ahead:
    "端末の記録が未来の日時になっています。端末の日時を確認してください。記録は保持しています。",
  invalid_phone_backup:
    "この端末記録ファイルは読み取れません。現在の記録は保持しています。",
  pending_records:
    "未送信の記録または途中の復習があるため、問題を上書きできません。現在の問題と記録は保持しています。",
  different_source: "別のWindows保存先の問題です。現在の問題を保持しています。",
  invalid_pack:
    "問題の整合性を確認できません。現在の保存内容は保持しています。",
  pack_large: "問題が多すぎます。保存内容は保持しています。",
  shell_missing:
    "アプリ本体の保存を確認できません。通信を確認し、アプリを完全に閉じて開き直してから保存し直してください。",
  secure_required: "Safariで専用のHTTPSアドレスを開いてください。",
  storage_blocked:
    "別の画面で保存先を使用中です。ほかのKyokuLoop画面を閉じて再試行してください。",
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
  if (location.pathname.startsWith("/phone/")) {
    try {
      return await (
        await import("./offline/store")
      ).phoneTransaction<T>(request as Record<string, unknown>);
    } catch (e) {
      if (e instanceof DOMException && e.name === "QuotaExceededError")
        throw new Error(
          "空き容量が足りず保存できません。今回の操作は完了していません。",
        );
      throw new Error(
        e instanceof Error
          ? (errors[e.message] ??
              "端末に保存できませんでした。同じ操作で再試行してください。")
          : "端末に保存できませんでした。",
      );
    }
  }
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
