"""Selected-round projection and separate review notes. No external analysis."""
import copy
import json
import re

KEY = 'round_review_v1'
TAGS = ['手作り', '押し引き', '鳴き・リーチ']
SCENE_KEYS = ('id','engine','round_index','event_index','seat','bakaze','kyoku','honba',
              'own_wind','own_hand','drawn','rivers','melds','dora_markers','scores','kyotaku',
              'reach_declared','reach_accepted','source_discard_index','event_type','actor',
              'actual','suggested','gap','weights_percent','model_name')


def fresh():
    return {'schema':1, 'sessions':{}, 'bookmarks':[], 'tags':TAGS.copy(), 'last_rounds':{}}


def round_label(s):
    return f"{dict(E='東',S='南',W='西',N='北').get(s['bakaze'],s['bakaze'])}{s['kyoku']}局 {s['honba']}本場"


def content_catalog(content):
    rounds = {}
    for scene in content['timeline']:
        ri = scene['round_index']
        rounds.setdefault(ri, {'index':ri, 'label':round_label(scene)})
    return {'report':content['id'], 'model':content['model_name'], 'rounds':list(rounds.values())}


def content_material(content, game, original, ri):
    if type(ri) is not int or ri < 0:
        raise ValueError('invalid_review')
    try:from .hand_reveal import replay_hands, scene_key
    except ImportError:from hand_reveal import replay_hands, scene_key
    decisions = {s['event_index']:s for s in content['decisions'] if s['round_index']==ri}
    timeline = []
    for event in content['timeline']:
        if event['round_index'] != ri: continue
        decision = decisions.get(event['event_index'])
        source = decision or event
        scene = {k:copy.deepcopy(source[k]) for k in SCENE_KEYS if k in source}
        scene['engine'] = content.get('engine','NAGA')
        scene['model_name'] = content['model_name']
        scene['is_decision'] = bool(decision) and not any((scene[k][scene['seat']] for k in ('reach_declared','reach_accepted')))
        if decision and scene['engine']=='Mortal':
            scene['policy_percent'] = [v*100/decision['weight_total'] for v in decision['raw_weights']]
        timeline.append(scene)
    if not timeline: raise ValueError('invalid_review')
    hands = replay_hands(original, timeline)
    return {'report':content['id'],'game':game,'seat':content['seat'],'round_index':ri,
            'label':round_label(timeline[0]),'model':content['model_name'],'timeline':timeline,
            'reveals':{str(s['event_index']):hands[scene_key(s)] for s in timeline if scene_key(s) in hands}}


def catalog(store, report):
    return content_catalog(store.detail(report))


def material(store, report, ri):
    try:from .p2_store import decode
    except ImportError:from p2_store import decode
    content = store.detail(report)
    row = store.db.execute('SELECT reports.game,sources.payload FROM reports JOIN sources ON reports.source=sources.hash WHERE reports.id=?',(report,)).fetchone()
    return content_material(content, row['game'], decode(row['payload']), ri)


def validate_state(value):
    if not isinstance(value,dict) or value.get('schema')!=1 or not isinstance(value.get('sessions'),dict) or not isinstance(value.get('bookmarks'),list):
        raise ValueError('invalid_review')
    tags = value.get('tags')
    if not isinstance(value.get('last_rounds',{}),dict) or any(not re.fullmatch(r'[0-9a-f]{64}',k) or type(v) is not int or not 0<=v<2000 for k,v in value.get('last_rounds',{}).items()):
        raise ValueError('invalid_review')
    if not isinstance(tags,list) or not 1 <= len(tags) <= 3 or len(set(tags))!=len(tags) or any(not isinstance(t,str) or not t.strip() or len(t)>20 for t in tags):
        raise ValueError('invalid_review')
    for key, s in value['sessions'].items():
        if not re.fullmatch(r'[0-9a-f]{64}:\d+',key) or not isinstance(s,dict) or type(s.get('index')) is not int or not 0<=s['index']<2000 or type(s.get('quiz')) is not bool:
            raise ValueError('invalid_review')
        for name in ('selected','answers'):
            if not isinstance(s.get(name),dict) or any(not re.fullmatch(r'\d+',k) or not isinstance(v,str) or not re.fullmatch(r'(?:[1-9][mps]|5[mps]r|[ESWNPFC])',v) for k,v in s[name].items()):
                raise ValueError('invalid_review')
    seen = set()
    for b in value['bookmarks']:
        if not isinstance(b,dict) or not re.fullmatch(r'[0-9a-f]{64}:[0-3]:\d+:\d+',b.get('id','')) or b['id'] in seen or not re.fullmatch(r'[0-9a-f]{64}',b.get('report','')):
            raise ValueError('invalid_review')
        seen.add(b['id'])
        if any(type(b.get(k)) is not int or not 0<=b[k]<2000 for k in ('round_index','event_index')) or b.get('tag') not in ['',*tags] or not isinstance(b.get('label'),str) or len(b['label'])>100 or not isinstance(b.get('memo'),str) or len(b['memo'])>2000:
            raise ValueError('invalid_review')
    return value


def apply_change(state, op):
    result = copy.deepcopy(state)
    kind = op.get('kind')
    if kind == 'session':
        result['sessions'][op.get('key','')] = op.get('value')
        key=op.get('key','').split(':')
        if len(key)!=2 or not key[1].isdigit(): raise ValueError('invalid_review')
        result.setdefault('last_rounds',{})[key[0]]=int(key[1])
    elif kind == 'bookmark':
        b = op.get('value')
        if not isinstance(b,dict): raise ValueError('invalid_review')
        result['bookmarks'] = [x for x in result['bookmarks'] if x['id']!=b.get('id')] + [b]
    elif kind == 'remove': result['bookmarks'] = [x for x in result['bookmarks'] if x['id']!=op.get('id')]
    elif kind == 'tag':
        old, new = op.get('old'), op.get('new')
        if old not in result['tags'] or not isinstance(new,str) or not new.strip(): raise ValueError('invalid_review')
        result['tags'] = list(dict.fromkeys(new if t==old else t for t in result['tags']))
        for b in result['bookmarks']:
            if b['tag']==old: b['tag']=new
    else: raise ValueError('invalid_review')
    return validate_state(result)


def read_state(store):
    row = store.db.execute('SELECT value FROM study_settings WHERE key=?',(KEY,)).fetchone()
    return validate_state(json.loads(row[0])) if row else fresh()


def change(store, op):
    with store.db:
        store.db.execute('BEGIN IMMEDIATE')
        result = apply_change(read_state(store), op)
        store.db.execute('INSERT INTO study_settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',(KEY,json.dumps(result,ensure_ascii=False)))
    return result


def merge_missing(current, incoming):
    result = copy.deepcopy(current)
    for key, s in incoming['sessions'].items(): result['sessions'].setdefault(key,s)
    for key, ri in incoming.get('last_rounds',{}).items(): result.setdefault('last_rounds',{}).setdefault(key,ri)
    ids = {b['id'] for b in result['bookmarks']}
    for b in incoming['bookmarks']:
        if b['id'] in ids: continue
        b = copy.deepcopy(b)
        if b['tag'] and b['tag'] not in result['tags']:
            if len(result['tags']) >= 3: raise ValueError('invalid_review')
            result['tags'].append(b['tag'])
        result['bookmarks'].append(b)
    return validate_state(result)
