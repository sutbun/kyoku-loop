import { expect, type Page } from "@playwright/test";
import { test } from "./static-app";
import { execFileSync } from "node:child_process";
import {
  freshPhoneState,
  phoneReduce,
  validatePhoneBackup,
  type PhonePack,
  type PhoneState,
} from "../src/offline/engine";
import {
  changeReview,
  newReviewState,
  candidates,
  isDiscrepancy,
  navigate,
  newRoundSession,
  type ReviewCatalog,
  type ReviewState,
  type RoundMaterial,
} from "../src/round-review-model";

const generated = JSON.parse(
  execFileSync(
    "python",
    [
      "-c",
      `
import sys,json,tempfile,copy
from pathlib import Path
sys.path.insert(0,'tests')
from test_p3_study import five_fixture
from tools.p2_store import Store
from tools.round_review import material,catalog
raw=five_fixture()
second=copy.deepcopy(raw['pred'][0]);second[0]['info']['msg'].update(kyoku=2,oya=1)
log=json.loads(raw['custom_haihu'][0]);log[0][0][0]=1
raw['custom_haihu'].append(json.dumps(log));raw['pred'].append(second)
with tempfile.TemporaryDirectory(dir='D:/dev-data/kyoku-loop/private') as temp:
 s=Store(Path(temp)/'review.sqlite3')
 r=s.commit(s.stage(json.dumps(raw).encode(),None)['token'],0,0,None)['id']
 for scene in s.detail(r)['decisions']:s.save(r,scene['id'],True)
 s.db.execute("UPDATE study_items SET due='2026-01-02'");s.db.commit()
 print(json.dumps(dict(pack=s.phone_pack(),workspace=s.state(),catalog=catalog(s,r),materials=[material(s,r,i) for i in range(2)]),ensure_ascii=True))
 s.close()
`,
    ],
    { encoding: "utf8", windowsHide: true },
  ),
) as {
  pack: PhonePack;
  workspace: any;
  catalog: ReviewCatalog;
  materials: RoundMaterial[];
};
const entry = {
  id: "260101-fictional-review_a123",
  url: "https://game.mahjongsoul.com/?paipu=260101-fictional-review_a123",
  created: "2026-01-01T00:00:00Z",
  reports: [generated.catalog.report],
  ready: true,
};

test("review navigation stops every unanswered own decision, ties and red policies stay exact", () => {
  const m = generated.materials[0],
    session = { ...newRoundSession(), quiz: true };
  const decision = m.timeline.findIndex((s) => s.is_decision);
  expect(navigate(m, session, m.timeline.length - 1)).toBe(decision);
  session.index = decision;
  expect(navigate(m, session, decision + 1)).toBe(decision);
  session.answers[String(m.timeline[decision].event_index)] = "1m";
  expect(navigate(m, session, m.timeline.length - 1)).toBeGreaterThan(decision);
  expect(navigate(m, session, 0)).toBe(0);
  const s = structuredClone(m.timeline[decision]);
  expect(candidates(s)).toHaveLength(2);
  expect(isDiscrepancy(s)).toBe(true);
  s.actual = s.suggested;
  expect(isDiscrepancy(s)).toBe(false);
  s.engine = "Mortal";
  s.own_hand = ["5p", "5pr", "1m"];
  s.actual = "5pr";
  s.policy_percent = Array(37).fill(0);
  s.policy_percent[13] = 45;
  s.policy_percent[35] = 45;
  s.policy_percent[0] = 10;
  expect(candidates(s).map((c) => c.value)).toEqual([45, 45, 10]);
  expect(isDiscrepancy(s)).toBe(false);
  delete s.policy_percent;
  expect(candidates(s)).toEqual([]);
  expect(isDiscrepancy(s)).toBe(false);
});

test("phone review cache, bookmark, tag merge, answers and backup preserve the five-question session", () => {
  let s = phoneReduce(freshPhoneState("review-test"), {
    action: "install_pack",
    pack: generated.pack,
  }).state;
  s = phoneReduce(s, { action: "study_start", mode: "practice" }).state;
  const old = JSON.stringify({
    session: s.session,
    events: s.events,
    pack: s.pack,
  });
  s = phoneReduce(s, {
    action: "round_review_cache",
    catalog: generated.catalog,
    material: generated.materials[0],
  }).state;
  const m = generated.materials[0],
    b = {
      id: `${m.game}:0:0:1`,
      report: m.report,
      round_index: 0,
      event_index: 1,
      label: m.label,
      tag: "手作り",
      memo: "振り返る",
    };
  for (const op of [
    { kind: "bookmark", value: b },
    { kind: "bookmark", value: { ...b, memo: "保存" } },
    { kind: "tag", old: "手作り", new: "押し引き" },
    {
      kind: "session",
      key: m.report + ":0",
      value: {
        index: 1,
        quiz: true,
        selected: { "1": "1m" },
        answers: { "1": "1m" },
      },
    },
  ])
    s = phoneReduce(s, { action: "round_review_change", op }).state;
  expect(
    JSON.stringify({ session: s.session, events: s.events, pack: s.pack }),
  ).toBe(old);
  expect(s.review?.state.bookmarks).toHaveLength(1);
  expect(s.review?.state.tags).toEqual(["押し引き", "鳴き・リーチ"]);
  expect(s.review?.state.bookmarks[0].tag).toBe("押し引き");
  validatePhoneBackup(s);
  const restored = phoneReduce(freshPhoneState("restored-review"), {
    action: "restore_phone",
    backup: s,
  }).state;
  expect(restored.review).toEqual(s.review);
  const before = JSON.stringify(s);
  expect(() =>
    phoneReduce(s, {
      action: "round_review_change",
      op: { kind: "session", key: "bad", value: { index: -1 } },
    }),
  ).toThrow();
  expect(JSON.stringify(s)).toBe(before);
  const invalid = structuredClone(generated.materials[0]);
  (invalid.timeline[0].rivers as any)[0] = [{ tile: null }];
  expect(() =>
    phoneReduce(s, { action: "round_review_cache", material: invalid }),
  ).toThrow();
  expect(JSON.stringify(s)).toBe(before);
});

async function writePhone(page: Page, state: PhoneState) {
  await page.evaluate(
    (state) =>
      new Promise<void>((done, fail) => {
        const r = indexedDB.open("kyokuloop-phone-v1", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("local");
        r.onerror = () => fail(r.error);
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction("local", "readwrite");
          tx.objectStore("local").put(state, "state");
          tx.oncomplete = () => {
            db.close();
            done();
          };
          tx.onerror = () => fail(tx.error);
        };
      }),
    state,
  );
}
async function setup(
  page: Page,
  phone: boolean,
  materials = generated.materials,
) {
  const catalog = {
    ...generated.catalog,
    rounds: materials.map((m) => ({ index: m.round_index, label: m.label })),
  };
  let review: ReviewState = newReviewState();
  let reads = 0;
  const requests: string[] = [];
  await page.route("**/api/local", async (route) => {
    const r = route.request().postDataJSON();
    requests.push(r.action);
    const value =
      r.action === "state"
        ? { ...generated.workspace, analysis_queue: [entry] }
        : r.action === "round_review_state"
          ? review
          : r.action === "round_review_change"
            ? (review = changeReview(review, r.op))
            : r.action === "round_review_catalog"
              ? catalog
              : r.action === "round_review_material"
                ? materials.find((m) => m.round_index === r.round_index)
                : {};
    await route.fulfill({ json: { ok: true, data: value } });
  });
  await page.route("**/phone/api", async (route) => {
    const r = route.request().postDataJSON();
    reads++;
    await route.fulfill({
      json: {
        ok: true,
        data:
          r.action === "round_review_catalog"
            ? catalog
            : materials.find((m) => m.round_index === r.round_index),
      },
    });
  });
  if (phone) {
    await page.addInitScript(() =>
      Object.defineProperty(navigator, "onLine", { get: () => false }),
    );
    await page.goto("/phone/");
    const state = phoneReduce(freshPhoneState("review-browser"), {
      action: "install_pack",
      pack: generated.pack,
    }).state;
    state.analysis_queue = [entry];
    await writePhone(page, state);
    await page.reload();
  } else await page.goto("/");
  await page.getByRole("button", { name: "牌譜", exact: true }).click();
  await page
    .getByTestId("analysis-row")
    .getByRole("button", { name: "一局レビュー", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "一局レビュー", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("現在の手順")).toHaveText("1 / 11");
  return { requests, reads: () => reads };
}

function withQuietMiddleHand() {
  const materials = [
    generated.materials[0],
    generated.materials[1],
    generated.materials[1],
  ].map((material) => structuredClone(material));
  materials.forEach((m, i) => {
    m.round_index = i;
    m.label = `東${i + 1}局 0本場`;
    m.timeline.forEach((s) => {
      s.round_index = i;
    });
  });
  materials[1].timeline.forEach((s) => {
    if (s.is_decision) s.actual = s.suggested;
  });
  return materials;
}

test("match discrepancies skip a quiet hand in both directions and preserve quiz answers and resume", async ({
  page,
}, info) => {
  const materials = withQuietMiddleHand();
  await setup(page, info.project.name === "phone", materials);
  const next = page.getByRole("button", { name: "次の不一致", exact: true });
  const previous = page.getByRole("button", {
    name: "前の不一致",
    exact: true,
  });
  await page.getByRole("button", { name: "クイズあり", exact: true }).click();
  await next.click();
  await page.getByTestId("real-hand").getByRole("button").first().click();
  for (let i = 0; i < 5; i++) await next.click();
  await expect(page.getByLabel("振り返る局")).toHaveValue("2");
  await expect(page.getByLabel("現在の手順")).toHaveText("2 / 11");
  await expect(
    page.getByRole("button", { name: "クイズあり", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".review-policy")).toHaveCount(0);
  await previous.click();
  await expect(page.getByLabel("振り返る局")).toHaveValue("0");
  await expect(page.getByLabel("現在の手順")).toHaveText("10 / 11");
  for (let i = 0; i < 4; i++) await previous.click();
  await expect(page.getByLabel("現在の手順")).toHaveText("2 / 11");
  await expect(
    page.locator(".review-mark").filter({ hasText: "回答" }),
  ).toHaveCount(1);
  await expect(previous).toBeDisabled();
  await page.getByLabel("振り返る局").selectOption("2");
  for (let i = 0; i < 4; i++) await next.click();
  await expect(next).toBeDisabled();
  await page.getByRole("button", { name: "牌譜に戻る", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "牌譜", exact: true }).click();
  await page
    .getByTestId("analysis-row")
    .getByRole("button", { name: "一局レビュー", exact: true })
    .click();
  await expect(page.getByLabel("振り返る局")).toHaveValue("2");
  await expect(page.getByLabel("現在の手順")).toHaveText("10 / 11");
});

test("match discrepancy search with no destination stops in place without wrapping", async ({
  page,
}, info) => {
  const materials = withQuietMiddleHand();
  materials[2].timeline.forEach((s) => {
    if (s.is_decision) s.actual = s.suggested;
  });
  await setup(page, info.project.name === "phone", materials);
  const next = page.getByRole("button", { name: "次の不一致", exact: true });
  for (let i = 0; i < 5; i++) await next.click();
  await next.click();
  await expect(next).toBeDisabled();
  await expect(page.getByLabel("振り返る局")).toHaveValue("0");
  await expect(page.getByLabel("現在の手順")).toHaveText("10 / 11");
  await page.getByLabel("振り返る局").selectOption("1");
  await page.getByRole("button", { name: "前の不一致", exact: true }).click();
  await expect(page.getByLabel("振り返る局")).toHaveValue("0");
  await expect(page.getByLabel("現在の手順")).toHaveText("10 / 11");
});

test("match discrepancy search never skips an unavailable intermediate hand and retries the original search", async ({
  page,
}, info) => {
  const phone = info.project.name === "phone";
  await setup(page, phone, withQuietMiddleHand());
  const next = page.getByRole("button", { name: "次の不一致", exact: true });
  for (let i = 0; i < 5; i++) await next.click();
  await page.getByRole("button", { name: "クイズあり", exact: true }).click();
  let blocked = true;
  const readRounds: number[] = [];
  await page.route(phone ? "**/phone/api" : "**/api/local", async (route) => {
    const r = route.request().postDataJSON();
    if (r.action === "round_review_material") {
      readRounds.push(r.round_index);
      if (blocked && r.round_index === 1)
        return route.fulfill({ status: 503, body: "" });
    }
    return route.fallback();
  });
  await next.click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("振り返る局")).toHaveValue("0");
  await expect(page.getByLabel("現在の手順")).toHaveText("10 / 11");
  expect(readRounds).not.toContain(2);
  blocked = false;
  await page.getByRole("button", { name: "再試行", exact: true }).click();
  await expect(page.getByLabel("振り返る局")).toHaveValue("2");
  await expect(page.getByLabel("現在の手順")).toHaveText("2 / 11");
  await expect(
    page.getByRole("button", { name: "クイズあり", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("connected hands browse both boundaries, carry quiz modes and retain each hand's answers", async ({
  page,
}, info) => {
  await setup(page, info.project.name === "phone");
  const next = page.getByRole("button", { name: "次の一手", exact: true });
  const previous = page.getByRole("button", { name: "前の一手", exact: true });
  const round = page.getByLabel("振り返る局");
  await expect(previous).toBeDisabled();
  for (let i = 0; i < 10; i++) await next.click();
  await expect(page.getByLabel("現在の手順")).toHaveText("11 / 11");
  await expect(next).toBeEnabled();
  // The same empty-board tap continues into the next hand.
  const board = page.locator(".round-review .table");
  const box = await board.boundingBox();
  if (!box) throw Error("board missing");
  await board.click({ position: { x: box.width / 2, y: box.height - 15 } });
  await expect(round).toHaveValue("1");
  await expect(page.getByLabel("現在の手順")).toHaveText("1 / 11");
  await expect(
    page.getByRole("button", { name: "クイズなし", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await previous.click();
  await expect(round).toHaveValue("0");
  await expect(page.getByLabel("現在の手順")).toHaveText("11 / 11");
  await page.getByRole("button", { name: "クイズあり", exact: true }).click();
  await next.click();
  await expect(round).toHaveValue("1");
  await expect(page.getByLabel("現在の手順")).toHaveText("1 / 11");
  await expect(
    page.getByRole("button", { name: "クイズあり", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await next.click();
  await expect(next).toBeDisabled();
  await page.getByTestId("real-hand").getByRole("button").first().click();
  await round.selectOption("0");
  await expect(
    page.getByRole("button", { name: "クイズあり", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await round.selectOption("1");
  await expect(page.getByLabel("現在の手順")).toHaveText("2 / 11");
  await expect(
    page.locator(".review-mark").filter({ hasText: "回答" }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "クイズなし", exact: true }).click();
  await round.selectOption("0");
  await expect(
    page.getByRole("button", { name: "クイズなし", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await next.click();
  for (let i = 0; i < 10; i++) await next.click();
  await expect(round).toHaveValue("1");
  await expect(next).toBeDisabled();
  await expect(page.getByLabel("現在の手順")).toHaveText("11 / 11");
});

test("connected hands next decision crosses hands and inertia stops at unanswered decisions", async ({
  page,
}, info) => {
  await setup(page, info.project.name === "phone");
  const next = page.getByRole("button", { name: "次の一手", exact: true });
  for (let i = 0; i < 9; i++) await next.click();
  await page.getByRole("button", { name: "クイズあり", exact: true }).click();
  await page.getByTestId("real-hand").getByRole("button").first().click();
  await page.getByRole("button", { name: "次の判断へ", exact: true }).click();
  await expect(page.getByLabel("振り返る局")).toHaveValue("1");
  await expect(page.getByLabel("現在の手順")).toHaveText("2 / 11");
  await expect(next).toBeDisabled();
  await page
    .locator(".round-review .table")
    .dispatchEvent("wheel", { deltaY: 800 });
  await page.waitForTimeout(650);
  await expect(page.getByLabel("現在の手順")).toHaveText("2 / 11");
  await expect(page.locator(".review-policy")).toHaveCount(0);
  await page.getByRole("button", { name: "クイズなし", exact: true }).click();
  await page.getByRole("button", { name: "前の一手", exact: true }).click();
  await page
    .locator(".round-review .table")
    .dispatchEvent("wheel", { deltaY: -480 });
  await expect(page.getByLabel("振り返る局")).toHaveValue("0");
  await expect(page.getByLabel("現在の手順")).toHaveText("11 / 11");
});

test("connected hands swipe does not turn its synthetic click into an extra step in the new hand", async ({
  page,
}, info) => {
  await setup(page, info.project.name === "phone");
  for (let i = 0; i < 10; i++)
    await page.getByRole("button", { name: "次の一手", exact: true }).click();
  await page.locator(".round-review .table").evaluate((board) => {
    for (const [type, y] of [
      ["touchstart", 300],
      ["touchmove", 220],
      ["touchend", 220],
    ] as const) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "touches", {
        value: type === "touchend" ? [] : [{ clientX: 100, clientY: y }],
      });
      board.dispatchEvent(event);
    }
  });
  await expect(page.getByLabel("振り返る局")).toHaveValue("1");
  await page.locator(".round-review .table").dispatchEvent("click");
  await expect(page.getByLabel("現在の手順")).toHaveText("1 / 11");
});

test("connected hands failed next-hand load retains the old scene and retries with quiz mode", async ({
  page,
}, info) => {
  const phone = info.project.name === "phone";
  await setup(page, phone);
  const next = page.getByRole("button", { name: "次の一手", exact: true });
  for (let i = 0; i < 10; i++) await next.click();
  await page.getByRole("button", { name: "クイズあり", exact: true }).click();
  let fail = true;
  await page.route(phone ? "**/phone/api" : "**/api/local", async (route) => {
    const r = route.request().postDataJSON();
    if (fail && r.action === "round_review_material" && r.round_index === 1)
      return route.fulfill({ status: 503, body: "" });
    return route.fallback();
  });
  await next.click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("振り返る局")).toHaveValue("0");
  await expect(page.getByLabel("現在の手順")).toHaveText("11 / 11");
  fail = false;
  await page.getByRole("button", { name: "再試行", exact: true }).click();
  await expect(page.getByLabel("振り返る局")).toHaveValue("1");
  await expect(page.getByLabel("現在の手順")).toHaveText("1 / 11");
  await expect(
    page.getByRole("button", { name: "クイズあり", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("one round quiz reveals up to three hand labels, saves and resumes without the instruction line", async ({
  page,
}, info) => {
  const phone = info.project.name === "phone";
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const fixture = await setup(page, phone);
  await expect(page.getByText("盤面の余白", { exact: false })).toHaveCount(0);
  await page.getByRole("button", { name: "クイズあり", exact: true }).click();
  await page.getByRole("button", { name: "次の一手", exact: true }).click();
  await expect(page.getByLabel("現在の手順")).toHaveText("2 / 11");
  await expect(page.locator(".review-policy")).toHaveCount(0);
  await expect(page.locator(".review-mark")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "次の一手", exact: true }),
  ).toBeDisabled();
  await page.getByTestId("real-hand").getByRole("button").first().click();
  await expect(page.locator(".review-policy")).toHaveCount(2);
  await expect(
    page.locator(".review-mark").filter({ hasText: "回答" }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "答え合わせ", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "次の判断へ", exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel("現在の手順")).toHaveText("2 / 11");
  await expect(
    page.locator(".review-mark").filter({ hasText: "実打" }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "☆ 場面を保存", exact: true }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByRole("button", { name: "押し引き", exact: true }).click();
  await drawer.getByLabel("場面のメモ").fill("この一手を確認");
  await drawer.getByRole("button", { name: "保存欄を閉じる" }).click();
  await page.getByRole("button", { name: "牌譜に戻る", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "牌譜", exact: true }).click();
  const reads = fixture.reads();
  await page
    .getByTestId("analysis-row")
    .getByRole("button", { name: "一局レビュー", exact: true })
    .click();
  await expect(page.getByLabel("現在の手順")).toHaveText("2 / 11");
  await expect(page.locator(".review-policy")).toHaveCount(2);
  await page.getByRole("button", { name: /保存した場面 1/ }).click();
  await expect(page.getByRole("dialog")).toContainText("この一手を確認");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存欄を閉じる" })
    .click();
  if (phone) expect(fixture.reads()).toBe(reads);
  expect(
    fixture.requests.filter((r) => r.startsWith("study_") || r === "save"),
  ).toEqual([]);
  await page.screenshot({
    path: info.outputPath("round-review.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("board tap and inertial scroll advance events, quiz is a stop and notes never move the board", async ({
  page,
}, info) => {
  await setup(page, info.project.name === "phone");
  const board = page.locator(".round-review .table");
  const size = await board.boundingBox();
  if (!size) throw Error("board missing");
  await board.click({ position: { x: size.width / 2, y: size.height - 15 } });
  await expect(page.getByLabel("現在の手順")).toHaveText("2 / 11");
  await board.dispatchEvent("wheel", { deltaY: 480, deltaX: 0, deltaMode: 0 });
  await expect(page.getByLabel("現在の手順")).toHaveText("10 / 11");
  await page.getByRole("button", { name: "クイズあり", exact: true }).click();
  await page.getByRole("button", { name: "前の不一致", exact: true }).click();
  const position = await page.getByLabel("現在の手順").textContent();
  await board.dispatchEvent("wheel", { deltaY: 800, deltaX: 0, deltaMode: 0 });
  await page.waitForTimeout(300);
  await expect(page.getByLabel("現在の手順")).toHaveText(position!);
  await page.getByRole("button", { name: "☆ 場面を保存", exact: true }).click();
  const memo = page.getByRole("dialog").getByLabel("場面のメモ");
  await memo.dispatchEvent("wheel", { deltaY: 500 });
  await expect(page.getByLabel("現在の手順")).toHaveText(position!);
});

test("round selection and cross-hand discrepancy jumps retain saved context and fit narrow screens", async ({
  page,
}, info) => {
  await setup(page, info.project.name === "phone");
  await page.getByLabel("振り返る局").selectOption("1");
  await expect(page.getByLabel("現在の手順")).toHaveText("1 / 11");
  await page.getByRole("button", { name: "次の不一致", exact: true }).click();
  await expect(page.getByLabel("現在の手順")).toHaveText("2 / 11");
  await expect(
    page.getByRole("button", { name: "前の不一致", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "☆ 場面を保存", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存欄を閉じる" })
    .click();
  await page.getByRole("button", { name: "牌譜に戻る", exact: true }).click();
  await page
    .getByTestId("analysis-row")
    .getByRole("button", { name: "一局レビュー", exact: true })
    .click();
  await expect(page.getByLabel("振り返る局")).toHaveValue("1");
  await expect(page.getByLabel("現在の手順")).toHaveText("2 / 11");
  await page.getByRole("button", { name: "牌譜に戻る", exact: true }).click();
  await page.getByRole("button", { name: "学習", exact: true }).click();
  await page.getByRole("button", { name: "保存した場面", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /東2局 0本場 · 手順2/ })
    .click();
  await expect(page.getByLabel("現在の手順")).toHaveText("2 / 11");
  for (const width of [1060, 650, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`round-${width}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect
    .poll(
      async () =>
        (await page.locator(".round-review .table").boundingBox())?.width ?? 0,
    )
    .toBeGreaterThanOrEqual(400);
  await expect
    .poll(async () => {
      const b = await page
        .getByRole("button", { name: "★ 保存済み", exact: true })
        .boundingBox();
      return b ? b.y + b.height : 10000;
    })
    .toBeLessThanOrEqual(768);
  const tops = await page
    .getByTestId("real-hand")
    .locator(":scope > span")
    .evaluateAll((tiles) =>
      tiles.map((t) => Math.round(t.getBoundingClientRect().top)),
    );
  expect(new Set(tops).size).toBe(1);
  await page.screenshot({
    path: info.outputPath("round-ipad.png"),
    fullPage: true,
  });
  await page.locator(".phone-app").evaluate((app) => {
    (app as HTMLElement).style.paddingBottom = "34px";
    window.dispatchEvent(new Event("resize"));
  });
  await expect
    .poll(async () => {
      const b = await page
        .getByRole("button", { name: "★ 保存済み", exact: true })
        .boundingBox();
      return b ? b.y + b.height : 10000;
    })
    .toBeLessThanOrEqual(734);
});

test("a failed scene save stays recoverable, blocks exit and commits the note after retry", async ({
  page,
}, info) => {
  const phone = info.project.name === "phone";
  await setup(page, phone);
  let blocked = true;
  if (phone)
    await page.evaluate(() => {
      (globalThis as any).reviewBlocked = true;
      const original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, ...args) {
        if (
          (globalThis as any).reviewBlocked &&
          value?.review?.state?.bookmarks?.length
        )
          throw new DOMException("fixture quota", "QuotaExceededError");
        return original.call(this, value, ...args);
      };
    });
  else
    await page.route("**/api/local", async (route) => {
      const r = route.request().postDataJSON();
      if (
        blocked &&
        r.action === "round_review_change" &&
        r.op.kind === "bookmark"
      )
        return route.fulfill({ status: 503, body: "" });
      return route.fallback();
    });
  await page.getByRole("button", { name: "☆ 場面を保存", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("場面のメモ")
    .fill("保存に失敗しても保持");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存欄を閉じる" })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "牌譜に戻る", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "一局レビュー", exact: true }),
  ).toBeVisible();
  blocked = false;
  if (phone)
    await page.evaluate(() => {
      (globalThis as any).reviewBlocked = false;
    });
  await page.getByRole("button", { name: "再試行", exact: true }).click();
  await expect(page.getByRole("alert")).not.toBeVisible();
  await page.getByRole("button", { name: "牌譜に戻る", exact: true }).click();
  await page.getByRole("button", { name: "学習", exact: true }).click();
  await page.getByRole("button", { name: "保存した場面", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("保存に失敗しても保持");
});

test("touch inertia advances multiple events while its synthetic click is suppressed", async ({
  page,
}, info) => {
  await setup(page, info.project.name === "phone");
  const immediate = await page
    .locator(".round-review .table")
    .evaluate((board) => {
      const emit = (type: string, y: number) => {
        const e = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(e, "touches", {
          value: type === "touchend" ? [] : [{ clientX: 100, clientY: y }],
        });
        board.dispatchEvent(e);
      };
      emit("touchstart", 300);
      emit("touchmove", 200);
      emit("touchend", 200);
      const before = document.querySelector(
        '[aria-label="現在の手順"]',
      )?.textContent;
      board.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      return {
        before,
        after: document.querySelector('[aria-label="現在の手順"]')?.textContent,
      };
    });
  expect(immediate.after).toBe(immediate.before);
  await expect
    .poll(async () =>
      Number(
        (await page.getByLabel("現在の手順").textContent())!.split("/")[0],
      ),
    )
    .toBeGreaterThan(3);
});

test("an unavailable round gives a readable error and retry opens the attempted round", async ({
  page,
}, info) => {
  const phone = info.project.name === "phone";
  await setup(page, phone);
  let unavailable = true;
  await page.route(phone ? "**/phone/api" : "**/api/local", async (route) => {
    const r = route.request().postDataJSON();
    if (
      unavailable &&
      r.action === "round_review_material" &&
      r.round_index === 1
    )
      return route.abort();
    return route.fallback();
  });
  await page.getByLabel("振り返る局").selectOption("1");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("alert")).not.toContainText("Failed to fetch");
  unavailable = false;
  await page.getByRole("button", { name: "再試行", exact: true }).click();
  await expect(page.getByLabel("振り返る局")).toHaveValue("1");
  await expect(page.getByLabel("現在の手順")).toHaveText("1 / 11");
});
