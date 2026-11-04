import type { PhoneState, LocalImport } from "./engine";
import { matchesMortalScores } from "../mortal-source-match";
import { visibleAnalysis } from "../analysis-queue";

export function reconcileLocalSources(state: PhoneState) {
  const imports = state.local_imports ?? [],
    entries = (state.analysis_queue ?? []).filter(visibleAnalysis);
  const family = (entry: LocalImport) =>
    `${entry.material.game}:${entry.material.seat}`;
  const plans: { own: LocalImport; id: string; kind: "scores" | "identity" }[] =
    [];
  for (const own of imports) {
    if (own.analysis_id) continue;
    const known = new Set([
      ...imports
        .filter((i) => i.analysis_id && family(i) === family(own))
        .map((i) => i.analysis_id!),
      ...entries
        .filter((e) => e.reports?.includes(own.material.id))
        .map((e) => e.id),
    ]);
    if (known.size) {
      if (known.size === 1 && entries.some((e) => e.id === [...known][0]))
        plans.push({ own, id: [...known][0], kind: "identity" });
      continue;
    }
    const matches = entries.filter(
      (e) =>
        e.history &&
        matchesMortalScores(e.history, own.final_scores, own.material.seat),
    );
    if (matches.length !== 1) continue;
    const match = matches[0];
    if (
      (match.reports ?? []).some(
        (id) =>
          !imports.some(
            (i) => i.material.id === id && family(i) === family(own),
          ),
      )
    )
      continue;
    if (
      imports.some(
        (i) => i.analysis_id === match.id && family(i) !== family(own),
      )
    )
      continue;
    plans.push({ own, id: match.id, kind: "scores" });
  }
  const contenders = new Map<string, Set<string>>();
  for (const p of plans) {
    if (!contenders.has(p.id)) contenders.set(p.id, new Set());
    contenders.get(p.id)!.add(family(p.own));
  }
  let linked = 0;
  for (const p of plans) {
    if (p.kind === "scores" && contenders.get(p.id)!.size !== 1) continue;
    p.own.analysis_id = p.id;
    p.own.source_link_kind = p.kind;
    delete p.own.synced_source;
    linked++;
  }
  // Keep local links visible across a delayed/old server receipt.
  for (const own of imports) {
    const entry = entries.find((e) => e.id === own.analysis_id);
    if (!entry) continue;
    entry.reports ??= [];
    if (!entry.reports.includes(own.material.id))
      entry.reports.push(own.material.id);
    if (own.item_ids.length) entry.ready = true;
  }
  return linked;
}
