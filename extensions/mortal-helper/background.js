import { Helper, active, MAX_BYTES, route } from "./core.js";

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
  if (job)
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
  serial(async () => {
    if (popupSender(sender)) {
      await expireJobs();
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
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
        };
      }
      if (message.type === "START") {
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
        const response = await helper.tick({
          tabId: sender.tab.id,
          documentId: sender.documentId,
          url: sender.url,
          snapshot: message.snapshot,
        });
        if (response.action === "download") await save(response);
        return response;
      }
      if (
        message.type === "STOP" &&
        ["form_changed", "manual_submission"].includes(message.reason)
      ) {
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
  })
    .then(async (value) => {
      await refresh();
      respond(value);
    })
    .catch((error) => respond({ error: error.message || "operation_failed" }));
  return true;
});
chrome.webNavigation.onCommitted.addListener((detail) => {
  void serial(async () => {
    await helper.navigate(detail);
    await refresh();
  }).catch(() => {});
});
chrome.webNavigation.onErrorOccurred.addListener((detail) => {
  if (detail.frameId === 0)
    void serial(async () => {
      await helper.stopTab(detail.tabId, "navigation_failed");
      await refresh();
    }).catch(() => {});
});
chrome.tabs.onRemoved.addListener((tabId) => {
  void serial(async () => {
    await helper.stopTab(tabId, "tab_closed");
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
    await refresh();
  }).catch(() => {});
});
async function endInterrupted() {
  await serial(async () => {
    for (const j of (await helper.state()).jobs.filter(active)) {
      await helper.stopTab(j.tabId, "browser_restarted");
      await cancelDownload(j.downloadId);
    }
    await refresh();
  });
}
chrome.runtime.onStartup.addListener(() => {
  void endInterrupted().catch(() => {});
});
chrome.runtime.onInstalled.addListener(() => {
  void endInterrupted().catch(() => {});
});
