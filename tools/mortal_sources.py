"""Automatic private source links; no network, names or dates used as identity."""
import json
from collections import defaultdict


def reconcile(store):
    """Caller owns the SQLite transaction. Plan the whole batch before writing."""
    try:
        from .p2_store import decode
        from .mortal_report import final_scores
    except ImportError:
        from p2_store import decode
        from mortal_report import final_scores
    entries = store.analysis_entries()
    by_url = {e['url']: e for e in entries}
    rows = [dict(r) for r in store.db.execute(
        'SELECT r.id,r.game,r.seat,r.source,r.source_game_url,r.content,s.payload '
        'FROM reports r JOIN sources s ON s.hash=r.source')]
    families = {r['id']: (r['game'], r['seat']) for r in rows}
    known = defaultdict(set)
    for r in rows:
        if r['source_game_url']:
            known[families[r['id']]].add(r['source_game_url'])
    plans, scores_cache = [], {}
    for r in rows:
        if r['source_game_url']:
            continue
        content = json.loads(r['content'])
        if content.get('engine') != 'Mortal':
            continue
        family = families[r['id']]
        urls = known[family]
        if urls:
            if len(urls) == 1:
                plans.append((r, next(iter(urls)), 'identity'))
            continue
        if r['source'] not in scores_cache:
            try:
                scores_cache[r['source']] = final_scores(decode(r['payload']))
            except ValueError:
                scores_cache[r['source']] = None
        scores = scores_cache[r['source']]
        if scores is None:
            continue
        rank = sorted(range(4), key=lambda i: (-scores[i], i)).index(r['seat'])+1
        matches = [e for e in entries if e.get('history')
                   and sorted(p['score'] for p in e['history']['players']) == sorted(scores)
                   and e['history']['players'][e['history']['seat']]['score'] == scores[r['seat']]
                   and e['history']['rank'] == rank]
        if len(matches) != 1:
            continue
        entry = matches[0]
        # An occupied URL is not a fresh candidate for a different game's result.
        if any(families.get(i) != family for i in entry['reports']):
            continue
        if any(other['source_game_url'] == entry['url'] and families[other['id']] != family for other in rows):
            continue
        plans.append((r, entry['url'], 'scores'))
    contenders = defaultdict(set)
    for r, url, kind in plans:
        contenders[url].add(families[r['id']])
    count = 0
    for r, url, kind in plans:
        if kind == 'scores' and len(contenders[url]) != 1:
            continue
        content = json.loads(r['content'])
        content['source_link_kind'] = kind
        store.db.execute('UPDATE reports SET source_game_url=?,content=? WHERE id=? AND source_game_url IS NULL',
                         (url, json.dumps(content, ensure_ascii=False), r['id']))
        if url in by_url:
            entry = by_url[url]
            if r['id'] not in entry['reports']:
                entry['reports'].append(r['id'])
                store._put_analysis(entry)
        count += 1
    return count
