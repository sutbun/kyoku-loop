const build = () =>
  document.querySelector<HTMLMetaElement>('meta[name="phone-build"]')?.content;
export async function verifyShell(repair = false): Promise<void> {
  if (!navigator.serviceWorker?.controller || !build())
    throw new Error("shell_missing");
  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => reject(new Error("shell_missing")), 10000);
    channel.port1.onmessage = (e) => {
      clearTimeout(timer);
      channel.port1.close();
      e.data?.ok && e.data.build === build()
        ? resolve()
        : reject(new Error("shell_missing"));
    };
    navigator.serviceWorker.controller!.postMessage(
      { type: repair ? "REPAIR" : "VERIFY", build: build() },
      [channel.port2],
    );
  });
}
export async function saveShell(): Promise<void> {
  if (!window.isSecureContext || !("serviceWorker" in navigator))
    throw new Error("secure_required");
  await navigator.serviceWorker.register("/phone/sw.js", {
    scope: "/phone/",
    updateViaCache: "none",
  });
  await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("shell_missing")), 30000),
    ),
  ]);
  if (!navigator.serviceWorker.controller)
    await new Promise<void>((resolve, reject) => {
      const done = () => {
        clearTimeout(timer);
        navigator.serviceWorker.removeEventListener("controllerchange", done);
        resolve();
      };
      const timer = setTimeout(() => {
        navigator.serviceWorker.removeEventListener("controllerchange", done);
        reject(new Error("shell_missing"));
      }, 10000);
      navigator.serviceWorker.addEventListener("controllerchange", done);
      if (navigator.serviceWorker.controller) done();
    });
  await verifyShell(true);
}
