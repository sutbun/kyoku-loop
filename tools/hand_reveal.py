"""Opt-in display data replayed from retained originals; public scenes stay unchanged."""
import copy
from collections import Counter

try:
    from .p0_verify import SUPPORTED, TILES
except ImportError:
    from p0_verify import SUPPORTED, TILES


def scene_key(scene):
    return (scene['round_index'], scene['event_index'])


def _rounds(report):
    if report.get('engine') != 'Mortal':
        return [[entry['info']['msg'] for entry in stream] for stream in report['pred']]
    rounds = []
    for event in report['mjai_log']:
        if event['type'] == 'start_kyoku':
            rounds.append([])
        if event['type'] in SUPPORTED:
            if not rounds: raise ValueError('hand_data_missing')
            rounds[-1].append(event)
    return rounds


def validate_hands(hands, scene):
    if (not isinstance(hands, list) or len(hands) != 4
            or any(not isinstance(hand, list) or not 0 <= len(hand) <= 14 for hand in hands)
            or any(tile not in TILES and tile not in ('5mr', '5pr', '5sr') for hand in hands for tile in hand)
            or Counter(hands[scene['seat']]) != Counter(scene['own_hand'])):
        raise ValueError('hand_data_missing')
    visible = sum(hands, []) + scene['dora_markers']
    visible += [t['tile'] for river in scene['rivers'] for t in river if not t['called']]
    for groups in scene['melds']:
        for group in groups:
            visible += group['consumed'] + ([group['tile']] if group.get('tile') else []) + ([group['added']] if group.get('added') else [])
    if max(Counter(t.removesuffix('r') for t in visible).values(), default=0) > 4:
        raise ValueError('hand_data_missing')


def replay_hands(report, scenes):
    wanted = {scene_key(scene): scene for scene in scenes}
    result = {}
    for ri, events in enumerate(_rounds(report)):
        hands = None
        for ei, event in enumerate(events):
            kind, actor = event['type'], event.get('actor')
            if kind == 'start_kyoku': hands = copy.deepcopy(event['tehais'])
            elif kind == 'tsumo': hands[actor].append(event['pai'])
            elif kind in ('dahai', 'kakan'): hands[actor].remove(event['pai'])
            elif kind in ('chi', 'pon', 'daiminkan', 'ankan'):
                for tile in event['consumed']: hands[actor].remove(tile)
            key = (ri, ei)
            if key in wanted:
                validate_hands(hands, wanted[key])
                result[key] = copy.deepcopy(hands)
    return result
