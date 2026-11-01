"""Research-probe guards; standard library only, no model/network/real replay."""
import math
import tempfile
import unittest
from pathlib import Path

from tools.mortal_local_probe import ACTION_LABELS, fictional_position, ranked_actions, run


class LocalMortalProbeTests(unittest.TestCase):
    def test_untrusted_model_rejected_before_native_runtime_loading(self):
        with tempfile.TemporaryDirectory() as tmp:
            model = Path(tmp) / 'model.onnx'
            model.write_bytes(b'not the pinned model')
            with self.assertRaisesRegex(ValueError, 'model_sha256_mismatch'):
                run(model)

    def test_illegal_high_q_never_wins(self):
        mask = [False] * 46
        mask[13] = mask[35] = True
        q = [10000.] * 46
        q[13], q[35] = -2., -1.
        self.assertEqual([ACTION_LABELS[i] for i, _ in ranked_actions(q, mask)], ['5pr', '5p'])

    def test_invalid_legal_scores_and_masks_stop(self):
        for value in [math.inf, -math.inf, math.nan]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                ranked_actions([value] * 46, [True] * 46)
        for mask in [[False] * 46, [1] * 46, [True] * 45]:
            with self.subTest(mask=mask), self.assertRaises(ValueError):
                ranked_actions([0.] * 46, mask)

    def test_positions_use_four_of_each_tile_and_one_red_per_suit(self):
        for seed in range(1, 6):
            seat, start, draw = fictional_position(seed, (seed - 1) % 4)
            self.assertEqual(len(start['tehais'][seat]), 13)
            tiles = sum(start['tehais'], []) + [draw['pai'], start['dora_marker']]
            ordinary = [t[:2] if t.endswith('r') else t for t in tiles]
            self.assertTrue(all(ordinary.count(t) <= 4 for t in ordinary))
            self.assertTrue(all(tiles.count('5' + s + 'r') <= 1 for s in 'mps'))


if __name__ == '__main__':
    unittest.main()
