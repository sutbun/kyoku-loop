"""Generated local imports and delayed sync; never uses real reports or HTTP."""
import base64
import gzip
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from tools.p2_store import Store, ImportFailure
from tools.mortal_material import compile_upload
from tools.mortal_report import sequential_sum
from test_p13_shortcut_json import two_rounds, repeated_rounds


class StandaloneTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir='D:/dev-data/kyoku-loop/private')
        self.store = Store(Path(self.tmp.name)/'test.sqlite3', clock=lambda: datetime(2026,11,20,tzinfo=timezone.utc))
        self.raw = json.dumps(repeated_rounds(two_rounds())).encode()
        self.material = compile_upload(base64.b64encode(self.raw).decode(), '2026-11-03T01:00:00.000Z')

    def tearDown(self):
        self.store.close(); self.tmp.cleanup()

    def register(self, ids=None, created='2026-11-03T01:00:00.000Z'):
        stage = self.store.phone_mortal_inspect(self.material['payload'], None)
        return self.store.phone_mortal_register(stage['token'], stage['source'], None, created,
                    ids if ids is not None else [i['id'] for i in self.material['items']])

    def test_delayed_registration_has_identical_ids_scenes_and_original_initial_due(self):
        result = self.register()
        self.assertEqual(result['id'], self.material['id'])
        pack = self.store.phone_pack()
        for initial in self.material['items']:
            item = next(i for i in pack['items'] if i['id']==initial['id'])
            self.assertEqual(item['scene'], initial['scene'])
            self.assertEqual(item['due'], '2026-11-04')
        before = [tuple(r) for r in self.store.db.execute('SELECT * FROM study_items')]
        self.assertTrue(self.register()['duplicate'])
        self.assertEqual(before, [tuple(r) for r in self.store.db.execute('SELECT * FROM study_items')])

    def test_invalid_metadata_never_commits_and_auto_quota_is_not_expanded(self):
        for ids, created in [(['not-a-scene'],'2026-11-03T01:00:00Z'), ([], '2026-12-01T00:00:00Z'), ([], '2026-11-03')]:
            with self.assertRaisesRegex(ImportFailure,'invalid_sync'): self.register(ids,created)
        self.assertEqual(self.store.state()['reports'], [])
        self.register()
        # A retained candidate absent from the auto set is inserted as manual only.
        ident = self.material['items'][0]['id']
        with self.store.db:
            self.store.db.execute('DELETE FROM study_items WHERE id=?',(ident,))
            for n in range(3):
                item = self.material['items'][0]
                self.store.db.execute('INSERT INTO study_items(id,report,scene,automatic,manual,status,history,due) VALUES(?,?,?,?,?,?,?,?)',
                    ('fictional-extra-'+str(n), self.material['id'], json.dumps(item['scene']),1,0,'未学習','[]','2026-11-04'))
        self.register()
        row = self.store.db.execute('SELECT automatic,manual,due FROM study_items WHERE id=?',(ident,)).fetchone()
        self.assertEqual(tuple(row),(0,1,'2026-11-04'))

    def test_original_payload_retained_and_inputs_fail_closed(self):
        self.assertEqual(gzip.decompress(base64.b64decode(self.material['payload'])), self.raw)
        for raw in (b'<html>wrong</html>', b'{}', b'[]', b'not JSON'):
            with self.assertRaises(ValueError): compile_upload(base64.b64encode(raw).decode(),'2026-11-03T01:00:00Z')
        self.assertEqual(sequential_sum([1e16, 1., -1e16]), 0.)


if __name__ == '__main__': unittest.main()
