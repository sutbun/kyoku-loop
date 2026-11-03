import { sourceURL } from "./analysis-queue";

// Public prefill entry point only. The user submits in their normal browser.
export const MORTAL_PAGE = "https://mjai.ekyu.moe/ja.html";
export function mortalLink(value: string): string {
  return `${MORTAL_PAGE}?url=${encodeURIComponent(sourceURL(value))}`;
}
export const MORTAL_READY =
  "Mortalで対象プレイヤーを確認して「送信」してください。";

export function openMortal(value: string): void {
  // Open synchronously inside the user's click; storage must not consume activation.
  window.open(mortalLink(value), "_blank", "noopener,noreferrer");
}
