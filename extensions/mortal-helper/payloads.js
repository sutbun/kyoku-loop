import { MAX_BYTES } from "./core.js";
export async function payloadHash(data) {
  if (typeof data !== "string" || data.length > Math.ceil(MAX_BYTES / 3) * 4)
    throw Error("size_limit");
  let binary;
  try {
    binary = atob(data);
  } catch {
    throw Error("invalid_report");
  }
  if (!binary.length || binary.length > MAX_BYTES) throw Error("size_limit");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
const open = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open("kyokuloop-mortal-pending", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("payload");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(Error("payload_storage_failed"));
  });
async function operation(mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("payload", mode);
      let value;
      fn(
        tx.objectStore("payload"),
        (result) => {
          value = result;
        },
        tx,
      );
      tx.oncomplete = () => resolve(value);
      tx.onabort = tx.onerror = () => reject(Error("payload_storage_failed"));
    });
  } finally {
    db.close();
  }
}
export const pendingPayload = () =>
  operation("readonly", (store, done) => {
    const request = store.get("pending");
    request.onsuccess = () => done(request.result || null);
  });
export async function getPayload(id) {
  const payload = await pendingPayload();
  if (!payload || payload.jobId !== id) return null;
  if ((await payloadHash(payload.data)) !== payload.hash)
    throw Error("invalid_report");
  return payload;
}
export async function putPayload(payload) {
  if ((await payloadHash(payload.data)) !== payload.hash)
    throw Error("invalid_report");
  await operation("readwrite", (store, done, tx) => {
    const request = store.get("pending");
    request.onsuccess = () => {
      if (request.result && request.result.jobId !== payload.jobId) {
        tx.abort();
        return;
      }
      store.put(payload, "pending");
    };
  });
}
export const removePayload = (id) =>
  operation("readwrite", (store) => {
    const request = store.get("pending");
    request.onsuccess = () => {
      if (request.result?.jobId === id) store.delete("pending");
    };
  });
