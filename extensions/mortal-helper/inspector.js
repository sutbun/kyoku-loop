// Read only public form controls / rendered text. Never inspect challenge
// responses, cookies, the site's JS globals, or other extensions.
globalThis.KyokuMortalInspect = function inspect(
  doc = document,
  href = location.href,
) {
  const shown = (e) =>
    !!(
      e &&
      e.getClientRects().length &&
      getComputedStyle(e).visibility !== "hidden" &&
      getComputedStyle(e).display !== "none"
    );
  const text = (doc.body?.innerText || "").slice(0, 100000);
  if (
    /verify you are human|just a moment|人間であることを確認|本人確認が必要/i.test(
      text,
    )
  )
    return { error: "human_confirmation" };
  if (
    /access denied|access restricted|forbidden|too many requests|アクセス.{0,6}(拒否|制限)|error\s*(401|403|429)\b/i.test(
      text,
    )
  )
    return { error: "access_restricted" };
  if (
    /failed to|task.{0,20}(failed|error)|解析.{0,10}(失敗|エラー)/i.test(text)
  )
    return { error: "site_error" };
  const u = new URL(href);
  if (u.pathname === "/killerducky/") {
    // Populated round text is rendered by the viewer after loading its report.
    return {
      error: null,
      resultReady:
        doc.readyState === "complete" &&
        [...doc.querySelectorAll(".info-round")].some(
          (e) => shown(e) && e.textContent.trim().length > 0,
        ),
    };
  }
  if (["/progress", "/review"].includes(u.pathname)) return { error: null };
  const forms = [...doc.forms].filter(
    (f) =>
      new URL(f.action, href).href === "https://mjai.ekyu.moe/review" &&
      f.method.toLowerCase() === "post",
  );
  if (forms.length !== 1) return { error: "form_changed" };
  const form = forms[0];
  if (form.target && form.target !== "_self") return { error: "form_changed" };
  const one = (selector) => {
    const es = form.querySelectorAll(selector);
    return es.length === 1 ? es[0] : null;
  };
  const url = one('input[name="log-url"]');
  const engine = one('select[name="engine"]');
  const model = one('select[name="mortal-model-tag"]');
  const player = one('select[name="player-id"]');
  const ui = one('select[name="ui"]');
  const temperature = one('input[name="temperature"]');
  const kyokus = one('input[name="kyokus"]');
  const submits = [
    ...form.querySelectorAll('button,input[type="submit"]'),
  ].filter((e) => e.type === "submit" && shown(e));
  if (
    ![url, engine, model, player, ui, temperature].every(Boolean) ||
    submits.length !== 1 ||
    !shown(url)
  )
    return { error: "form_changed" };
  if (
    submits[0].hasAttribute("formaction") ||
    submits[0].hasAttribute("formtarget") ||
    submits[0].hasAttribute("formmethod")
  )
    return { error: "form_changed" };
  if (
    [...form.querySelectorAll('input[type="file"]')].some(
      (e) => !e.disabled && e.files.length,
    )
  )
    return { error: "form_changed" };
  const radios = [...form.querySelectorAll('input[type="radio"]:checked')];
  if (
    radios.length &&
    (radios.length !== 1 || !["url", "log-url"].includes(radios[0].value))
  )
    return { error: "form_changed" };
  if (
    [
      ...form.querySelectorAll(
        'input[type="text"],input[type="url"],input:not([type]),textarea',
      ),
    ].some(
      (e) =>
        !e.disabled &&
        e.value.trim() &&
        !["log-url", "temperature", "kyokus"].includes(e.name),
    )
  )
    return { error: "form_changed" };
  const snapshot = {
    source: url.value.trim(),
    engine: engine.value,
    model: model.value,
    player: player.value,
    ui: ui.value,
    temperature: temperature.value,
    kyokus: kyokus?.value || "",
    rating: !!form.querySelector('input[name="show-rating"]:checked'),
    valid: !url.disabled && url.validity.valid,
    ready:
      !submits[0].matches(":disabled") &&
      submits[0].getAttribute("aria-disabled") !== "true",
    error: null,
  };
  // Observe only the presence of a visible inline widget in the public page.
  // Never enter its frame/shadow tree, read a response, or interact with it.
  snapshot.confirmationPending =
    !snapshot.ready &&
    [
      ...doc.querySelectorAll(
        '.cf-turnstile, iframe[src^="https://challenges.cloudflare.com/"]',
      ),
    ].some(shown);
  return snapshot;
};
