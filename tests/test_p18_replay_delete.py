import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tools.p2_store import Store
from tools.study import StudyFailure
from test_p0_verify import fixture

URL = 'https://game.mahjongsoul.com/?paipu=260101-fictional-delete-one'
OTHER = 'https://game.mahjongsoul.com/?paipu=260101-fictional-delete-two'


class ReplayDeleteTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir='D:/dev-data/kyoku-loop/private')
        self.store = Store(Path(self.tmp.name)/'delete.sqlite3')

    def tearDown(self):
        self.store.close()
        self.tmp.cleanup()

    def test_delete_preserves_reports_questions_and_history_and_survives_stale_sync(self):
        a = self.store.analysis_add(URL)['entries'][0]
        b = self.store.analysis_add(OTHER)['entries'][0]
        stage = self.store.stage(json.dumps(fixture()).encode(), None)
        self.store.commit(stage['token'], 0, 0, URL, a['id'])
        self.store.study_start('practice')
        tables = ('sources', 'reports', 'study_items', 'review_events', 'study_sessions')
        before = {t: [dict(r) for r in self.store.db.execute('SELECT * FROM '+t)] for t in tables}
        self.store.analysis_delete([a['id'], b['id']])
        self.assertEqual(self.store.analysis_entries(), [])
        self.assertEqual(before, {t: [dict(r) for r in self.store.db.execute('SELECT * FROM '+t)] for t in tables})
        path = self.store.path
        self.store.close()
        self.store = Store(path)
        reply = self.store.analysis_receive([a, b])
        self.assertTrue(all(e['visibility']['deleted'] for e in reply['entries']))
        self.assertEqual(self.store.analysis_entries(), [])
        self.store.analysis_add(URL)
        self.assertEqual(self.store.analysis_entry(a['id'])['visibility'], {'revision': 2, 'deleted': False})
        self.assertEqual(len(self.store.analysis_entries()), 1)
        self.store.analysis_receive([dict(a, visibility={'revision': 1, 'deleted': True})])
        self.assertEqual(len(self.store.analysis_entries()), 1)
        self.store.analysis_bulk(URL+'\n'+OTHER)
        self.assertEqual(len(self.store.analysis_entries()), 2)

    def test_invalid_or_failed_batch_is_atomic(self):
        a = self.store.analysis_add(URL)['entries'][0]
        b = self.store.analysis_add(OTHER)['entries'][0]
        before = copy.deepcopy(self.store.analysis_entries())
        for ids in ([], [a['id'], 'missing'], [a['id'], a['id']], [None], 'bad'):
            with self.assertRaises(StudyFailure): self.store.analysis_delete(ids)
            self.assertEqual(self.store.analysis_entries(), before)
        put = self.store._put_analysis
        def fail(e):
            if e['id'] == b['id']: raise OSError('full')
            return put(e)
        with patch.object(self.store, '_put_analysis', side_effect=fail):
            with self.assertRaises(OSError): self.store.analysis_delete([a['id'], b['id']])
        self.assertEqual(self.store.analysis_entries(), before)

    def test_visibility_is_validated_before_sync_writes(self):
        a = self.store.analysis_add(URL)['entries'][0]
        for v in ({'revision': True, 'deleted': True}, {'revision': -1, 'deleted': False}, {'revision': 1, 'deleted': 'yes'}, None):
            with self.assertRaises(StudyFailure): self.store.analysis_receive([dict(a, visibility=v)])
        self.assertNotIn('visibility', self.store.analysis_entry(a['id']))

    def test_backup_preserves_deletion_and_old_backup_cannot_resurrect_it(self):
        a = self.store.analysis_add(URL)['entries'][0]
        old = self.store.backup_create()
        self.store.analysis_delete([a['id']])
        plan = self.store.backup_inspect(old['name'])
        self.store.backup_restore(old['name'], plan['hash'])
        self.assertEqual(self.store.analysis_entries(), [])
        new = self.store.backup_create()
        recovered = Store(Path(self.tmp.name)/'recovered.sqlite3')
        try:
            plan = recovered.backup_inspect(new['name'])
            recovered.backup_restore(new['name'], plan['hash'])
            self.assertEqual(recovered.analysis_entries(), [])
            self.assertTrue(recovered.analysis_entry(a['id'])['visibility']['deleted'])
        finally: recovered.close()
