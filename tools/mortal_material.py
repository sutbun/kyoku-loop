"""Shared, deterministic Mortal material compiler. No network or storage."""
import base64
import copy
import gzip
import hashlib
import io
import json
from datetime import datetime, timedelta, timezone

try:
    from . import mortal_report
    from .hand_reveal import replay_hands, scene_key
except ImportError:
    import mortal_report
    from hand_reveal import replay_hands, scene_key

LIMIT = 20 * 1024 * 1024
PUBLIC = ('id','engine','round_index','event_index','seat','bakaze','kyoku','honba','own_wind',
          'own_hand','drawn','rivers','melds','dora_markers','scores','kyotaku',
          'reach_declared','reach_accepted','source_discard_index')


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',',':')).encode()).hexdigest()


def rank_decisions(scenes):
    candidates = sorted((s for s in scenes if s['gap'] > 0), key=lambda s:(-s['gap'],s['round_index'],s.get('event_index',0)))
    heads, rest, seen = [], [], set()
    for scene in candidates:
        if scene['round_index'] not in seen:
            heads.append(scene)
            seen.add(scene['round_index'])
        else:
            rest.append(scene)
    return sorted((heads + rest)[:10], key=lambda s:(-s['gap'],s['round_index'],s.get('event_index',0)))


def compile_material(report):
    report = mortal_report.validate(report)
    summary, valid, timeline = mortal_report.project(report)
    source = digest(report)
    game = digest([cell['log'] for cell in report['split_logs']])
    seat = report['player_id']
    ident = digest([source, seat, 0])
    for scene in valid:
        scene['id'] = digest([game,seat,scene['round_index'],scene['source_discard_index'],'discard','Mortal'])
    important = rank_decisions(valid)
    content = {'id':ident,'seat':seat,'model':0,'engine':'Mortal',
               'model_name':report['review']['model_tag'],'model_version':report['version'],
               'rounds':summary['rounds'],'decisions':valid,'timeline':timeline,
               'important':[s['id'] for s in important],'excluded':summary['excluded'],
               'rule':'mortal-policy-gap-v1-diverse10-positive','unknown_weights':0}
    # This superset lets a device identify existing automatic questions from
    # the same gameplay/seat, even when they came from another model.
    family = [digest([game,seat,ri,di,'discard','Mortal'])
              for ri, cell in enumerate(report['split_logs'])
              for di in range(len(cell['log'][0][6+3*seat]))]
    return {'source':source,'game':game,'content':content,'family_ids':family}


def compile_upload(encoded, created_at):
    """Closed Worker entry point; untrusted input is JSON bytes, never code."""
    if not isinstance(encoded, str) or len(encoded) > ((LIMIT+2)//3)*4:
        raise ValueError('size_limit')
    try:
        payload = base64.b64decode(encoded, validate=True)
    except ValueError:
        raise ValueError('invalid_json') from None
    if len(payload) > LIMIT: raise ValueError('size_limit')
    try:
        raw = payload
        if raw[:2] == b'\x1f\x8b':
            with gzip.GzipFile(fileobj=io.BytesIO(raw)) as stream:
                raw = stream.read(LIMIT+1)
        if len(raw) > LIMIT: raise ValueError('size_limit')
        report = json.loads(raw.decode('utf-8-sig'))
        if not isinstance(report, dict): raise ValueError('invalid_json')
        if report.get('engine') != 'Mortal': raise ValueError('inbox_mortal_only')
        report = mortal_report.validate(report)
        material = compile_material(report)
        at = datetime.fromisoformat(created_at.replace('Z','+00:00'))
        if at.tzinfo is None: raise ValueError('invalid_import_time')
    except (UnicodeError, OSError, EOFError, RecursionError, KeyError, TypeError, AttributeError):
        raise ValueError('invalid_json') from None
    content = material['content']
    due = (at.astimezone(timezone(timedelta(hours=9)))+timedelta(days=1)).date().isoformat()
    items = []
    byid = {s['id']:s for s in content['decisions']}
    for ident in content['important'][:3]:
        original = byid[ident]
        scene = {k:copy.deepcopy(original[k]) for k in PUBLIC if k in original}
        scene.update({k:copy.deepcopy(original[k]) for k in ('actual','suggested','gap','weights_percent','model_name')})
        scene['is_decision'] = True
        items.append({'id':ident,'report':content['id'],'scene':scene,'automatic':1,'manual':0,
                      'status':'未学習','history':[],'due':due,'streak':0,'cycle':'initial',
                      'last_credit_day':'','revision':0,'review_count':0})
    hands = replay_hands(report, [byid[item['id']] for item in items])
    reveals = {item['id']:hands[scene_key(byid[item['id']])] for item in items if scene_key(byid[item['id']]) in hands}
    return {'id':content['id'],'game':material['game'],'seat':content['seat'],
            'model':content['model_name'],'rounds':content['rounds'],'created':created_at,
            'players':[str(v)[:100] for v in report['split_logs'][0]['name']],
            'important_count':len(content['important']),'family_ids':material['family_ids'],
            'policies':{i['id']:[v*100/byid[i['id']]['weight_total'] for v in byid[i['id']]['raw_weights']] for i in items},
            'items':items,'payload':base64.b64encode(gzip.compress(raw,mtime=0)).decode(), 'reveals':reveals}
