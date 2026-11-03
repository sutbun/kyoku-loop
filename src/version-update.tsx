import { useEffect, useRef, useState } from "react";
import { VERSION } from "./version";
import { lockUpdate, unlockUpdate } from "./offline/update-lock";

type Info = { protocol: 1; build: string; version: string };
const currentBuild = () =>
  document.querySelector<HTMLMetaElement>('meta[name="phone-build"]')?.content;
function ask(
  worker: ServiceWorker,
  type: string,
  build?: string,
  active = false,
): Promise<Info> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(
      () => {
        channel.port1.close();
        reject(Error("update_unavailable"));
      },
      type === "PREPARE_UPDATE" ? 150000 : 12000,
    );
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      channel.port1.close();
      const value = event.data;
      if (!value?.ok) {
        reject(Error(value?.error ?? "update_unavailable"));
        return;
      }
      if (
        value.protocol !== 1 ||
        !/^[a-f0-9]{20}$/.test(value.build) ||
        !/^(DEV-)?\d{2}\.\d{2}-\d+$/.test(value.version)
      ) {
        reject(Error("update_incomplete"));
        return;
      }
      resolve(value);
    };
    worker.postMessage({ type, build, active }, [channel.port2]);
  });
}
async function installed(worker: ServiceWorker) {
  if (["installed", "activating", "activated"].includes(worker.state)) return;
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      worker.removeEventListener("statechange", changed);
    };
    const changed = () => {
      if (["installed", "activating", "activated"].includes(worker.state)) {
        finish();
        resolve();
      } else if (worker.state === "redundant") {
        finish();
        reject(Error("update_unavailable"));
      }
    };
    const timer = setTimeout(() => {
      finish();
      reject(Error("update_unavailable"));
    }, 30000);
    worker.addEventListener("statechange", changed);
    changed();
  });
}
const labels: Record<string, string> = {
  update_unavailable: "接続を確認",
  update_incomplete: "保存を再試行",
  update_changed: "もう一度確認",
  update_other_window: "他の画面を確認",
  update_busy: "処理後に再試行",
};
export function VersionUpdate({
  guard,
  onLock,
  enabled,
}: {
  guard: () => string | null;
  onLock: (locked: boolean) => void;
  enabled: boolean;
}) {
  const [available, setAvailable] = useState<Info | null>(null);
  const [working, setWorking] = useState(false),
    [hint, setHint] = useState("");
  const latest = useRef({ guard, onLock });
  latest.current = { guard, onLock };
  const owner = useRef(""),
    lease = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flight = useRef<Promise<{
    worker: ServiceWorker;
    info: Info;
    active: boolean;
  } | null> | null>(null);
  const manual = useRef(false),
    lastCheck = useRef(0),
    alive = useRef(true),
    reloading = useRef(false);
  const release = () => {
    if (lease.current) clearTimeout(lease.current);
    unlockUpdate(owner.current);
    owner.current = "";
    latest.current.onLock(false);
  };
  const discover = () => {
    if (flight.current) return flight.current;
    flight.current = (async () => {
      if (!navigator.serviceWorker) throw Error("update_unavailable");
      const registration =
        (await navigator.serviceWorker.getRegistration("/phone/")) ??
        (navigator.onLine
          ? await navigator.serviceWorker.register("/phone/sw.js", {
              scope: "/phone/",
              updateViaCache: "none",
            })
          : null);
      if (!registration) throw Error("update_unavailable");
      if (navigator.onLine) {
        lastCheck.current = Date.now();
        try {
          if (!registration.installing) await registration.update();
        } catch {
          if (!registration.waiting) throw Error("update_unavailable");
        }
      }
      if (registration.installing) await installed(registration.installing);
      const worker =
        registration.waiting ??
        navigator.serviceWorker.controller ??
        registration.active;
      if (!worker) {
        if (!navigator.onLine) throw Error("update_unavailable");
        return null;
      }
      const info = await ask(worker, "UPDATE_INFO");
      if (info.build === currentBuild() && registration.waiting !== worker) {
        if (!navigator.onLine) throw Error("update_unavailable");
        return null;
      }
      await ask(worker, "PREPARE_UPDATE");
      const active = worker.state === "activated";
      if (registration.waiting !== worker && !active)
        throw Error("update_changed");
      if (alive.current) {
        setAvailable(info);
        setHint("");
      }
      return { worker, info, active };
    })().finally(() => {
      flight.current = null;
    });
    return flight.current;
  };
  useEffect(() => {
    alive.current = true;
    const message = (event: MessageEvent) => {
      const source = event.source as ServiceWorker | null;
      if (source?.scriptURL !== new URL("/phone/sw.js", location.href).href)
        return;
      if (
        event.data?.type === "RELOAD_UPDATE" &&
        event.data.id === owner.current &&
        !reloading.current
      ) {
        reloading.current = true;
        location.reload();
        return;
      }
      if (
        event.data?.type === "CANCEL_UPDATE" &&
        event.data.id === owner.current
      ) {
        release();
        return;
      }
      if (
        event.data?.type !== "CAN_UPDATE" ||
        typeof event.data.id !== "string"
      )
        return;
      const ok = !latest.current.guard() && lockUpdate(event.data.id);
      if (ok) {
        if (lease.current) clearTimeout(lease.current);
        owner.current = event.data.id;
        latest.current.onLock(true);
        lease.current = setTimeout(release, 15000);
      }
      event.ports[0]?.postMessage({ id: event.data.id, ok });
    };
    const changed = () => {
      if (owner.current && !reloading.current) {
        reloading.current = true;
        location.reload();
      }
    };
    navigator.serviceWorker?.addEventListener("message", message);
    navigator.serviceWorker?.addEventListener("controllerchange", changed);
    return () => {
      alive.current = false;
      release();
      navigator.serviceWorker?.removeEventListener("message", message);
      navigator.serviceWorker?.removeEventListener("controllerchange", changed);
    };
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const check = () => {
      if (navigator.onLine && Date.now() - lastCheck.current > 60000)
        void discover().catch(() => {});
    };
    const visible = () => {
      if (document.visibilityState === "visible") check();
    };
    const timer = setTimeout(check, 1000);
    window.addEventListener("online", check);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("online", check);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [enabled]);
  const activate = async () => {
    if (manual.current) return;
    const blocked = latest.current.guard();
    if (blocked) {
      setHint(blocked);
      return;
    }
    manual.current = true;
    setWorking(true);
    setHint("");
    try {
      const candidate = await discover();
      if (!candidate) {
        setAvailable(null);
        setHint("最新版");
        return;
      }
      const blocked = latest.current.guard();
      if (blocked) {
        setHint(blocked);
        return;
      }
      await ask(
        candidate.worker,
        "ACTIVATE_UPDATE",
        candidate.info.build,
        candidate.active,
      );
    } catch (error) {
      if (alive.current)
        setHint(
          labels[error instanceof Error ? error.message : ""] ?? "更新を再試行",
        );
    } finally {
      manual.current = false;
      if (alive.current) setWorking(false);
    }
  };
  const suffix = working ? "確認中…" : hint || (available ? "↑" : "");
  return (
    <button
      type="button"
      className="phone-version"
      data-testid="version-update"
      aria-label={`${VERSION}。${working ? "更新を確認中" : hint || (available ? `${available.version}へ更新` : "更新を確認")}`}
      title={available ? `${available.version}へ更新` : "タップして更新を確認"}
      disabled={!enabled || working}
      onClick={() => void activate()}
    >
      {VERSION}
      {suffix ? ` · ${suffix}` : ""}
    </button>
  );
}
