import { Helper, active, MAX_BYTES, route } from "./core.js";
import { APP, BatchRunner, choices } from "./batch.js";
import {
  pendingPayload,
  getPayload,
  putPayload,
  removePayload,
} from "./payloads.js";

const ready = chrome.storage.local.setAccessLevel({
  accessLevel: "TRUSTED_CONTEXTS",
});
const helper = new Helper({
  read: async () => {
    await ready;
    const { state } = await chrome.storage.local.get("state");
    if (state && (!Array.isArray(state.jobs) || state.jobs.length > 1000))
      throw Error("invalid_storage");
    return state || { jobs: [] };
  },
  write: async (state) => {
    await ready;
    await chrome.storage.local.set({ state });
  },
});
const isAppURL = (value) => {
  try {
    const u = new URL(value);
    return u.origin === APP && u.pathname === "/" && !u.username && !u.password;
  } catch {
    return false;
  }
};
async function appCall(tabId, message) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!isAppURL(tab.url)) throw Error("local_unavailable");
    let ping;
    try {
      ping = await chrome.tabs.sendMessage(
        tabId,
        { type: "APP_PING" },
        { frameId: 0 },
      );
    } catch {
      /* Install only our isolated bridge, retaining the app's current UI. */
    }
    if (!ping?.ok)
      await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        files: ["app-content.js"],
      });
    const frame = await chrome.webNavigation.getFrame({ tabId, frameId: 0 });
    if (!frame?.documentId || !isAppURL(frame.url))
      throw Error("local_unavailable");
    const result = await chrome.tabs.sendMessage(tabId, message, {
      documentId: frame.documentId,
    });
    if (!result?.ok) throw Error(result?.error || "local_unavailable");
    return result.data;
  } catch (e) {
    throw Error(
      /^[a-z_]{1,60}$/.test(e.message) ? e.message : "local_unavailable",
    );
  }
}
async function findApp() {
  const [current] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (isAppURL(current?.url)) return current.id;
  const tabs = (await chrome.tabs.query({ url: APP + "/*" })).filter((t) =>
    isAppURL(t.url),
  );
  if (tabs.length !== 1) throw Error("open_kyokuloop_tab");
  return tabs[0].id;
}
const batch = new BatchRunner(helper, {
  now: () => Date.now(),
  list: (tabId) => appCall(tabId, { type: "APP_LIST" }),
  pending: pendingPayload,
  get: getPayload,
  put: putPayload,
  remove: removePayload,
  open: async (url, previous) => {
    if (!previous) return chrome.tabs.create({ url, active: true });
    let tab;
    try {
      tab = await chrome.tabs.get(previous);
    } catch {
      throw Error("tab_closed");
    }
    const page = route(tab.url),
      state = await helper.state(),
      b = state.batch;
    const current = b.items[b.index];
    const previousTasks = state.jobs
      .filter((j) => b.items.some((i) => i.jobId === j.id))
      .map((j) => j.task);
    if (
      !(page?.kind === "result" && previousTasks.includes(page.task)) &&
      !(page?.kind === "input" && page.source === current.url)
    )
      throw Error("page_changed");
    return chrome.tabs.update(previous, { url });
  },
  read: async (job, documentId) => {
    if (!documentId) throw Error("wrong_result");
    let result;
    try {
      result = await chrome.tabs.sendMessage(
        job.tabId,
        { type: "READ_REPORT", task: job.task, model: job.model },
        { documentId },
      );
    } catch {
      throw Error("report_read_failed");
    }
    if (!result?.ok) throw Error(result?.error || "report_read_failed");
    return {
      jobId: job.id,
      source: job.source,
      task: job.task,
      model: job.model,
      data: result.data,
      hash: result.hash,
    };
  },
  register: (tabId, job, payload) =>
    appCall(tabId, {
      type: "APP_IMPORT",
      source: job.source,
      model: job.model,
      data: payload.data,
    }),
});
let pending = Promise.resolve();
const serial = (fn) => {
  const run = pending.then(fn);
  pending = run.catch(() => {});
  return run;
};
async function cancelDownload(id) {
  if (!Number.isInteger(id)) return;
  try {
    await chrome.downloads.cancel(id);
  } catch {
    /* Already completed; never remove a saved file. */
  }
}
async function expireJobs() {
  const overdue = (await helper.state()).jobs.filter(
    (j) => active(j) && Date.now() > j.expires,
  );
  await helper.expire();
  for (const j of overdue) await cancelDownload(j.downloadId);
}
async function refresh() {
  const { jobs } = await helper.state();
  const job = jobs.find(active);
  await chrome.action.setBadgeText({ text: job ? "処理中" : "" });
  if (job || (await helper.state()).batch?.phase === "running")
    await chrome.alarms.create("mortal-helper-expiry", {
      periodInMinutes: 0.5,
    });
  else await chrome.alarms.clear("mortal-helper-expiry");
}
async function finishDownload(item) {
  if (!item) return;
  if (
    Math.max(
      item.fileSize || 0,
      item.totalBytes || 0,
      item.bytesReceived || 0,
    ) > MAX_BYTES &&
    item.state === "in_progress"
  ) {
    await chrome.downloads.cancel(item.id);
    await helper.downloadFinished({ ...item, state: "interrupted" });
  } else await helper.downloadFinished(item);
}
async function save(grant) {
  try {
    const id = await chrome.downloads.download({
      url: grant.url,
      filename: grant.filename,
      conflictAction: "uniquify",
      saveAs: false,
    });
    await helper.downloadStarted(grant.id, id);
    await finishDownload((await chrome.downloads.search({ id }))[0]);
  } catch {
    const { jobs } = await helper.state();
    const job = jobs.find((j) => j.id === grant.id);
    if (job) await helper.stopTab(job.tabId, "download_failed");
  }
}
const pageSender = (sender) =>
  sender.id === chrome.runtime.id &&
  sender.frameId === 0 &&
  Number.isInteger(sender.tab?.id) &&
  route(sender.url);
const popupSender = (sender) =>
  sender.id === chrome.runtime.id &&
  sender.url === chrome.runtime.getURL("popup.html");

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const dispatch = async () => {
    if (popupSender(sender)) {
      await expireJobs();
      if (message.type === "BATCH_LOAD") {
        const appTabId = await findApp();
        const state = await helper.state();
        return {
          entries: choices(
            await appCall(appTabId, { type: "APP_LIST" }),
            state.jobs,
            message.model || "4.1b",
            state.blocks,
          ),
        };
      }
      if (message.type === "BATCH_START") {
        await batch.start(message.ids, await findApp(), message.model);
        return { ok: true };
      }
      if (message.type === "BATCH_STOP") {
        await batch.stop();
        return { ok: true };
      }
      if (message.type === "BATCH_RESUME") {
        await batch.resume(await findApp());
        return { ok: true };
      }
      if (message.type === "BATCH_END") {
        await batch.end();
        return { ok: true };
      }
      if (message.type === "OPEN_APP") {
        const tabs = (await chrome.tabs.query({ url: APP + "/*" })).filter(
          (t) => isAppURL(t.url),
        );
        if (tabs.length) {
          await chrome.tabs.update(tabs[0].id, { active: true });
          await chrome.windows.update(tabs[0].windowId, { focused: true });
        } else await chrome.tabs.create({ url: APP + "/", active: true });
        return { ok: true };
      }
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (message.type === "RECOVER_MANUAL_RESULT") {
        if (!(await batch.canRecoverManual())) throw Error("manual_submission");
        const page = route(tab?.url);
        if (page?.kind !== "result" || page.task !== message.expectedTask)
          throw Error("wrong_result");
        let frame = await chrome.webNavigation.getFrame({
          tabId: tab.id,
          frameId: 0,
        });
        if (!frame?.documentId || frame.url !== tab.url)
          throw Error("page_changed");
        let snapshot;
        try {
          snapshot = await chrome.tabs.sendMessage(
            tab.id,
            { type: "INSPECT" },
            { documentId: frame.documentId },
          );
        } catch {
          /* Reloading the extension can leave this existing page without its bridge. */
        }
        if (!snapshot) {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id, frameIds: [0] },
            files: ["inspector.js", "content.js"],
          });
          const current = await chrome.webNavigation.getFrame({
            tabId: tab.id,
            frameId: 0,
          });
          if (
            current?.documentId !== frame.documentId ||
            current.url !== tab.url
          )
            throw Error("page_changed");
          snapshot = await chrome.tabs.sendMessage(
            tab.id,
            { type: "INSPECT" },
            { documentId: frame.documentId },
          );
        }
        if (snapshot?.error) {
          if (snapshot.error === "access_restricted")
            await batch.pause("access_restricted");
          throw Error(snapshot.error);
        }
        if (!snapshot?.resultReady) throw Error("result_not_ready");
        await batch.recoverManual(
          { tabId: tab.id, documentId: frame.documentId, url: tab.url },
          await findApp(),
          message.expectedTask,
        );
        try {
          await chrome.tabs.sendMessage(
            tab.id,
            { type: "WAKE" },
            { documentId: frame.documentId },
          );
        } catch {
          await helper.stopTab(tab.id, "page_changed");
          await batch.pause("page_changed");
          throw Error("page_changed");
        }
        return { ok: true };
      }
      if (message.type === "STATUS") {
        let snapshot = null;
        if (route(tab?.url)?.kind === "input") {
          try {
            snapshot = await chrome.tabs.sendMessage(
              tab.id,
              { type: "INSPECT" },
              { frameId: 0 },
            );
          } catch {
            /* Page may need reloading after initial installation. */
          }
        }
        return {
          tabId: tab?.id,
          snapshot,
          jobs: (await helper.state()).jobs.slice(-20).reverse(),
          batch: (await helper.state()).batch || null,
          hasPendingPayload: !!(await pendingPayload()),
          resumeAllowed: await batch.canResume(),
          manualRecoveryAllowed: await batch.canRecoverManual(),
          recoveryTask:
            route(tab?.url)?.kind === "result" ? route(tab.url).task : null,
        };
      }
      if (message.type === "START") {
        if (["running", "paused"].includes((await helper.state()).batch?.phase))
          throw Error("another_job_running");
        if (route(tab?.url)?.kind !== "input") throw Error("wrong_page");
        const frame = await chrome.webNavigation.getFrame({
          tabId: tab.id,
          frameId: 0,
        });
        if (!frame?.documentId || frame.url !== tab.url)
          throw Error("page_changed");
        const snapshot = await chrome.tabs.sendMessage(
          tab.id,
          { type: "INSPECT" },
          { documentId: frame.documentId },
        );
        const blocked = (await helper.state()).blocks?.[snapshot?.source];
        if (blocked) throw Error(blocked);
        const job = await helper.start({
          tabId: tab.id,
          documentId: frame.documentId,
          url: frame.url,
          snapshot,
        });
        try {
          await chrome.tabs.sendMessage(
            tab.id,
            { type: "WAKE" },
            { documentId: frame.documentId },
          );
        } catch {
          await helper.stopTab(tab.id, "page_changed");
          throw Error("page_changed");
        }
        return { ok: true, id: job.id };
      }
      if (message.type === "CANCEL") {
        if ((await helper.state()).batch?.phase === "running")
          throw Error("another_job_running");
        const job = (await helper.state()).jobs.find(
          (j) => j.tabId === tab?.id && active(j),
        );
        await helper.stopTab(tab?.id, "cancelled");
        await cancelDownload(job?.downloadId);
        return { ok: true };
      }
      if (message.type === "EXPORT") {
        const jobs = (await helper.state()).jobs.map(
          ({
            source,
            model,
            player,
            task,
            report,
            phase,
            reason,
            created,
            saved,
            filename,
          }) => ({
            source,
            model,
            player,
            task,
            report,
            phase,
            reason,
            created,
            saved,
            filename,
          }),
        );
        const body = JSON.stringify(
          { format: "kyokuloop-mortal-correspondence", version: 1, jobs },
          null,
          2,
        );
        await chrome.downloads.download({
          url: `data:text/plain;charset=utf-8,${encodeURIComponent(body)}`,
          filename: `KyokuLoop-Mortal/correspondence-${Date.now()}.txt`,
          conflictAction: "uniquify",
          saveAs: false,
        });
        return { ok: true };
      }
    } else if (pageSender(sender)) {
      if (message.type === "TICK") {
        await expireJobs();
        const input = {
          tabId: sender.tab.id,
          documentId: sender.documentId,
          url: sender.url,
          snapshot: message.snapshot,
        };
        const response =
          (await batch.tick(input)) || (await helper.tick(input));
        if (response.action === "download") await save(response);
        return response;
      }
      if (
        message.type === "STOP" &&
        ["form_changed", "manual_submission"].includes(message.reason)
      ) {
        const b = (await helper.state()).batch;
        if (
          ["running", "paused"].includes(b?.phase) &&
          b.tabId === sender.tab.id &&
          b.items[b.index]?.documentId === sender.documentId
        )
          await batch.pause(message.reason);
        if (
          (await helper.state()).jobs.some(
            (j) =>
              active(j) &&
              j.tabId === sender.tab.id &&
              j.documentId === sender.documentId,
          )
        )
          await helper.stopTab(sender.tab.id, message.reason);
        return { ok: true };
      }
    }
    throw Error("invalid_message");
  };
  serial(async () => {
    const value = await dispatch();
    await batch.drive();
    await refresh();
    return value;
  })
    .then(respond)
    .catch((error) => respond({ error: error.message || "operation_failed" }));
  return true;
});
chrome.webNavigation.onCommitted.addListener((detail) => {
  void serial(async () => {
    await helper.navigate(detail);
    await batch.navigation(detail);
    await batch.drive();
    await refresh();
  }).catch(() => {});
});
chrome.webNavigation.onErrorOccurred.addListener((detail) => {
  if (detail.frameId === 0)
    void serial(async () => {
      await helper.stopTab(detail.tabId, "navigation_failed");
      if ((await helper.state()).batch?.tabId === detail.tabId)
        await batch.pause("navigation_failed");
      await refresh();
    }).catch(() => {});
});
chrome.tabs.onRemoved.addListener((tabId) => {
  void serial(async () => {
    await helper.stopTab(tabId, "tab_closed");
    const b = (await helper.state()).batch;
    if (b?.tabId === tabId || b?.appTabId === tabId)
      await batch.pause("tab_closed");
    await refresh();
  }).catch(() => {});
});
chrome.downloads.onChanged.addListener((delta) => {
  void serial(async () => {
    if (
      !(await helper.state()).jobs.some(
        (j) => j.downloadId === delta.id && j.phase === "saving",
      )
    )
      return;
    await finishDownload((await chrome.downloads.search({ id: delta.id }))[0]);
    await batch.drive();
    await refresh();
  }).catch(() => {});
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "mortal-helper-expiry") return;
  void serial(async () => {
    for (const j of (await helper.state()).jobs.filter(
      (j) => j.phase === "saving" && Number.isInteger(j.downloadId),
    ))
      await finishDownload(
        (await chrome.downloads.search({ id: j.downloadId }))[0],
      );
    await expireJobs();
    await batch.drive();
    await refresh();
  }).catch(() => {});
});
async function endInterrupted() {
  await serial(async () => {
    for (const j of (await helper.state()).jobs.filter(active)) {
      await helper.stopTab(j.tabId, "browser_restarted");
      await cancelDownload(j.downloadId);
    }
    await batch.pause("browser_restarted");
    await refresh();
  });
}
chrome.runtime.onStartup.addListener(() => {
  void endInterrupted().catch(() => {});
});
chrome.runtime.onInstalled.addListener(() => {
  void endInterrupted().catch(() => {});
});
