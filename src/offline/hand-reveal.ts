import { readPhone, phoneTransaction } from "./store";
export async function openPhoneHands(
  id: unknown,
): Promise<{ hands: string[][] }> {
  if (typeof id !== "string") throw Error("hand_data_missing");
  let state = await readPhone();
  const lookup = () =>
    state?.pack?.reveals && Object.hasOwn(state.pack.reveals, id)
      ? state.pack.reveals[id]
      : undefined;
  if (!lookup()) {
    const entry = state?.local_imports?.find((e) => e.item_ids.includes(id));
    if (entry && state?.pack) {
      const { retainedReveals } = await import("./mortal-compiler");
      const reveals = await retainedReveals(entry.material);
      await phoneTransaction({
        action: "cache_reveals",
        source: state.pack.source,
        material: entry.material.id,
        reveals,
      });
      state = await readPhone();
    }
  }
  const hands = lookup();
  if (!hands) throw Error("hand_data_missing");
  return { hands };
}
