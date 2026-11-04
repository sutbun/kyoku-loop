"""Fictional score matches only. No network, real players or app data."""
import copy
import json
import tempfile
import unittest
from pathlib import Path
from tools.p2_store import Store, ImportFailure
from tools.paipu_history import encoded_player
from test_p8_mortal import mortal_fixture


def history(n=1):
    return {'url': f'https://game.mahjongsoul.com/?paipu=260101-fictional-auto-{n}_a{encoded_player(123)}',
            'at': '2026-01-01T00:00:00+09:00', 'mode': 12, 'seat': 0, 'rank': 1,
            'players': [{'name': f'履歴の架空{i}', 'score': 25000} for i in range(4)]}


def batch(rows):
    return json.dumps({'kind': 'kyokuloop-history', 'version': 1, 'player': 123, 'entries': rows})


class AutoLinkTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir='D:/dev-data/kyoku-loop/private')
        self.store = Store(Path(self.tmp.name)/'auto.sqlite3')

    def tearDown(self):
        self.store.close()
        self.tmp.cleanup()

    def register(self, report=None, analysis_id=None):
        r = report or mortal_fixture()
        staged = self.store.stage(json.dumps(r).encode(), None)
        return self.store.commit(staged['token'], r['player_id'], 0, None, analysis_id)

    def link(self, ident):
        row = self.store.db.execute('SELECT source_game_url,content FROM reports WHERE id=?', (ident,)).fetchone()
        return row[0], json.loads(row[1])['source_link_kind']

    def both_orders(self, metadata_first):
        if metadata_first: self.store.analysis_bulk(batch([history()]))
        result = self.register()
        before = {t: [tuple(r) for r in self.store.db.execute('SELECT * FROM '+t)]
                  for t in ['study_items', 'review_events', 'study_sessions']}
        self.store.analysis_bulk(batch([history()]))
        self.assertEqual(self.link(result['id']), (history()['url'], 'scores'))
        self.assertEqual(self.store.analysis_entries()[0]['reports'], [result['id']])
        self.assertTrue(self.register()['duplicate'])
        for table, rows in before.items():
            self.assertEqual(rows, [tuple(r) for r in self.store.db.execute('SELECT * FROM '+table)])

    def test_metadata_first(self): self.both_orders(True)

    def test_json_first(self): self.both_orders(False)

    def test_all_candidates_are_considered_before_linking_and_receipts_include_links(self):
        result = self.register()
        self.store.analysis_bulk(batch([history(1), history(2)]))
        self.assertIsNone(self.link(result['id'])[0])
        self.assertTrue(all(not e['reports'] for e in self.store.analysis_entries()))
        # Adding a URL and backfilling its metadata through phone sync also works.
        self.store.db.execute("DELETE FROM study_settings WHERE key LIKE 'analysis:%' OR key LIKE 'paipu-meta:%'")
        self.store.db.commit()
        h = history()
        entry = {'id': h['url'].split('paipu=')[1], 'url': h['url'], 'created': h['at']}
        self.store.analysis_receive([entry])
        self.assertIsNone(self.link(result['id'])[0])
        receipt = self.store.analysis_receive([entry | {'history': h | {'player': 123}}])
        self.assertEqual(receipt['entries'][0]['reports'], [result['id']])

    def test_ambiguous_reports_and_used_sources_are_not_assigned_to_another_game(self):
        a = self.register()
        b = self.register(mortal_fixture(True))
        self.store.analysis_bulk(batch([history()]))
        self.assertIsNone(self.link(a['id'])[0])
        self.assertIsNone(self.link(b['id'])[0])
        self.store.link_source(a['id'], history()['url'].split('paipu=')[1])
        self.store.state()
        self.assertIsNone(self.link(b['id'])[0])

    def test_manual_links_and_full_game_identity_win_over_score_guesses(self):
        h = history()
        self.store.analysis_add(h['url'])
        a = self.register(analysis_id=h['url'].split('paipu=')[1])
        self.store.analysis_bulk(batch([history(2)]))
        r = mortal_fixture()
        r['review']['model_tag'] = 'fictional-second-model'
        b = self.register(r)
        self.assertEqual(self.link(a['id']), (h['url'], 'manual'))
        self.assertEqual(self.link(b['id'])[0], h['url'])
        self.assertEqual(len(self.store.analysis_entries()[0]['reports']), 2)

    def test_conflicting_metadata_rolls_back_all_links_and_old_unlinked_results_are_reconciled(self):
        result = self.register()
        invalid = history(2)
        invalid['players'][0]['score'] = 30000
        invalid['rank'] = 4
        with self.assertRaises(ValueError): self.store.analysis_bulk(batch([history(), invalid]))
        self.assertIsNone(self.link(result['id'])[0])
        self.assertEqual(self.store.analysis_entries(), [])
        # Simulate a result saved before this feature without modifying its payload.
        self.store.analysis_bulk(batch([history()]))
        self.store.db.execute('UPDATE reports SET source_game_url=NULL WHERE id=?', (result['id'],))
        self.store.db.commit()
        self.store.state()
        self.assertEqual(self.link(result['id'])[0], history()['url'])
