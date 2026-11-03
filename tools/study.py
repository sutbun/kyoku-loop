"""Private, transactional study state. No network or client-controlled clock."""
import base64
import copy
import gzip
import hashlib
import io
import json
import re
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    from .naga_preferences import KEY as NAGA_PREFERENCE, valid_name
except ImportError:
    from naga_preferences import KEY as NAGA_PREFERENCE, valid_name

JST = timezone(timedelta(hours=9))
STATE = ('status', 'due', 'streak', 'cycle', 'last_credit_day', 'revision')
PUBLIC = ('id','engine','round_index','event_index','seat','bakaze','kyoku','honba','own_wind',
          'own_hand','drawn','rivers','melds','dora_markers','scores','kyotaku',
          'reach_declared','reach_accepted','source_discard_index')
TABLES = ('sources','reports','study_items','review_events','study_sessions','study_settings')


class StudyFailure(ValueError):
    pass


def public_scene(scene):
    return {k:copy.deepcopy(scene[k]) for k in PUBLIC if k in scene} | {'is_decision':True}


def assessment_scene(scene):
    result = copy.deepcopy(scene)
    if scene.get('engine') == 'Mortal':
        result['policy_percent'] = [v * 100 / scene['weight_total'] for v in scene['raw_weights']]
    return result


class StudyMixin:
    def phone_sync(self,request):
        try:from .sync import receive
        except ImportError:from sync import receive
        return receive(self,request)

    def phone_pack(self):
        """Read-only, minimal study bundle. No reports, identities or URLs."""
        source=self.db.execute("SELECT value FROM study_settings WHERE key='device'").fetchone()[0]
        items=[]
        histories={}
        for row in self.db.execute('SELECT * FROM study_items ORDER BY rowid'):
            item=dict(row)
            scene=json.loads(item['scene'])
            safe=public_scene(scene)
            safe.update({k:v for k,v in assessment_scene(scene).items() if k in ('actual','suggested','gap','weights_percent','model_name','policy_percent')})
            item['scene']=safe
            item['history']=json.loads(item['history'])
            item['review_count']=self.db.execute("SELECT count(*) FROM review_events WHERE item=? AND kind='answer'",(item['id'],)).fetchone()[0]
            items.append(item)
            history=self.item_history(item['id'])
            history['scene']=safe
            histories[item['id']]=history
        # Older phone shells hard-code NAGA labels. They must refuse a Mortal
        # bundle instead of displaying another engine's evaluations as NAGA.
        policy = 2 if any(i['scene'].get('engine') == 'Mortal' for i in items) else 1
        return {'schema':1,'policy':policy,'source':source,'exported_at':self.moment().isoformat(),
                'items':items,'histories':histories,'reveals':self.hand_reveals(items)}

    def moment(self):
        value = self.clock() if self.clock else datetime.now(timezone.utc)
        if value.tzinfo is None:
            raise StudyFailure('invalid_clock')
        return value.astimezone(timezone.utc)

    def today(self):
        return self.moment().astimezone(JST).date().isoformat()

    def init_study(self):
        if self.db.execute('PRAGMA user_version').fetchone()[0] not in (0,3):
            raise StudyFailure('unsupported_storage')
        cols={r[1] for r in self.db.execute('PRAGMA table_info(study_items)')}
        if 'streak' not in cols and self.db.execute('SELECT count(*) FROM study_items').fetchone()[0]:
            # SQLite backup API takes a consistent copy before any migration.
            self._snapshot('pre-p3')
        with self.db:
            for key,decl in [('streak','INTEGER NOT NULL DEFAULT 0'),('cycle',"TEXT NOT NULL DEFAULT 'initial'"),
                             ('last_credit_day',"TEXT NOT NULL DEFAULT ''"),('revision','INTEGER NOT NULL DEFAULT 0')]:
                if key not in cols:
                    self.db.execute(f'ALTER TABLE study_items ADD COLUMN {key} {decl}')
            self.db.executescript('''
            CREATE TABLE IF NOT EXISTS review_events(id TEXT PRIMARY KEY,item TEXT NOT NULL REFERENCES study_items(id),kind TEXT NOT NULL,at TEXT NOT NULL,day TEXT NOT NULL,device TEXT NOT NULL,cycle TEXT NOT NULL,session TEXT,answer TEXT,rating TEXT,credited INTEGER NOT NULL,before_state TEXT NOT NULL,after_state TEXT NOT NULL,undo_of TEXT UNIQUE,request TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS study_sessions(id TEXT PRIMARY KEY,content TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS study_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
            PRAGMA user_version=3;
            ''')
            self.db.execute('INSERT OR IGNORE INTO study_settings VALUES(?,?)',('device',secrets.token_hex(16)))

    def _item(self, ident):
        row=self.db.execute('SELECT * FROM study_items WHERE id=?',(ident,)).fetchone()
        if row is None: raise StudyFailure('item_not_found')
        return dict(row)

    def _session(self, ident=None):
        if ident is None:
            row=self.db.execute("SELECT value FROM study_settings WHERE key='active_session'").fetchone()
            ident=row[0] if row else None
        row=self.db.execute('SELECT content FROM study_sessions WHERE id=?',(ident,)).fetchone()
        return json.loads(row[0]) if row else None

    def _put_session(self, session):
        self.db.execute('INSERT INTO study_sessions VALUES(?,?) ON CONFLICT(id) DO UPDATE SET content=excluded.content',
                        (session['id'],json.dumps(session,ensure_ascii=False)))

    def _snapshot_state(self, item):
        return {k:item[k] for k in STATE}

    def _put_item(self, ident, state):
        self.db.execute('UPDATE study_items SET '+','.join(k+'=?' for k in STATE)+' WHERE id=?',
                        (*[state[k] for k in STATE],ident))

    def _event(self, event_id, item, kind, before, after, request, **values):
        if not isinstance(event_id,str) or not 1 <= len(event_id) <= 100:
            raise StudyFailure('event_id_required')
        device=self.db.execute("SELECT value FROM study_settings WHERE key='device'").fetchone()[0]
        now=values.get('now') or self.moment()
        self.db.execute('INSERT INTO review_events VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            (event_id,item,kind,now.isoformat(),now.astimezone(JST).date().isoformat(),device,before['cycle'],
             values.get('session'),values.get('answer'),values.get('rating'),int(values.get('credited',False)),
             json.dumps(before),json.dumps(after),values.get('undo_of'),json.dumps(request,sort_keys=True)))

    def _duplicate(self, event_id, request):
        row=self.db.execute('SELECT request FROM review_events WHERE id=?',(event_id,)).fetchone()
        if row:
            stored=json.loads(row[0])
            if stored.get('_sync')==1:stored=stored['original_request']
            if stored != request: raise StudyFailure('event_conflict')
            return True
        return False

    def _queue(self, mode):
        today=self.today()
        items=[dict(r) for r in self.db.execute("SELECT * FROM study_items WHERE status IN ('未学習','復習中')")]
        if mode=='scheduled':
            items=[i for i in items if i['due'] and i['due']<=today and i['last_credit_day']!=today]
        return sorted(items,key=lambda i:(0 if i['status']=='復習中' else 1 if i['manual'] else 2,i['due'],i['id']))[:5]

    def study_start(self, mode):
        if mode not in ('scheduled','practice'): raise StudyFailure('invalid_mode')
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            s=self._session()
            if not s or s['index']>=len(s['queue']):
                s={'id':secrets.token_hex(16),'mode':mode,'index':0,'selected':None,'revealed':False,'answers':[],
                   'queue':[{'id':i['id'],'cycle':i['cycle'],'revision':i['revision']} for i in self._queue(mode)]}
                self._put_session(s)
                self.db.execute("INSERT INTO study_settings VALUES('active_session',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",(s['id'],))
        return self.study_current(s['id'])

    def _current_item(self, s):
        if not s or s['index']>=len(s['queue']): raise StudyFailure('session_complete')
        q=s['queue'][s['index']]
        item=self._item(q['id'])
        if item['revision']!=q['revision'] or item['cycle']!=q['cycle'] or item['status'] not in ('未学習','復習中'):
            raise StudyFailure('study_changed')
        return item

    def study_current(self, ident=None):
        s=self._session(ident)
        if not s: return None
        complete=s['index']>=len(s['queue'])
        result={k:s[k] for k in ('id','mode','index','selected','revealed')}
        result.update(total=len(s['queue']),complete=complete,scene=None,stale=False,answers=[])
        result['can_undo']=bool(s['answers'] and s['answers'][-1]['index']==s['index']-1)
        for a in s['answers']:
            row=self.db.execute('SELECT id,item,rating,credited,day FROM review_events WHERE id=?',(a['event'],)).fetchone()
            if row: result['answers'].append(dict(row))
        if not complete:
            try:
                item=self._current_item(s)
                scene=json.loads(item['scene'])
                result['scene']=public_scene(scene)
                if s['revealed']:
                    result['scene'].update({k:v for k,v in assessment_scene(scene).items() if k in ('actual','suggested','gap','weights_percent','model_name','policy_percent')})
                result['item_id']=item['id']
            except StudyFailure:
                result.update(stale=True,selected=None,revealed=False)
        return result

    def study_choice(self, session_id, answer, action):
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            s=self._session(session_id)
            item=self._current_item(s)
            if action=='choose':
                if s['revealed'] or answer not in json.loads(item['scene'])['own_hand']: raise StudyFailure('invalid_answer')
                s['selected']=answer
            elif action=='clear':
                if s['revealed']: raise StudyFailure('invalid_answer')
                s['selected']=None
            elif action=='confirm':
                if s['selected'] is None: raise StudyFailure('answer_required')
                s['revealed']=True
            elif action=='rechoose': s['revealed']=False
            else: raise StudyFailure('invalid_request')
            self._put_session(s)
        return self.study_current(session_id)

    def study_rate(self, session_id, item_id, rating, event_id):
        request={'session':session_id,'item':item_id,'rating':rating,'kind':'answer'}
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            if self._duplicate(event_id,request): return self.study_current(session_id)
            if rating not in ('理解した','再復習','保留'): raise StudyFailure('invalid_rating')
            now=self.moment()
            day=now.astimezone(JST).date()
            today=day.isoformat()
            s=self._session(session_id)
            item=self._current_item(s)
            if item['id']!=item_id or not s['revealed'] or s['selected'] is None: raise StudyFailure('answer_required')
            before=self._snapshot_state(item)
            after=dict(before,revision=before['revision']+1)
            credited=s['mode']=='scheduled' and item['due'] and item['due']<=today and item['last_credit_day']!=today and rating!='保留'
            if rating=='保留': after.update(status='保留',due='')
            elif credited:
                streak=item['streak']+1 if rating=='理解した' else 0
                after.update(streak=streak,last_credit_day=today,status='習得済み' if streak>=5 else '復習中',
                    due='' if streak>=5 else (day+timedelta(days=([3,7,14,30][streak-1] if streak else 1))).isoformat())
            self._event(event_id,item_id,'answer',before,after,request,session=session_id,answer=s['selected'],rating=rating,credited=credited,now=now)
            self._put_item(item_id,after)
            s['answers'].append({'event':event_id,'index':s['index']})
            s.update(index=s['index']+1,selected=None,revealed=False)
            self._put_session(s)
        return self.study_current(session_id)

    def study_skip(self, session_id):
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            s=self._session(session_id)
            if not s or s['index']>=len(s['queue']): raise StudyFailure('session_complete')
            # Only stale questions may be skipped without an answer event.
            try: self._current_item(s)
            except StudyFailure: pass
            else: raise StudyFailure('not_stale')
            s.update(index=s['index']+1,selected=None,revealed=False)
            self._put_session(s)
        return self.study_current(session_id)

    def study_control(self, ident, action, event_id):
        request={'item':ident,'action':action,'kind':'control'}
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            if self._duplicate(event_id,request): return {'event':event_id}
            now=self.moment()
            day=now.astimezone(JST).date()
            item=self._item(ident)
            before=self._snapshot_state(item)
            after=dict(before,revision=before['revision']+1)
            if action=='pause' and item['status'] in ('未学習','復習中'): after.update(status='保留',due='')
            elif action=='resume' and item['status']=='保留':
                after.update(status='復習中',due=(day+timedelta(days=int(item['last_credit_day']==day.isoformat()))).isoformat())
            elif action=='restart' and item['status']=='習得済み':
                after.update(status='復習中',due=day.isoformat(),streak=0,last_credit_day='',cycle=secrets.token_hex(16))
            else: raise StudyFailure('study_changed')
            self._event(event_id,ident,action,before,after,request,now=now)
            self._put_item(ident,after)
        return {'event':event_id}

    def _undo_event(self, original, undo_id, request):
        e=self.db.execute('SELECT * FROM review_events WHERE id=?',(original,)).fetchone()
        if not e or self.db.execute('SELECT 1 FROM review_events WHERE undo_of=?',(original,)).fetchone(): raise StudyFailure('cannot_undo')
        item=self._item(e['item'])
        expected=json.loads(e['after_state'])
        if self._snapshot_state(item)!=expected: raise StudyFailure('study_changed')
        restored=dict(json.loads(e['before_state']),revision=item['revision']+1)
        self._event(undo_id,item['id'],'undo',self._snapshot_state(item),restored,request,undo_of=original)
        self._put_item(item['id'],restored)
        return e,restored

    def study_undo(self, session_id, event_id):
        request={'session':session_id,'kind':'undo_answer'}
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            if self._duplicate(event_id,request): return self.study_current(session_id)
            s=self._session(session_id)
            if not s or not s['answers'] or s['answers'][-1]['index']!=s['index']-1: raise StudyFailure('cannot_undo')
            e,restored=self._undo_event(s['answers'][-1]['event'],event_id,request)
            s['answers'].pop()
            s.update(index=s['index']-1,selected=e['answer'],revealed=True)
            s['queue'][s['index']]['revision']=restored['revision']
            self._put_session(s)
        return self.study_current(session_id)

    def study_undo_control(self, original, event_id):
        request={'event':original,'kind':'undo_control'}
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            if self._duplicate(event_id,request): return {'event':event_id}
            e=self.db.execute('SELECT kind FROM review_events WHERE id=?',(original,)).fetchone()
            if not e or e[0] not in ('pause','resume','restart'): raise StudyFailure('cannot_undo')
            event,restored=self._undo_event(original,event_id,request)
            s=self._session()
            if s and s['index']<len(s['queue']):
                q=s['queue'][s['index']]
                if q['id']==event['item'] and q['revision']==json.loads(event['before_state'])['revision']:
                    q['revision']=restored['revision']
                    self._put_session(s)
        return {'event':event_id}

    def item_history(self, ident):
        item=self._item(ident)
        events=[dict(r) for r in self.db.execute('SELECT id,kind,at,day,device,cycle,session,answer,rating,credited,undo_of,request FROM review_events WHERE item=? ORDER BY rowid',(ident,))]
        for e in events:
            request=json.loads(e.pop('request'))
            if request.get('_sync')==1:e['sync_reason']=request.get('reason','')
        undone={e['undo_of'] for e in events if e['undo_of']}
        for e in events: e['undone']=e['id'] in undone
        return {'id':ident,'scene':assessment_scene(json.loads(item['scene'])),'events':events,'legacy_history':json.loads(item['history'])}

    def _backup_dir(self):
        folder=self.path.parent/'backups'
        folder.mkdir(exist_ok=True)
        if folder.resolve().parent!=self.path.parent: raise StudyFailure('invalid_backup_path')
        return folder

    def _snapshot(self, prefix='backup'):
        name=f'{prefix}-{datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")}-{secrets.token_hex(4)}.sqlite3'
        target=self._backup_dir()/name
        connection=sqlite3.connect(target)
        try: self.db.backup(connection)
        finally: connection.close()
        return target

    def backup_create(self):
        target=self._snapshot()
        try: from .backup_mirror import mirror_backup
        except ImportError: from backup_mirror import mirror_backup
        return {'name':target.name,'mirror':mirror_backup(self.path,target)}

    def backup_list(self):
        folder=self._backup_dir()
        try:
            try: from .backup_mirror import mirror_folder
            except ImportError: from backup_mirror import mirror_folder
            mirror=mirror_folder(self.path)
            extra={'mirror_folder':str(mirror) if mirror else ''}
        except Exception: extra={'mirror_folder':'','mirror_error':True}
        return {'folder':str(folder),**extra,'files':[{'name':p.name,'bytes':p.stat().st_size,
            'created':datetime.fromtimestamp(p.stat().st_mtime,timezone.utc).isoformat()} for p in sorted(folder.glob('backup-*.sqlite3'),reverse=True)]}

    def _backup_path(self,name):
        if not isinstance(name,str) or not re.fullmatch(r'backup-[A-Za-z0-9T_-]+\.sqlite3',name): raise StudyFailure('invalid_backup')
        path=(self._backup_dir()/name).resolve()
        if path.parent!=self._backup_dir().resolve() or not path.is_file(): raise StudyFailure('invalid_backup')
        return path

    def backup_export(self,name):
        payload=gzip.compress(self._backup_path(name).read_bytes())
        if len(payload)>20*1024*1024: raise StudyFailure('backup_download_large')
        return {'name':'kyokuloop-'+name+'.gz','data':base64.b64encode(payload).decode()}

    def backup_upload(self,data):
        try:
            payload=base64.b64decode(data,validate=True)
            if len(payload)>20*1024*1024: raise StudyFailure('invalid_backup')
            if payload[:2]==b'\x1f\x8b':
                with gzip.GzipFile(fileobj=io.BytesIO(payload)) as stream: payload=stream.read(256*1024*1024+1)
            if len(payload)>256*1024*1024 or not payload.startswith(b'SQLite format 3\x00'): raise StudyFailure('invalid_backup')
            name=f'backup-{datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")}-{secrets.token_hex(4)}.sqlite3'
            target=self._backup_dir()/name
            target.write_bytes(payload)
            try: return self.backup_inspect(name)
            except Exception:
                target.unlink()  # Only the just-created rejected upload.
                raise
        except (ValueError,TypeError,OSError,EOFError,sqlite3.Error): raise StudyFailure('invalid_backup') from None

    def _read_backup(self,name):
        path=self._backup_path(name)
        fingerprint=hashlib.sha256(path.read_bytes()).hexdigest()
        connection=sqlite3.connect(path.as_uri()+'?mode=ro',uri=True)
        connection.row_factory=sqlite3.Row
        try:
            connection.execute('BEGIN')
            if connection.execute('PRAGMA user_version').fetchone()[0]!=3 or connection.execute('PRAGMA quick_check').fetchone()[0]!='ok' or connection.execute('PRAGMA foreign_key_check').fetchone(): raise StudyFailure('invalid_backup')
            if connection.execute("SELECT 1 FROM sqlite_master WHERE type IN ('trigger','view')").fetchone(): raise StudyFailure('invalid_backup')
            rows={table:[dict(r) for r in connection.execute(f'SELECT * FROM {table}')] for table in TABLES}
            if any(set(r)!=set(c[1] for c in self.db.execute(f'PRAGMA table_info({table})')) for table in TABLES for r in rows[table]): raise StudyFailure('invalid_backup')
            for item in rows['study_items']:
                if item['status'] not in ('未学習','復習中','習得済み','保留') or type(item['streak']) is not int or item['streak'] not in range(6): raise StudyFailure('invalid_backup')
                if item['due']:
                    datetime.strptime(item['due'],'%Y-%m-%d')
                json.loads(item['scene'])
            for e in rows['review_events']:
                if e['kind'] not in ('answer','pause','resume','restart','undo'): raise StudyFailure('invalid_backup')
                json.loads(e['before_state']); json.loads(e['after_state']); json.loads(e['request'])
            self._validate_backup_rows(rows)
            if fingerprint!=hashlib.sha256(path.read_bytes()).hexdigest(): raise StudyFailure('backup_changed')
            return fingerprint,rows
        except (sqlite3.Error,ValueError,TypeError,KeyError): raise StudyFailure('invalid_backup') from None
        finally: connection.close()

    def _validate_backup_rows(self,rows):
        try:
            from .p2_store import decode, digest
            from .p0_verify import inspect_report, tile_index
        except ImportError:
            from p2_store import decode, digest
            from p0_verify import inspect_report, tile_index
        sources={}
        for row in rows['sources']:
            report=decode(row['payload'])
            if digest(report)!=row['hash']: raise StudyFailure('invalid_backup')
            sources[row['hash']]=report
        assessments={}
        for row in rows['reports']:
            report=sources[row['source']]
            if report.get('engine') == 'Mortal':
                try:
                    from .mortal_report import project
                except ImportError:
                    from mortal_report import project
                if row['seat'] != report['player_id'] or row['model'] != 0: raise StudyFailure('invalid_backup')
                game=digest([s['log'] for s in report['split_logs']])
                if row['game']!=game or row['id']!=digest([row['source'],row['seat'],0]): raise StudyFailure('invalid_backup')
                _,scenes,timeline=project(report)
                content=json.loads(row['content'])
                if content.get('engine')!='Mortal' or content['timeline']!=timeline: raise StudyFailure('invalid_backup')
                verified={}
                for scene in scenes:
                    scene['id']=digest([game,row['seat'],scene['round_index'],scene['source_discard_index'],'discard','Mortal'])
                    verified[scene['id']]=scene
                if content['decisions']!=list(verified.values()): raise StudyFailure('invalid_backup')
                if any(i not in verified for i in content['important']): raise StudyFailure('invalid_backup')
                assessments[row['id']]=verified
                continue
            raw=[json.loads(r) if isinstance(r,str) else r for r in report['custom_haihu']]
            if row['game']!=digest(raw) or row['id']!=digest([row['source'],row['seat'],row['model']]): raise StudyFailure('invalid_backup')
            content=json.loads(row['content'])
            timeline=[]
            summary,scenes=inspect_report(report,row['seat'],row['model'],timeline)
            if summary['issues'] or content['timeline']!=timeline: raise StudyFailure('invalid_backup')
            verified={digest([row['game'],row['seat'],s['round_index'],s['source_discard_index'],'discard']):s for s in scenes}
            assessments[row['id']]={}
            for scene in content['decisions']:
                base=verified[scene['id']]
                if any(scene[k]!=v for k,v in base.items()): raise StudyFailure('invalid_backup')
                weights=base['raw_weights'];total=sum(weights)
                if total<=0 or scene['gap']!=(max(weights)-weights[tile_index(scene['actual'])])*100/total: raise StudyFailure('invalid_backup')
                assessments[row['id']][scene['id']]=scene
            if any(i not in assessments[row['id']] for i in content['important']): raise StudyFailure('invalid_backup')
        items={i['id']:i for i in rows['study_items']}
        for item in items.values():
            if json.loads(item['scene'])!=assessments[item['report']][item['id']]: raise StudyFailure('invalid_backup')
        prior={}
        event_ids={e['id']:e for e in rows['review_events']}
        for e in rows['review_events']:
            before,after=json.loads(e['before_state']),json.loads(e['after_state'])
            if set(before)!=set(STATE) or set(after)!=set(STATE) or after['revision']!=before['revision']+1: raise StudyFailure('invalid_backup')
            if e['item'] in prior and before!=prior[e['item']]: raise StudyFailure('invalid_backup')
            at=datetime.fromisoformat(e['at'])
            if at.tzinfo is None or e['cycle']!=before['cycle'] or at.astimezone(JST).date().isoformat()!=e['day']: raise StudyFailure('invalid_backup')
            if e['kind']=='answer' and (e['answer'] not in json.loads(items[e['item']]['scene'])['own_hand'] or e['rating'] not in ('理解した','再復習','保留')): raise StudyFailure('invalid_backup')
            if e['undo_of'] and (e['undo_of'] not in event_ids or event_ids[e['undo_of']]['item']!=e['item']): raise StudyFailure('invalid_backup')
            prior[e['item']]=after
        for ident,last in prior.items():
            if self._snapshot_state(items[ident])!=last: raise StudyFailure('invalid_backup')
        try:from .sync import envelope,original,validate,project
        except ImportError:from sync import envelope,original,validate,project
        wrapped_items={e['item'] for e in rows['review_events'] if envelope(e)}
        backup_sessions={s['id']:json.loads(s['content']) for s in rows['study_sessions']}
        for ident in wrapped_items:
            group=[e for e in rows['review_events'] if e['item']==ident]
            base=next(envelope(e)['base'] for e in group if envelope(e));events=[]
            for e in group:
                raw=original(e);validate(raw,items[ident],self.moment());wrapped=envelope(e)
                session=backup_sessions.get(e['session'])
                mode=raw.get('mode') or (session['mode'] if session else 'scheduled' if raw['credited'] else 'practice')
                if wrapped:
                    if wrapped['base']!=base or wrapped['mode']!=mode:raise StudyFailure('invalid_backup')
                    events.append(wrapped)
                else:events.append({'_sync':1,'original':raw,'base':base,'mode':mode,'original_request':json.loads(e['request'])})
            state,derived=project(base,events)
            if state!=self._snapshot_state(items[ident]) or len(derived)!=len(group):raise StudyFailure('invalid_backup')
            for a,b in zip(derived,group):
                if any(a[k]!=b[k] for k in ('id','cycle','credited','undo_of')) or any(json.loads(a[k])!=json.loads(b[k]) for k in ('before_state','after_state')):raise StudyFailure('invalid_backup')
        for session in rows['study_sessions']:
            s=json.loads(session['content'])
            if s['id']!=session['id'] or s['mode'] not in ('scheduled','practice') or type(s['index']) is not int or not 0<=s['index']<=len(s['queue'])<=5: raise StudyFailure('invalid_backup')
            if type(s['revealed']) is not bool or not isinstance(s['answers'],list): raise StudyFailure('invalid_backup')
            if any(q['id'] not in items for q in s['queue']): raise StudyFailure('invalid_backup')
            if any(type(q['revision']) is not int or q['revision']<0 or not isinstance(q['cycle'],str) or not q['cycle'] for q in s['queue']): raise StudyFailure('invalid_backup')
            if any(a['event'] not in event_ids for a in s['answers']): raise StudyFailure('invalid_backup')
            indices=[a['index'] for a in s['answers']]
            if any(type(i) is not int or not 0<=i<s['index'] for i in indices) or indices!=sorted(set(indices)): raise StudyFailure('invalid_backup')
            if any(event_ids[a['event']]['session']!=s['id'] or event_ids[a['event']]['item']!=s['queue'][a['index']]['id'] for a in s['answers']): raise StudyFailure('invalid_backup')
            if s['selected'] is not None:
                if s['index']>=len(s['queue']) or s['selected'] not in json.loads(items[s['queue'][s['index']]['id']]['scene'])['own_hand']: raise StudyFailure('invalid_backup')
            if s['revealed'] and s['selected'] is None: raise StudyFailure('invalid_backup')
        session_ids={s['id'] for s in rows['study_sessions']}
        if any(r['value'] not in session_ids for r in rows['study_settings'] if r['key']=='active_session'): raise StudyFailure('invalid_backup')
        try:from .analysis_queue import stored_entry, PREFIX
        except ImportError:from analysis_queue import stored_entry, PREFIX
        reports={r['id']:r for r in rows['reports']}
        try:from .paipu_history import META_PREFIX, validated_meta
        except ImportError:from paipu_history import META_PREFIX, validated_meta
        analysis_urls = {r['key'][len(PREFIX):]:stored_entry(json.loads(r['value']))['url'] for r in rows['study_settings'] if r['key'].startswith(PREFIX)}
        for row in rows['study_settings']:
            if row['key'].startswith(META_PREFIX):
                meta = validated_meta(json.loads(row['value']))
                if analysis_urls.get(row['key'][len(META_PREFIX):]) != meta['url']: raise StudyFailure('invalid_backup')
            if row['key'].startswith(PREFIX):
                entry=stored_entry(json.loads(row['value']))
                if row['key']!=PREFIX+entry['id'] or any(r not in reports or reports[r]['source_game_url']!=entry['url'] for r in entry['reports']):
                    raise StudyFailure('invalid_backup')
            if row['key']=='analysis_setup' and row['value'] not in ('0','1'): raise StudyFailure('invalid_backup')
            if row['key']==NAGA_PREFERENCE and not valid_name(row['value']): raise StudyFailure('invalid_backup')

    def backup_inspect(self,name):
        try:from .sync import same_original
        except ImportError:from sync import same_original
        fingerprint,rows=self._read_backup(name)
        conflicts=0
        adopt=[]
        for e in rows['review_events']:
            current=self.db.execute('SELECT * FROM review_events WHERE id=?',(e['id'],)).fetchone()
            if current and not same_original(dict(current),e): conflicts+=1
        for item in rows['study_items']:
            current=self.db.execute('SELECT * FROM study_items WHERE id=?',(item['id'],)).fetchone()
            if not current:
                adopt.append(item['id']); continue
            ours=[r[0] for r in self.db.execute('SELECT id FROM review_events WHERE item=? ORDER BY rowid',(item['id'],))]
            theirs=[e['id'] for e in rows['review_events'] if e['item']==item['id']]
            if not set(ours).issubset(theirs) and not set(theirs).issubset(ours): conflicts+=1
            elif len(ours)<len(theirs): adopt.append(item['id'])
            if current['scene']!=item['scene'] or current['report']!=item['report']: conflicts+=1
        for table,key in [('sources','hash'),('reports','id')]:
            for r in rows[table]:
                current=self.db.execute(f'SELECT * FROM {table} WHERE {key}=?',(r[key],)).fetchone()
                if current and table=='reports' and any(current[k]!=r[k] for k in ('source','game','seat','model')): conflicts+=1
                if current and table=='reports' and current['source_game_url'] and r['source_game_url'] and current['source_game_url']!=r['source_game_url']: conflicts+=1
                if current and table=='sources' and current['hash']!=r['hash']: conflicts+=1
        return {'name':name,'hash':fingerprint,'reports':len(rows['reports']),'items':len(rows['study_items']),
                'events':len(rows['review_events']),'conflicts':conflicts,'adopt':adopt}

    def backup_restore(self,name,fingerprint):
        # Add missing data; never roll back newer local history. Divergent
        # histories are left for explicit conflict handling, not overwritten.
        self._snapshot('pre-restore')
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            empty=not self.db.execute('SELECT 1 FROM reports LIMIT 1').fetchone()
            plan=self.backup_inspect(name)
            if plan['hash']!=fingerprint: raise StudyFailure('backup_changed')
            if plan['conflicts']: raise StudyFailure('backup_conflict')
            actual_hash,rows=self._read_backup(name)
            if actual_hash!=fingerprint: raise StudyFailure('backup_changed')
            for table in ('sources','reports','study_items','review_events','study_sessions'):
                for row in rows[table]:
                    columns=list(row)
                    self.db.execute(f'INSERT OR IGNORE INTO {table} ('+','.join(columns)+') VALUES('+','.join('?' for _ in columns)+')',tuple(row.values()))
            for item in rows['study_items']:
                if item['id'] in plan['adopt']: self._put_item(item['id'],self._snapshot_state(item))
            # Restore missing URL inbox entries and links without dropping newer
            # local reports or the user's explicit analysis-request declaration.
            try:from .analysis_queue import stored_entry, PREFIX
            except ImportError:from analysis_queue import stored_entry, PREFIX
            for report in rows['reports']:
                if report['source_game_url']:
                    self.db.execute('UPDATE reports SET source_game_url=COALESCE(source_game_url,?) WHERE id=?',(report['source_game_url'],report['id']))
            for row in rows['study_settings']:
                if row['key'].startswith(PREFIX):
                    incoming=stored_entry(json.loads(row['value']))
                    current=self.db.execute('SELECT value FROM study_settings WHERE key=?',(row['key'],)).fetchone()
                    if current:
                        entry=stored_entry(json.loads(current[0]))
                        entry['reports']=list(dict.fromkeys(entry['reports']+incoming['reports']))
                        self._put_analysis(entry)
                    else:self._put_analysis(incoming)
                elif row['key'] in ('analysis_setup',NAGA_PREFERENCE):
                    self.db.execute('INSERT OR IGNORE INTO study_settings VALUES(?,?)',(row['key'],row['value']))
            try:from .paipu_history import META_PREFIX, validated_meta
            except ImportError:from paipu_history import META_PREFIX, validated_meta
            for row in rows['study_settings']:
                if row['key'].startswith(META_PREFIX):
                    meta = validated_meta(json.loads(row['value']))
                    self.db.execute('INSERT OR IGNORE INTO study_settings VALUES(?,?)', (row['key'],json.dumps(meta,ensure_ascii=False)))
            # Resume the backed-up in-flight session only if this installation
            # has no active session. A newer local progress is retained.
            active=next((r['value'] for r in rows['study_settings'] if r['key']=='active_session'),None)
            if active:
                self.db.execute("INSERT OR IGNORE INTO study_settings VALUES('active_session',?)",(active,))
            if empty:
                source=next((r['value'] for r in rows['study_settings'] if r['key']=='device'),None)
                if source:self.db.execute("UPDATE study_settings SET value=? WHERE key='device'",(source,))
            try:from .sync import envelope,reconcile
            except ImportError:from sync import envelope,reconcile
            affected={e['item'] for e in rows['review_events'] if envelope(e)}
            for ident in affected:reconcile(self,ident)
        return {'restored':True}
