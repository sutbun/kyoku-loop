import json,tempfile,unittest
from pathlib import Path
from tools.p2_store import Store
from test_p0_verify import fixture

class PhonePackTests(unittest.TestCase):
    def test_export_is_read_only_and_contains_only_study_public_scenes(self):
        with tempfile.TemporaryDirectory(dir='D:/dev-data/kyoku-loop/private') as temp:
            s=Store(Path(temp)/'pack.sqlite3')
            try:
                r=fixture();r['player_info']={'name':['private-name']*4}
                s.commit(s.stage(json.dumps(r).encode(),None)['token'],0,0,None)
                before=s.db.execute('SELECT count(*) FROM review_events').fetchone()[0]
                pack=s.phone_pack()
                self.assertEqual(pack['schema'],1)
                self.assertEqual(len(pack['items']),1)
                self.assertNotIn('private-name',json.dumps(pack))
                self.assertNotIn('tehais',pack['items'][0]['scene'])
                self.assertEqual(s.db.execute('SELECT count(*) FROM review_events').fetchone()[0],before)
            finally:s.close()

if __name__=='__main__':unittest.main()
