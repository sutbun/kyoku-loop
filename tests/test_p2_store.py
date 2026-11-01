"""Generated fixtures only; no personal reports or network requests."""
import copy
import json
import gzip
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from test_p0_verify import fixture
from tools.p2_store import Store, ImportFailure, NoRedirect, canonical_report_url, rank_decisions, fetch_report
import urllib.error


class P2Tests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir='D:/dev-data/kyoku-loop/private')
        self.store = Store(Path(self.tmp.name) / 'test.sqlite3')

    def tearDown(self):
        self.store.close()
        self.tmp.cleanup()

    def stage(self, report=None):
        return self.store.stage(json.dumps(report or fixture()).encode(), None)

    def test_url_allowlist_rejects_credentials_redirect_hosts_and_queries(self):
        ident = 'a' * 64 + 'v2_2'
        self.assertEqual(canonical_report_url(ident), f'https://naga.dmv.nico/reports/{ident}.json')
        for value in ['http://naga.dmv.nico/reports/a.json', 'https://evil.invalid/',
                      f'https://u:p@naga.dmv.nico/htmls/{ident}.html',
                      f'https://naga.dmv.nico:444/reports/{ident}.json',
                      f'https://naga.dmv.nico/htmls/report_viewer.html?report_id={ident}&next=x']:
            with self.assertRaises(ImportFailure):
                canonical_report_url(value)

    def test_seat_and_model_are_required_before_persistence(self):
        meta = self.stage()
        self.assertEqual(len(meta['players']), 4)
        self.assertEqual(self.store.state()['reports'], [])
        with self.assertRaises(ImportFailure):
            self.store.commit(meta['token'], None, None, None)
        self.assertEqual(self.store.state()['items'], [])

    def test_import_reopen_and_reimport_preserve_unique_items_and_history(self):
        result = self.store.commit(self.stage()['token'], 0, 0, None)
        detail = self.store.detail(result['id'])
        self.assertEqual(len(detail['decisions']), 1)
        self.assertGreater(len(detail['timeline']), 1)
        decision = detail['decisions'][0]
        self.assertAlmostEqual(decision['gap'], 4003*100/9997)
        self.assertEqual(decision['actual'], '5pr')
        self.assertNotIn('tehais', detail['timeline'][0])
        self.assertNotIn('hands', detail['timeline'][0])
        self.store.db.execute("UPDATE study_items SET history = ?", ('["retained"]',))
        self.store.db.commit()
        db = self.store.path
        self.store.close()
        self.store = Store(db)
        repeat = self.store.commit(self.stage()['token'], 0, 0, None)
        self.assertEqual(result['id'], repeat['id'])
        self.assertTrue(repeat['duplicate'])
        self.assertEqual(len(self.store.state()['items']), 1)
        self.assertEqual(self.store.state()['items'][0]['history'], ['retained'])

    def test_separate_model_assessment_does_not_duplicate_same_decision(self):
        report = fixture()
        report['naga_types']['1'] = 'generated-model-b'
        report['pred'][0][1]['dahai_pred'].append(report['pred'][0][1]['dahai_pred'][0][:])
        report['pred'][0][1]['info']['msg']['pred_dahai'].append('1m')
        first = self.store.commit(self.stage(report)['token'], 0, 0, None)
        second = self.store.commit(self.stage(report)['token'], 0, 1, None)
        self.assertNotEqual(first['id'], second['id'])
        self.assertEqual(len(self.store.state()['items']), 1)

    def test_unknown_or_zero_weights_never_become_questions(self):
        report = fixture()
        report['pred'][0][1]['dahai_pred'][0] = [0] * 34
        result = self.store.commit(self.stage(report)['token'], 0, 0, None)
        self.assertEqual(self.store.detail(result['id'])['decisions'], [])
        self.assertEqual(self.store.state()['items'], [])

    def test_invalid_round_rejects_without_partial_save(self):
        report = fixture()
        report['pred'][0][0]['info']['msg']['tehais'][0][0] = 'C'
        with self.assertRaises(ImportFailure):
            self.store.commit(self.stage(report)['token'], 0, 0, None)
        self.assertEqual(self.store.state()['reports'], [])

    def test_manual_registration_cancel_retains_existing_automatic_item(self):
        result = self.store.commit(self.stage()['token'], 0, 0, None)
        decision = self.store.detail(result['id'])['decisions'][0]
        self.store.save(result['id'], decision['id'], True)
        self.store.save(result['id'], decision['id'], False)
        self.assertEqual(len(self.store.state()['items']), 1)

    def test_diversity_limits_and_final_gap_order(self):
        scenes = [{'id': str(i), 'round_index': i // 6, 'gap': 100-i} for i in range(30)]
        selected = rank_decisions(scenes)
        self.assertEqual(len(selected), 10)
        self.assertEqual(len({s['round_index'] for s in selected}), 5)
        self.assertEqual([s['gap'] for s in selected], sorted([s['gap'] for s in selected], reverse=True))
        self.assertEqual(rank_decisions([{'id':'x','round_index':0,'gap':0}]), [])

    def test_database_cannot_be_placed_under_git(self):
        with self.assertRaises(ImportFailure):
            Store(Path(__file__).resolve().parents[1] / 'test.sqlite3')

    def test_gzip_and_altered_evaluation_share_game_and_preserve_items(self):
        report = fixture()
        first = self.store.commit(self.stage(report)['token'],0,0,None)
        report['pred'][0][1]['dahai_pred'][0][0] -= 1
        report['pred'][0][1]['dahai_pred'][0][13] += 1
        staged = self.store.stage(gzip.compress(json.dumps(report).encode()),None)
        second = self.store.commit(staged['token'],0,0,None)
        self.assertNotEqual(first['id'],second['id'])
        self.assertEqual(len(self.store.state()['items']),1)

    def test_unknown_scales_models_and_rule_fail_closed(self):
        report=fixture()
        report['pred'][0][1]['dahai_pred'][0]=[0.0]*34
        report['pred'][0][1]['dahai_pred'][0][0]=1.0
        result=self.store.commit(self.stage(report)['token'],0,0,None)
        self.assertEqual(self.store.detail(result['id'])['unknown_weights'],1)
        self.assertEqual(self.store.state()['items'],[])
        for key,value in [('game_type',1),('naga_version',[99,0]),('data_version',[99,0])]:
            report=fixture()
            report[key]=value
            with self.assertRaises(ImportFailure): self.stage(report)

    def test_network_errors_are_classified_without_credentials_or_redirects(self):
        ident='a'*64+'v2_2'
        for code,expected in [(401,'access_denied'),(403,'access_denied'),(404,'report_not_ready'),(500,'upstream_error')]:
            with patch('urllib.request.build_opener') as opener:
                opener.return_value.open.side_effect=urllib.error.HTTPError('generated',code,'',{},None)
                with self.assertRaisesRegex(ImportFailure,expected): fetch_report(ident)
        with self.assertRaisesRegex(ImportFailure,'access_redirect'):
            NoRedirect().redirect_request(None,None,302,'',{},'https://example.invalid')

    def test_storage_transaction_failure_does_not_leave_partial_import(self):
        self.store.db.execute("CREATE TRIGGER generated_failure BEFORE INSERT ON study_items BEGIN SELECT RAISE(ABORT,'generated'); END")
        with self.assertRaises(Exception):
            self.store.commit(self.stage()['token'],0,0,None)
        self.assertEqual(self.store.state()['reports'],[])
        self.assertEqual(self.store.db.execute('SELECT count(*) FROM sources').fetchone()[0],0)

    def test_own_reach_locked_draw_is_not_a_free_discard_question(self):
        report=fixture()
        raw=json.loads(report['custom_haihu'][0])
        raw[0][5].append(39)
        raw[0][6]=['r60',60]
        report['custom_haihu'][0]=json.dumps(raw)
        entries=report['pred'][0]
        entries.insert(2,{'info':{'msg':{'type':'reach','actor':0}}})
        entries.append({'info':{'msg':{'type':'reach_accepted','actor':0,'scores':[24000,25000,25000,25000]}}})
        next_draw=copy.deepcopy(entries[1])
        next_draw['info']['msg'].update(pai='9s',real_dahai='9s')
        entries.extend([next_draw,{'info':{'msg':{'type':'dahai','actor':0,'pai':'9s','tsumogiri':True}}}])
        result=self.store.commit(self.stage(report)['token'],0,0,None)
        detail=self.store.detail(result['id'])
        self.assertEqual(len(detail['decisions']),1)
        self.assertEqual(len(detail['timeline']),7)

    def test_nonfinite_or_noninteger_scores_never_reach_display(self):
        report=fixture()
        report['pred'][0][0]['info']['msg']['scores'][0]=float('nan')
        with self.assertRaises(ImportFailure):
            self.store.commit(self.stage(report)['token'],0,0,None)


if __name__ == '__main__':
    unittest.main()
