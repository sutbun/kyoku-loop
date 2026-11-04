"""Score-based suggestions use fictional reports; never identify or link a game."""
import base64
import copy
import gzip
import json
import tempfile
import unittest
from pathlib import Path

from tools.mortal_report import final_scores
from tools.mortal_material import compile_upload, preview_upload
from tools.p2_store import Store
from test_p8_mortal import mortal_fixture
from test_p13_shortcut_json import two_rounds, repeated_rounds


def ending(start, ends, reaches=()):
    r = mortal_fixture()
    r['mjai_log'] = [
        {'type': 'start_game'}, {'type': 'start_kyoku', 'scores': start},
        *({'type': 'reach_accepted', 'actor': i} for i in reaches),
        *ends, {'type': 'end_kyoku'}, {'type': 'end_game'},
    ]
    result = ['和了' if ends[0]['type'] == 'hora' else '流局']
    for e in ends:
        if 'deltas' in e:
            result.extend([e['deltas'], []])
    log = r['split_logs'][0]['log'][0]
    log[1], log[-1] = start[:], result
    return r


class MortalScoresTests(unittest.TestCase):
    def test_last_round_only_and_negative_scores(self):
        r = ending([26000, 29000, 22000, 23000], [
            {'type': 'hora', 'deltas': [32000, -32000, 0, 0]}])
        r['mjai_log'][1:1] = [
            {'type': 'start_kyoku', 'scores': [25000]*4},
            {'type': 'ryukyoku', 'deltas': [0]*4}, {'type': 'end_kyoku'}]
        self.assertEqual(final_scores(r), [58000, -3000, 22000, 23000])

    def test_reach_deposits_and_multiple_wins_are_counted_once(self):
        r = ending([24000, 24000, 26000, 26000], [
            {'type': 'hora', 'deltas': [9000, 0, -8000, 0]},
            {'type': 'hora', 'deltas': [0, 4000, -4000, 0]},
        ], reaches=[0])
        self.assertEqual(final_scores(r), [32000, 28000, 14000, 26000])

    def test_draw_ties_and_repeated_shortcut_logs(self):
        r = ending([25000]*4, [{'type': 'ryukyoku', 'deltas': [1500, -1500, 1500, -1500]}])
        self.assertEqual(final_scores(r), [26500, 23500, 26500, 23500])
        self.assertEqual(final_scores(repeated_rounds(two_rounds())), [25000]*4)

    def test_missing_invalid_inconsistent_or_unsettled_scores_abstain(self):
        base = ending([25000]*4, [{'type': 'hora', 'deltas': [8000, -8000, 0, 0]}])
        mutations = [
            lambda r: r['mjai_log'][-3].pop('deltas'),
            lambda r: r['mjai_log'][-3].update(deltas=[True, -8000, 0, 0]),
            lambda r: r['mjai_log'][-3].update(deltas=[8000, -8000, 0]),
            lambda r: r['mjai_log'][-3].update(deltas=[7000, -8000, 0, 0]),
            lambda r: r['split_logs'][0]['log'][0][-1][1].__setitem__(0, 7000),
            lambda r: r['mjai_log'].pop(),
            lambda r: r['mjai_log'].insert(2, {'type': 'reach_accepted', 'actor': 4}),
        ]
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                r = copy.deepcopy(base)
                mutate(r)
                self.assertIsNone(final_scores(r))
        self.assertIsNone(final_scores(ending([25000]*4, [{'type': 'ryukyoku'}])))

    def test_preview_preserves_material_contract_for_old_backups_and_gzip(self):
        raw = json.dumps(repeated_rounds(two_rounds())).encode()
        at = '2026-11-04T00:00:00.000Z'
        for payload in (raw, gzip.compress(raw)):
            encoded = base64.b64encode(payload).decode()
            ordinary = compile_upload(encoded, at)
            preview = preview_upload(encoded, at)
            self.assertEqual(preview['material'], ordinary)
            self.assertNotIn('final_scores', ordinary)
            self.assertEqual(preview['final_scores'], [25000]*4)
        with tempfile.TemporaryDirectory(dir='D:/dev-data/kyoku-loop/private') as tmp:
            store = Store(Path(tmp)/'scores.sqlite3')
            try:
                stage = store.phone_mortal_inspect(base64.b64encode(raw).decode(), None)
                self.assertEqual(stage['final_scores'], [25000]*4)
                self.assertEqual(store.db.execute('SELECT count(*) FROM reports').fetchone()[0], 0)
            finally:
                store.close()
