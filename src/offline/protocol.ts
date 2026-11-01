import {
  validatePack,
  isItemState,
  type PhoneState,
  type PhoneEvent,
  type PhonePack,
  type Receipt,
} from "./engine";

export type SyncPayload = {
  protocol: 1;
  source: string;
  device: string;
  events: PhoneEvent[];
};
export type SyncReply = {
  protocol: 1;
  source: string;
  device: string;
  receipts: Receipt[];
  pack: PhonePack;
};
export function stable(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map(
          (k) =>
            JSON.stringify(k) +
            ":" +
            stable((value as Record<string, unknown>)[k]),
        )
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export async function hashEvent(event: PhoneEvent) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(stable(event)),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export function syncPayload(state: PhoneState): SyncPayload {
  if (!state.pack) throw new Error("no_pack");
  return JSON.parse(
    JSON.stringify({
      protocol: 1,
      source: state.pack.source,
      device: state.device,
      events: state.events,
    }),
  );
}
export async function validateSyncReply(
  payload: SyncPayload,
  value: unknown,
): Promise<SyncReply> {
  const reply = value as SyncReply;
  if (
    !reply ||
    reply.protocol !== 1 ||
    reply.source !== payload.source ||
    reply.device !== payload.device ||
    !Array.isArray(reply.receipts)
  )
    throw new Error("invalid_receipt");
  validatePack(reply.pack);
  if (
    reply.pack.source !== payload.source ||
    reply.receipts.length !== payload.events.length
  )
    throw new Error("invalid_receipt");
  const receipts = new Map(reply.receipts.map((r) => [r.id, r]));
  if (receipts.size !== reply.receipts.length)
    throw new Error("invalid_receipt");
  for (const event of payload.events) {
    const r = receipts.get(event.id);
    const history = reply.pack.histories[event.item]?.events.find(
      (e) => e.id === event.id,
    );
    if (
      !r ||
      r.hash !== (await hashEvent(event)) ||
      !history ||
      history.answer !== event.answer ||
      history.rating !== event.rating ||
      history.device !== event.device ||
      history.day !== event.day ||
      history.kind !== event.kind ||
      history.credited !== r.credited ||
      ![0, 1].includes(r.credited) ||
      !isItemState(r.before_state) ||
      !isItemState(r.after_state) ||
      r.after_state.revision !== r.before_state.revision + 1
    )
      throw new Error("invalid_receipt");
  }
  return reply;
}
