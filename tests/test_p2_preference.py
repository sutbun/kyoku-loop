"""NAGA-type preference tests with generated reports and private scratch DBs."""
import base64
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from test_p0_verify import fixture
from tools.p2_store import Store
from tools.study import StudyFailure


def two_types(honba=0):
    report = fixture()
    report['naga_types'] = {'0': 'ニシキ', '1': 'ヒバカリ'}
    report['pred'][0][1]['dahai_pred'] *= 2
    report['pred'][0][1]['info']['msg']['pred_dahai'] *= 2
    report['pred'][0][0]['info']['msg']['honba'] = honba
    raw = json.loads(report['custom_haihu'][0])
    raw[0][0][1] = honba
    report['custom_haihu'][0] = json.dumps(raw)
    return report


class PreferenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir='D:/dev-data/kyoku-loop/private')
        self.root = Path(self.temp.name)
        self.store = Store(self.root / 'source' / 'generated.sqlite3')

    def tearDown(self):
        self.store.close()
        self.temp.cleanup()

    def stage(self, report=None, store=None):
        return (store or self.store).stage(json.dumps(report or two_types()).encode(), None)

    def commit(self, model, store=None, honba=0):
        target = store or self.store
        return target.commit(self.stage(two_types(honba), target)['token'], 0, model, None)

    def test_initial_nishiki_requires_no_setting_write_and_missing_type_stays_empty(self):
        self.assertEqual(self.stage().get('preferred_model'), 0)
        self.assertIsNone(self.store.db.execute(
            "SELECT value FROM study_settings WHERE key='preferred_naga_type'").fetchone())
        single = two_types()
        single['naga_types'] = {'0': 'ヒバカリ'}
        self.assertIsNone(self.stage(single).get('preferred_model'))
        self.assertEqual(self.store.state()['reports'], [])

    def test_success_remembers_name_across_restart_and_changed_indices(self):
        self.commit(1)
        original_items = self.store.state()['items']
        path = self.store.path
        self.store.close()
        self.store = Store(path)
        report = two_types()
        report['naga_types'] = {'0': 'ヒバカリ', '1': 'ニシキ'}
        self.assertEqual(self.stage(report).get('preferred_model'), 0)
        self.assertEqual(self.store.state()['items'], original_items)
        self.assertEqual(self.store.db.execute('PRAGMA user_version').fetchone()[0], 3)

    def test_cancelled_stage_and_failed_commit_do_not_change_preference(self):
        self.commit(0)
        cancelled = self.stage()
        self.assertEqual(cancelled.get('preferred_model'), 0)
        self.assertEqual(self.stage().get('preferred_model'), 0)
        self.store.db.execute("CREATE TRIGGER fail_generated BEFORE INSERT ON reports BEGIN SELECT RAISE(ABORT,'generated'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            self.store.commit(cancelled['token'], 0, 1, None)
        self.assertEqual(self.stage().get('preferred_model'), 0)
        self.assertEqual(self.store.db.execute('SELECT count(*) FROM reports').fetchone()[0], 1)

    def test_ambiguous_or_unsupported_match_never_selects_a_type(self):
        ambiguous = two_types()
        ambiguous['naga_types'] = {'0': 'ニシキ', '1': 'ニシキ'}
        self.assertIsNone(self.stage(ambiguous).get('preferred_model'))
        unsupported = two_types()
        unsupported['naga_types'] = {'0': 'ヒバカリ', '2': 'ニシキ'}
        self.assertIsNone(self.stage(unsupported).get('preferred_model'))

    def test_preference_storage_failure_rolls_back_report_and_items(self):
        self.commit(0)
        before = self.store.state()
        self.store.db.execute("CREATE TRIGGER fail_preference BEFORE INSERT ON study_settings WHEN NEW.key='preferred_naga_type' BEGIN SELECT RAISE(ABORT,'generated'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            self.commit(1, honba=1)
        self.assertEqual(self.store.state(), before)
        self.assertEqual(self.store.db.execute('SELECT count(*) FROM sources').fetchone()[0], 1)
        self.assertEqual(self.stage().get('preferred_model'), 0)

    def test_backup_restores_missing_preference_and_keeps_existing_destination_choice(self):
        self.commit(1)
        saved = self.store.backup_create()
        payload = self.store._backup_path(saved['name']).read_bytes()
        for existing in (False, True):
            with self.subTest(existing=existing):
                target = Store(self.root / str(existing) / 'generated.sqlite3')
                try:
                    if existing:
                        self.commit(0, target, honba=1)
                    plan = target.backup_upload(base64.b64encode(payload).decode())
                    target.backup_restore(plan['name'], plan['hash'])
                    self.assertEqual(self.stage(store=target).get('preferred_model'), 0 if existing else 1)
                finally:
                    target.close()

    def test_old_backup_without_preference_uses_initial_nishiki(self):
        self.commit(1)
        saved = self.store.backup_create()
        path = self.store._backup_path(saved['name'])
        db = sqlite3.connect(path)
        db.execute("DELETE FROM study_settings WHERE key='preferred_naga_type'")
        db.commit()
        db.close()
        target = Store(self.root / 'old-backup' / 'generated.sqlite3')
        try:
            plan = target.backup_upload(base64.b64encode(path.read_bytes()).decode())
            target.backup_restore(plan['name'], plan['hash'])
            self.assertEqual(self.stage(store=target).get('preferred_model'), 0)
        finally:
            target.close()

    def test_invalid_backup_preference_is_rejected(self):
        self.commit(1)
        for invalid in ('', ' ニシキ', 'ニシキ\n', 'x' * 101):
            with self.subTest(value=repr(invalid)):
                saved = self.store.backup_create()
                db = sqlite3.connect(self.store._backup_path(saved['name']))
                db.execute("UPDATE study_settings SET value=? WHERE key='preferred_naga_type'", (invalid,))
                db.commit()
                db.close()
                with self.assertRaisesRegex(StudyFailure, 'invalid_backup'):
                    self.store.backup_inspect(saved['name'])


if __name__ == '__main__':
    unittest.main()
