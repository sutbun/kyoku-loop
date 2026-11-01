"""Immutable source events in request envelopes; transactional derived study state.

No new database columns or tables. Existing schema-3 backups retain originals.
"""
import copy
import hashlib
import heapq
import json
from datetime import datetime, timedelta, timezone

try:
    from .study import STATE, JST, StudyFailure
except ImportError:
    from study import STATE, JST, StudyFailure

FIELDS=('id','item','kind','at','day','device','cycle','session','answer','rating',
        'credited','before_state','after_state','undo_of','request')


def canonical(value):
    return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False)


def fingerprint(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def envelope(row):
    try:
        value=json.loads(row['request'])
        return value if value.get('_sync')==1 else None
    except (ValueError,AttributeError,TypeError):return None


def original(row):
    saved=envelope(row)
    if saved:return saved['original']
    raw={k:row[k] for k in FIELDS}
    for key in ('before_state','after_state'):raw[key]=json.loads(raw[key])
    return raw


def same_original(a,b):
    return canonical(original(a))==canonical(original(b))


def moment(raw):
    at=datetime.fromisoformat(raw['at'].replace('Z','+00:00'))
    if at.tzinfo is None:raise ValueError('timezone required')
    return at.astimezone(timezone.utc)


def validate(raw,item,now):
    try:
        if not isinstance(raw,dict) or set(raw)-set(FIELDS)-{'mode'} or set(FIELDS)-set(raw):raise ValueError()
        for key in ('id','item','device','cycle'):
            if not isinstance(raw[key],str) or not 1<=len(raw[key])<=100:raise ValueError()
        if raw['item']!=item['id'] or raw['kind'] not in ('answer','pause','resume','restart','undo'):raise ValueError()
        if not isinstance(raw['at'],str) or len(raw['at'])>50:raise ValueError()
        at=moment(raw)
        if at>now+timedelta(days=1):raise StudyFailure('clock_ahead')
        if raw['day']!=at.astimezone(JST).date().isoformat():raise ValueError()
        if type(raw['credited']) is not int or raw['credited'] not in (0,1):raise ValueError()
        if raw.get('mode') not in (None,'scheduled','practice'):raise ValueError()
        if raw['session'] is not None and (not isinstance(raw['session'],str) or not 1<=len(raw['session'])<=100):raise ValueError()
        if not isinstance(raw['request'],str) or len(raw['request'])>3000 or not isinstance(json.loads(raw['request']),dict):raise ValueError()
        for key in ('before_state','after_state'):
            state=raw[key]
            if not isinstance(state,dict) or set(state)!=set(STATE):raise ValueError()
            if state['status'] not in ('未学習','復習中','習得済み','保留'):raise ValueError()
            if type(state['streak']) is not int or not 0<=state['streak']<=5:raise ValueError()
            if type(state['revision']) is not int or not 0<=state['revision']<1000000000:raise ValueError()
            if not isinstance(state['cycle'],str) or not 1<=len(state['cycle'])<=100:raise ValueError()
            for date_key in ('due','last_credit_day'):
                value=state[date_key]
                if value!='' and (not isinstance(value,str) or datetime.strptime(value,'%Y-%m-%d').date().isoformat()!=value):raise ValueError()
        before,after=raw['before_state'],raw['after_state']
        if after['revision']!=before['revision']+1 or raw['cycle']!=before['cycle']:raise ValueError()
        if raw['kind'] not in ('restart','undo') and after['cycle']!=before['cycle']:raise ValueError()
        if raw['kind']=='restart' and after['cycle']==before['cycle']:raise ValueError()
        if raw['kind']=='answer':
            if raw['answer'] not in json.loads(item['scene'])['own_hand'] or raw['rating'] not in ('理解した','再復習','保留') or raw['undo_of'] is not None:raise ValueError()
        elif raw['answer'] is not None or raw['rating'] is not None or raw['credited']!=0:raise ValueError()
        if raw['kind']=='undo':
            if not isinstance(raw['undo_of'],str) or not 1<=len(raw['undo_of'])<=100:raise ValueError()
        elif raw['undo_of'] is not None:raise ValueError()
    except StudyFailure:raise
    except (ValueError,TypeError,KeyError,OverflowError):raise StudyFailure('invalid_sync') from None


def ordered(events):
    byid={e['original']['id']:e for e in events}
    edges={key:set() for key in byid};degree={key:0 for key in byid}
    def link(a,b):
        if a==b:raise StudyFailure('invalid_sync')
        if b not in edges[a]:edges[a].add(b);degree[b]+=1
    devices={};cycles={}
    for key,e in byid.items():
        r=e['original'];devices.setdefault(r['device'],[]).append(r)
        if r['kind']=='restart':cycles[r['after_state']['cycle']]=key
        if r['kind']=='undo':
            target=byid.get(r['undo_of'])
            if not target:raise StudyFailure('sync_dependency')
            if target['original']['kind']=='undo':raise StudyFailure('invalid_sync')
            link(r['undo_of'],key)
    for group in devices.values():
        group.sort(key=lambda r:(r['before_state']['revision'],moment(r),r['id']))
        for a,b in zip(group,group[1:]):link(a['id'],b['id'])
    for key,e in byid.items():
        parent=cycles.get(e['original']['cycle'])
        if parent:link(parent,key)
    def key(ident):
        r=byid[ident]['original'];return(moment(r),r['device'],ident)
    ready=[key(ident) for ident,n in degree.items() if n==0];heapq.heapify(ready)
    result=[]
    while ready:
        _,_,ident=heapq.heappop(ready);result.append(byid[ident])
        for nxt in edges[ident]:
            degree[nxt]-=1
            if not degree[nxt]:heapq.heappush(ready,key(nxt))
    if len(result)!=len(events):raise StudyFailure('invalid_sync')
    return result


def project(base,events):
    state=copy.deepcopy(base);result=[];undone=set()
    for wrapped in ordered(events):
        raw=wrapped['original'];day=raw['day'];before=copy.deepcopy(state)
        after=dict(before,revision=before['revision']+1);credited=0;undo_of=None;reason=''
        active=before['status'] in ('未学習','復習中')
        same_cycle=raw['cycle']==before['cycle']
        if raw['kind']=='undo':
            if result and result[-1]['id']==raw['undo_of'] and raw['undo_of'] not in undone:
                after=dict(json.loads(result[-1]['before_state']),revision=after['revision'])
                undo_of=raw['undo_of'];undone.add(undo_of)
            else:reason='undo_conflict'
        elif not same_cycle:reason='old_cycle'
        elif raw['kind']=='answer':
            if not active:reason='inactive'
            elif raw['rating']=='保留':after.update(status='保留',due='')
            elif wrapped['mode']=='scheduled' and before['due'] and before['due']<=day and before['last_credit_day']!=day:
                credited=1;streak=before['streak']+1 if raw['rating']=='理解した' else 0
                after.update(streak=streak,last_credit_day=day,status='習得済み' if streak>=5 else '復習中',
                    due='' if streak>=5 else (datetime.strptime(day,'%Y-%m-%d').date()+timedelta(days=([3,7,14,30][streak-1] if streak else 1))).isoformat())
            else:reason='practice' if wrapped['mode']=='practice' else 'same_day' if before['last_credit_day']==day else 'not_due'
        elif raw['kind']=='pause' and active:after.update(status='保留',due='')
        elif raw['kind']=='resume' and before['status']=='保留':
            after.update(status='復習中',due=(datetime.strptime(day,'%Y-%m-%d').date()+timedelta(days=int(before['last_credit_day']==day))).isoformat())
        elif raw['kind']=='restart' and before['status']=='習得済み':
            after.update(status='復習中',due=day,streak=0,last_credit_day='',cycle=raw['after_state']['cycle'])
        else:reason='inactive'
        state=after
        derived=dict(wrapped,reason=reason)
        row={k:raw[k] for k in FIELDS}
        row.update(at=moment(raw).isoformat(),day=day,cycle=before['cycle'],credited=credited,
            before_state=json.dumps(before),after_state=json.dumps(after),undo_of=undo_of,request=canonical(derived))
        result.append(row)
    return state,result


def reconcile(store,ident,incoming=()):
    rows=[dict(r) for r in store.db.execute('SELECT * FROM review_events WHERE item=? ORDER BY rowid',(ident,))]
    saved=[envelope(r) for r in rows if envelope(r)]
    base=copy.deepcopy(saved[0]['base'] if saved else json.loads(rows[0]['before_state']) if rows else store._snapshot_state(store._item(ident)))
    if any(v['base']!=base for v in saved):raise StudyFailure('sync_base_conflict')
    events=[]
    for row in rows:
        value=envelope(row)
        if not value:
            raw=original(row);session=store._session(row['session']) if row['session'] else None
            mode=session['mode'] if session else 'scheduled' if row['credited'] else 'practice'
            value={'_sync':1,'original':raw,'base':base,'mode':mode,'original_request':json.loads(row['request'])}
        events.append(value)
    events.extend({'_sync':1,'original':raw,'base':base,'mode':raw.get('mode') or ('scheduled' if raw['credited'] else 'practice'),'original_request':None} for raw in incoming)
    state,projected=project(base,events)
    store.db.execute('DELETE FROM review_events WHERE item=?',(ident,))
    columns=FIELDS
    for row in projected:
        store.db.execute('INSERT INTO review_events ('+','.join(columns)+') VALUES('+','.join('?' for _ in columns)+')',tuple(row[k] for k in columns))
    store._put_item(ident,state)


def receive(store,request):
    if not isinstance(request,dict) or type(request.get('protocol')) is not int or request['protocol']!=1:raise StudyFailure('invalid_sync')
    source=store.db.execute("SELECT value FROM study_settings WHERE key='device'").fetchone()[0]
    if request.get('source')!=source:raise StudyFailure('different_source')
    if not isinstance(request.get('device'),str) or not 1<=len(request['device'])<=100:raise StudyFailure('invalid_sync')
    events=request.get('events')
    if not isinstance(events,list) or len(events)>5000 or len(canonical(events).encode())>20*1024*1024:raise StudyFailure('size_limit')
    now=store.moment();seen={}
    for raw in events:
        try:item=store._item(raw['item'])
        except (TypeError,KeyError):raise StudyFailure('invalid_sync') from None
        validate(raw,item,now)
        if raw['id'] in seen and seen[raw['id']]!=raw:raise StudyFailure('event_conflict')
        seen[raw['id']]=raw
    if any(not store.db.execute('SELECT 1 FROM review_events WHERE id=?',(raw['id'],)).fetchone() for raw in seen.values()):
        store._snapshot('pre-sync')
    with store.db:
        store.db.execute('BEGIN IMMEDIATE');grouped={}
        for raw in seen.values():
            current=store.db.execute('SELECT * FROM review_events WHERE id=?',(raw['id'],)).fetchone()
            if current:
                if canonical(original(dict(current)))!=canonical(raw):raise StudyFailure('event_conflict')
            else:grouped.setdefault(raw['item'],[]).append(raw)
        for ident,incoming in grouped.items():reconcile(store,ident,incoming)
        receipts=[]
        for raw in seen.values():
            row=dict(store.db.execute('SELECT * FROM review_events WHERE id=?',(raw['id'],)).fetchone())
            receipts.append({'id':raw['id'],'hash':fingerprint(raw),'credited':row['credited'],
                'before_state':json.loads(row['before_state']),'after_state':json.loads(row['after_state']),
                'reason':(envelope(row) or {}).get('reason','')})
        result={'protocol':1,'source':source,'device':request['device'],'receipts':receipts,'pack':store.phone_pack()}
    return result


def inspect_phone_backup(store,value):
    try:
        if not isinstance(value,dict) or value.get('schema')!=1 or not isinstance(value.get('pack'),dict):raise ValueError()
        payload={'protocol':1,'source':value['pack']['source'],'device':value['device'],'events':value['events']}
        source=store.db.execute("SELECT value FROM study_settings WHERE key='device'").fetchone()[0]
        if payload['source']!=source:raise StudyFailure('different_source')
        if not isinstance(payload['events'],list) or len(payload['events'])>5000 or len(canonical(value).encode())>20*1024*1024:raise ValueError()
        if not isinstance(payload['device'],str) or not 1<=len(payload['device'])<=100:raise ValueError()
        ids=set();duplicates=0
        for raw in payload['events']:
            validate(raw,store._item(raw['item']),store.moment())
            if raw['id'] in ids:raise ValueError()
            ids.add(raw['id']);current=store.db.execute('SELECT * FROM review_events WHERE id=?',(raw['id'],)).fetchone()
            if current:
                if canonical(original(dict(current)))!=canonical(raw):raise StudyFailure('event_conflict')
                duplicates+=1
        return {'hash':fingerprint(value),'events':len(ids),'duplicates':duplicates,'new':len(ids)-duplicates},payload
    except StudyFailure:raise
    except (ValueError,TypeError,KeyError):raise StudyFailure('invalid_phone_backup') from None


def restore_phone_backup(store,value,expected):
    plan,payload=inspect_phone_backup(store,value)
    if plan['hash']!=expected:raise StudyFailure('backup_changed')
    result=receive(store,payload)
    return {'restored':True,'events':len(result['receipts'])}
