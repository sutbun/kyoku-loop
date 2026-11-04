import { active, route, ORIGIN, fingerprint } from "./core.js";
export const APP = "http://127.0.0.1:1460";
export const MAX_BATCH = 20;
export const COOLDOWN = 30000;
const sourceOK = (value) =>
  typeof value === "string" &&
  /^https:\/\/game\.mahjongsoul\.com\/\?paipu=[A-Za-z0-9_-]{10,200}_a\d+$/.test(
    value,
  );
export function choices(entries, jobs, model, blocks = {}) {
  return entries.map((entry) => {
    let reason = null;
    const previous = [...jobs]
      .reverse()
      .find((j) => j.source === entry.url && j.claimed);
    if (!sourceOK(entry.url) || entry.id !== entry.url.split("paipu=")[1])
      reason = "invalid_source";
    else if (blocks[entry.url]) reason = blocks[entry.url];
    else if (entry.reports?.length) reason = "already_registered";
    else if ([8, 11, 15].includes(entry.history?.mode))
      reason = "unsupported_rule";
    else if (
      previous &&
      (previous.phase !== "saved" ||
        previous.model !== model ||
        previous.key !== fingerprint(batchSnapshot(entry.url, model)) ||
        previous.transferError === "access_restricted" ||
        previous.transferError === "invalid_report")
    )
      reason = "already_attempted";
    else if (entry.requested && !previous) reason = "already_attempted";
    return {
      id: entry.id,
      url: entry.url,
      history: entry.history,
      available: !reason,
      reason,
      reuse: previous?.phase === "saved" ? previous.id : null,
    };
  });
}
export function batchSnapshot(source, model) {
  return {
    source,
    engine: "mortal",
    model,
    player: "",
    ui: "killerducky",
    temperature: "",
    kyokus: "",
    rating: false,
  };
}

// The background worker serializes all calls, including the existing Helper.
// Effects are granted durably before sending/reading. Registration is retriable
// only from retained bytes, and a local ACK never grants a second analysis.
export class BatchRunner {
  constructor(helper, host) {
    this.helper = helper;
    this.host = host;
  }
  async state() {
    return this.helper.state();
  }
  async save(data) {
    await this.helper.io.write(data);
  }
  async pause(reason) {
    const data = await this.state();
    if (["running", "paused"].includes(data.batch?.phase)) {
      if (data.batch.phase === "paused" && reason === "browser_restarted")
        return;
      if (["access_restricted", "manual_submission"].includes(reason)) {
        const source = data.batch.items[data.batch.index]?.url;
        data.blocks ??= {};
        if (source) data.blocks[source] = reason;
      }
      data.batch.phase = "paused";
      data.batch.reason = reason;
      await this.save(data);
    }
  }
  async start(ids, appTabId, model) {
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > MAX_BATCH ||
      new Set(ids).size !== ids.length ||
      !["4.1a", "4.1b", "4.1c", "4.0", "3.0"].includes(model)
    )
      throw Error("batch_limit");
    const data = await this.state();
    if (
      data.jobs.some(active) ||
      ["running", "paused"].includes(data.batch?.phase)
    )
      throw Error("another_job_running");
    const pending = await this.host.pending();
    if (pending) {
      const j = data.jobs.find((j) => j.id === pending.jobId);
      if (j?.phase === "registered") await this.host.remove(j.id);
      else throw Error("pending_registration");
    }
    const list = choices(
      await this.host.list(appTabId),
      data.jobs,
      model,
      data.blocks,
    );
    const selected = ids.map((id) => list.find((e) => e.id === id));
    if (selected.some((e) => !e?.available)) throw Error("queue_changed");
    data.batch = {
      id: crypto.randomUUID(),
      phase: "running",
      model,
      appTabId,
      index: 0,
      nextAt: 0,
      created: this.host.now(),
      items: selected.map((e) => ({ ...e, status: "queued" })),
    };
    await this.save(data);
  }
  async stop() {
    const data = await this.state();
    const b = data.batch;
    if (!b || b.phase !== "running") return;
    const item = b.items[b.index];
    const job = data.jobs.find((j) => j.id === item?.jobId);
    if (job?.claimed && !["stopped", "registered"].includes(job.phase))
      b.stopAfterCurrent = true;
    else {
      b.phase = "paused";
      b.reason = "user_pause";
    }
    await this.save(data);
    if (job && !job.claimed) await this.helper.stopTab(job.tabId, "cancelled");
  }
  async resumeContext() {
    const data = await this.state();
    const b = data.batch;
    if (!b || b.phase !== "paused" || data.jobs.some(active))
      throw Error("another_job_running");
    const item = b.items[b.index];
    const job = data.jobs.find((j) => j.id === item?.jobId);
    if (
      ["access_restricted", "invalid_report", "payload_missing"].includes(
        b.reason,
      )
    )
      throw Error(b.reason);
    const cached = job ? await this.host.get(job.id) : null;
    if (!cached && data.blocks?.[item?.url]) throw Error(data.blocks[item.url]);
    if (
      job?.claimed &&
      job.phase !== "registered" &&
      !cached &&
      (job.phase !== "saved" || job.transferAttempted)
    )
      throw Error("submission_uncertain");
    return { data, b, item, job, cached };
  }
  async canResume() {
    try {
      await this.resumeContext();
      return true;
    } catch {
      return false;
    }
  }
  async manualRecoveryContext() {
    const data = await this.state(),
      b = data.batch;
    const item = b?.items?.[b.index];
    if (
      b?.phase !== "paused" ||
      b.reason !== "manual_submission" ||
      !item ||
      !sourceOK(item.url) ||
      item.id !== item.url.split("paipu=")[1] ||
      data.blocks?.[item.url] !== "manual_submission" ||
      data.jobs.some(active)
    )
      throw Error("manual_submission");
    if (
      data.jobs.some(
        (j) =>
          j.source === item.url &&
          (j.claimed ||
            j.transferAttempted ||
            j.reason === "access_restricted" ||
            ["access_restricted", "invalid_report"].includes(j.transferError)),
      )
    )
      throw Error("already_attempted");
    if (await this.host.pending()) throw Error("pending_registration");
    return { data, b, item };
  }
  async canRecoverManual() {
    try {
      await this.manualRecoveryContext();
      return true;
    } catch {
      return false;
    }
  }
  async recoverManual({ tabId, documentId, url }, appTabId, expectedTask) {
    const page = route(url);
    if (
      page?.kind !== "result" ||
      page.task !== expectedTask ||
      !Number.isInteger(tabId) ||
      !Number.isInteger(appTabId) ||
      !documentId
    )
      throw Error("wrong_result");
    const { data, b, item } = await this.manualRecoveryContext();
    if (data.jobs.some((j) => j.claimed && j.task === page.task))
      throw Error("already_attempted");
    if (data.jobs.length >= 1000) throw Error("history_full");
    const current = (await this.host.list(appTabId)).find(
      (e) => e.id === item.id && e.url === item.url,
    );
    if (!current) throw Error("queue_changed");
    // Explicit user association of a manual submission with this paused item.
    // This grants only normal result saving/reading, never another form submit.
    const job = {
      id: crypto.randomUUID(),
      tabId,
      documentId,
      key: fingerprint(batchSnapshot(item.url, b.model)),
      source: item.url,
      model: b.model,
      player: "",
      phase: "analysing",
      claimed: true,
      manualSubmission: true,
      task: page.task,
      created: this.host.now(),
      expires: this.host.now() + 180000,
    };
    data.jobs.push(job);
    item.jobId = job.id;
    item.status = "active";
    item.documentId = documentId;
    b.phase = "running";
    b.reason = null;
    b.stopAfterCurrent = false;
    b.tabId = tabId;
    b.appTabId = appTabId;
    await this.save(data);
    return job;
  }
  async resume(appTabId) {
    const { data, b, item, job, cached } = await this.resumeContext();
    // The old tab cannot be reused after closure. Only detach it after all
    // existing submission/payload guards have accepted this explicit resume.
    if (b.reason === "tab_closed") b.tabId = undefined;
    b.phase = "running";
    b.reason = null;
    b.stopAfterCurrent = false;
    b.appTabId = appTabId;
    if (item && !cached && job?.phase !== "registered") {
      item.status = "queued";
      item.jobId = undefined;
    }
    await this.save(data);
  }
  async end() {
    const data = await this.state();
    if (data.batch?.phase !== "paused" || data.jobs.some(active))
      throw Error("another_job_running");
    if (await this.host.pending()) throw Error("pending_registration");
    // Keep every claim and source/task association. Only release the unsent list.
    data.batch.phase = "ended";
    await this.save(data);
  }
  async navigation(detail) {
    if (detail.frameId !== 0) return;
    const data = await this.state();
    const b = data.batch;
    if (b?.phase !== "running" || b.tabId !== detail.tabId) return;
    const item = b.items[b.index];
    const page = route(detail.url);
    if (!item) return;
    if (item.status === "opening") {
      if (page?.kind !== "input" || page.source !== item.url)
        return this.pause("page_changed");
      item.documentId = detail.documentId;
    } else if (item.status === "viewing") {
      const job = data.jobs.find((j) => j.id === item.jobId);
      if (page?.kind !== "result" || page.task !== job?.task)
        return this.pause("wrong_result");
      item.documentId = detail.documentId;
    } else if (item.status === "active") {
      const job = data.jobs.find((j) => j.id === item.jobId);
      if (page?.task && page.task === job?.task)
        item.documentId = detail.documentId;
    }
    await this.save(data);
  }
  async tick({ tabId, documentId, url, snapshot }) {
    const data = await this.state();
    const b = data.batch;
    if (b?.phase !== "running" || b.tabId !== tabId) return null;
    const item = b.items[b.index];
    if (!item || !["opening", "viewing"].includes(item.status)) return null;
    if (documentId !== item.documentId) return { action: "idle" };
    if (snapshot?.error) {
      await this.pause(snapshot.error);
      return { action: "stop" };
    }
    if (item.status === "viewing") {
      if (snapshot?.resultReady) {
        item.status = "active";
        await this.save(data);
      }
      return { action: "wait" };
    }
    const page = route(url);
    if (
      page?.kind !== "input" ||
      page.source !== item.url ||
      (snapshot.source && snapshot.source !== item.url)
    ) {
      await this.pause("source_changed");
      return { action: "stop" };
    }
    const expected = batchSnapshot(item.url, b.model);
    if (fingerprint(snapshot) !== fingerprint(expected))
      return { action: "prepare", settings: expected };
    const job = await this.helper.start(
      { tabId, documentId, url, snapshot },
      this.host.now(),
    );
    const fresh = await this.state();
    fresh.batch.items[fresh.batch.index].jobId = job.id;
    fresh.batch.items[fresh.batch.index].status = "active";
    await this.save(fresh);
    return { action: "wait" };
  }
  async finish(job, receipt) {
    if (
      !receipt ||
      !/^[a-f0-9]{64}$/.test(receipt.id) ||
      receipt.source_link?.linked !== true ||
      receipt.source_link.analysis_id !== job.source.split("paipu=")[1]
    )
      throw Error("invalid_receipt");
    const data = await this.state();
    const stored = data.jobs.find((j) => j.id === job.id);
    stored.phase = "registered";
    stored.registration = receipt;
    stored.registeredAt = this.host.now();
    await this.save(data);
    await this.host.remove(job.id);
    await this.complete("done", receipt);
  }
  async complete(status, receipt) {
    const data = await this.state();
    const b = data.batch;
    const item = b.items[b.index];
    item.status = status;
    if (receipt) item.result = receipt;
    b.index++;
    if (b.index >= b.items.length) b.phase = "done";
    else if (b.stopAfterCurrent) {
      b.phase = "paused";
      b.reason = "user_pause";
    } else b.nextAt = this.host.now() + COOLDOWN;
    await this.save(data);
  }
  async drive() {
    const data = await this.state();
    const b = data.batch;
    if (b?.phase !== "running") return;
    const item = b.items[b.index];
    if (!item) return;
    try {
      if (["opening", "viewing"].includes(item.status)) {
        if (this.host.now() > item.openExpires) await this.pause("timeout");
        return;
      }
      if (item.status === "queued") {
        if (this.host.now() < b.nextAt) return;
        const current = (await this.host.list(b.appTabId)).find(
          (e) => e.id === item.id && e.url === item.url,
        );
        if (!current || current.reports?.length) {
          await this.complete("skipped");
          return;
        }
        const option = choices([current], data.jobs, b.model, data.blocks)[0];
        if (!option?.available) throw Error("queue_changed");
        const previous = data.jobs.find((j) => j.id === option.reuse);
        if (previous) {
          item.jobId = previous.id;
          item.status = "active";
          const cached = await this.host.get(previous.id);
          if (cached) {
            await this.save(data);
            return await this.register(previous, cached, b.appTabId);
          }
          if (previous.transferAttempted) throw Error("payload_missing");
          item.status = "viewing";
        } else item.status = "opening";
        item.openExpires = this.host.now() + 45000;
        item.documentId = null;
        await this.save(data);
        const url = previous
          ? `${ORIGIN}/killerducky/?data=/report/${previous.task}.json`
          : `${ORIGIN}/ja.html?url=${encodeURIComponent(item.url)}`;
        const tab = await this.host.open(url, b.tabId);
        const fresh = await this.state();
        fresh.batch.tabId = tab.id;
        await this.save(fresh);
        return;
      }
      const job = data.jobs.find((j) => j.id === item.jobId);
      if (!job) throw Error("invalid_storage");
      if (job.phase === "registered") {
        await this.host.remove(job.id);
        await this.complete("done", job.registration);
        return;
      }
      const cached = await this.host.get(job.id);
      if (cached) {
        await this.register(job, cached, b.appTabId);
        return;
      }
      if (job.phase === "stopped")
        throw Error(job.reason || "submission_uncertain");
      if (job.phase !== "saved") return;
      if (job.transferAttempted) throw Error("payload_missing");
      job.transferAttempted = true;
      await this.save(data);
      let payload;
      try {
        payload = await this.host.read(
          { ...job, tabId: b.tabId },
          item.documentId,
        );
      } catch (e) {
        const fresh = await this.state();
        fresh.jobs.find((j) => j.id === job.id).transferError = e.message;
        await this.save(fresh);
        throw e;
      }
      await this.host.put(payload);
      await this.register(job, payload, b.appTabId);
    } catch (e) {
      await this.pause(e.message || "batch_failed");
    }
  }
  async register(job, payload, appTabId) {
    if (
      payload.jobId !== job.id ||
      payload.source !== job.source ||
      payload.task !== job.task ||
      payload.model !== job.model
    )
      throw Error("invalid_report");
    const receipt = await this.host.register(appTabId, job, payload);
    await this.finish(job, receipt);
  }
}
