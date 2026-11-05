import copy
import json
import tempfile
import unittest
from pathlib import Path
from test_p3_study import five_fixture
from tools.p2_store import Store


class RoundReviewTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir='D:/dev-data/kyoku-loop/private')
        self.store = Store(Path(self.temp.name)/'test.sqlite3')
        stage = self.store.stage(json.dumps(five_fixture()).encode(), None)
        self.report = self.store.commit(stage['token'], 0, 0, None)['id']

    def tearDown(self):
        self.store.close()
        self.temp.cleanup()

    def test_selected_round_has_all_events_exact_decisions_and_no_future_hands(self):
        from tools.round_review import catalog, material
        index = catalog(self.store, self.report)
        self.assertEqual(len(index['rounds']), 1)
        value = material(self.store, self.report, 0)
        detail = self.store.detail(self.report)
        self.assertEqual([s['event_index'] for s in value['timeline']], [s['event_index'] for s in detail['timeline']])
        self.assertEqual(sum(bool(s.get('is_decision')) for s in value['timeline']), 5)
        self.assertNotIn('hands', value['timeline'][0])
        self.assertIn(str(value['timeline'][0]['event_index']), value['reveals'])
        self.assertTrue(all('raw_weights' not in s for s in value['timeline']))

    def test_review_save_and_resume_are_independent_and_backup_retains_them(self):
        from tools.round_review import read_state, change
        before = copy.deepcopy(self.store.state())
        change(self.store, {'kind':'session', 'key':self.report+':0', 'value':{'index':2,'quiz':True,'selected':{'2':'1m'},'answers':{}}})
        bookmark = {'id':'a'*64+':0:0:2','report':self.report,'round_index':0,'event_index':2,'label':'東1局 0本場','tag':'手作り','memo':'再確認'}
        change(self.store, {'kind':'bookmark','value':bookmark})
        change(self.store, {'kind':'bookmark','value':dict(bookmark, memo='保持')})
        self.assertEqual(before, self.store.state())
        state = read_state(self.store)
        self.assertEqual(len(state['bookmarks']), 1)
        backup = self.store.backup_create()
        second = Store(Path(self.temp.name)/'second.sqlite3')
        try:
            plan = second.backup_inspect(backup['name'])
            second.backup_restore(backup['name'], plan['hash'])
            self.assertEqual(read_state(second), state)
        finally:
            second.close()

    def test_bad_requests_do_not_modify_any_review_or_srs(self):
        from tools.round_review import read_state, change, material
        state = read_state(self.store)
        with self.assertRaises(ValueError): material(self.store, self.report, -1)
        with self.assertRaises(ValueError): change(self.store, {'kind':'session','key':'x','value':{'index':-1}})
        self.assertEqual(read_state(self.store), state)

    def test_mortal_worker_projection_matches_windows_without_changing_old_material(self):
        import base64
        from test_p8_mortal import mortal_fixture
        from tools.mortal_material import compile_upload, review_upload
        from tools.round_review import material
        raw = json.dumps(mortal_fixture(True)).encode()
        encoded = base64.b64encode(raw).decode()
        created = '2026-01-01T00:00:00Z'
        before = compile_upload(encoded, created)
        result = self.store.commit(self.store.stage(raw, None)['token'], 0, 0, None)
        value = review_upload(encoded, created, 0)
        self.assertEqual(value, material(self.store, result['id'], 0))
        self.assertEqual(compile_upload(encoded, created), before)
        decision = next(s for s in value['timeline'] if s['is_decision'])
        self.assertAlmostEqual(decision['policy_percent'][13], 45)
        self.assertAlmostEqual(decision['policy_percent'][35], 40)
        self.assertNotIn('policy_percent', value['timeline'][0])

    def test_restore_adds_missing_notes_without_overwriting_newer_progress(self):
        from tools.round_review import read_state, change
        op = {'kind':'session','key':self.report+':0','value':{'index':1,'quiz':True,'selected':{},'answers':{}}}
        change(self.store, op)
        backup = self.store.backup_create()
        change(self.store, dict(op, value=dict(op['value'], index=3)))
        latest = read_state(self.store)
        plan = self.store.backup_inspect(backup['name'])
        self.store.backup_restore(backup['name'], plan['hash'])
        self.assertEqual(read_state(self.store), latest)


if __name__ == '__main__': unittest.main()
