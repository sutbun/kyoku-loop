(() => {
  const previous = globalThis.KyokuMortalContentBridge;
  if (previous) {
    try {
      if (chrome.runtime.onMessage.hasListener(previous.onMessage)) return;
    } catch {
      /* A previous extension context may have been invalidated. */
    }
    previous.dispose?.();
  }
  let timer,
    busy = false,
    ownClick = false,
    expectedKey;
  const fingerprint = (s) =>
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
  const halt = () => {
    clearInterval(timer);
    timer = null;
  };
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const response = await chrome.runtime.sendMessage({
        type: "TICK",
        snapshot: KyokuMortalInspect(),
      });
      if (
        response?.error ||
        ["idle", "stop", "download"].includes(response?.action)
      )
        halt();
      if (response?.action === "click") {
        // Recheck after the durable claim. Never force an inactive control.
        const snapshot = KyokuMortalInspect();
        if (
          snapshot.error ||
          !snapshot.ready ||
          fingerprint(snapshot) !== response.key
        ) {
          await chrome.runtime.sendMessage({
            type: "STOP",
            reason: "form_changed",
          });
          halt();
          return;
        }
        const form = [...document.forms].find(
          (f) => f.action === "https://mjai.ekyu.moe/review",
        );
        const button = [
          ...form.querySelectorAll('button,input[type="submit"]'),
        ].find((e) => e.type === "submit" && e.getClientRects().length);
        ownClick = true;
        expectedKey = response.key;
        button.click();
      }
      if (response?.action === "prepare") {
        const s = response.settings,
          current = KyokuMortalInspect();
        if (current.error || (current.source && current.source !== s.source))
          throw Error("form_changed");
        const form = [...document.forms].find(
          (f) => f.action === "https://mjai.ekyu.moe/review",
        );
        for (const [name, value] of Object.entries({
          "log-url": s.source,
          engine: s.engine,
          "mortal-model-tag": s.model,
          "player-id": s.player,
          ui: s.ui,
          temperature: s.temperature,
          kyokus: s.kyokus,
        })) {
          const fields = form.querySelectorAll(`[name="${name}"]`);
          if (fields.length !== 1 || fields[0].disabled)
            throw Error("form_changed");
          const e = fields[0];
          if (
            e.tagName === "SELECT" &&
            ![...e.options].some((o) => o.value === value)
          )
            throw Error("form_changed");
          e.value = value;
          e.dispatchEvent(new Event("input", { bubbles: true }));
          e.dispatchEvent(new Event("change", { bubbles: true }));
        }
        const rating = form.querySelector('input[name="show-rating"]');
        if (rating) {
          rating.checked = false;
          rating.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
    } catch {
      halt(); /* Unknown outcome must never be retried by the content script. */
      void chrome.runtime
        .sendMessage({ type: "STOP", reason: "form_changed" })
        .catch(() => {});
    } finally {
      busy = false;
    }
  };
  const wake = () => {
    if (!timer) {
      timer = setInterval(tick, 750);
      void tick();
    }
  };
  const onMessage = (message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message.type === "INSPECT") {
      respond(KyokuMortalInspect());
      return;
    }
    if (message.type === "WAKE") {
      wake();
      respond({ ok: true });
    }
    if (message.type === "READ_REPORT") {
      const read = async () => {
        const u = new URL(location.href),
          expected = `/report/${message.task}.json`;
        if (
          !/^[a-f0-9]{16}$/.test(message.task) ||
          u.origin !== "https://mjai.ekyu.moe" ||
          u.pathname !== "/killerducky/" ||
          [...u.searchParams].length !== 1 ||
          u.searchParams.get("data") !== expected ||
          u.hash ||
          !KyokuMortalInspect().resultReady
        )
          throw Error("wrong_result");
        const original = location.href;
        let response;
        try {
          response = await fetch(expected, {
            credentials: "same-origin",
            redirect: "error",
            signal: AbortSignal.timeout(30000),
          });
        } catch {
          throw Error("report_read_failed");
        }
        if ([401, 403, 429].includes(response.status))
          throw Error("access_restricted");
        if (
          !response.ok ||
          response.url !== u.origin + expected ||
          !response.body
        )
          throw Error("report_read_failed");
        const reader = response.body.getReader(),
          chunks = [];
        let size = 0;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 20 * 1024 * 1024) {
            await reader.cancel();
            throw Error("size_limit");
          }
          chunks.push(value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        let report;
        try {
          report = JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(bytes),
          );
        } catch {
          throw Error("invalid_report");
        }
        if (
          report.engine !== "Mortal" ||
          report.review?.model_tag !== message.model ||
          location.href !== original ||
          KyokuMortalInspect().error
        )
          throw Error("invalid_report");
        let binary = "";
        for (let i = 0; i < bytes.length; i += 8192)
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        const hash = [
          ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        ]
          .map((n) => n.toString(16).padStart(2, "0"))
          .join("");
        return { data: btoa(binary), hash };
      };
      read()
        .then((data) => respond({ ok: true, ...data }))
        .catch((e) => respond({ error: e.message || "report_read_failed" }));
      return true;
    }
  };
  chrome.runtime.onMessage.addListener(onMessage);
  const onSubmit = (event) => {
    if (ownClick && fingerprint(KyokuMortalInspect()) !== expectedKey) {
      event.preventDefault();
      void chrome.runtime
        .sendMessage({ type: "STOP", reason: "form_changed" })
        .catch(() => {});
      halt();
    } else if (!ownClick) {
      void chrome.runtime
        .sendMessage({ type: "STOP", reason: "manual_submission" })
        .catch(() => {});
      halt();
    }
  };
  document.addEventListener("submit", onSubmit, true);
  globalThis.KyokuMortalContentBridge = {
    onMessage,
    dispose() {
      halt();
      document.removeEventListener("submit", onSubmit, true);
      try {
        chrome.runtime.onMessage.removeListener(onMessage);
      } catch {
        /* Invalidated context. */
      }
    },
  };
  wake();
})();
