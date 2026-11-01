"""Synthetic-only tests: no external data, URLs, identities or account state."""
import json
import unittest
from pathlib import Path

from tools.p0_verify import inspect_report, private_output, select_five, tile, validate_weights


def fixture():
    deck = [n for suit in (10, 20, 30) for n in range(suit + 1, suit + 10) for _ in range(4)]
    deck += [n for n in range(41, 48) for _ in range(4)]
    hands = [deck[i * 13:(i + 1) * 13] for i in range(4)]
    raw = [[0, 0, 0], [25000] * 4, [39], []]
    for hand in hands:
        raw += [hand, [], []]
    raw += [["流局", [0] * 4]]
    raw[5], raw[6] = [52], [60]
    start = {"type": "start_kyoku", "bakaze": "E", "kyoku": 1, "honba": 0,
             "kyotaku": 0, "oya": 0, "dora_marker": "9s", "scores": [25000] * 4,
             "tehais": [list(map(tile, hand)) for hand in hands]}
    row = [0] * 34
    row[0], row[13] = 7000, 2997
    entries = [
        {"info": {"msg": start}},
        {"info": {"msg": {"type": "tsumo", "actor": 0, "pai": "5pr", "real_dahai": "5pr", "pred_dahai": ["1m"]}}, "dahai_pred": [row]},
        {"info": {"msg": {"type": "dahai", "actor": 0, "pai": "5pr", "tsumogiri": True}}},
    ]
    return {"data_version": [1, 0], "naga_version": [2,2], "game_type": 0, "naga_types": {"0": "架空モデル"},
            "pred": [entries], "custom_haihu": [json.dumps([raw])]}


def kan_fixture(kind):
    report = fixture()
    raw = json.loads(report["custom_haihu"][0])[0]
    raw[2] = [39, 38]
    own = [11] * (3 if kind == "daiminkan" else 2)
    own += [12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23][:13 - len(own)]
    deck = [n for suit in (10, 20, 30) for n in range(suit + 1, suit + 10) for _ in range(4)]
    deck += [n for n in range(41, 48) for _ in range(4)]
    for n in own + [11, 25, 26] + ([11] if kind == "kakan" else []):
        deck.remove(n)
    hands = [own, deck[:13], deck[13:26], [11] + deck[26:38]]
    for seat in range(4):
        raw[4 + 3 * seat], raw[5 + 3 * seat], raw[6 + 3 * seat] = hands[seat], [], []
    raw[14], raw[15] = [25], [11]
    start = report["pred"][0][0]
    start["info"]["msg"]["tehais"] = [list(map(tile, h)) for h in hands]
    def event(t, **kw):
        return {"info": {"msg": {"type": t, **kw}}}
    def prediction(pai, actual):
        row = [0] * 34
        from tools.p0_verify import tile_index
        row[tile_index(actual)] = 9999
        return {"info": {"msg": {"type": "tsumo", "actor": 0, "pai": pai, "real_dahai": actual, "pred_dahai": [actual]}}, "dahai_pred": [row]}
    entries = [start, event("tsumo", actor=3, pai="5p"), event("dahai", actor=3, pai="1m", tsumogiri=False)]
    if kind == "daiminkan":
        raw[5], raw[6] = ["m11111111", 26], [0, 60]
        entries += [event("daiminkan", actor=0, target=3, pai="1m", consumed=["1m"] * 3)]
    else:
        raw[5], raw[6] = ["p111111", 11, 26], [12, "k11111111", 60]
        entries += [event("pon", actor=0, target=3, pai="1m", consumed=["1m"] * 2),
                    event("dahai", actor=0, pai="2m", tsumogiri=False),
                    event("tsumo", actor=0, pai="1m"),
                    event("kakan", actor=0, target=3, pai="1m", consumed=["1m"] * 3)]
    entries += [prediction("6p", "6p"), event("dora", dora_marker="8s"), event("dahai", actor=0, pai="6p", tsumogiri=True)]
    report["pred"], report["custom_haihu"] = [entries], [json.dumps([raw])]
    return report


class P0Tests(unittest.TestCase):
    def test_daiminkan_consumes_source_zero_placeholder(self):
        summary, scenes = inspect_report(kan_fixture('daiminkan'))
        self.assertEqual(summary['issues'], {})
        self.assertEqual(summary['counts']['meld_tiles_match'], 1)
        self.assertEqual(len(scenes), 1)
        self.assertEqual(len(scenes[0]['own_hand']), 11)

    def test_kakan_upgrades_existing_pon_instead_of_adding_a_meld(self):
        summary, scenes = inspect_report(kan_fixture('kakan'))
        self.assertEqual(summary['issues'], {})
        self.assertEqual(summary['counts']['kakan_tiles_match'], 1)
        self.assertEqual(len(scenes), 1)
        self.assertEqual(len(scenes[0]['melds'][0]), 1)
        self.assertEqual(scenes[0]['melds'][0][0]['type'], 'kakan')

    def test_call_target_must_match_editor_marker_position(self):
        report = kan_fixture('daiminkan')
        raw = json.loads(report['custom_haihu'][0])
        raw[0][5][0] = '11m111111'
        report['custom_haihu'][0] = json.dumps(raw)
        summary, scenes = inspect_report(report)
        self.assertIn('meld_target_mismatch', summary['issues'])
        self.assertEqual(scenes, [])

    def test_kakan_target_metadata_does_not_overwrite_verified_pon_source(self):
        report = kan_fixture('kakan')
        for entry in report['pred'][0]:
            if entry['info']['msg']['type'] == 'kakan':
                entry['info']['msg']['target'] = 0
        summary, scenes = inspect_report(report)
        self.assertEqual(summary['issues'], {})
        self.assertEqual(summary['counts']['kakan_target_metadata_diff'], 1)
        self.assertEqual(scenes[0]['melds'][0][0]['target'], 3)

    def test_new_dora_before_discard_is_included_without_future_reach_choice(self):
        report = fixture()
        raw = json.loads(report['custom_haihu'][0])
        raw[0][2] = [39, 38]
        report['custom_haihu'][0] = json.dumps(raw)
        report['pred'][0].insert(2, {'info': {'msg': {'type': 'dora', 'dora_marker': '8s'}}})
        timeline=[]
        summary, scenes = inspect_report(report,timeline=timeline)
        self.assertEqual(summary['issues'], {})
        self.assertEqual(scenes[0]['dora_markers'], ['9s', '8s'])
        self.assertEqual(timeline[1]['dora_markers'],['9s'])

    def test_dora_update_must_match_converted_source(self):
        report = fixture()
        report['pred'][0].insert(2, {'info': {'msg': {'type': 'dora', 'dora_marker': '8s'}}})
        summary, scenes = inspect_report(report)
        self.assertIn('dora_update_mismatch', summary['issues'])
        self.assertEqual(scenes, [])
    def test_red_draw_discard_and_public_projection(self):
        report = fixture()
        summary, scenes = inspect_report(report)
        self.assertEqual(summary["issues"], {})
        self.assertEqual(summary["counts"]["discard_match"], 1)
        self.assertEqual(len(scenes), 1)
        self.assertEqual(scenes[0]["actual"], "5pr")
        self.assertEqual(scenes[0]["own_hand"][-1], "5pr")
        self.assertNotIn("tehais", scenes[0])
        self.assertNotIn("hands", scenes[0])
        self.assertFalse(summary["p0_gate_passed"])
        # Neither future river tiles nor mutations of the input leak backward.
        self.assertEqual(scenes[0]["rivers"][0], [])
        report["pred"][0][0]["info"]["msg"]["tehais"][0].clear()
        self.assertEqual(len(scenes[0]["own_hand"]), 14)

    def test_start_hand_mismatch_invalidates_round(self):
        report = fixture()
        report["pred"][0][0]["info"]["msg"]["tehais"][1][0] = "C"
        summary, scenes = inspect_report(report)
        self.assertIn("initial_hand_mismatch", summary["issues"])
        self.assertEqual(scenes, [])

    def test_converted_discard_mismatch_invalidates_round(self):
        report = fixture()
        raw = json.loads(report["custom_haihu"][0])
        raw[0][6][0] = 11
        report["custom_haihu"][0] = json.dumps(raw)
        summary, scenes = inspect_report(report)
        self.assertIn("discard_mismatch", summary["issues"])
        self.assertEqual(scenes, [])

    def test_assessment_must_match_following_actual_discard(self):
        report = fixture()
        report["pred"][0][1]["info"]["msg"]["real_dahai"] = "1m"
        summary, scenes = inspect_report(report)
        self.assertIn("real_dahai_mismatch", summary["issues"])
        self.assertEqual(scenes, [])

    def test_zero_distribution_is_skipped_not_normalized(self):
        report = fixture()
        report["pred"][0][1]["dahai_pred"] = [[0] * 34]
        summary, scenes = inspect_report(report)
        self.assertEqual(summary["excluded"]["weight_zero"], 1)
        self.assertEqual(scenes, [])

    def test_suggestion_mapping_is_verified(self):
        report = fixture()
        report["pred"][0][1]["info"]["msg"]["pred_dahai"] = ["C"]
        summary, scenes = inspect_report(report)
        self.assertEqual(summary["excluded"]["suggestion_mismatch"], 1)
        self.assertEqual(scenes, [])

    def test_end_or_kan_is_not_treated_as_following_discard(self):
        report = fixture()
        report["pred"][0].insert(2, {"info": {"msg": {"type": "tsumo", "actor": 1, "pai": "C"}}})
        summary, scenes = inspect_report(report)
        self.assertEqual(summary["excluded"]["no_following_discard"], 1)
        self.assertEqual(scenes, [])

    def test_reach_declaration_between_prediction_and_discard(self):
        report = fixture()
        raw = json.loads(report["custom_haihu"][0])
        raw[0][6] = ["r60"]
        report["custom_haihu"][0] = json.dumps(raw)
        report["pred"][0].insert(2, {"info": {"msg": {"type": "reach", "actor": 0}}})
        summary, scenes = inspect_report(report)
        self.assertEqual(summary["issues"], {})
        self.assertFalse(scenes[0]["reach_declared"][0])

    def test_unsupported_event_does_not_produce_partial_round_scenes(self):
        report = fixture()
        report["pred"][0].append({"info": {"msg": {"type": "unknown", "actor": 0}}})
        summary, scenes = inspect_report(report)
        self.assertIn("unsupported_event", summary["issues"])
        self.assertEqual(scenes, [])

    def test_bad_root_and_version_fail_closed(self):
        with self.assertRaises(ValueError):
            inspect_report([])
        report = fixture()
        report["data_version"] = [99, 0]
        with self.assertRaises(ValueError):
            inspect_report(report)

    def test_output_cannot_be_saved_in_source_or_shared_git(self):
        with self.assertRaises(ValueError):
            private_output(Path(__file__).resolve().parents[1] / ".local/p0-test")
        with self.assertRaises(ValueError):
            private_output(Path("E:/dev/work/kyoku-loop/ai/evidence/private-test"))

    def test_weights_require_finite_nonnegative_34_values(self):
        self.assertEqual(validate_weights([1] * 33, "1m"), "weight_shape")
        for invalid in (-1, float("nan"), float("inf"), True):
            row = [1] * 34
            row[0] = invalid
            self.assertEqual(validate_weights(row, "1m"), "weight_value")

    def test_selection_does_not_invent_five_scenes(self):
        _, scenes = inspect_report(fixture())
        self.assertEqual(len(select_five(scenes)), 1)


if __name__ == "__main__":
    unittest.main()
