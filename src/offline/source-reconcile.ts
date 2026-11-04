import { readPhone, phoneTransaction } from "./store";
import { compilerReady, retainedSourceScores } from "./mortal-compiler";
import { beginStorageOperation } from "./update-lock";

let pending: Promise<void> | undefined;
const unavailable = new Set<string>();
export function hydrateLocalSources() {
  return (pending ??= hydrate().finally(() => {
    pending = undefined;
  }));
}
async function hydrate() {
  const state = await readPhone();
  const missing = (state?.local_imports ?? []).filter(
    (e) =>
      !e.analysis_id &&
      e.final_scores === undefined &&
      !unavailable.has(e.material.id),
  );
  if (!missing.length || !(await compilerReady())) return;
  const end = beginStorageOperation();
  try {
    const entries = [];
    for (const own of missing) {
      try {
        entries.push({
          id: own.material.id,
          final_scores: await retainedSourceScores(own.material),
        });
      } catch {
        unavailable.add(own.material.id);
      }
    }
    if (entries.length)
      await phoneTransaction({ action: "source_scores", entries });
  } finally {
    end();
  }
}
