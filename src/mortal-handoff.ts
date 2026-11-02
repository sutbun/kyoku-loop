import { sourceURL } from "./analysis-queue";

// Public copy/prefill entry points only: no form POST, cross-origin DOM access,
// challenge token or result-fetch workaround.
export const MORTAL_PAGE = "https://mjai.ekyu.moe/ja.html";
// Public prefill link used by Amae-koromo; opening it never submits a review.
export function mortalLink(value: string): string {
  return `${MORTAL_PAGE}?url=${encodeURIComponent(sourceURL(value))}`;
}
export const MORTAL_COPIED =
  "URLをコピーしました。Mortalの牌譜URL欄へ貼り付けて「送信」してください。";
export const MORTAL_COPY_FAILED =
  "URLをコピーできませんでした。入力欄のURLをコピーして、Mortalへ貼り付けてください。";

export function openMortal(value: string): Promise<boolean> {
  const url = sourceURL(value);
  let copied: Promise<boolean>;
  try {
    copied = navigator.clipboard.writeText(url).then(
      () => true,
      () => false,
    );
  } catch {
    copied = Promise.resolve(false);
  }
  // Keep this inside the user's click, before any async storage request.
  window.open(MORTAL_PAGE, "_blank", "noopener,noreferrer");
  return copied;
}
