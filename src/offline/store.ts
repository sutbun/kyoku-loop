import {
  freshPhoneState,
  phoneReduce,
  validatePack,
  validatePhoneBackup,
  type PhoneState,
} from "./engine";

const NAME = "kyokuloop-phone-v1";
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("local");
    r.onsuccess = () => {
      r.result.onversionchange = () => r.result.close();
      resolve(r.result);
    };
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error("storage_blocked"));
  });
}
function valid(s: PhoneState) {
  if (
    s.schema !== 1 ||
    !s.device ||
    !Array.isArray(s.events) ||
    !Number.isSafeInteger(s.sequence)
  )
    throw new Error("unsupported_storage");
  if (s.pack) validatePack(s.pack);
  validatePhoneBackup(s);
  return s;
}
// No awaited work inside the transaction. Only oncomplete means the write committed.
export async function phoneTransaction<T>(
  request: Record<string, unknown>,
): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction("local", "readwrite", { durability: "strict" });
    } catch {
      tx = db.transaction("local", "readwrite");
    }
    let result: T;
    let failure: unknown;
    const store = tx.objectStore("local");
    const r = store.get("state");
    r.onsuccess = () => {
      try {
        const before = r.result ? valid(r.result) : freshPhoneState();
        const reduced = phoneReduce(before, request);
        if (
          request.action === "apply_sync" ||
          request.action === "analysis_ack" ||
          request.action === "restore_phone"
        )
          valid(reduced.state);
        result = reduced.data as T;
        // First read also establishes a durable device ID.
        if (!r.result || reduced.state.sequence !== before.sequence)
          store.put(reduced.state, "state");
      } catch (e) {
        failure = e;
        tx.abort();
      }
    };
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(failure ?? tx.error ?? new Error("storage_failed"));
    };
  });
}
export async function readPhone(): Promise<PhoneState | null> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("local", "readonly");
    const r = tx.objectStore("local").get("state");
    tx.oncomplete = () => {
      db.close();
      try {
        resolve(r.result ? valid(r.result) : null);
      } catch (e) {
        reject(e);
      }
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("storage_failed"));
    };
  });
}
