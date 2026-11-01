"""Generated round streams only; this is not evidence for real East-only reports."""
import base64
import json
import tempfile
import unittest
from collections import Counter
from pathlib import Path

from test_p0_verify import fixture
from tools.p0_verify import inspect_report, tile, tile_index
from tools.p2_store import ImportFailure, Store


EAST = [('E', n, 0, 0) for n in range(1, 5)]


def generated_rounds(locations):
    """Four seats, 70 draws per round, no calls/reach; scores are snapshots.

    The test exercises converted round/action alignment, not end-of-game rules,
    hand scoring, or the original provider's East-only report schema.
    """
    report = fixture()
    report['pred'], report['custom_haihu'] = [], []
    for wind, number, honba, kyotaku in locations:
        deck = [n for suit in (10, 20, 30)
                for n in range(suit + 1, suit + 10) for _ in range(4)]
        deck += [n for n in range(41, 48) for _ in range(4)]
        deck.remove(25)
        deck.append(52)
        first_draws = [52, 41, 42, 43]
        for code in [39, *first_draws]:
            deck.remove(code)
        hands = [deck[s * 13:(s + 1) * 13] for s in range(4)]
        dealer = number - 1
        order = [(dealer + n) % 4 for n in range(4)]
        wall = [first_draws[s] for s in order] + deck[52:118]
        assert len(wall) == 70
        scores = [25000 - kyotaku * 1000, 25000, 25000, 25000]
        raw = [[(0 if wind == 'E' else 4) + dealer, honba, kyotaku],
               scores, [39], []]
        for hand in hands:
            raw += [hand, [], []]
        raw += [['流局', [0] * 4]]
        start = {'type': 'start_kyoku', 'bakaze': wind, 'kyoku': number,
                 'honba': honba, 'kyotaku': kyotaku, 'oya': dealer,
                 'dora_marker': '9s', 'scores': scores,
                 'tehais': [list(map(tile, hand)) for hand in hands]}
        entries = [{'info': {'msg': start}}]
        for turn, code in enumerate(wall):
            seat = order[turn % 4]
            actual, suggested = tile(code), tile(hands[seat][0])
            weights = [0] * 34
            weights[tile_index(suggested)] = 7000
            weights[tile_index(actual)] += 2997
            raw[5 + 3 * seat].append(code)
            raw[6 + 3 * seat].append(60)
            entries += [
                {'info': {'msg': {'type': 'tsumo', 'actor': seat, 'pai': actual,
                                 'real_dahai': actual, 'pred_dahai': [suggested]}},
                 'dahai_pred': [weights]},
                {'info': {'msg': {'type': 'dahai', 'actor': seat, 'pai': actual,
                                 'tsumogiri': True}}},
            ]
        report['pred'].append(entries)
        report['custom_haihu'].append(json.dumps([raw]))
    return report


class RoundFormatTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir='D:/dev-data/kyoku-loop/private')
        self.root = Path(self.temp.name)
        self.store = Store(self.root / 'source' / 'generated.sqlite3')

    def tearDown(self):
        self.store.close()
        self.temp.cleanup()

    def register(self, report, store=None):
        store = store or self.store
        stage = store.stage(json.dumps(report).encode(), None)
        result = store.commit(stage['token'], 0, 0, None)
        return result, store.detail(result['id'])

    def test_four_east_rounds_rotate_dealer_and_winds_for_all_seats(self):
        report = generated_rounds(EAST)
        for seat in range(4):
            with self.subTest(seat=seat):
                timeline = []
                summary, scenes = inspect_report(report, seat, 0, timeline)
                self.assertEqual(summary['issues'], {})
                self.assertEqual(summary['counts']['draw_match'], 280)
                self.assertEqual(summary['counts']['discard_match'], 280)
                self.assertEqual(len(scenes), 70)
                for round_index in range(4):
                    scene = next(s for s in scenes if s['round_index'] == round_index)
                    self.assertEqual((scene['bakaze'], scene['kyoku']), ('E', round_index + 1))
                    self.assertEqual(scene['own_wind'], ('E', 'S', 'W', 'N')[(seat-round_index) % 4])
                    self.assertEqual(scene['actual'], tile([52, 41, 42, 43][seat]))
                    self.assertIn(scene['suggested'], scene['own_hand'])
                    self.assertEqual(len(scene['own_hand']), 14)
                    self.assertEqual(scene['dora_markers'], ['9s'])
                for scene in scenes + timeline:
                    self.assertNotIn('tehais', scene)
                    self.assertNotIn('hands', scene)

    def test_east_four_is_retained_and_important_scenes_cover_each_round(self):
        result, detail = self.register(generated_rounds(EAST))
        self.assertEqual(detail['rounds'], 4)
        self.assertEqual(len(detail['important']), 10)
        selected = [s for s in detail['decisions'] if s['id'] in detail['important']]
        self.assertEqual({s['round_index'] for s in selected}, set(range(4)))
        self.assertEqual({(s['bakaze'], s['kyoku']) for s in detail['decisions']},
                         {('E', n) for n in range(1, 5)})
        self.assertEqual(len(self.store.state()['items']), 3)
        self.assertFalse(result['duplicate'])

    def test_repeat_round_honba_and_riichi_deposit_keep_distinct_decisions(self):
        locations = [('E', 1, 0, 0), ('E', 1, 1, 1), *EAST[1:]]
        _, detail = self.register(generated_rounds(locations))
        first = [next(s for s in detail['decisions'] if s['round_index'] == n)
                 for n in range(2)]
        self.assertNotEqual(first[0]['id'], first[1]['id'])
        self.assertEqual((first[1]['honba'], first[1]['kyotaku']), (1, 1))
        self.assertEqual(first[1]['scores'], [24000, 25000, 25000, 25000])
        self.assertEqual(detail['rounds'], 5)

    def test_south_extension_is_projected_without_a_four_round_cutoff(self):
        _, detail = self.register(generated_rounds([*EAST, ('S', 1, 0, 0)]))
        scenes = [s for s in detail['decisions'] if s['round_index'] == 4]
        self.assertEqual(detail['rounds'], 5)
        self.assertTrue(scenes)
        self.assertTrue(all((s['bakaze'], s['kyoku'], s['own_wind']) == ('S', 1, 'E')
                            for s in scenes))

    def test_inconsistent_last_round_metadata_never_partially_saves(self):
        for field in range(3):
            with self.subTest(raw_field=field):
                report = generated_rounds(EAST)
                raw = json.loads(report['custom_haihu'][-1])
                raw[0][0][field] += 1
                report['custom_haihu'][-1] = json.dumps(raw)
                with self.assertRaisesRegex(ImportFailure, 'reconstruction_failed'):
                    self.register(report)
                self.assertEqual(self.store.state()['reports'], [])
                self.assertEqual(self.store.state()['items'], [])
                self.assertEqual(self.store.db.execute('SELECT count(*) FROM sources').fetchone()[0], 0)

    def test_backup_resume_and_reimport_keep_ids_and_answer_history(self):
        report = generated_rounds(EAST)
        result, detail = self.register(report)
        session = self.store.study_start('practice')
        self.store.study_choice(session['id'], session['scene']['own_hand'][0], 'choose')
        self.store.study_choice(session['id'], None, 'confirm')
        current = self.store.study_rate(session['id'], session['scene']['id'],
                                        '理解した', 'generated-east-answer')
        backup = self.store.backup_create()
        payload = self.store._backup_path(backup['name']).read_bytes()
        restored = Store(self.root / 'restored' / 'generated.sqlite3')
        try:
            plan = restored.backup_upload(base64.b64encode(payload).decode())
            self.assertEqual(plan['conflicts'], 0)
            restored.backup_restore(plan['name'], plan['hash'])
            repeat, again = self.register(report, restored)
            self.assertTrue(repeat['duplicate'])
            self.assertEqual(repeat['id'], result['id'])
            self.assertEqual(again['decisions'], detail['decisions'])
            self.assertEqual(len(restored.state()['items']), 3)
            self.assertEqual(restored.study_current()['id'], current['id'])
            self.assertEqual(restored.study_current()['index'], 1)
            before = [tuple(row) for row in self.store.db.execute('SELECT * FROM review_events')]
            after = [tuple(row) for row in restored.db.execute('SELECT * FROM review_events')]
            self.assertEqual(before, after)
        finally:
            restored.close()

    def test_south_four_in_hanchan_uses_the_same_round_identity_contract(self):
        locations = [*EAST, *[('S', n, 0, 0) for n in range(1, 5)]]
        _, detail = self.register(generated_rounds(locations))
        self.assertEqual(detail['rounds'], 8)
        self.assertEqual(len(detail['important']), 10)
        selected = [s for s in detail['decisions'] if s['id'] in detail['important']]
        self.assertEqual(len(Counter(s['round_index'] for s in selected)), 8)
        self.assertTrue(any(s['bakaze'] == 'S' and s['kyoku'] == 4
                            for s in detail['decisions']))


if __name__ == '__main__':
    unittest.main()
