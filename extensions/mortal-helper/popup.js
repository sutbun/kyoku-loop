import { diagnosticText } from "./diagnostics.js";

const $ = (id) => document.getElementById(id);
const messages = {
  selection_limit: "最大20件です",
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
  reconstruction_failed:
    "局面・評価候補の照合で止まりました。保存済みJSONを保持しています。",
};
const label = (value) =>
  messages[value] || "操作を完了できませんでした。ページを確認してください。";
let busy = false,
  refreshing = false,
  loading = false;
let entries = [],
  batch = null,
  latestStatus = null;
let loadedKey = null,
  loadError = "",
  batchFeedback = "",
  feedback = "";
const selected = new Set();
const verified = (entry) => [9, 12, 16].includes(entry.history?.mode);
const locked = () => ["running", "paused"].includes(batch?.phase);
const currentKey = () =>
  `${batch?.id || "idle"}:${batch?.phase || "idle"}:${$("batch-model").value}`;
const shortStage = {
  waiting: "送信の準備中",
  submitting: "送信中",
  analysing: "解析中",
  saving: "保存中",
  saved: "登録中",
  registered: "登録済み",
};
const stopLabels = {
  local_unavailable: "KyokuLoopと接続できません",
  source_conflict: "対局情報が一致しません",
  invalid_report: "解析結果を確認できません",
  invalid_receipt: "登録完了を確認できません",
  reconstruction_failed: "局面の照合で停止しました",
  access_restricted: "アクセス制限で停止しました",
  human_confirmation: "Mortalで本人確認が必要です",
  browser_restarted: "再起動により停止しました",
  timeout: "待ち時間の上限に達しました",
};
function chooseDefault() {
  selected.clear();
  for (const entry of entries.filter(verified).slice(0, 20))
    selected.add(entry.id);
}
function entryLabel(entry) {
  const h = entry.history;
  const at = new Date(h?.at);
  if (!h?.at || !Number.isFinite(at.getTime()))
    return `日時不明 · ${entry.id.slice(-8)}`;
  const date = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(at);
  return `${date}${h.rank ? `　${h.rank}位` : ""}`;
}
function renderEntries() {
  $("batch-list").replaceChildren();
  for (const confirmed of [true, false]) {
    const group = entries.filter((e) => verified(e) === confirmed);
    if (!group.length) continue;
    if (!confirmed) {
      const title = document.createElement("p");
      title.className = "group-label";
      title.textContent = "四人半荘か確認して選択";
      $("batch-list").append(title);
    }
    for (const entry of group) {
      const row = document.createElement("label");
      row.className = "queue-entry";
      row.title = entry.id;
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = entry.id;
      input.checked = selected.has(entry.id);
      input.addEventListener("change", () => {
        batchFeedback = "";
        if (input.checked && selected.size >= 20) {
          input.checked = false;
          batchFeedback = "selection_limit";
        } else if (input.checked) selected.add(entry.id);
        else selected.delete(entry.id);
        render();
      });
      const text = document.createElement("span");
      text.textContent = entryLabel(entry);
      if (entry.reuse) {
        const reuse = document.createElement("small");
        reuse.textContent = "保存済み結果から登録";
        text.append(reuse);
      }
      row.append(input, text);
      $("batch-list").append(row);
    }
  }
}
function render() {
  const data = latestStatus || { jobs: [] };
  const running = batch?.phase === "running";
  const paused = batch?.phase === "paused";
  const done = batch?.phase === "done";
  const singleActive = data.jobs.find((j) =>
    ["waiting", "submitting", "analysing", "saving"].includes(j.phase),
  );
  const singleError =
    !locked() &&
    data.jobs.find(
      (j) =>
        j.tabId === data.tabId &&
        j.phase === "stopped" &&
        !["cancelled", "user_pause"].includes(j.reason),
    );
  const registered =
    batch?.items.filter((i) => i.status === "done").length || 0;
  const total = batch?.items.length || 0;
  const skipped =
    batch?.items.filter((i) => i.status === "skipped").length || 0;
  const count = $("batch-count");
  const notice = $("batch-notice");
  notice.textContent = "";
  if (running || paused) {
    count.textContent = paused
      ? `${registered} / ${total}件を登録して停止`
      : `登録完了 ${registered} / ${total}件`;
    if (paused)
      notice.textContent =
        batch.reason === "user_pause"
          ? "一時停止中"
          : stopLabels[batch.reason] || label(batch.reason);
    else {
      const item = batch.items[batch.index];
      const job = data.jobs.find((j) => j.id === item?.jobId);
      const stage =
        batch.nextAt > Date.now() && item?.status === "queued"
          ? `次の開始まで ${Math.ceil((batch.nextAt - Date.now()) / 1000)}秒`
          : `${Math.min(batch.index + 1, total)}件目を${shortStage[job?.phase] || "準備中"}`;
      notice.textContent =
        stage + (batch.stopAfterCurrent ? "\nこの1件の後に停止します" : "");
    }
    if (skipped) notice.textContent += `\nスキップ ${skipped}件`;
  } else if (singleActive) {
    count.textContent = "1件を保存中";
    notice.textContent = shortStage[singleActive.phase];
  } else if (loadError) {
    count.textContent = "読み込めませんでした";
    notice.textContent = ["open_kyokuloop_tab", "local_unavailable"].includes(
      loadError,
    )
      ? "同じブラウザでPCのKyokuLoopを開いてください"
      : label(loadError);
  } else if (done) {
    count.textContent = `${registered}件を登録しました`;
    if (skipped) notice.textContent = `スキップ ${skipped}件`;
  } else if (loading || loadedKey === null) count.textContent = "読み込み中";
  else {
    count.textContent = entries.length
      ? `未登録 ${entries.length}件`
      : "未解析の牌譜はありません";
    if (entries.length && !entries.some(verified))
      notice.textContent = "対象を変更して四人半荘を選んでください";
  }
  if (batchFeedback) notice.textContent = label(batchFeedback);
  const progress = $("batch-progress");
  progress.hidden = !(running || paused);
  progress.max = total || 1;
  progress.value = registered;
  const start = $("batch-start");
  start.hidden =
    running ||
    !!singleActive ||
    (paused ? !data.resumeAllowed : !entries.length || !!loadError || loading);
  start.textContent = paused
    ? data.hasPendingPayload
      ? "登録を再開"
      : "続きから再開"
    : `${done ? "次の" : ""}${selected.size}件を解析・登録`;
  start.disabled =
    busy ||
    loading ||
    (paused ? !data.resumeAllowed : selected.size === 0 || selected.size > 20);
  const stop = $("batch-stop");
  stop.hidden = !running;
  stop.textContent = batch?.stopAfterCurrent
    ? "この1件の後に停止"
    : "この1件で止める";
  stop.disabled = busy || !!batch?.stopAfterCurrent;
  $("open-app").hidden = !(
    done ||
    !!loadError ||
    (!locked() && loadedKey !== null && !loading && !entries.length) ||
    (paused && batch.reason === "local_unavailable")
  );
  $("retry-load").hidden = !loadError || locked();
  $("retry-load").disabled = busy || loading;
  $("batch-model").disabled = busy || loading || locked() || !!singleActive;
  $("batch-load").disabled = busy || loading || locked() || !!singleActive;
  $("end-batch").hidden = !paused;
  $("end-batch").disabled = busy || data.hasPendingPayload || !!singleActive;
  const targets = $("targets");
  targets.hidden =
    locked() || !!singleActive || !entries.length || !!loadError || loading;
  if (targets.hidden) targets.open = false;
  $("selection-count").textContent = `${selected.size} / 20件を選択`;
  for (const input of $("batch-list").querySelectorAll("input")) {
    input.checked = selected.has(input.value);
    input.disabled = busy || loading || locked();
  }
  $("select-default").disabled = busy || loading || !entries.some(verified);
  $("select-none").disabled = busy || loading || !selected.size;
  const showError = (paused && batch.reason !== "user_pause") || !!singleError;
  $("copy-diagnostics").hidden = !showError;
  $("copy-diagnostics").disabled = !latestStatus;
  if (!showError) {
    $("copy-notice").textContent = "";
    $("diagnostics-text").hidden = true;
  }
}
async function loadEntries() {
  if (loading || locked()) return;
  loading = true;
  loadError = "";
  loadedKey = currentKey(); // Retry only on request or a new state, never each poll.
  render();
  try {
    const result = await chrome.runtime.sendMessage({
      type: "BATCH_LOAD",
      model: $("batch-model").value,
    });
    if (result.error) throw Error(result.error);
    entries = result.entries
      .filter((e) => e.available)
      .sort((a, b) => {
        const aTime = Date.parse(a.history?.at),
          bTime = Date.parse(b.history?.at);
        return (
          (Number.isFinite(aTime) ? aTime : Infinity) -
          (Number.isFinite(bTime) ? bTime : Infinity)
        );
      });
    chooseDefault();
  } catch (error) {
    entries = [];
    selected.clear();
    loadError = messages[error.message] ? error.message : "operation_failed";
  } finally {
    loading = false;
    renderEntries();
    render();
  }
}
function renderTools(data) {
  const active = data.jobs.find((j) =>
    ["waiting", "submitting", "analysing", "saving"].includes(j.phase),
  );
  const current = data.jobs.find((j) => j.tabId === data.tabId);
  const s = data.snapshot;
  const target = s?.source ? s : current;
  $("selection").textContent = target?.source
    ? `${target.source}\nMortal ${target.model}`
    : "URL入力済みのMortalページを開いてください";
  $("start").disabled = busy || !s?.source || !!s.error || !!active || locked();
  $("cancel").disabled =
    busy || !active || active.tabId !== data.tabId || locked();
  $("notice").textContent =
    feedback ||
    (current
      ? `${label(current.phase)}${current.reason ? `：${label(current.reason)}` : ""}`
      : s?.error
        ? label(s.error)
        : "");
  $("export").disabled = !data.jobs.length;
  $("history").replaceChildren();
  for (const job of data.jobs) {
    const box = document.createElement("div");
    box.className = "record";
    for (const value of [
      label(job.phase),
      job.reason ? label(job.reason) : "",
      `元URL：${job.source}`,
      `モデル：${job.model}`,
      job.task ? `結果ID：${job.task}` : "",
      job.filename ? `保存先：${job.filename}` : "",
    ].filter(Boolean)) {
      const p = document.createElement("p");
      p.textContent = value;
      box.append(p);
    }
    $("history").append(box);
  }
}
export async function refresh() {
  if (busy || refreshing || loading) return;
  refreshing = true;
  try {
    const data = await chrome.runtime.sendMessage({ type: "STATUS" });
    if (data.error) throw Error(data.error);
    latestStatus = data;
    batch = data.batch;
    if (locked())
      $("batch-model").value = batch.model || $("batch-model").value;
    if (!locked() && loadedKey !== currentKey()) await loadEntries();
    renderTools(data);
    render();
  } catch (error) {
    loadError = messages[error.message] ? error.message : "operation_failed";
    render();
  } finally {
    refreshing = false;
  }
}
async function batchAction(type) {
  if (busy || loading) return;
  busy = true;
  batchFeedback = "";
  render();
  try {
    const result = await chrome.runtime.sendMessage({
      type,
      model: $("batch-model").value,
      ids: [...selected],
    });
    if (result.error) batchFeedback = result.error;
    else if (type === "BATCH_START" || type === "BATCH_RESUME") {
      $("tools").open = false;
      $("targets").open = false;
    }
  } catch {
    batchFeedback = "operation_failed";
  } finally {
    busy = false;
  }
  await refresh();
}
$("batch-load").addEventListener("click", () => {
  batchFeedback = "";
  void loadEntries();
});
$("retry-load").addEventListener("click", () => {
  batchFeedback = "";
  void loadEntries();
});
$("batch-start").addEventListener(
  "click",
  () =>
    void batchAction(
      batch?.phase === "paused" ? "BATCH_RESUME" : "BATCH_START",
    ),
);
$("batch-stop").addEventListener("click", () => void batchAction("BATCH_STOP"));
$("end-batch").addEventListener("click", () => void batchAction("BATCH_END"));
$("open-app").addEventListener("click", async () => {
  try {
    const result = await chrome.runtime.sendMessage({ type: "OPEN_APP" });
    if (result.error) throw Error(result.error);
  } catch {
    batchFeedback = "operation_failed";
    render();
  }
});
$("select-default").addEventListener("click", () => {
  batchFeedback = "";
  chooseDefault();
  render();
});
$("select-none").addEventListener("click", () => {
  batchFeedback = "";
  selected.clear();
  render();
});
$("batch-model").addEventListener("change", async () => {
  try {
    await chrome.storage.local.set({ popupModel: $("batch-model").value });
    batchFeedback = "";
    await loadEntries();
  } catch {
    batchFeedback = "operation_failed";
    render();
  }
});
async function action(type) {
  if (busy) return;
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
$("copy-diagnostics").addEventListener("click", async () => {
  if (!latestStatus) return;
  const text = diagnosticText(
    latestStatus,
    chrome.runtime.getManifest().version_name,
    label,
  );
  const fallback = $("diagnostics-text");
  fallback.hidden = true;
  try {
    // Keep this write in the user's click, without fetching or asking permission.
    await navigator.clipboard.writeText(text);
    $("copy-notice").textContent = "コピーしました";
  } catch {
    fallback.value = text;
    fallback.hidden = false;
    fallback.focus();
    fallback.select();
    $("copy-notice").textContent = "Ctrl+Cでコピーできます";
  }
});
$("version").textContent = chrome.runtime.getManifest().version_name;
async function initialize() {
  try {
    const { popupModel } = await chrome.storage.local.get("popupModel");
    if (["4.1a", "4.1b", "4.1c", "4.0", "3.0"].includes(popupModel))
      $("batch-model").value = popupModel;
  } catch {
    /* Default to 4.1b without modifying the processing ledger. */
  }
  await refresh();
  setInterval(() => void refresh(), 1000);
}
void initialize();
