import { api, errors } from "./api";
import type { ReviewCatalog, RoundMaterial } from "./round-review-model";
import { validateRoundMaterial } from "./round-review-model";
import { readPhone, phoneTransaction } from "./offline/store";
import { retainedReview } from "./offline/mortal-compiler";

export async function loadReview<T extends ReviewCatalog | RoundMaterial>(
  report: string,
  round?: number,
): Promise<T> {
  const request =
    round === undefined
      ? { action: "round_review_catalog", report }
      : { action: "round_review_material", report, round_index: round };
  if (!location.pathname.startsWith("/phone/")) return api<T>(request);
  const state = await readPhone();
  const cached =
    round === undefined
      ? state?.review?.catalogs.find((c) => c.report === report)
      : state?.review?.materials.find(
          (m) => m.report === report && m.round_index === round,
        );
  if (cached) return cached as T;
  const local = state?.local_imports?.find((e) => e.material.id === report);
  let value: T;
  if (local) {
    try {
      value = await retainedReview<T>(local.material, round);
    } catch (e) {
      throw Error(
        e instanceof Error
          ? (errors[e.message] ??
              "保存した原本から一局を準備できませんでした。記録は保持しています。")
          : "一局を準備できませんでした。",
      );
    }
  } else {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch("/phone/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok)
        throw Error(
          "未保存の局です。Windowsに接続して、もう一度開いてください。",
        );
      const result = await response.json();
      if (!result.ok)
        throw Error(
          errors[result.error] ?? "局のデータを取得できませんでした。",
        );
      value = result.data;
    } catch (e) {
      if (
        e instanceof TypeError ||
        (e instanceof DOMException && e.name === "AbortError")
      )
        throw Error(
          "この局はまだ端末に保存されていません。Windowsに接続して、もう一度開いてください。",
        );
      throw e;
    } finally {
      clearTimeout(timeout);
    }
  }
  if (value.report !== report) throw Error(errors.invalid_review);
  if (round !== undefined) validateRoundMaterial(value);
  await phoneTransaction({
    action: "round_review_cache",
    ...(round === undefined ? { catalog: value } : { material: value }),
  });
  return value;
}
