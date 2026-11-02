"""Validation for private Amae-koromo history metadata; no network or analysis."""
import json
import re
from datetime import datetime
from hashlib import sha256

try:
    from .analysis_queue import source_url
except ImportError:
    from analysis_queue import source_url


MODES = {12: '玉南', 16: '王座南', 9: '金南', 11: '玉東', 15: '王座東', 8: '金東'}
META_PREFIX = 'paipu-meta:'


def profile(value):
    if not isinstance(value, str):
        raise ValueError('invalid_history_profile')
    match = re.fullmatch(r'https://amae-koromo\.sapk\.ch/player/([1-9][0-9]{0,9})/(8|9|11|12|15|16)/?', value.strip())
    if not match or int(match[1]) > 2147483647:
        raise ValueError('invalid_history_profile')
    return {'url': f'https://amae-koromo.sapk.ch/player/{match[1]}/{match[2]}',
            'player': int(match[1]), 'mode': int(match[2])}


def encoded_player(player):
    # Match the public site's JS signed 32-bit XOR, including its tie/seat data.
    bits = ((7 * player + 1117113) & 0xffffffff) ^ 86216345
    signed = bits - 0x100000000 if bits >= 0x80000000 else bits
    return 1358437 + signed


def text(value, maximum=100):
    if not isinstance(value, str) or not 1 <= len(value.strip()) <= maximum:
        raise ValueError('invalid_history')
    if any(ord(c) < 32 for c in value):
        raise ValueError('invalid_history')
    return value.strip()


def record(value, selected):
    if not isinstance(value, dict):
        raise ValueError('invalid_history')
    at = value.get('at')
    try:
        moment = datetime.fromisoformat(at.replace('Z', '+00:00'))
        if moment.tzinfo is None or not 2019 <= moment.year <= 2100:
            raise ValueError()
    except (AttributeError, TypeError, ValueError):
        raise ValueError('invalid_history') from None
    players = value.get('players')
    if not isinstance(players, list) or len(players) != 4:
        raise ValueError('invalid_history')
    clean_players = []
    for p in players:
        if not isinstance(p, dict) or type(p.get('score')) is not int or not -1000000 <= p['score'] <= 1000000:
            raise ValueError('invalid_history')
        clean_players.append({'name': text(p.get('name')), 'score': p['score']})
    seat = value.get('seat')
    if type(seat) is not int or not 0 <= seat < 4:
        raise ValueError('invalid_history')
    # Equal scores are ordered by original seat, as in the site's public code.
    order = sorted(range(4), key=lambda i: (-clean_players[i]['score'], i))
    url = value.get('url')
    if url is not None:
        url = source_url(url)
        if not url.endswith('_a' + str(encoded_player(selected['player']))):
            raise ValueError('history_target_mismatch')
    data = {'at': moment.isoformat(), 'players': clean_players, 'seat': seat,
            'rank': order.index(seat) + 1, 'url': url, 'mode': selected['mode']}
    identity = url if url else json.dumps(data, ensure_ascii=False, sort_keys=True)
    return {'id': sha256(identity.encode()).hexdigest(), **data}


def records(value, selected):
    if not isinstance(value, list) or len(value) > 100:
        raise ValueError('invalid_history')
    result = [record(v, selected) for v in value]
    if len({r['id'] for r in result}) != len(result):
        raise ValueError('duplicate_history')
    return sorted(result, key=lambda r: r['at'], reverse=True)


def validated_meta(value):
    if not isinstance(value, dict) or type(value.get('player')) is not int or not 1 <= value['player'] <= 2147483647:
        raise ValueError('invalid_history')
    if type(value.get('mode')) is not int or value['mode'] not in MODES:
        raise ValueError('invalid_history')
    return record(value, {'player': value['player'], 'mode': value['mode']}) | {'player': value['player']}


def parse_batch(value):
    """All-or-nothing validation. Full URLs retain their evaluated player."""
    if not isinstance(value, str) or not value.strip() or len(value.encode('utf-8')) > 2 * 1024 * 1024:
        raise ValueError('invalid_history')
    if value.lstrip().startswith('{'):
        data = json.loads(value)
        if not isinstance(data, dict) or data.get('kind') != 'kyokuloop-history' or type(data.get('version')) is not int or data['version'] != 1:
            raise ValueError('invalid_history')
        raw = data.get('entries')
        if not isinstance(raw, list) or not 1 <= len(raw) <= 500:
            raise ValueError('invalid_history')
        player = data.get('player')
    else:
        raw = [{'url': line.strip()} for line in value.splitlines() if line.strip()]
        if not 1 <= len(raw) <= 500: raise ValueError('invalid_history')
        player = None
    valid = {}
    for entry in raw:
        if not isinstance(entry, dict): raise ValueError('invalid_history')
        url = source_url(entry.get('url'))
        meta = None
        if any(key in entry for key in ('at','players','seat','mode')):
            meta = validated_meta(entry | {'url': url, 'player': player})
        previous = valid.get(url)
        if previous and previous['meta'] and meta and previous['meta'] != meta:
            raise ValueError('invalid_history')
        valid[url] = {'url': url, 'meta': meta or (previous or {}).get('meta')}
    return list(valid.values()), len(raw)
