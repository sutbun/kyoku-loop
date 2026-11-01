"""Offline research probe, not the production reviewer or a replay downloader.

Only five generated positions enter this tool. No URL, account, database, HTTP,
pickle or user replay input is accepted. See docs/MORTAL-LOCAL-RESEARCH.md.
"""
import argparse
import hashlib
import json
import math
import random
import time
from pathlib import Path


MODEL_ID = 'hhim8826/mortal3-b40c192'
MODEL_REVISION = '7784a9deddf63df03f023474116f715850d3c7a0'
MODEL_SHA256 = 'ce6c44cb25f9381cb31065a035556df2ea5e86107b44151a8eff8c266e40971e'
TILES = [f'{i}{s}' for s in 'mps' for i in range(1, 10)] + list('ESWNPFC')
ACTION_LABELS = TILES + ['5mr', '5pr', '5sr', 'riichi', 'chi_low',
                         'chi_mid', 'chi_high', 'pon', 'kan', 'agari', 'ryukyoku', 'pass']


def verify_model(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    if digest.hexdigest() != MODEL_SHA256:
        raise ValueError('model_sha256_mismatch')


def ranked_actions(q, mask):
    """Never report an illegal action or serialize non-finite legal values."""
    if len(q) != 46 or len(mask) != 46 or any(type(x) is not bool for x in mask):
        raise ValueError('invalid_action_space')
    legal = [(i, float(v)) for i, v in enumerate(q) if mask[i]]
    if not legal or any(not math.isfinite(v) for _, v in legal):
        raise ValueError('invalid_legal_values')
    return sorted(legal, key=lambda item: (-item[1], item[0]))


def fictional_position(seed, seat):
    wall = [t for t in TILES for _ in range(4)]
    for suit in 'mps':
        wall[wall.index('5' + suit)] = '5' + suit + 'r'
    random.Random(seed).shuffle(wall)
    # One position explicitly distinguishes red and ordinary five actions.
    if seed == 1:
        wall.remove('5p')
        wall.remove('5pr')
        wall = ['5p', '5pr'] + wall
        seat = 0
    start = dict(type='start_kyoku', bakaze='E', kyoku=1, honba=0,
                 kyotaku=0, oya=seat, scores=[25000] * 4,
                 tehais=[wall[i * 13:(i + 1) * 13] for i in range(4)],
                 dora_marker=wall[53])
    draw = dict(type='tsumo', actor=seat, pai=wall[52])
    return seat, start, draw


def run(model):
    verify_model(model)  # Before importing native runtimes or opening the graph.
    import numpy as np
    import onnxruntime as ort
    from libriichi.state import PlayerState

    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    started = time.perf_counter()
    session = ort.InferenceSession(str(model), options, providers=['CPUExecutionProvider'])
    if [(x.name, x.type, x.shape[1:]) for x in session.get_inputs()] != [
            ('obs', 'tensor(float)', [934, 34]), ('mask', 'tensor(bool)', [46])]:
        raise ValueError('unsupported_graph_inputs')
    if [(x.name, x.type, x.shape[1:]) for x in session.get_outputs()] != [
            ('q', 'tensor(float)', [46])]:
        raise ValueError('unsupported_graph_outputs')
    loaded = time.perf_counter()
    rows = []
    for seed in range(1, 6):
        seat, start, draw = fictional_position(seed, (seed - 1) % 4)
        state = PlayerState(seat)
        for event in [start, draw]:
            state.update(json.dumps(event))
        obs, mask = state.encode_obs(3, False)
        if obs.shape != (934, 34) or mask.shape != (46,) or not state.last_cans.can_discard:
            raise ValueError('invalid_encoded_position')
        # Opponents' hidden tiles must not affect an ordinary (non-oracle) model.
        hidden = json.loads(json.dumps(start))
        opponents = [i for i in range(4) if i != seat]
        hands = [hidden['tehais'][i] for i in opponents]
        for i, hand in zip(opponents, hands[1:] + hands[:1]):
            hidden['tehais'][i] = hand
        other = PlayerState(seat)
        for event in [hidden, draw]:
            other.update(json.dumps(event))
        hidden_obs, hidden_mask = other.encode_obs(3, False)
        if not np.array_equal(obs, hidden_obs) or not np.array_equal(mask, hidden_mask):
            raise ValueError('hidden_information_leak')
        inputs = {'obs': obs[np.newaxis].astype(np.float32), 'mask': mask[np.newaxis]}
        q = session.run(['q'], inputs)[0]
        repeated = session.run(['q'], inputs)[0]
        if q.shape != (1, 46) or not np.array_equal(q, repeated):
            raise ValueError('invalid_or_unstable_inference')
        ranking = ranked_actions(q[0].tolist(), mask.tolist())
        discard_slots = [i for i, _ in ranking if i < 37]
        for i in discard_slots:
            tile = ACTION_LABELS[i]
            state.validate_reaction(json.dumps(dict(type='dahai', actor=seat, pai=tile,
                                                    tsumogiri=tile == draw['pai'])))
        if seed == 1 and not (mask[13] and mask[35]):
            raise ValueError('red_five_not_distinguished')
        rows.append(dict(case=seed, seat=seat, best=ACTION_LABELS[ranking[0][0]],
                         legal_actions=len(ranking), validated_discards=len(discard_slots),
                         legal_q=[dict(action=ACTION_LABELS[i], q=v) for i, v in ranking]))
    return dict(scope='five_fictional_positions_only', model=MODEL_ID,
                revision=MODEL_REVISION, sha256=MODEL_SHA256, feature_version=3,
                runtime=ort.__version__, provider='CPUExecutionProvider',
                load_seconds=round(loaded - started, 3),
                probe_seconds=round(time.perf_counter() - loaded, 3),
                deterministic=True, hidden_information_independent=True, cases=rows)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(run(args.model), ensure_ascii=False, allow_nan=False, indent=2))
