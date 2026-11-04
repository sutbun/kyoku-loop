import { test, expect } from "@playwright/test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  mortalSourceOptions,
  MortalSourceSelect,
} from "../src/mortal-source-select";
import {
  validateAnalysisQueue,
  type AnalysisEntry,
} from "../src/analysis-queue";
import type { Stage } from "../src/real-types";
const stage: Stage = {
  engine: "Mortal",
  target_seat: 1,
  token: "fictional",
  players: ["架空A", "架空B", "架空C", "架空D"],
  models: [{ index: 0, name: "4.1b" }],
  rounds: 11,
};
function entry(
  n: number,
  at = "2026-11-03T00:00:00Z",
  seat = 1,
): AnalysisEntry {
  const url = `https://game.mahjongsoul.com/?paipu=260101-fictional-source-${n}_a${1358437 + ((7 * 123 + 1117113) ^ 86216345)}`;
  return {
    id: url.split("paipu=")[1],
    url,
    created: at,
    history: {
      url,
      player: 123,
      at,
      seat,
      rank: seat + 1,
      mode: 12,
      players: stage.players.map((name) => ({ name, score: 25000 })),
    },
  };
}
test("candidate labels use date, rank and opponents and prioritize exact four-name and target-name matches", () => {
  const inputs = [
    entry(1, "2026-11-04T00:00:00Z", 0),
    entry(2),
    entry(3, "2026-11-04T01:00:00Z"),
  ];
  validateAnalysisQueue(inputs);
  const before = structuredClone(inputs),
    result = mortalSourceOptions(inputs, stage, true);
  expect(result.map((o) => o.entry.id)).toEqual([
    inputs[2].id,
    inputs[1].id,
    inputs[0].id,
  ]);
  expect(result.map((o) => o.matches)).toEqual([true, true, false]);
  expect(result[0].label).toContain("2026/11/4 10:00");
  expect(result[0].label).toContain("2位");
  expect(result[0].label).toContain("架空A / 架空C / 架空D");
  expect(result[0].label).not.toContain("架空B");
  expect(result[0].label).not.toContain("fictional-source");
  expect(inputs).toEqual(before);
});
test("duplicate player names and case differences never become false matches", () => {
  const a = entry(1);
  a.history!.players[2].name = "架空B";
  expect(mortalSourceOptions([a], stage, true)[0].matches).toBe(false);
  const b = entry(2);
  b.history!.players[0].name = "架空a";
  expect(mortalSourceOptions([b], stage, true)[0].matches).toBe(false);
});
test("Windows-only registration hides unreceived URLs and missing metadata retains a stable fallback", () => {
  const a = entry(1),
    b = entry(2);
  b.received = "2026-11-04T00:00:00Z";
  delete b.history;
  expect(mortalSourceOptions([a, b], stage, false)).toHaveLength(1);
  expect(mortalSourceOptions([a, b], stage, false)[0].label).toContain(
    "保存牌譜 2",
  );
  expect(mortalSourceOptions([a, b], stage, true)).toHaveLength(2);
});
test("preview defaults to automatic linking; JSON opponents and manual source remain readable and escaped", () => {
  const a = entry(1);
  a.history!.players[0].name = "<script>other</script>";
  const same = entry(2);
  let changed = 0;
  const html = renderToStaticMarkup(
    createElement(MortalSourceSelect, {
      entries: [same, a],
      stage,
      local: true,
      value: "",
      disabled: false,
      onChange: () => changed++,
    }),
  );
  expect(changed).toBe(0);
  expect(html).toContain('value="" selected=""');
  expect(html).toContain("自動で紐付け（候補が1件の場合）");
  expect(html).toContain("4人の名前が一致");
  expect(html).toContain("JSONの対戦相手");
  expect(html).toContain("&lt;script&gt;other&lt;/script&gt;");
  expect(html).not.toContain("<script>");
  const chosen = renderToStaticMarkup(
    createElement(MortalSourceSelect, {
      entries: [same],
      stage,
      local: true,
      value: same.id,
      disabled: true,
      onChange: () => changed++,
    }),
  );
  expect(chosen).toContain("選択した牌譜");
  expect(chosen).toContain('disabled=""');
});

test("anonymous JSON uses all four final scores, own score and rank, independently of display order", () => {
  const anonymous = {
    ...stage,
    players: ["Aさん", "Bさん", "Cさん", "Dさん"],
    target_seat: 0,
    final_scores: [41000, 30000, 20000, 9000],
  };
  const same = entry(1);
  same.history!.players = [30000, 41000, 9000, 20000].map((score, i) => ({
    name: `架空${i}`,
    score,
  }));
  same.history!.rank = 1;
  const wrongOther = structuredClone(same);
  wrongOther.id += "x";
  wrongOther.history!.players[0].score = 31000;
  wrongOther.history!.players[3].score = 19000;
  const wrongOwn = structuredClone(same);
  wrongOwn.id += "y";
  wrongOwn.history!.seat = 0;
  wrongOwn.history!.rank = 2;
  const result = mortalSourceOptions(
    [wrongOther, wrongOwn, same],
    anonymous,
    true,
  );
  expect(result[0].entry.id).toBe(same.id);
  expect(result.map((o) => o.scoreMatches)).toEqual([true, false, false]);
  expect(result[0].label).toContain("41,000点");
  const html = renderToStaticMarkup(
    createElement(MortalSourceSelect, {
      entries: [same, { ...same, id: same.id + "duplicate-game" }],
      stage: anonymous,
      local: true,
      value: "",
      disabled: false,
      onChange: () => {
        throw Error("Must not auto select");
      },
    }),
  );
  expect(html).toContain("点数・順位が一致（2件の候補）");
  expect(html).toContain("JSONの最終点数");
  expect(html).toContain("41,000点 · 1位");
  expect(html).toContain('value="" selected=""');
});

test("ties use target seat to break ranks and malformed summaries cannot recommend scores", () => {
  const same = entry(1);
  const tied = {
    ...stage,
    players: ["Aさん", "Bさん", "Cさん", "Dさん"],
    final_scores: [25000, 25000, 25000, 25000],
  };
  expect(mortalSourceOptions([same], tied, true)[0].scoreMatches).toBe(true);
  expect(
    mortalSourceOptions([same], { ...tied, target_seat: 2 }, true)[0]
      .scoreMatches,
  ).toBe(false);
  for (const scores of [
    null,
    [25000, 25000, 25000],
    [25000, NaN, 25000, 25000],
    [25000.5, 24999.5, 25000, 25000],
  ]) {
    expect(
      mortalSourceOptions([same], { ...tied, final_scores: scores }, true)[0]
        .scoreMatches,
    ).toBe(false);
  }
  expect(
    mortalSourceOptions([same], { ...tied, target_seat: 4 }, true)[0]
      .scoreMatches,
  ).toBe(false);
});

test("one score candidate keeps automatic mode; conflicting scores do not get a name-match heading", () => {
  const same = entry(1);
  const scored = { ...stage, final_scores: [25000, 25000, 25000, 25000] };
  const render = (source: Stage) =>
    renderToStaticMarkup(
      createElement(MortalSourceSelect, {
        entries: [same],
        stage: source,
        local: true,
        value: "",
        disabled: false,
        onChange: () => {
          throw Error("Must not auto select");
        },
      }),
    );
  expect(render(scored)).toContain("点数・順位が一致（1件の候補）");
  expect(render(scored)).toContain(`value="${same.id}" selected=""`);
  const missing = render({
    ...scored,
    final_scores: [41000, 30000, 20000, 9000],
  });
  expect(missing).toContain("点数・順位が一致する候補はありません");
  expect(missing).not.toContain("4人の名前が一致");
  expect(missing).toContain(same.id);
  expect(render({ ...stage, final_scores: null })).toContain(
    "最終点数を照合できません",
  );
  expect(mortalSourceOptions([same], scored, false)).toHaveLength(0);
});

test("automatic source preview shows and defaults to the matching replay without a manual override", () => {
  const same = entry(1);
  same.history!.players[0].name = "<架空の相手>";
  const before = structuredClone(same);
  const html = renderToStaticMarkup(
    createElement(MortalSourceSelect, {
      entries: [same],
      stage: { ...stage, final_scores: [25000, 25000, 25000, 25000] },
      local: true,
      value: "",
      disabled: false,
      onChange: () => {
        throw Error("Preview must not change selection");
      },
    }),
  );
  const visible = html.split("</select>")[1];
  expect(visible).toContain("紐付け先（自動選択）");
  for (const text of [
    "2026/11/3 09:00",
    "2位",
    "25,000点",
    "&lt;架空の相手&gt; / 架空C / 架空D",
  ])
    expect(visible).toContain(text);
  expect(visible).not.toContain("紐付け済み");
  expect(html).toContain(`value="${same.id}" selected=""`);
  expect(same).toEqual(before);
});

test("ambiguous automatic candidates show both replay summaries and require manual choice", () => {
  const html = renderToStaticMarkup(
    createElement(MortalSourceSelect, {
      entries: [entry(1), entry(2, "2026-11-04T00:00:00Z")],
      stage: { ...stage, final_scores: [25000, 25000, 25000, 25000] },
      local: true,
      value: "",
      disabled: false,
      onChange: () => {},
    }),
  );
  const visible = html.split("</select>")[1];
  expect(visible).toContain("自動紐付けの候補（2件）");
  expect(visible).toContain("2026/11/3 09:00");
  expect(visible).toContain("2026/11/4 09:00");
  expect(visible).toContain("候補が複数あるため、元牌譜を選んでください。");
  expect(html).toContain('value="" selected=""');
});

test("no score match, unavailable scores and unreceived Windows sources never appear as automatic candidates", () => {
  for (const [scores, local] of [
    [null, true],
    [[41000, 30000, 20000, 9000], true],
    [[25000, 25000, 25000, 25000], false],
  ] as const) {
    const html = renderToStaticMarkup(
      createElement(MortalSourceSelect, {
        entries: [entry(1)],
        stage: { ...stage, final_scores: scores ? [...scores] : null },
        local,
        value: "",
        disabled: false,
        onChange: () => {},
      }),
    );
    expect(html.split("</select>")[1]).not.toContain("自動紐付けの候補");
    expect(html.split("</select>")[1]).not.toContain("紐付け先（自動選択）");
  }
});

test("manual selection replaces the automatic preview with the explicitly chosen replay", () => {
  const same = entry(1),
    other = entry(2, "2026-11-04T00:00:00Z");
  const html = renderToStaticMarkup(
    createElement(MortalSourceSelect, {
      entries: [same, other],
      stage: { ...stage, final_scores: [25000, 25000, 25000, 25000] },
      local: true,
      value: other.id,
      disabled: true,
      onChange: () => {},
    }),
  );
  const visible = html.split("</select>")[1];
  expect(visible).toContain("選択した牌譜：2026/11/4 09:00");
  expect(visible).not.toContain("自動紐付けの候補");
  expect(visible).not.toContain("2026/11/3 09:00");
});
