"""Fictional draws only: a policy selects a tile, the log keeps physical discard."""
import copy
import math
import unittest

from test_p8_mortal import mortal_fixture
from tools.mortal_report import project
from tools.mortal_material import compile_material


def same_tile_fixture(tsumogiri=False):
    report = mortal_fixture()
    raw = report['split_logs'][0]['log'][0]
    start, draw, discard = report['mjai_log'][1:4]
    # Reserve a copy of 4m for the draw, retaining a 4m in the player's hand.
    other = raw[7].index(14)
    raw[7][other] = 39
    start['tehais'][1][other] = '9s'
    raw[5][0], raw[6][0] = 14, 60 if tsumogiri else 14
    draw['pai'] = discard['pai'] = '4m'
    discard['tsumogiri'] = tsumogiri
    entry = report['review']['kyokus'][0]['entries'][0]
    entry['tile'] = '4m'
    entry['state']['tehai'] = start['tehais'][0] + ['4m']
    entry['actual'] = copy.deepcopy(discard)
    choices = list(dict.fromkeys(entry['state']['tehai']))
    entry['details'] = [
        {'action': {'type': 'dahai', 'actor': 0, 'pai': tile,
                    'tsumogiri': not tsumogiri if tile == '4m' else False},
         'prob': 0.7 if tile == '1m' else 0.3 / (len(choices)-1),
         'q_value': 0.1 * math.log(0.7 if tile == '1m' else 0.3 / (len(choices)-1))}
        for tile in choices]
    entry['expected'] = copy.deepcopy(entry['details'][0]['action'])
    entry['actual_index'] = choices.index('4m')
    return report


class SameTileMortalTests(unittest.TestCase):
    def test_tile_policy_can_represent_the_other_identical_physical_tile(self):
        for tsumogiri in [False, True]:
            with self.subTest(tsumogiri=tsumogiri):
                report = same_tile_fixture(tsumogiri)
                original = copy.deepcopy(report)
                _, scenes, _ = project(report)
                self.assertEqual((scenes[0]['actual'], scenes[0]['suggested']), ('4m', '1m'))
                self.assertEqual(report, original)
                self.assertEqual(compile_material(report)['source'], compile_material(original)['source'])
                exact = copy.deepcopy(report)
                entry = exact['review']['kyokus'][0]['entries'][0]
                entry['details'][entry['actual_index']]['action']['tsumogiri'] = tsumogiri
                self.assertEqual(scenes, project(exact)[1])

    def test_index_pointing_to_another_tile_is_rejected(self):
        report = same_tile_fixture()
        report['review']['kyokus'][0]['entries'][0]['actual_index'] = 0
        with self.assertRaisesRegex(ValueError, 'reconstruction_failed'):
            project(report)

    def test_single_drawn_tile_cannot_be_claimed_as_hand_discard(self):
        report = mortal_fixture()
        entry = report['review']['kyokus'][0]['entries'][0]
        entry['details'][entry['actual_index']]['action']['tsumogiri'] = False
        with self.assertRaisesRegex(ValueError, 'reconstruction_failed'):
            project(report)

    def test_red_five_is_not_the_same_choice_as_normal_five(self):
        report = mortal_fixture(True)
        entry = report['review']['kyokus'][0]['entries'][0]
        entry['actual_index'] = next(i for i, d in enumerate(entry['details']) if d['action']['pai'] == '5p')
        with self.assertRaisesRegex(ValueError, 'reconstruction_failed'):
            project(report)

    def test_actual_discard_still_has_to_match_the_next_log_event_exactly(self):
        report = same_tile_fixture()
        report['review']['kyokus'][0]['entries'][0]['actual']['tsumogiri'] = True
        with self.assertRaisesRegex(ValueError, 'reconstruction_failed'):
            project(report)

    def test_invalid_flag_and_different_actor_are_rejected(self):
        for field, value in [('tsumogiri', 1), ('actor', 1)]:
            with self.subTest(field=field):
                report = same_tile_fixture()
                entry = report['review']['kyokus'][0]['entries'][0]
                entry['details'][entry['actual_index']]['action'][field] = value
                with self.assertRaisesRegex(ValueError, 'reconstruction_failed'):
                    project(report)
