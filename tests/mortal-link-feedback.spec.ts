import { test, expect } from "@playwright/test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MortalRegistrationNotice } from "../src/mortal-registration-notice";
import { freshPhoneState, phoneReduce } from "../src/offline/engine";
import { execFileSync } from "node:child_process";

const receipt = {
  id: "a".repeat(64),
  duplicate: false,
  source_link: {
    linked: true,
    analysis_id: "fictional",
    at: "2026-01-02T00:03:00Z",
    rank: 4,
    score: 1300,
  },
};
const render = (result: any, local = true, entries: any[] = []) =>
  renderToStaticMarkup(
    createElement(MortalRegistrationNotice, { result, local, entries }),
  );
test("registration separately confirms actual source, date, rank and score for local/Windows and duplicates", () => {
  const html = render(receipt);
  expect(html).toContain("この端末に登録しました");
  expect(html).toContain("元牌譜に紐付け済み");
  expect(html).toContain("2026/1/2 09:03");
  expect(html).toContain("4位 · 1,300点");
  const duplicate = render({ ...receipt, duplicate: true }, false);
  expect(duplicate).toContain("Windowsに登録済みの結果です");
  expect(duplicate).toContain("元牌譜に紐付け済み");
});
test("unlinked and old acknowledgements never look linked just because a candidate exists", () => {
  expect(
    render({ ...receipt, source_link: { linked: false, analysis_id: null } }),
  ).toContain("元牌譜は未紐付けです");
  expect(render({ id: receipt.id, duplicate: false })).toContain(
    "元牌譜との紐付けは未確認です",
  );
  expect(
    render({ ...receipt, source_link: { linked: true, analysis_id: null } }),
  ).toContain("元牌譜に紐付け済み");
});
test("later exact report references update a JSON-first receipt without guessing by scores", () => {
  const pending = {
    ...receipt,
    source_link: { linked: false, analysis_id: null },
  };
  const entry = {
    id: "fictional",
    reports: [receipt.id],
    history: {
      at: receipt.source_link.at,
      rank: 4,
      seat: 3,
      players: [48100, 33700, 16900, 1300].map((score) => ({
        name: "fictional",
        score,
      })),
    },
  };
  expect(render(pending, true, [entry])).toContain("元牌譜に紐付け済み");
  expect(render(pending, true, [{ ...entry, reports: [] }])).toContain(
    "元牌譜は未紐付けです",
  );
});
test("local and Windows registration receipts reflect committed state, including duplicate and no-source outcomes", () => {
  const compiled = JSON.parse(
    execFileSync(
      "python",
      [
        "-c",
        `
import sys,json,base64,tempfile
from pathlib import Path
sys.path.insert(0,'tests')
from test_p8_mortal import mortal_fixture
from test_p17_auto_link import history,batch
from tools.mortal_material import compile_upload
from tools.p2_store import Store
raw=json.dumps(mortal_fixture()).encode()
m=compile_upload(base64.b64encode(raw).decode(),'2026-11-04T01:00:00.000Z')
with tempfile.TemporaryDirectory(dir='D:/dev-data/kyoku-loop/private') as folder:
 s=Store(Path(folder)/'receipt.sqlite3')
 s.analysis_bulk(batch([history()]))
 stage=s.phone_mortal_inspect(m['payload'],None)
 reply=s.phone_mortal_register(stage['token'],stage['source'],None)
 again=s.phone_mortal_register(stage['token'],stage['source'],None)
 print(json.dumps({'material':m,'reply':reply,'duplicate':again,'entry':s.analysis_entries()[0]}))
 s.close()
`,
      ],
      { encoding: "utf8", windowsHide: true },
    ),
  );
  expect(compiled.reply.source_link).toMatchObject({
    linked: true,
    rank: 1,
    score: 25000,
  });
  expect(compiled.duplicate.source_link).toEqual(compiled.reply.source_link);
  let state = phoneReduce(freshPhoneState("receipt"), {
    action: "enable_local",
  }).state;
  const noSource: any = phoneReduce(state, {
    action: "register_local",
    material: compiled.material,
    final_scores: [25000, 25000, 25000, 25000],
    analysis_id: null,
  });
  expect(noSource.data.source_link).toMatchObject({
    linked: false,
    analysis_id: null,
  });
  state = phoneReduce(state, {
    action: "analysis_bulk",
    data: JSON.stringify({
      kind: "kyokuloop-history",
      version: 1,
      player: 123,
      entries: [compiled.entry.history],
    }),
  }).state;
  const linked: any = phoneReduce(state, {
    action: "register_local",
    material: compiled.material,
    final_scores: [25000, 25000, 25000, 25000],
    analysis_id: null,
  });
  expect(linked.data.source_link).toEqual(compiled.reply.source_link);
  const duplicate: any = phoneReduce(linked.state, {
    action: "register_local",
    material: compiled.material,
    final_scores: [25000, 25000, 25000, 25000],
    analysis_id: null,
  });
  expect(duplicate.data.source_link).toEqual(linked.data.source_link);
});
