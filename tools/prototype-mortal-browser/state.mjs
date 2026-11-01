// THROWAWAY: can a single browser-owned form submission yield one validated
// result without an HTTP client, credentials, or retries? No product state.
export const initial = () => ({ phase: "idle", submissions: 0, captured: 0 });
export function step(state, event) {
  if (event.type === "stop") return { ...state, phase: "stopped", reason: event.reason };
  const next = {
    open: ["idle", "opening"],
    ready: ["opening", "ready"],
    submit: ["ready", "submitted"],
    task: ["submitted", "analysing"],
    capture: ["analysing", "validating"],
    validated: ["validating", "complete"],
  }[event.type];
  if (!next || state.phase !== next[0]) throw Error("invalid_transition");
  return {
    ...state,
    phase: next[1],
    submissions: state.submissions + (event.type === "submit" ? 1 : 0),
    captured: state.captured + (event.type === "capture" ? 1 : 0),
    ...(event.summary ? { summary: event.summary } : {}),
  };
}
