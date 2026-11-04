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
  registered: "KyokuLoopへ登録しました",
  open_kyokuloop_tab:
    "同じブラウザでPCのKyokuLoop（http://127.0.0.1:1460/）を1つ開いてください。",
  local_unavailable:
    "KyokuLoopと通信できません。取得済みJSONは保持しています。アプリのタブと起動状態を確認し、再開してください。",
  invalid_queue: "KyokuLoopの牌譜一覧を確認できませんでした。",
  invalid_source: "対象プレイヤー付きの雀魂URLが必要です。",
  already_registered: "登録済み",
  unsupported_rule: "東風は対象外です。四人半荘を選んでください。",
  batch_limit: "1〜20件を選択してください。",
  queue_changed: "解析待ちの内容が変わりました。一覧を確認してください。",
  source_conflict:
    "元対局の順位・点数と結果が一致しないため登録を止めました。JSONは保持しています。",
  invalid_report: "JSONの内容またはモデルを確認できないため止めました。",
  invalid_receipt:
    "元対局への登録完了を確認できません。取得済みJSONを保持しています。",
  payload_missing:
    "JSONの受け渡しが途切れました。再取得・再解析はせず、ダウンロード済みJSONをKyokuLoopで登録してください。",
  pending_registration:
    "未登録のJSONを保持しています。先に登録を再開してください。",
  submission_uncertain:
    "送信済みか不明なため再解析しません。結果画面・保存済みJSONを確認してください。",
  report_read_failed:
    "結果JSONの読取を確認できませんでした。再取得・再解析せず、保存済みJSONを確認してください。",
  payload_storage_failed:
    "JSONの一時保存を確認できませんでした。ダウンロード済みJSONを確認してください。",
  size_limit: "JSONが空、または20MiBを超えたため止めました。",
  user_pause: "一時停止しました。",
};
const label = (value) =>
  messages[value] || "操作を完了できませんでした。ページを確認してください。";
let busy = false,
  feedback = "";
let refreshing = false,
  entries = [],
  batch = null,
  hasPending = false,
  batchFeedback = "";
const selected = new Set();
function batchControls() {
  const locked = ["running", "paused"].includes(batch?.phase);
  $("batch-model").disabled = busy || locked;
  $("batch-load").disabled = busy || locked;
  $("batch-start").textContent =
    batch?.phase === "paused"
      ? "続きから再開"
      : batch?.phase === "running"
        ? "解析・登録中"
        : `選択した${selected.size}件を解析・登録`;
  $("batch-start").disabled =
    busy ||
    batch?.phase === "running" ||
    (batch?.phase === "paused"
      ? ["access_restricted", "invalid_report", "payload_missing"].includes(
          batch.reason,
        )
      : !selected.size || selected.size > 20);
  $("batch-stop").textContent =
    batch?.phase === "paused"
      ? "この一覧を終了"
      : batch?.stopAfterCurrent
        ? "この1件の後に停止"
        : "停止";
  $("batch-stop").disabled =
    busy ||
    !locked ||
    !!batch?.stopAfterCurrent ||
    (batch?.phase === "paused" && hasPending);
  for (const input of $("batch-list").querySelectorAll("input"))
    input.disabled =
      locked || !entries.find((e) => e.id === input.value)?.available;
}
function renderEntries() {
  $("batch-list").replaceChildren();
  for (const entry of entries) {
    const row = document.createElement("label");
    row.className = "queue-entry";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = entry.id;
    input.checked = selected.has(entry.id);
    input.addEventListener("change", () => {
      if (input.checked) selected.add(entry.id);
      else selected.delete(entry.id);
      batchControls();
    });
    const text = document.createElement("span"),
      h = entry.history;
    text.textContent = h ? `${h.at} ／ ${h.rank}位` : "日時・順位なし";
    const detail = document.createElement("small");
    detail.textContent = entry.id;
    const reason = document.createElement("small");
    reason.textContent = entry.reason
      ? label(entry.reason)
      : entry.reuse
        ? "保存済み結果から登録（再解析なし）"
        : h
          ? "未登録"
          : "ルール未確認：四人半荘だけ選んでください";
    text.append(detail, reason);
    row.append(input, text);
    $("batch-list").append(row);
  }
  if (!entries.length)
    $("batch-list").textContent =
      "解析待ちの牌譜はありません。KyokuLoopに牌譜を追加してください。";
  batchControls();
}
function batchProgress(data) {
  batch = data.batch;
  hasPending = data.hasPendingPayload;
  batchControls();
  if (batch?.phase === "running" || batch?.phase === "paused") {
    const item = batch.items[batch.index],
      job = data.jobs.find((j) => j.id === item?.jobId);
    const progress = `登録 ${batch.items.filter((i) => i.status === "done").length}件 ／ 全${batch.items.length}件`;
    const detail =
      batch.phase === "paused"
        ? label(batch.reason)
        : batch.nextAt > Date.now() && item?.status === "queued"
          ? `次の対局まで ${Math.ceil((batch.nextAt - Date.now()) / 1000)}秒`
          : job
            ? job.phase === "saved"
              ? "JSONを検証し、KyokuLoopへ登録しています"
              : label(job.phase)
            : "Mortalのページを開いています";
    $("batch-notice").textContent =
      batchFeedback ||
      `${progress}\n${item?.id || ""}\n${detail}${batch.stopAfterCurrent ? "\nこの1件の処理後に停止します。" : ""}`;
  } else
    $("batch-notice").textContent =
      batchFeedback ||
      (batch?.phase === "done"
        ? `完了：登録 ${batch.items.filter((i) => i.status === "done").length}件、スキップ ${batch.items.filter((i) => i.status === "skipped").length}件。KyokuLoopに戻ると一覧が更新されます。`
        : batch?.phase === "ended"
          ? "一覧を終了しました。送信・登録の記録は保持しています。"
          : "");
}
$("version").textContent = chrome.runtime.getManifest().version_name;
export async function refresh() {
  if (busy || refreshing) return;
  refreshing = true;
  try {
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
    batchProgress(data);
    $("selection").textContent = selected?.source
      ? `${selected.source}\nモデル：${selected.model} ／ 対象：${selected.player === "" ? "URLから自動選択" : `東1局の席 ${Number(selected.player) + 1}`}`
      : "URL入力済みのMortalページを開いてください。初回導入後はページを読み直してください。";
    const batchLocked = ["running", "paused"].includes(batch?.phase);
    $("start").disabled = !s?.source || !!s.error || !!running || batchLocked;
    $("cancel").disabled =
      !running || running.tabId !== data.tabId || batchLocked;
    if (s?.source && !batchLocked) $("single").open = true;
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
  } finally {
    refreshing = false;
  }
}
async function batchAction(type) {
  if (busy) return;
  busy = true;
  batchFeedback = "";
  batchControls();
  try {
    const result = await chrome.runtime.sendMessage({
      type,
      model: $("batch-model").value,
      ids: [...selected],
    });
    if (result.error) batchFeedback = label(result.error);
    else if (type === "BATCH_LOAD") {
      entries = result.entries;
      selected.clear();
      renderEntries();
    } else if (type === "BATCH_START") selected.clear();
  } catch {
    batchFeedback = label("operation_failed");
  } finally {
    busy = false;
  }
  await refresh();
}
$("batch-load").addEventListener("click", () => void batchAction("BATCH_LOAD"));
$("batch-start").addEventListener(
  "click",
  () =>
    void batchAction(
      batch?.phase === "paused" ? "BATCH_RESUME" : "BATCH_START",
    ),
);
$("batch-stop").addEventListener(
  "click",
  () =>
    void batchAction(batch?.phase === "paused" ? "BATCH_END" : "BATCH_STOP"),
);
$("batch-model").addEventListener("change", () => {
  entries = [];
  selected.clear();
  $("batch-list").textContent =
    "モデルを変えました。「KyokuLoopから読み込む」で対象を確認してください。";
  batchControls();
});
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
