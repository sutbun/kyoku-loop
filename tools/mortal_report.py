"""Mortal mjai-reviewer 1.5.10 result adapter. No analysis or authentication.

Only the exercised JSON export is accepted. Public snapshots are independently
replayed against the embedded editor logs; review entries must bind to an exact
own draw/call, hand, and following discard. This is internal consistency, not
independent proof of the original Mahjong Soul game or account ownership.
"""
import copy
import json
import math
import re
from collections import Counter
from urllib.parse import parse_qs, urlsplit

try:
    from .p0_verify import HONORS, TILES, SUPPORTED, inspect_event_rounds, tile_index
except ImportError:
    from p0_verify import HONORS, TILES, SUPPORTED, inspect_event_rounds, tile_index

EXACT_TILES = TILES + ['5mr', '5pr', '5sr']


def sequential_sum(values):
    # Preserve the established Python 3.10 calculation on newer/Wasm Python,
    # whose built-in float sum uses a different accumulation algorithm.
    total = 0
    for value in values:
        total += value
    return total


def canonical_url(value):
    try:
        u = urlsplit(value.strip())
        if u.scheme != 'https' or u.netloc != 'mjai.ekyu.moe' or u.fragment:
            raise ValueError()
        query = parse_qs(u.query, strict_parsing=True, keep_blank_values=True) if u.query else {}
        if any(len(v) != 1 for v in query.values()): raise ValueError()
        if u.path == '/progress' and set(query) == {'task'}:
            ident = query['task'][0]
        elif u.path == '/killerducky/' and set(query) == {'data'}:
            match = re.fullmatch(r'/report/([a-f0-9]{16})\.json', query['data'][0])
            if not match: raise ValueError()
            ident = match[1]
        elif not query:
            match = re.fullmatch(r'/report/([a-f0-9]{16})\.json', u.path)
            if not match: raise ValueError()
            ident = match[1]
        else: raise ValueError()
        if not re.fullmatch(r'[a-f0-9]{16}', ident): raise ValueError()
        return f'https://mjai.ekyu.moe/report/{ident}.json'
    except (ValueError, TypeError, AttributeError):
        raise ValueError('invalid_url') from None


def validate(report):
    if report.get('engine') != 'Mortal' or report.get('version') != '1.5.10':
        raise ValueError('unsupported_format')
    if report.get('game_length') != 'Hanchan': raise ValueError('unsupported_rule')
    seat = report.get('player_id')
    review = report.get('review')
    if type(seat) is not int or seat not in range(4) or not isinstance(review, dict):
        raise ValueError('unsupported_format')
    if not re.fullmatch(r'[A-Za-z0-9_.-]{1,120}', review.get('model_tag', '')):
        raise ValueError('unsupported_model')
    if type(review.get('temperature')) not in (int, float) or not 0 < review['temperature'] <= 100:
        raise ValueError('unsupported_model')
    logs, kyokus, events = report.get('split_logs'), review.get('kyokus'), report.get('mjai_log')
    if (not isinstance(logs, list) or not 1 <= len(logs) <= 200
            or not isinstance(kyokus, list) or len(logs) != len(kyokus)
            or not isinstance(events, list) or not 1 <= len(events) <= 200000):
        raise ValueError('unsupported_format')
    for log, kyoku in zip(logs, kyokus):
        if (not isinstance(log, dict) or not isinstance(log.get('name'), list) or len(log['name']) != 4
                or not isinstance(log.get('log'), list) or len(log['log']) not in (1, len(logs))
                or any(not isinstance(r, list) or len(r) != 17 for r in log['log'])
                or not isinstance(kyoku, dict) or not isinstance(kyoku.get('entries'), list)
                or len(kyoku['entries']) > 2000):
            raise ValueError('unsupported_format')
    if any(len(cell['log']) != 1 for cell in logs):
        # An observed iPad Shortcuts export repeats the game in each split log.
        # Recover only identical, complete arrays in the same order.
        # project() still cross-checks every round, event and review snapshot.
        full = logs[0]['log']
        identity = json.dumps(full, sort_keys=True, allow_nan=False)
        if len(full) != len(logs) or any(json.dumps(cell['log'], sort_keys=True, allow_nan=False) != identity for cell in logs):
            raise ValueError('unsupported_format')
        report = dict(report, split_logs=[dict(cell, log=[full[i]]) for i, cell in enumerate(logs)])
    return report


def _meld_signature(m, review=False):
    kind = m['type']
    if kind not in ('chi', 'pon', 'daiminkan', 'ankan', 'kakan'): raise ValueError()
    tiles = list(m['consumed'])
    if kind != 'ankan': tiles.append(m['pai'] if review else m['tile'])
    if not review and kind == 'kakan': tiles.append(m['added'])
    if any(t not in EXACT_TILES for t in tiles): raise ValueError()
    return kind, tuple(sorted(tiles)), m.get('target')


def project(report):
    report = validate(report)
    seat = report['player_id']
    rounds, triggers, ends = [], {}, []
    current = None
    scores = None
    junme, left, last_tile = 0, 70, None
    started = ended = False
    for source in report['mjai_log']:
        event = copy.deepcopy(source)
        kind, actor = event['type'], event.get('actor')
        if kind == 'start_game':
            if started or rounds: raise ValueError('reconstruction_failed')
            started = True
            continue
        if not started or ended: raise ValueError('reconstruction_failed')
        if kind == 'end_game':
            if current is not None: raise ValueError('reconstruction_failed')
            ended = True
            continue
        if kind == 'start_kyoku':
            if current is not None: raise ValueError('reconstruction_failed')
            current = []
            rounds.append(current)
            ends.append([])
            scores = event['scores'][:]
            junme, left, last_tile = 0, 70, None
        if current is None: raise ValueError('reconstruction_failed')
        if kind in ('hora', 'ryukyoku'):
            ends[-1].append(event)
            continue
        if kind == 'end_kyoku':
            if not ends[-1]: raise ValueError('reconstruction_failed')
            current = None
            continue
        if kind not in SUPPORTED or ends[-1]: raise ValueError('reconstruction_failed')
        if actor is not None and (type(actor) is not int or actor not in range(4)):
            raise ValueError('reconstruction_failed')
        if kind == 'reach_accepted':
            scores[actor] -= 1000
            if 'scores' in event and event['scores'] != scores: raise ValueError('reconstruction_failed')
            event['scores'] = scores[:]
        if kind == 'kakan':
            # mjai kakan has no target. The original pon target is preserved by
            # the replay validator, not guessed from the actor on this event.
            event.setdefault('target', actor)
        if kind == 'tsumo':
            left -= 1
            if actor == seat: junme += 1
            last_tile = event['pai']
        elif kind in ('chi', 'pon') and actor == seat:
            junme += 1
        elif kind in ('dahai', 'kakan'):
            last_tile = event['pai']
        index = len(current)
        current.append({'info': {'msg': event}})
        if actor == seat and kind in ('tsumo', 'chi', 'pon'):
            key = (len(rounds)-1, junme, left)
            if key in triggers: raise ValueError('reconstruction_failed')
            triggers[key] = (index, last_tile)
    if not ended or current is not None or len(rounds) != len(report['split_logs']):
        raise ValueError('reconstruction_failed')
    if any(not 1 <= len(r) <= 2000 for r in rounds): raise ValueError('reconstruction_failed')
    timeline = []
    summary, _ = inspect_event_rounds(rounds, [s['log'] for s in report['split_logs']], seat, timeline=timeline)
    if summary['issues']: raise ValueError('reconstruction_failed')
    snapshots = {(s['round_index'], s['event_index']): s for s in timeline}
    scenes, excluded, bound = [], Counter(), set()
    for ri, (kyoku, stream) in enumerate(zip(report['review']['kyokus'], rounds)):
        start = stream[0]['info']['msg']
        if ([kyoku['kyoku'], kyoku['honba']] != [HONORS.index(start['bakaze'])*4+start['kyoku']-1, start['honba']]
                or kyoku['end_status'] != ends[ri]
                or kyoku['relative_scores'] != start['scores'][seat:]+start['scores'][:seat]):
            raise ValueError('reconstruction_failed')
        for entry in kyoku['entries']:
            actual, expected, details = entry['actual'], entry['expected'], entry['details']
            actions = [actual, expected, *(d['action'] for d in details)]
            if (any(a.get('type') not in ('dahai','reach','chi','pon','daiminkan','ankan','kakan','hora','ryukyoku','none') for a in actions)
                    or any(type(entry.get(k)) is not bool for k in ('at_self_riichi','at_self_chi_pon','at_opponent_kakan'))):
                raise ValueError('reconstruction_failed')
            if (actual['type'] != 'dahai' or expected['type'] != 'dahai'
                    or not details or any(d['action']['type'] != 'dahai' for d in details)):
                excluded['non_discard_choice'] += 1
                continue
            if entry['at_self_riichi']:
                excluded['reach_locked'] += 1
                continue
            trigger = triggers.get((ri, entry['junme'], entry['tiles_left']))
            if trigger is None: raise ValueError('reconstruction_failed')
            ei, last_tile = trigger
            scene = copy.deepcopy(snapshots[(ri, ei)])
            if (ri, ei) in bound: raise ValueError('reconstruction_failed')
            bound.add((ri, ei))
            state = entry['state']
            if (entry['last_actor'] != seat or entry['tile'] != last_tile
                    or Counter(state['tehai']) != Counter(scene['own_hand'])
                    or [_meld_signature(m, True) for m in state['fuuros']] != [_meld_signature(m) for m in scene['melds'][seat]]):
                raise ValueError('reconstruction_failed')
            following = next(((j, v['info']['msg']) for j, v in enumerate(stream[ei+1:], ei+1)
                              if v['info']['msg']['type'] not in ('reach', 'reach_accepted', 'dora')), None)
            if following is None or actual != following[1]: raise ValueError('reconstruction_failed')
            if scene['reach_declared'][seat] or scene['reach_accepted'][seat]:
                excluded['reach_locked'] += 1
                continue
            exact, qvalues, probabilities = [0.] * 37, [], []
            seen = set()
            for detail in details:
                action, q, prob = detail['action'], detail['q_value'], detail['prob']
                tile = action['pai']
                if (action['actor'] != seat or tile not in scene['own_hand'] or tile in seen
                        or type(q) not in (int, float) or not math.isfinite(q)
                        or type(prob) not in (int, float) or not math.isfinite(prob) or not 0 <= prob <= 1):
                    raise ValueError('reconstruction_failed')
                seen.add(tile)
                exact[EXACT_TILES.index(tile)] = prob
                qvalues.append(q)
                probabilities.append(prob)
            total = sequential_sum(probabilities)
            if (actual['actor'] != seat or expected != details[0]['action'] or expected['pai'] not in seen
                    or actual['pai'] not in seen or not 0.9999 <= total <= 1.0001
                    or exact[EXACT_TILES.index(expected['pai'])] != max(exact)
                    or type(entry['actual_index']) is not int
                    or entry['actual_index'] not in range(len(details))
                    or details[entry['actual_index']]['action'] != actual):
                raise ValueError('reconstruction_failed')
            # Verify the reported policy against Q and the recorded temperature;
            # these are model preferences, not win probabilities or point loss.
            softmax = [math.exp((q-max(qvalues))/report['review']['temperature']) for q in qvalues]
            if any(abs(p/total-v/sequential_sum(softmax)) > 0.0001 for p,v in zip(probabilities,softmax)):
                raise ValueError('reconstruction_failed')
            weights = [0.] * 34
            for tile, prob in zip(EXACT_TILES, exact): weights[tile_index(tile)] += prob*100/total
            scene.update({'actual': actual['pai'], 'suggested': expected['pai'], 'engine': 'Mortal',
                          'model_name': report['review']['model_tag'], 'raw_weights': exact,
                          'weight_total': total, 'weights_percent': weights,
                          'gap': (max(exact)-exact[EXACT_TILES.index(actual['pai'])])*100/total})
            # Include only dora observable before this exact discard.
            scene['dora_markers'] += [v['info']['msg']['dora_marker'] for v in stream[ei+1:following[0]]
                                      if v['info']['msg']['type'] == 'dora']
            visible = scene['own_hand'] + scene['dora_markers']
            visible += [t['tile'] for river in scene['rivers'] for t in river if not t['called']]
            for melds in scene['melds']:
                for meld in melds:
                    visible += meld['consumed'] + ([meld['tile']] if 'tile' in meld else []) + ([meld['added']] if 'added' in meld else [])
            if max(Counter(t.removesuffix('r') for t in visible).values()) > 4:
                raise ValueError('reconstruction_failed')
            scenes.append(scene)
    summary['excluded'] = dict(excluded)
    summary['projected_decisions'] = len(scenes)
    return summary, scenes, timeline
