const BUILD = __BUILD_JSON__,
  VERSION = __VERSION_JSON__,
  URLS = __URLS_JSON__,
  RUNTIME = __RUNTIME_JSON__;
const NAME = "kyokuloop-shell-" + BUILD;
async function shellMatches(response) {
  return (
    !!response &&
    (await response.clone().text()).match(
      /name="phone-build" content="([^"]+)"/,
    )?.[1] === BUILD
  );
}
async function complete(cache) {
  for (const url of URLS) if (!(await cache.match(url))) return false;
  return shellMatches(await cache.match("/phone/"));
}
async function repair(cache) {
  if (await complete(cache)) return;
  const responses = await Promise.all(
    URLS.map((url) => fetch(url, { cache: "no-store" })),
  );
  if (responses.some((r) => !r.ok) || !(await shellMatches(responses[0])))
    throw Error("mixed generation");
  await Promise.all(URLS.map((url, i) => cache.put(url, responses[i])));
  if (!(await complete(cache))) throw Error("incomplete");
}
async function matches(response, file) {
  if (!response?.ok) return false;
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== file.size) return false;
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return (
    Array.from(new Uint8Array(hash), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("") === file.sha256
  );
}
async function runtimeReady(download) {
  const cache = await caches.open(RUNTIME.cache);
  for (const file of RUNTIME.files) {
    if (await matches(await cache.match(file.url), file)) continue;
    if (!download) throw Error("update_incomplete");
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(file.url, {
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
      if (!(await matches(response.clone(), file)))
        throw Error("update_incomplete");
      await cache.put(file.url, response);
    } finally {
      clearTimeout(timer);
    }
  }
}
self.addEventListener("install", (event) =>
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(NAME);
        await cache.addAll(URLS);
        if (!(await complete(cache))) throw Error("incomplete");
        await runtimeReady(true);
      } catch (error) {
        await caches.delete(NAME);
        throw error;
      }
    })(),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      const others = (await caches.keys()).filter(
        (k) => k.startsWith("kyokuloop-shell-") && k !== NAME,
      );
      for (const name of others.slice(0, -1)) await caches.delete(name);
      await self.clients.claim();
    })(),
  ),
);
async function phoneClients() {
  const scope = new URL(self.registration.scope).pathname;
  return (
    await self.clients.matchAll({ type: "window", includeUncontrolled: true })
  ).filter((client) => new URL(client.url).pathname.startsWith(scope));
}
function askClient(client, id) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      resolve(false);
    }, 2000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(event.data?.id === id && event.data?.ok === true);
    };
    client.postMessage({ type: "CAN_UPDATE", id, build: BUILD }, [
      channel.port2,
    ]);
  });
}
let activation = false;
async function activateUpdate(alreadyActive) {
  if (activation) throw Error("update_busy");
  activation = true;
  const id = crypto.randomUUID();
  let clients = [];
  try {
    if (!(await complete(await caches.open(NAME))))
      throw Error("update_incomplete");
    await runtimeReady(false);
    clients = await phoneClients();
    if (
      !clients.length ||
      !(await Promise.all(clients.map((c) => askClient(c, id)))).every(Boolean)
    )
      throw Error("update_other_window");
    // Refuse a window opened during negotiation; it has not agreed to reload.
    const current = await phoneClients();
    if (
      current.length !== clients.length ||
      current.some((c) => !clients.some((old) => old.id === c.id))
    )
      throw Error("update_other_window");
    if (alreadyActive) {
      if (self.registration.waiting) throw Error("update_changed");
      for (const client of clients)
        client.postMessage({ type: "RELOAD_UPDATE", id, build: BUILD });
    } else await self.skipWaiting();
    return id;
  } catch (error) {
    for (const client of clients)
      client.postMessage({ type: "CANCEL_UPDATE", id });
    throw error;
  } finally {
    activation = false;
  }
}
self.addEventListener("message", (event) => {
  const type = event.data?.type;
  if (
    ![
      "VERIFY",
      "REPAIR",
      "UPDATE_INFO",
      "PREPARE_UPDATE",
      "ACTIVATE_UPDATE",
    ].includes(type)
  )
    return;
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(NAME);
        if (type === "VERIFY" || type === "REPAIR") {
          if (type === "REPAIR") await repair(cache);
          event.ports[0]?.postMessage({
            ok: event.data.build === BUILD && (await complete(cache)),
            build: BUILD,
          });
          return;
        }
        if (type === "PREPARE_UPDATE") {
          if (!(await complete(cache))) throw Error("update_incomplete");
          await runtimeReady(true);
        }
        if (type === "ACTIVATE_UPDATE") {
          if (event.data.build !== BUILD) throw Error("update_changed");
          await activateUpdate(event.data.active === true);
        }
        event.ports[0]?.postMessage({
          ok: true,
          protocol: 1,
          build: BUILD,
          version: VERSION,
        });
      } catch (error) {
        const allowed = [
          "update_busy",
          "update_incomplete",
          "update_other_window",
          "update_changed",
        ];
        event.ports[0]?.postMessage({
          ok: false,
          error: allowed.includes(error.message)
            ? error.message
            : "update_unavailable",
        });
      }
    })(),
  );
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin)
    return;
  if (RUNTIME.files.some((file) => file.url === url.pathname)) {
    event.respondWith(
      (async () =>
        (await (await caches.open(RUNTIME.cache)).match(url.pathname)) ||
        fetch(event.request))(),
    );
    return;
  }
  const key =
    event.request.mode === "navigate" && url.pathname.startsWith("/phone/")
      ? "/phone/"
      : url.pathname;
  const oldAsset = /^\/phone\/assets\/[\w.-]+$/.test(key);
  if (URLS.includes(key) || oldAsset)
    event.respondWith(
      (async () => {
        const hit = await (await caches.open(NAME)).match(key);
        if (hit) return hit;
        if (oldAsset)
          for (const name of (await caches.keys())
            .filter((k) => k.startsWith("kyokuloop-shell-") && k !== NAME)
            .reverse()) {
            const previous = await (await caches.open(name)).match(key);
            if (previous) return previous;
          }
        return fetch(event.request);
      })(),
    );
});
