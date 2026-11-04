export const ORIGIN = "https://mjai.ekyu.moe";
export const MAX_BYTES = 20 * 1024 * 1024;
export const active = (job) =>
  ["waiting", "submitting", "analysing", "saving"].includes(job.phase);

export function route(value) {
  try {
    const u = new URL(value);
    if (u.origin !== ORIGIN || u.username || u.password || u.hash) return null;
    const keys = [...u.searchParams.keys()];
    if (u.pathname === "/review" && !keys.length) return { kind: "submitted" };
    if (
      ["/", "/ja.html", "/en.html"].includes(u.pathname) &&
      (keys.length === 0 || (keys.length === 1 && keys[0] === "url"))
    )
      return { kind: "input", source: u.searchParams.get("url") };
    if (
      u.pathname === "/progress" &&
      keys.length === 1 &&
      keys[0] === "task" &&
      /^[a-f0-9]{16}$/.test(u.searchParams.get("task"))
    )
      return { kind: "progress", task: u.searchParams.get("task") };
    if (
      u.pathname === "/killerducky/" &&
      keys.length === 1 &&
      keys[0] === "data"
    ) {
      const m = /^\/report\/([a-f0-9]{16})\.json$/.exec(
        u.searchParams.get("data"),
      );
      if (m) return { kind: "result", task: m[1], report: ORIGIN + m[0] };
    }
  } catch {
    /* Untrusted URLs are rejected as a whole. */
  }
  return null;
}
function validate(snapshot) {
  const s = snapshot;
  if (
    !s ||
    s.error ||
    !s.valid ||
    !/^https:\/\/game\.mahjongsoul\.com\/\?paipu=[A-Za-z0-9_-]{10,200}$/.test(
      s.source,
    ) ||
    s.engine !== "mortal" ||
    s.ui !== "killerducky" ||
    !/^[A-Za-z0-9._-]{1,32}$/.test(s.model) ||
    !/^(?:|[0-3])$/.test(s.player) ||
    (!s.player && !/_a\d+$/.test(s.source)) ||
    (s.temperature !== "" &&
      (!/^\d+(?:\.\d+)?$/.test(s.temperature) ||
        +s.temperature <= 0 ||
        +s.temperature > 10)) ||
    typeof s.kyokus !== "string" ||
    s.kyokus.length > 256 ||
    !/^[a-zA-Z0-9.,\s-]*$/.test(s.kyokus)
  )
    throw Error(s?.error || "invalid_form");
}
export const fingerprint = (s) =>
  JSON.stringify([
    s.source,
    s.engine,
    s.model,
    s.player,
    s.ui,
    s.temperature,
    s.kyokus,
    !!s.rating,
  ]);
const stop = (job, reason) => {
  job.phase = "stopped";
  job.reason = reason;
};

// All callers serialize operations. Persist grants before returning them: a worker
// restart may leave an uncertain operation, but must never repeat a submission.
export class Helper {
  constructor(io) {
    this.io = io;
  }
  async state() {
    return (await this.io.read()) || { jobs: [] };
  }
  async start({ tabId, documentId, url, snapshot }, now = Date.now()) {
    const page = route(url);
    if (page?.kind !== "input" || !Number.isInteger(tabId) || !documentId)
      throw Error("wrong_page");
    validate(snapshot);
    if (page.source && page.source !== snapshot.source)
      throw Error("source_changed");
    const data = await this.state();
    if (data.jobs.some(active)) throw Error("another_job_running");
    const key = fingerprint(snapshot);
    if (
      data.jobs.some(
        (j) => j.key === key && (j.claimed || j.reason === "access_restricted"),
      )
    )
      throw Error("already_attempted");
    if (data.jobs.length >= 1000) throw Error("history_full");
    const job = {
      id: crypto.randomUUID(),
      tabId,
      documentId,
      key,
      source: snapshot.source,
      model: snapshot.model,
      player: snapshot.player,
      phase: "waiting",
      created: now,
      expires: now + 45000,
      claimed: false,
    };
    data.jobs.push(job);
    await this.io.write(data);
    return job;
  }
  async tick({ tabId, documentId, url, snapshot }, now = Date.now()) {
    const data = await this.state();
    const job = data.jobs.find((j) => j.tabId === tabId && active(j));
    if (!job) return { action: "idle" };
    if (now > job.expires) stop(job, "timeout");
    else if (documentId !== job.documentId) {
      if (job.phase === "waiting") stop(job, "page_changed");
      else return { action: "idle" }; // A late message from the previous document cannot affect the next one.
    } else if (snapshot?.error) stop(job, snapshot.error);
    else if (job.phase === "waiting") {
      const page = route(url);
      try {
        validate(snapshot);
      } catch (e) {
        stop(job, e.message);
      }
      if (
        active(job) &&
        (page?.kind !== "input" || fingerprint(snapshot) !== job.key)
      )
        stop(job, "form_changed");
      if (active(job) && snapshot.ready) {
        job.phase = "submitting";
        job.claimed = true;
        job.expires = now + 180000;
        await this.io.write(data);
        return { action: "click", id: job.id, key: job.key };
      }
    } else if (job.phase === "analysing") {
      const page = route(url);
      if (!page || page.task !== job.task) stop(job, "wrong_result");
      else if (page.kind === "result" && snapshot?.resultReady) {
        job.phase = "saving";
        job.report = page.report;
        job.expires = now + 120000;
        await this.io.write(data);
        return {
          action: "download",
          id: job.id,
          url: page.report,
          filename: `KyokuLoop-Mortal/${job.task}.json`,
        };
      }
    }
    if (!active(job)) {
      await this.io.write(data);
      return { action: "stop", reason: job.reason };
    }
    return { action: "wait" };
  }
  async navigate(detail, now = Date.now()) {
    if (detail.frameId !== 0) return;
    const data = await this.state();
    const job = data.jobs.find((j) => j.tabId === detail.tabId && active(j));
    if (!job) return;
    const page = route(detail.url);
    if (
      job.phase === "submitting" &&
      page?.kind === "submitted" &&
      detail.transitionType === "form_submit"
    ) {
      job.responseDocument = detail.documentId;
      job.documentId = detail.documentId;
    } else if (
      job.phase === "submitting" &&
      ["progress", "result"].includes(page?.kind) &&
      (detail.transitionType === "form_submit" ||
        (job.responseDocument &&
          detail.transitionQualifiers?.includes("client_redirect")))
    ) {
      job.task = page.task;
      job.phase = "analysing";
      job.documentId = detail.documentId;
      job.expires = now + 180000;
    } else if (job.phase === "analysing" && page?.task === job.task)
      job.documentId = detail.documentId;
    else stop(job, "page_changed");
    await this.io.write(data);
  }
  async stopTab(tabId, reason) {
    const data = await this.state();
    for (const job of data.jobs.filter((j) => j.tabId === tabId && active(j)))
      stop(job, reason);
    await this.io.write(data);
  }
  async expire(now = Date.now()) {
    const data = await this.state();
    let changed = false;
    for (const job of data.jobs.filter((j) => active(j) && now > j.expires)) {
      stop(job, "timeout");
      changed = true;
    }
    if (changed) await this.io.write(data);
  }
  async downloadStarted(id, downloadId) {
    const data = await this.state();
    const job = data.jobs.find((j) => j.id === id);
    if (!job || job.phase !== "saving" || !Number.isInteger(downloadId))
      throw Error("download_state_changed");
    job.downloadId = downloadId;
    await this.io.write(data);
  }
  async downloadFinished(item) {
    const data = await this.state();
    const job = data.jobs.find(
      (j) => j.downloadId === item.id && j.phase === "saving",
    );
    if (!job || item.state === "in_progress") return;
    if (
      item.state !== "complete" ||
      item.url !== job.report ||
      item.finalUrl !== job.report ||
      !Number.isSafeInteger(item.fileSize) ||
      item.fileSize <= 0 ||
      item.fileSize > MAX_BYTES ||
      ![
        "application/json",
        "application/octet-stream",
        "application/gzip",
        "application/x-gzip",
      ].includes(item.mime?.split(";")[0].trim())
    )
      stop(job, "download_failed");
    else {
      job.phase = "saved";
      job.filename = item.filename;
      job.saved = Date.now();
    }
    await this.io.write(data);
  }
}
