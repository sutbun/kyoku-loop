import type { MortalRegistrationResult } from "./mortal-registration";
export type BatchRegistration = MortalRegistrationResult & {
  linked?: boolean;
};
export type MortalBatchItem = {
  file: File;
  result?: BatchRegistration;
  error?: string;
};
export function validateMortalFiles(files: File[]) {
  if (
    !files.length ||
    files.length > 50 ||
    files.reduce((n, f) => n + f.size, 0) > 100 * 1024 * 1024
  )
    throw Error("batch_limit");
  if (files.some((f) => f.size > 20 * 1024 * 1024)) throw Error("size_limit");
}
export async function encodeReport(file: File) {
  if (file.size > 20 * 1024 * 1024) throw Error("size_limit");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export async function runMortalBatch(
  items: MortalBatchItem[],
  register: (file: File) => Promise<BatchRegistration>,
  progress?: (items: MortalBatchItem[]) => void,
) {
  validateMortalFiles(items.map((i) => i.file));
  const next = items.map((i) => ({ ...i }));
  for (const item of next) {
    if (item.result) continue;
    delete item.error;
    try {
      item.result = await register(item.file);
    } catch (e) {
      item.error = e instanceof Error ? e.message : "取り込めませんでした。";
    }
    progress?.(next.map((i) => ({ ...i })));
  }
  return next;
}
