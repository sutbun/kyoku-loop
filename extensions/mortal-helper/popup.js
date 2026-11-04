const $ = (id) => document.getElementById(id);
const messages = {
  waiting: "送信できる状態を待っています",
  submitting: "送信操作を開始・結果は未確認です",
  analysing: "解析完了を待っています",
  saving: "JSONを保存しています",
  saved: "ファイルを保存しました（内容検証・アプリ登録は未実施）",
  stopped: "停止しました",
  wrong_page: "URL入力済みのMortalページを開いてください。",
  invalid_form:
    "URL・対象プレイヤー・Mortal・Killerducky UI・温度を確認してください。",
  source_changed: "ページのURLと入力された牌譜URLが異なります。",
  form_changed: "入力内容または画面構造が変わったため停止しました。",
  page_changed: "別のページへ移動したため停止しました。",
  another_job_running: "ほかの1件が処理中です。",
  already_attempted:
    "同じ設定の送信は操作済み、または結果不明です。二重依頼を防ぐため再送しません。",
  human_confirmation: "本人確認が必要です。自動操作を停止しました。",
  access_restricted:
    "アクセス制限を検出しました。この処理を再試行しないでください。",
  site_error: "サイトにエラーが表示されたため停止しました。",
  timeout: "待機時間の上限に達しました。送信状態不明のときは再送しません。",
  wrong_result: "別の解析結果へ移動したため保存しませんでした。",
  download_failed:
    "保存が失敗、またはファイル種別・大きさ・宛先を確認できませんでした。自動再取得はしません。",
  cancelled: "停止を指定しました。",
  tab_closed: "処理中のタブが閉じられました。",
  browser_restarted: "ブラウザまたは拡張が再起動したため停止しました。",
  navigation_failed: "ページへの移動が失敗しました。",
  manual_submission: "本人の送信操作を検出したため拡張の処理を停止しました。",
  history_full: "処理記録が上限に達しました。",
  invalid_storage: "処理記録を読み取れません。再送せず確認してください。",
  operation_failed: "操作を完了できませんでした。",
};
const label = (value) =>
  messages[value] || "操作を完了できませんでした。ページを確認してください。";
let busy = false,
  feedback = "";
$("version").textContent = chrome.runtime.getManifest().version_name;
export async function refresh() {
  if (busy) return;
  const data = await chrome.runtime.sendMessage({ type: "STATUS" });
  if (data.error) {
    $("notice").textContent = label(data.error);
    return;
  }
  const running = data.jobs.find((j) =>
    ["waiting", "submitting", "analysing", "saving"].includes(j.phase),
  );
  const current = data.jobs.find((j) => j.tabId === data.tabId);
  const s = data.snapshot;
  const selected = s?.source ? s : current;
  $("selection").textContent = selected?.source
    ? `${selected.source}\nモデル：${selected.model} ／ 対象：${selected.player === "" ? "URLから自動選択" : `東1局の席 ${Number(selected.player) + 1}`}`
    : "URL入力済みのMortalページを開いてください。初回導入後はページを読み直してください。";
  $("start").disabled = !s?.source || !!s.error || !!running;
  $("cancel").disabled = !running || running.tabId !== data.tabId;
  $("notice").textContent =
    feedback ||
    (current
      ? `${label(current.phase)}${current.reason ? `：${label(current.reason)}` : ""}`
      : running
        ? "ほかのタブで1件を処理中です。"
        : s?.error
          ? label(s.error)
          : "");
  $("export").disabled = !data.jobs.length;
  $("history").replaceChildren();
  for (const job of data.jobs) {
    const box = document.createElement("div");
    box.className = "record";
    for (const text of [
      label(job.phase),
      job.reason ? label(job.reason) : "",
      `元URL：${job.source}`,
      `モデル：${job.model}`,
      job.task ? `結果ID：${job.task}` : "",
      job.filename ? `保存先：${job.filename}` : "",
    ].filter(Boolean)) {
      const p = document.createElement("p");
      p.textContent = text;
      box.append(p);
    }
    $("history").append(box);
  }
}
async function action(type) {
  feedback = "";
  busy = true;
  $("start").disabled = true;
  $("cancel").disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ type });
    if (result.error) feedback = label(result.error);
  } catch {
    feedback = label("operation_failed");
  } finally {
    busy = false;
  }
  await refresh();
}
$("start").addEventListener("click", () => void action("START"));
$("cancel").addEventListener("click", () => void action("CANCEL"));
$("export").addEventListener("click", () => void action("EXPORT"));
void refresh().catch(() => {
  $("notice").textContent = label("operation_failed");
});
setInterval(() => void refresh().catch(() => {}), 1000);
