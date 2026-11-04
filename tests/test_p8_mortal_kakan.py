"""Synthetic Mortal Kakan state using mjai-reviewer's serialized Fuuro shape."""
import copy
import json
import math
import unittest

from test_p0_verify import kan_fixture
from test_p8_mortal import mortal_fixture
from tools.mortal_report import project


def kakan_review_fixture():
    original = kan_fixture('kakan')
    events = [copy.deepcopy(e['info']['msg']) for e in original['pred'][0]]
    for event in events:
        event.pop('real_dahai', None)
        event.pop('pred_dahai', None)
    hand = events[0]['tehais'][0][:]
    for tile in ['1m', '1m', '2m']:
        hand.remove(tile)
    hand.append('6p')
    choices = list(dict.fromkeys(hand))
    details = [dict(action=dict(type='dahai', actor=0, pai=tile, tsumogiri=tile == '6p'),
                    prob=1/len(choices), q_value=0.1*math.log(1/len(choices))) for tile in choices]
    end = dict(type='ryukyoku', deltas=[0]*4)
    report = mortal_fixture()
    report['split_logs'][0]['log'] = json.loads(original['custom_haihu'][0])
    report['mjai_log'] = [dict(type='start_game'), *events, end,
                          dict(type='end_kyoku'), dict(type='end_game')]
    kyoku = report['review']['kyokus'][0]
    kyoku['end_status'] = [end]
    entry = kyoku['entries'][0]
    entry.update(junme=3, tiles_left=67, tile='6p', actual=copy.deepcopy(events[-1]),
                 expected=copy.deepcopy(details[0]['action']), details=details,
                 actual_index=choices.index('6p'),
                 state=dict(tehai=hand, fuuros=[dict(type='kakan', pai='1m',
                     previous_pon_target=3, previous_pon_pai='1m', consumed=['1m','1m'])]))
    return report


class MortalKakanStateTests(unittest.TestCase):
    def test_official_review_shape_matches_all_four_replayed_tiles_and_pon_target(self):
        report = kakan_review_fixture()
        before = copy.deepcopy(report)
        summary, scenes, _ = project(report)
        self.assertFalse(summary['issues'])
        self.assertEqual(len(scenes), 1)
        meld = scenes[0]['melds'][0][0]
        self.assertEqual(meld['type'], 'kakan')
        self.assertEqual(meld['target'], 3)
        self.assertEqual(meld['consumed'] + [meld['tile'], meld['added']], ['1m']*4)
        self.assertEqual(report, before)

    def test_original_pon_target_and_both_called_and_added_tiles_are_verified(self):
        for key, value in [('previous_pon_target', 2), ('previous_pon_pai', '2m'), ('pai', '2m')]:
            with self.subTest(key=key):
                report = kakan_review_fixture()
                report['review']['kyokus'][0]['entries'][0]['state']['fuuros'][0][key] = value
                with self.assertRaisesRegex(ValueError, 'reconstruction_failed'):
                    project(report)

    def test_invalid_or_missing_kakan_fields_are_rejected(self):
        for key, value in [('previous_pon_target', None), ('previous_pon_pai', None),
                           ('pai', None), ('consumed', None), ('consumed', ['1m']*3),
                           ('consumed', ['1m']), ('previous_pon_pai', '5mr')]:
            with self.subTest(key=key, value=value):
                report = kakan_review_fixture()
                meld = report['review']['kyokus'][0]['entries'][0]['state']['fuuros'][0]
                if value is None:
                    del meld[key]
                else:
                    meld[key] = value
                with self.assertRaisesRegex(ValueError, 'reconstruction_failed'):
                    project(report)
