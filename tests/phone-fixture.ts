import { execFileSync } from "node:child_process";
import type { PhonePack } from "../src/offline/engine";
export function phoneFixture(reveals = false): PhonePack {
  const pack: PhonePack = JSON.parse(
    execFileSync(
      "python",
      [
        "-c",
        `
import sys,json,tempfile
from pathlib import Path
sys.path.insert(0,'tests')
from test_p3_study import five_fixture
from tools.p2_store import Store
with tempfile.TemporaryDirectory(dir='D:/dev-data/kyoku-loop/private') as temp:
 s=Store(Path(temp)/'test.sqlite3')
 try:
  r=s.commit(s.stage(json.dumps(five_fixture()).encode(),None)['token'],0,0,None)
  for scene in s.detail(r['id'])['decisions'][3:]:s.save(r['id'],scene['id'],True)
  s.db.execute("UPDATE study_items SET due='2026-01-02'");s.db.commit()
  print(json.dumps(s.phone_pack(),ensure_ascii=True))
 finally:s.close()
`,
      ],
      { encoding: "utf8", windowsHide: true },
    ),
  );
  if (!reveals) delete pack.reveals;
  return pack;
}
