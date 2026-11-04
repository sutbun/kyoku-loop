(() => {
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
    } catch {
      halt(); /* Unknown outcome must never be retried by the content script. */
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
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message.type === "INSPECT") {
      respond(KyokuMortalInspect());
      return;
    }
    if (message.type === "WAKE") {
      wake();
      respond({ ok: true });
    }
  });
  document.addEventListener(
    "submit",
    (event) => {
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
    },
    true,
  );
  wake();
})();
