import { test, expect, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { phoneFixture } from "./phone-fixture";
import {
  freshPhoneState,
  phoneReduce,
  type PhonePack,
} from "../src/offline/engine";

const base = phoneFixture();
async function stored(page: Page) {
  return page.evaluate(
    () =>
      new Promise<any>((done, reject) => {
        const r = indexedDB.open("kyokuloop-phone-v1", 1);
        r.onsuccess = () => {
          const db = r.result;
          const q = db.transaction("local").objectStore("local").get("state");
          q.onsuccess = () => {
            db.close();
            done(q.result);
          };
          q.onerror = () => {
            db.close();
            reject(q.error);
          };
        };
        r.onerror = () => reject(r.error);
      }),
  );
}
function manyQuestions(count = 207): PhonePack {
  const pack = structuredClone(base);
  pack.items = Array.from({ length: count }, (_, n) => {
    const item = structuredClone(base.items[n % base.items.length]);
    item.id = `fictional-question-${String(n).padStart(3, "0")}`;
    item.scene.id = item.id;
    item.manual = 0;
    item.due = "2026-11-05";
    return item;
  });
  pack.histories = Object.fromEntries(
    pack.items.map((i) => [
      i.id,
      { id: i.id, scene: i.scene, events: [], legacy_history: [] },
    ]),
  );
  delete pack.reveals;
  return pack;
}

for (const mode of ["practice", "scheduled"] as const) {
  test(`207 mobile questions rotate without repeats in ${mode} until all have been answered`, () => {
    let state = freshPhoneState("large-rotation");
    const call = (request: object) => {
      const result = phoneReduce(state, request, "2026-11-05T12:00:00+09:00");
      state = result.state;
      return result.data as any;
    };
    call({ action: "install_pack", pack: manyQuestions() });
    const seen = new Set<string>();
    for (let n = 0; n < 207; n++) {
      const q = call({ action: "study_start", mode });
      expect(seen.has(q.item_id), `repeat after ${n} answers`).toBe(false);
      seen.add(q.item_id);
      call({
        action: "study_choice",
        session: q.id,
        choice: "choose",
        answer: q.scene.own_hand[0],
      });
      call({ action: "study_choice", session: q.id, choice: "confirm" });
      call({
        action: "study_rate",
        session: q.id,
        item: q.item_id,
        rating: "理解した",
        event: `answer-${n}`,
      });
    }
    expect(seen.size).toBe(207);
    expect(
      state.pack!.items.every(
        (i) => i.streak === (mode === "practice" ? 0 : 1),
      ),
    ).toBe(true);
  });
}

for (const counter of [undefined, 0]) {
  test(`mobile packs use saved answer history when the answer counter is ${counter}`, () => {
    let state = freshPhoneState("legacy-count");
    const call = (request: object) => {
      const result = phoneReduce(state, request, "2026-11-05T12:00:00+09:00");
      state = result.state;
      return result.data as any;
    };
    call({ action: "install_pack", pack: manyQuestions() });
    for (let n = 0; n < 5; n++) {
      const q = call({ action: "study_start", mode: "practice" });
      call({
        action: "study_choice",
        session: q.id,
        choice: "choose",
        answer: q.scene.own_hand[0],
      });
      call({ action: "study_choice", session: q.id, choice: "confirm" });
      call({
        action: "study_rate",
        session: q.id,
        item: q.item_id,
        rating: "理解した",
        event: `legacy-${n}`,
      });
    }
    const answered = new Set(state.events.map((e) => e.item));
    const legacy = structuredClone(state.pack!);
    for (const item of legacy.items) {
      delete item.review_count;
      if (counter !== undefined) item.review_count = counter;
      legacy.histories[item.id].events = state.events
        .filter((e) => e.item === item.id)
        .map((e) => ({ ...e, undone: false }));
    }
    state = freshPhoneState("restored-legacy");
    call({ action: "install_pack", pack: legacy });
    const next = call({ action: "study_start", mode: "practice" });
    expect(answered.has(next.item_id)).toBe(false);
    expect(state.session!.queue.every((q) => !answered.has(q.id))).toBe(true);
  });
}

test("mobile UI completes a set then chooses different questions from a legacy history", async ({
  page,
}) => {
  const pack = manyQuestions();
  // A retained pack can contain answers while its old summary counter is absent.
  let generated = phoneReduce(freshPhoneState("history-fixture"), {
    action: "install_pack",
    pack,
  }).state;
  let n = 0;
  while (n < 5) {
    const call = (request: object) => {
      const result = phoneReduce(generated, request);
      generated = result.state;
      return result.data as any;
    };
    const q = call({ action: "study_start", mode: "practice" });
    call({
      action: "study_choice",
      session: q.id,
      choice: "choose",
      answer: q.scene.own_hand[0],
    });
    call({ action: "study_choice", session: q.id, choice: "confirm" });
    call({
      action: "study_rate",
      session: q.id,
      item: q.item_id,
      rating: "理解した",
      event: `old-${n++}`,
    });
  }
  const old = new Set(generated.events.map((e) => e.item));
  for (const item of pack.items) {
    delete item.review_count;
    pack.histories[item.id].events = generated.events
      .filter((e) => e.item === item.id)
      .map((e) => ({ ...e, undone: false }));
  }
  const state = phoneReduce(freshPhoneState("browser-repetition"), {
    action: "install_pack",
    pack,
  }).state;
  await page.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === "/fixture")
      return route.fulfill({
        contentType: "text/html",
        body: "<!doctype html>",
      });
    const path = u.pathname.startsWith("/phone/assets/")
      ? u.pathname.slice(6)
      : u.pathname.endsWith("/")
        ? u.pathname + "index.html"
        : u.pathname;
    const file = resolve("dist", "." + path);
    if (file.startsWith(resolve("dist")) && existsSync(file))
      return route.fulfill({ path: file });
    return route.abort();
  });
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "onLine", { get: () => false }),
  );
  await page.goto("/fixture");
  await page.evaluate(
    (state) =>
      new Promise<void>((done, reject) => {
        const r = indexedDB.open("kyokuloop-phone-v1", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("local");
        r.onsuccess = () => {
          const db = r.result;
          const tx = db.transaction("local", "readwrite");
          tx.objectStore("local").put(state, "state");
          tx.oncomplete = () => {
            db.close();
            done();
          };
          tx.onabort = () => {
            db.close();
            reject(tx.error);
          };
        };
        r.onerror = () => reject(r.error);
      }),
    state,
  );
  await page.goto("/phone/");
  await page.getByRole("button", { name: "5問練習する", exact: true }).click();
  for (let index = 0; index < 5; index++) {
    await expect(
      page.getByText(`${index + 1} / 5 問`, { exact: true }),
    ).toBeVisible();
    const current = await stored(page);
    expect(old.has(current.session.queue[current.session.index].id)).toBe(
      false,
    );
    await page.locator(".hand button").first().click();
    await page.getByRole("button", { name: "回答する", exact: true }).click();
    await page.getByRole("button", { name: "理解した", exact: true }).click();
  }
  await page.getByRole("button", { name: "学習へ", exact: true }).click();
  await page.getByRole("button", { name: "5問練習する", exact: true }).click();
  const next = await stored(page);
  const answered = new Set([...old, ...next.events.map((e: any) => e.item)]);
  expect(next.pack.items).toHaveLength(207);
  expect(next.session.queue.every((q: any) => !answered.has(q.id))).toBe(true);
});
