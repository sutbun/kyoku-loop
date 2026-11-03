import manifest from "virtual:phone-runtime";
import type { PhoneState, PhoneItem } from "./engine";

export type LocalMaterial = {
  id: string;
  game: string;
  seat: number;
  model: string;
  rounds: number;
  created: string;
  players: string[];
  important_count: number;
  family_ids: string[];
  items: PhoneItem[];
  payload: string;
};
async function matches(
  response: Response | undefined,
  file: (typeof manifest.files)[number],
) {
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
export async function compilerReady() {
  if (!("caches" in globalThis)) return false;
  const cache = await caches.open(manifest.cache);
  for (const file of manifest.files)
    if (!(await matches(await cache.match(file.url), file))) return false;
  return true;
}
export async function saveCompiler() {
  const cache = await caches.open(manifest.cache);
  for (const file of manifest.files) {
    if (await matches(await cache.match(file.url), file)) continue;
    const response = await fetch(file.url, {
      cache: "no-store",
      redirect: "error",
    });
    if (!(await matches(response.clone(), file)))
      throw Error("runtime_unavailable");
    await cache.put(file.url, response);
  }
  if (!(await compilerReady())) throw Error("runtime_missing");
  await execute(null, "");
}
async function execute(
  data: string | null,
  created: string,
): Promise<LocalMaterial> {
  const worker = new Worker(
    new URL("./mortal-compiler.worker.ts", import.meta.url),
    { type: "module" },
  );
  return new Promise((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      worker.terminate();
    };
    const timer = setTimeout(() => {
      finish();
      reject(Error("runtime_timeout"));
    }, 90000);
    worker.onerror = () => {
      finish();
      reject(Error("runtime_unavailable"));
    };
    worker.onmessage = (event) => {
      finish();
      if (event.data.ok) resolve(event.data.data);
      else reject(Error(event.data.error));
    };
    worker.postMessage({ id: 1, data, created });
  });
}
export async function compileMortal(
  file: File | Blob,
  created = new Date().toISOString(),
) {
  if (file.size > 20 * 1024 * 1024) throw Error("size_limit");
  if (!(await compilerReady())) throw Error("runtime_missing");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return execute(btoa(binary), created);
}

// Recompile retained originals before importing a backup; supplied scenes/IDs are not trusted.
export async function verifyLocalBackup(state: PhoneState) {
  if (state.schema !== 2) return;
  if (!(await compilerReady())) throw Error("runtime_missing");
  for (const entry of state.local_imports ?? []) {
    const actual = await execute(
      entry.material.payload,
      entry.material.created,
    );
    const { payload: a, ...left } = actual;
    const { payload: b, ...right } = entry.material;
    if (JSON.stringify(left) !== JSON.stringify(right))
      throw Error("invalid_phone_backup");
  }
}
