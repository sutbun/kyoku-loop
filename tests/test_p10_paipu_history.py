"""Fictional history metadata only. Never fetch a player or run an analysis."""
import copy
import unittest
import json
import tempfile
from pathlib import Path

from tools.paipu_history import profile, record, records, encoded_player
from tools.p2_store import Store
from tools.study import StudyFailure


def sample():
    return {'at': '2026-01-01T12:30:00+09:00', 'seat': 1,
            'players': [{'name': n, 'score': s} for n, s in zip(
                ['架空A', '架空B', '架空C', '架空D'], [25000, 30000, 30000, 15000])],
            'url': 'https://game.mahjongsoul.com/?paipu=260101-fictional-history_a' + str(encoded_player(123456))}


class HistoryValidationTests(unittest.TestCase):
    def setUp(self):
        self.selected = profile('https://amae-koromo.sapk.ch/player/123456/12')

    def test_profile_rejects_other_origins_credentials_ports_queries_and_modes(self):
        for url in ['https://evil.invalid/player/123456/12',
                    'https://amae-koromo.sapk.ch:443/player/123456/12',
                    'https://u@amae-koromo.sapk.ch/player/123456/12',
                    'https://amae-koromo.sapk.ch/player/123456/12?x=1',
                    'https://amae-koromo.sapk.ch/player/123456/99']:
            with self.subTest(url=url), self.assertRaises(ValueError):
                profile(url)

    def test_rank_ties_follow_original_seats_and_id_is_stable(self):
        a = record(sample(), self.selected)
        self.assertEqual(a['rank'], 1)
        self.assertEqual(a['id'], record(copy.deepcopy(sample()), self.selected)['id'])
        self.assertEqual(a['players'][1]['name'], '架空B')

    def test_masked_entry_keeps_metadata_without_inventing_replay_url(self):
        row = sample()
        row['url'] = None
        self.assertIsNone(record(row, self.selected)['url'])

    def test_other_player_or_external_replay_is_rejected(self):
        for url in ['https://evil.invalid/?paipu=fictional',
                    'https://game.mahjongsoul.com/?paipu=260101-fictional-history_a1']:
            row = sample()
            row['url'] = url
            with self.subTest(url=url), self.assertRaises(ValueError):
                record(row, self.selected)

    def test_invalid_dates_seats_scores_and_duplicate_rows_are_rejected(self):
        for key, value in [('at', 'not a date'), ('at', '2026-01-01T12:00:00'),
                           ('seat', True), ('seat', 4), ('players', [])]:
            row = sample()
            row[key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                records([row], self.selected)
        with self.assertRaisesRegex(ValueError, 'duplicate_history'):
            records([sample(), sample()], self.selected)


class BulkHistoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir='D:/dev-data/kyoku-loop/private')
        self.store = Store(Path(self.temp.name)/'main.sqlite3')

    def tearDown(self):
        self.store.close()
        self.temp.cleanup()

    def payload(self):
        return json.dumps({'kind': 'kyokuloop-history', 'version': 1, 'player': 123456,
                           'entries': [sample() | {'mode': 12}]}, ensure_ascii=False)

    def test_metadata_import_is_idempotent_and_preserves_request_and_learning_state(self):
        self.store.analysis_add(sample()['url'])
        ident = sample()['url'].split('paipu=')[1]
        self.store.analysis_requested(ident, True)
        from test_p3_study import five_fixture
        report = self.store.stage(json.dumps(five_fixture()).encode(), None)
        self.store.commit(report['token'], 0, 0, sample()['url'], ident)
        self.store.study_start('practice')
        tables = ('sources','reports','study_items','review_events','study_sessions','study_settings')
        before = {t: [tuple(r) for r in self.store.db.execute('SELECT * FROM '+t)] for t in tables}
        for _ in range(2):
            self.assertEqual(self.store.analysis_bulk(self.payload())['added'], 0)
        for table in tables:
            current = [tuple(r) for r in self.store.db.execute('SELECT * FROM '+table)]
            for row in before[table]: self.assertIn(row, current)
        entry = self.store.analysis_entry(ident)
        self.assertTrue(entry['requested'])
        self.assertTrue(entry['reports'])
        self.assertEqual(entry['history']['rank'], 1)

    def test_plain_urls_deduplicate_and_invalid_batch_never_partially_saves(self):
        url = sample()['url']
        with self.assertRaises(StudyFailure):
            self.store.analysis_bulk(url+'\nhttps://evil.invalid/?paipu=anything')
        self.assertEqual(self.store.analysis_entries(), [])
        result = self.store.analysis_bulk('雀魂牌譜:'+url+'\n'+url)
        self.assertEqual((result['added'], result['existing']), (1, 1))
        self.assertFalse(self.store.analysis_entries()[0]['requested'])

    def test_metadata_and_url_restore_without_replacing_newer_local_state(self):
        self.store.analysis_bulk(self.payload())
        saved = self.store.backup_create()
        restored = Store(Path(self.temp.name)/'restore'/'main.sqlite3')
        try:
            uploaded = restored.backup_upload(self.store.backup_export(saved['name'])['data'])
            restored.backup_restore(uploaded['name'], uploaded['hash'])
            before = restored.analysis_entries()
            restored.analysis_requested(before[0]['id'], True)
            restored.backup_restore(uploaded['name'], uploaded['hash'])
            self.assertEqual(restored.analysis_entries()[0]['history'], before[0]['history'])
            self.assertTrue(restored.analysis_entries()[0]['requested'])
        finally:
            restored.close()

    def test_wrong_actor_or_excessive_batch_rejected_without_writes(self):
        data = json.loads(self.payload())
        data['player'] = 1
        with self.assertRaises(StudyFailure): self.store.analysis_bulk(json.dumps(data))
        with self.assertRaises(StudyFailure): self.store.analysis_bulk('\n'.join([sample()['url']]*501))
        self.assertEqual(self.store.analysis_entries(), [])
