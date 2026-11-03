import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { freshPhoneState, phoneReduce } from "../src/offline/engine";
test("practice rotates through unanswered items, preserves active session and scheduled streaks", () => {
  const pack = JSON.parse(
    execFileSync(
      "python",
      [
        "-c",
        `import sys,json,tempfile
from pathlib import Path
sys.path.insert(0,'tests')
from test_p3_study import five_fixture
from tools.p2_store import Store
with tempfile.TemporaryDirectory(dir='D:/dev-data/kyoku-loop/private') as temp:
 s=Store(Path(temp)/'test.sqlite3')
 r=s.commit(s.stage(json.dumps(five_fixture(8)).encode(),None)['token'],0,0,None)
 for scene in s.detail(r['id'])['decisions']:s.save(r['id'],scene['id'],True)
 print(json.dumps(s.phone_pack(),ensure_ascii=True))
 s.close()`,
      ],
      { encoding: "utf8", windowsHide: true },
    ),
  );
  let state = freshPhoneState("rotation-device");
  const call = (r: object) => {
    const result = phoneReduce(state, r);
    state = result.state;
    return result.data as any;
  };
  call({ action: "install_pack", pack });
  let q = call({ action: "study_start", mode: "practice" });
  const first = state.session!.queue.map((i) => i.id);
  expect(call({ action: "study_start", mode: "practice" }).id).toBe(q.id);
  for (let n = 0; n < 5; n++) {
    call({
      action: "study_choice",
      session: q.id,
      choice: "choose",
      answer: q.scene.own_hand[0],
    });
    call({ action: "study_choice", session: q.id, choice: "confirm" });
    q = call({
      action: "study_rate",
      session: q.id,
      item: q.item_id,
      rating: "理解した",
      event: `rotation-${n}`,
    });
  }
  expect(q.complete).toBe(true);
  call({ action: "study_start", mode: "practice" });
  expect(
    state.session!.queue.filter((i) => !first.includes(i.id)),
  ).toHaveLength(3);
  expect(state.pack!.items.every((i) => i.streak === 0)).toBe(true);
});
