"""Generated hands only; opening never rewrites canonical study records."""
import copy
import json
import tempfile
import unittest
from collections import Counter
from pathlib import Path

from test_p0_verify import fixture, kan_fixture
from test_p13_shortcut_json import two_rounds, repeated_rounds
from tools.hand_reveal import replay_hands, scene_key
from tools.p2_store import Store
from tools.study import StudyFailure


class HandRevealTests(unittest.TestCase):
    def test_replay_original_hands_at_every_scene_without_writing_study_rows(self):
        for report in [fixture(), kan_fixture('daiminkan'), kan_fixture('kakan'), repeated_rounds(two_rounds())]:
            with self.subTest(engine=report.get('engine')), tempfile.TemporaryDirectory(dir='D:/dev-data/kyoku-loop/private') as temp:
                store = Store(Path(temp) / 'generated.sqlite3')
                try:
                    staged = store.stage(json.dumps(report).encode(), None)
                    result = store.commit(staged['token'], 0, 0, None)
                    before = '\n'.join(store.db.iterdump())
                    detail = store.detail(result['id'])
                    projected = replay_hands(report, detail['timeline'])
                    initial = report['mjai_log'] if report.get('engine') == 'Mortal' else [e['info']['msg'] for e in report['pred'][0]]
                    start = next(e for e in initial if e['type'] == 'start_kyoku')
                    self.assertEqual(projected[(0, 0)], start['tehais'])
                    for scene in detail['timeline']:
                        self.assertNotIn('hands', scene)
                        hands = store.open_hands(report=result['id'], round_index=scene['round_index'], event_index=scene['event_index'])['hands']
                        self.assertEqual(hands, projected[scene_key(scene)])
                        self.assertEqual(Counter(hands[scene['seat']]), Counter(scene['own_hand']))
                    pack = store.phone_pack()
                    for item in pack['items']:
                        self.assertEqual(store.open_hands(item=item['id'])['hands'], pack['reveals'][item['id']])
                    self.assertEqual(before, '\n'.join(store.db.iterdump()))
                finally:
                    store.close()

    def test_draw_discard_timing_and_bad_source_do_not_fabricate_hands(self):
        report = fixture()
        with tempfile.TemporaryDirectory(dir='D:/dev-data/kyoku-loop/private') as temp:
            store = Store(Path(temp) / 'generated.sqlite3')
            try:
                result = store.commit(store.stage(json.dumps(report).encode(), None)['token'], 0, 0, None)
                scenes = store.detail(result['id'])['timeline']
                hands = replay_hands(report, scenes)
                self.assertEqual(list(map(len, hands[(0, 0)])), [13] * 4)
                self.assertEqual(hands[(0, 1)][0][-1], '5pr')
                self.assertEqual(len(hands[(0, 1)][0]), 14)
                self.assertEqual(len(hands[(0, 2)][0]), 13)
                bad = copy.deepcopy(report)
                bad['pred'][0][0]['info']['msg']['tehais'][1][0] = 'invalid'
                with self.assertRaises(ValueError):
                    replay_hands(bad, scenes)
                store.db.execute("UPDATE sources SET payload=?", (json.dumps(bad).encode(),))
                store.db.commit()
                self.assertEqual(store.phone_pack()['reveals'], {})
                with self.assertRaises(StudyFailure):
                    store.open_hands(item=store.state()['items'][0]['id'])
            finally:
                store.close()
