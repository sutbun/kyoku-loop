(() => {
  if (
    location.origin !== "http://127.0.0.1:1460" ||
    location.pathname !== "/" ||
    globalThis.KyokuMortalAppBridge
  )
    return;
  globalThis.KyokuMortalAppBridge = true;
  async function api(body) {
    let response;
    try {
      response = await fetch("/api/local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(65000),
      });
    } catch {
      throw Error("local_unavailable");
    }
    if (!response.ok) throw Error("local_unavailable");
    const result = await response.json();
    if (!result?.ok)
      throw Error(
        /^[a-z_]{1,60}$/.test(result?.error)
          ? result.error
          : "local_unavailable",
      );
    return result.data;
  }
  const list = async () => {
    const state = await api({ action: "state" });
    if (
      !Array.isArray(state.analysis_queue) ||
      state.analysis_queue.length > 1000
    )
      throw Error("invalid_queue");
    // Only queue metadata leaves the app tab; never report contents or answers.
    return state.analysis_queue.map(
      ({ id, url, requested, reports, history }) => ({
        id,
        url,
        requested,
        reports,
        history,
      }),
    );
  };
  async function importReport(message) {
    const { source, model, data } = message;
    if (
      !/^https:\/\/game\.mahjongsoul\.com\/\?paipu=[A-Za-z0-9_-]{10,200}$/.test(
        source,
      ) ||
      typeof data !== "string" ||
      data.length > 28 * 1024 * 1024
    )
      throw Error("invalid_report");
    const id = source.split("paipu=")[1];
    const before = (await list()).find((e) => e.id === id && e.url === source);
    if (!before) throw Error("queue_changed");
    // File bytes only: never request an external URL through the application.
    const staged = await api({ action: "inspect", data });
    if (
      staged.engine !== "Mortal" ||
      !Number.isInteger(staged.target_seat) ||
      staged.target_seat < 0 ||
      staged.target_seat > 3 ||
      staged.models?.length !== 1 ||
      staged.models[0].index !== 0 ||
      staged.models[0].name !== model
    )
      throw Error("invalid_report");
    const h = before.history,
      scores = staged.final_scores;
    if (h) {
      if (
        !Array.isArray(scores) ||
        scores.length !== 4 ||
        !Array.isArray(h.players) ||
        h.players.length !== 4
      )
        throw Error("source_conflict");
      const rank =
        [0, 1, 2, 3]
          .sort((a, b) => scores[b] - scores[a] || a - b)
          .indexOf(staged.target_seat) + 1;
      if (
        JSON.stringify([...scores].sort((a, b) => a - b)) !==
          JSON.stringify(h.players.map((p) => p.score).sort((a, b) => a - b)) ||
        h.players[h.seat]?.score !== scores[staged.target_seat] ||
        h.rank !== rank
      )
        throw Error("source_conflict");
    }
    if (!(await list()).some((e) => e.id === id && e.url === source))
      throw Error("queue_changed");
    const result = await api({
      action: "commit",
      token: staged.token,
      seat: staged.target_seat,
      model: 0,
      source_url: source,
      analysis_id: id,
    });
    if (
      !/^[a-f0-9]{64}$/.test(result?.id) ||
      result.source_link?.linked !== true ||
      result.source_link.analysis_id !== id
    )
      throw Error("invalid_receipt");
    return result;
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (
      sender.id !== chrome.runtime.id ||
      !["APP_PING", "APP_LIST", "APP_IMPORT"].includes(message.type)
    )
      return;
    const action =
      message.type === "APP_PING"
        ? Promise.resolve({ ok: true })
        : message.type === "APP_LIST"
          ? list()
          : importReport(message);
    action
      .then((value) => respond({ ok: true, data: value }))
      .catch((error) =>
        respond({ error: error.message || "local_unavailable" }),
      );
    return true;
  });
})();
