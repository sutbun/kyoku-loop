"""Loopback application's private data boundary. Stdlib only; no paid APIs."""
from __future__ import annotations

import base64
import gzip
import hashlib
import io
import json
import os
import re
import secrets
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    from .p0_verify import inspect_report, tile_index
    from .study import StudyMixin, StudyFailure, public_scene
    from .analysis_queue import AnalysisQueueMixin, source_url
    from .naga_preferences import preferred_model, remember_type
    from . import mortal_report
    from .mortal_material import digest, rank_decisions, compile_material
except ImportError:
    from p0_verify import inspect_report, tile_index
    from study import StudyMixin, StudyFailure, public_scene
    from analysis_queue import AnalysisQueueMixin, source_url
    from naga_preferences import preferred_model, remember_type
    import mortal_report
    from mortal_material import digest, rank_decisions, compile_material

ROOT = Path('D:/dev-data/kyoku-loop/private')
LIMIT = 20 * 1024 * 1024
RULE = 'gap-percent-v1-diverse10-positive'
ID = r'[a-f0-9]{64}v[0-9]+_[0-9]+'


class ImportFailure(ValueError):
    pass


def canonical_report_url(value):
    if not isinstance(value, str):
        raise ImportFailure('invalid_url')
    value = value.strip()
    if re.fullmatch(ID, value):
        return f'https://naga.dmv.nico/reports/{value}.json'
    try:
        u = urllib.parse.urlsplit(value)
        if u.scheme != 'https' or u.netloc != 'naga.dmv.nico' or u.fragment:
            raise ImportFailure('invalid_url')
        query = urllib.parse.parse_qs(u.query, strict_parsing=True, keep_blank_values=True)
        if any(len(v) != 1 for v in query.values()):
            raise ImportFailure('invalid_url')
        if u.path in ('/htmls/report_viewer.html', '/htmls/report_viewer_v2.html'):
            if set(query) - {'report_id', 'tw'} or ('tw' in query and query['tw'][0] not in ('0','1','2','3')):
                raise ImportFailure('invalid_url')
            ident = query.get('report_id', [''])[0]
        else:
            match = re.fullmatch(r'/(?:reports/('+ID+r')\.json(?:\.gz)?|htmls/('+ID+r')\.html)', u.path)
            if not match or query:
                raise ImportFailure('invalid_url')
            ident = match[1] or match[2]
        if not re.fullmatch(ID, ident):
            raise ImportFailure('invalid_url')
        return f'https://naga.dmv.nico/reports/{ident}.json'
    except (ValueError, IndexError):
        raise ImportFailure('invalid_url') from None


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ImportFailure('access_redirect')


def fetch_report(value):
    try:
        mortal_host = isinstance(value, str) and urllib.parse.urlsplit(value.strip()).hostname == 'mjai.ekyu.moe'
    except ValueError:
        raise ImportFailure('invalid_url') from None
    if mortal_host:
        try: url = mortal_report.canonical_url(value)
        except ValueError: raise ImportFailure('invalid_url') from None
    else:
        url = canonical_report_url(value)
    try:
        # No CookieProcessor, proxy credentials, authentication or redirects.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        with opener.open(urllib.request.Request(url, headers={'Accept': 'application/json'}), timeout=25) as response:
            payload = response.read(LIMIT + 1)
        return payload, url
    except urllib.error.HTTPError as exc:
        raise ImportFailure('access_denied' if exc.code in (401,403) else 'report_not_ready' if exc.code == 404 else 'upstream_error') from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise ImportFailure('network_error') from None


def decode(payload):
    try:
        if len(payload) > LIMIT:
            raise ImportFailure('size_limit')
        if payload[:2] == b'\x1f\x8b':
            with gzip.GzipFile(fileobj=io.BytesIO(payload)) as stream:
                payload = stream.read(LIMIT + 1)
        if len(payload) > LIMIT:
            raise ImportFailure('size_limit')
        report = json.loads(payload.decode('utf-8-sig'))
        if not isinstance(report, dict):
            raise ImportFailure('invalid_json')
        if report.get('engine') == 'Mortal':
            try: return mortal_report.validate(report)
            except ValueError as exc: raise ImportFailure(str(exc)) from None
        if report.get('data_version') != [1,0] or not isinstance(report.get('custom_haihu'),list):
            raise ImportFailure('unsupported_format')
        rounds = report.get('pred')
        if not isinstance(rounds,list) or not 1 <= len(rounds) <= 200 or any(not isinstance(r,list) or not 1 <= len(r) <= 2000 for r in rounds):
            raise ImportFailure('unsupported_format')
        if any(len(r[0]['info']['msg']['tehais']) != 4 for r in rounds):
            raise ImportFailure('unsupported_rule')
        # Only model output/version exercised in P0. Unknown versions stay closed.
        if report.get('naga_version') != [2,2]:
            raise ImportFailure('unsupported_model')
        if report.get('game_type') != 0:
            raise ImportFailure('unsupported_rule')
        models = report.get('naga_types')
        if not isinstance(models,dict) or not models or any(not k.isdigit() or not isinstance(v,str) for k,v in models.items()):
            raise ImportFailure('unsupported_model')
        return report
    except ImportFailure:
        raise
    except (ValueError, TypeError, KeyError, IndexError, OSError, EOFError, RecursionError):
        raise ImportFailure('invalid_json') from None


class Store(StudyMixin, AnalysisQueueMixin):
    def __init__(self, path=None, clock=None):
        self.clock=clock
        self.path = Path(path or ROOT / 'app/kyokuloop.sqlite3').resolve()
        if ROOT.resolve() not in self.path.parents or any((p/'.git').exists() for p in self.path.parents):
            raise ImportFailure('private_storage_required')
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.path, timeout=30)
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA foreign_keys=ON')
        self.db.executescript('''
        CREATE TABLE IF NOT EXISTS staging(token TEXT PRIMARY KEY,payload BLOB NOT NULL,url TEXT,created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS sources(hash TEXT PRIMARY KEY,payload BLOB NOT NULL,url TEXT,created TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY,source TEXT REFERENCES sources(hash),game TEXT NOT NULL,seat INTEGER NOT NULL,model INTEGER NOT NULL,source_game_url TEXT,content TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS study_items(id TEXT PRIMARY KEY,report TEXT REFERENCES reports(id),scene TEXT NOT NULL,automatic INTEGER NOT NULL,manual INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL,history TEXT NOT NULL,due TEXT NOT NULL);
        ''')
        self.init_study()

    def close(self):
        self.db.close()

    def stage(self, payload, url):
        report = decode(payload)
        token = secrets.token_urlsafe(32)
        mortal = report.get('engine') == 'Mortal'
        names = report['split_logs'][0]['name'] if mortal else report.get('player_info',{}).get('name',[])
        if not isinstance(names,list) or len(names) != 4:
            names = [f'席{i+1}' for i in range(4)]
        with self.db:
            self.db.execute('DELETE FROM staging WHERE created < ?', (time.time()-1800,))
            self.db.execute('INSERT INTO staging VALUES(?,?,?,?)',(token,payload,url,time.time()))
        if mortal:
            return {'token':token,'players':[str(n)[:100] for n in names], 'engine':'Mortal',
                    'target_seat':report['player_id'], 'preferred_model':0,
                    'final_scores':mortal_report.final_scores(report),
                    'models':[{'index':0,'name':report['review']['model_tag']}], 'rounds':len(report['split_logs'])}
        return {'token':token,'players':[str(n)[:100] for n in names],
                'models':[{'index':int(k),'name':v} for k,v in report['naga_types'].items()],
                'preferred_model':preferred_model(self.db,report['naga_types']), 'rounds':len(report['pred'])}

    def commit(self, token, seat, model, source_game_url, analysis_id=None):
        if type(seat) is not int or seat not in range(4) or type(model) is not int:
            raise ImportFailure('selection_required')
        row = self.db.execute('SELECT * FROM staging WHERE token=? AND created>?',(token,time.time()-1800)).fetchone()
        if not row:
            raise ImportFailure('stage_expired')
        report = decode(row['payload'])
        if report.get('engine') == 'Mortal':
            return self.commit_mortal(row, report, seat, model, source_game_url, analysis_id)
        if str(model) not in report['naga_types'] or model not in (0,1):
            raise ImportFailure('unsupported_model')
        if source_game_url: source_game_url = source_url(source_game_url)
        if analysis_id is not None:
            entry = self.analysis_entry(analysis_id)
            if source_game_url and source_game_url != entry['url']: raise ImportFailure('source_conflict')
            source_game_url = entry['url']
        source = digest(report)
        # Gameplay identity excludes evaluations, model and display names. Raw
        # editor round data includes all draws, discards and round outcomes.
        try:
            raw = [json.loads(r) if isinstance(r,str) else r for r in report['custom_haihu']]
        except (ValueError,TypeError):
            raise ImportFailure('reconstruction_failed') from None
        game = digest(raw)
        report_id = digest([source,seat,model])
        existing = self.db.execute('SELECT source_game_url,content FROM reports WHERE id=?',(report_id,)).fetchone()
        if existing:
            if source_game_url and existing['source_game_url'] not in (None,source_game_url):
                raise ImportFailure('source_conflict')
        timeline = []
        try:
            summary, scenes = inspect_report(report,seat,model,timeline)
        except (ValueError, TypeError, KeyError, IndexError, OverflowError):
            raise ImportFailure('reconstruction_failed') from None
        if summary['issues']:
            raise ImportFailure('reconstruction_failed')
        valid, reach_skipped, unknown_weights = [], 0, 0
        for scene in scenes:
            # Once own reach is declared the normal discard-choice exercise
            # no longer applies. Do not manufacture a free discard choice.
            if scene['reach_declared'][seat] or scene['reach_accepted'][seat]:
                reach_skipped += 1
                continue
            weights = scene['raw_weights']
            # P0 observed integer count distributions, rounded to ~10000.
            # Do not interpret a new scale as this format or silently rescale it.
            if any(type(w) is not int for w in weights) or not 9900 <= sum(weights) <= 10000:
                unknown_weights += 1
                continue
            s = dict(scene)
            total = sum(weights)
            s['gap'] = (max(weights)-weights[tile_index(s['actual'])])*100/total
            s['weights_percent'] = [w*100/total for w in weights]
            s['id'] = digest([game,seat,s['round_index'],s['source_discard_index'],'discard'])
            valid.append(s)
        important = rank_decisions(valid)
        content = {'id':report_id,'seat':seat,'model':model,'model_name':report['naga_types'][str(model)],
                   'model_version':report.get('naga_version'),'rounds':summary['rounds'],
                   'decisions':valid,'important':[s['id'] for s in important],
                   'timeline':timeline,'excluded':summary['excluded'],'rule':RULE,
                   'unknown_weights':unknown_weights,'reach_locked':reach_skipped,
                   'created':json.loads(existing['content'])['created'] if existing else datetime.now(timezone.utc).isoformat(),
                   'source_link_kind':'manual' if source_game_url else 'unlinked'}
        tomorrow = (self.moment().astimezone(timezone(timedelta(hours=9)))+timedelta(days=1)).date().isoformat()
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            # Recheck after obtaining the write lock; two import windows must
            # not relink an existing report to different original games.
            linked = self.db.execute('SELECT source_game_url FROM reports WHERE id=?',(report_id,)).fetchone()
            if linked and source_game_url and linked[0] not in (None,source_game_url):
                raise ImportFailure('source_conflict')
            self.db.execute('INSERT OR IGNORE INTO sources VALUES(?,?,?,?)',(source,row['payload'],row['url'],content['created']))
            self.db.execute('''INSERT INTO reports VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
                content=excluded.content,source_game_url=COALESCE(reports.source_game_url,excluded.source_game_url)''',
                (report_id,source,game,seat,model,source_game_url,json.dumps(content,ensure_ascii=False)))
            # A second model/source for identical gameplay must not silently
            # expand the automatic set or replace its original assessment.
            auto_count = self.db.execute('SELECT COUNT(*) FROM study_items i JOIN reports r ON i.report=r.id WHERE r.game=? AND r.seat=? AND i.automatic=1',(game,seat)).fetchone()[0]
            for s in important[:3]:
                if auto_count >= 3:
                    break
                existed = self.db.execute('SELECT 1 FROM study_items WHERE id=?',(s['id'],)).fetchone()
                if existed:
                    continue
                self.db.execute('INSERT OR IGNORE INTO study_items(id,report,scene,automatic,manual,status,history,due) VALUES(?,?,?,?,?,?,?,?)',(s['id'],report_id,json.dumps(s,ensure_ascii=False),1,0,'未学習','[]',tomorrow))
                auto_count += 1
            if analysis_id is not None:
                entry = self.analysis_entry(analysis_id)
                if report_id not in entry['reports']: entry['reports'].append(report_id)
                self._put_analysis(entry)
            remember_type(self.db,report['naga_types'][str(model)])
        return {'id':report_id,'duplicate':bool(existing)}

    def commit_mortal(self, row, report, seat, model, source_game_url, analysis_id, created_at=None, item_ids=None):
        if seat != report['player_id'] or model != 0:
            raise ImportFailure('mortal_target_required')
        if source_game_url: source_game_url = source_url(source_game_url)
        if analysis_id is not None:
            entry = self.analysis_entry(analysis_id)
            if source_game_url and source_game_url != entry['url']: raise ImportFailure('source_conflict')
            source_game_url = entry['url']
        try:
            prepared = compile_material(report)
        except (ValueError, TypeError, KeyError, IndexError, OverflowError, AttributeError):
            raise ImportFailure('reconstruction_failed') from None
        source, game, content = prepared['source'], prepared['game'], prepared['content']
        report_id = content['id']
        byid = {s['id']:s for s in content['decisions']}
        important = [byid[ident] for ident in content['important']]
        created = datetime.now(timezone.utc).isoformat()
        initial_time = self.moment()
        if created_at is not None or item_ids is not None:
            try:
                initial_time = datetime.fromisoformat(created_at.replace('Z','+00:00'))
                created = initial_time.isoformat()
                if initial_time.tzinfo is None or initial_time.year < 2000 or initial_time > self.moment()+timedelta(days=1): raise ValueError()
                if not isinstance(item_ids,list) or len(item_ids)>3 or len(set(item_ids))!=len(item_ids) or any(ident not in content['important'][:3] for ident in item_ids): raise ValueError()
            except (ValueError, TypeError, AttributeError):
                raise ImportFailure('invalid_sync') from None
        content.update(created=created,
                       source_link_kind='manual' if source_game_url else 'unlinked')
        tomorrow = (initial_time.astimezone(timezone(timedelta(hours=9)))+timedelta(days=1)).date().isoformat()
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            linked = self.db.execute('SELECT source_game_url,content FROM reports WHERE id=?',(report_id,)).fetchone()
            if linked and source_game_url and linked[0] not in (None, source_game_url):
                raise ImportFailure('source_conflict')
            if linked:
                content['created'] = json.loads(linked['content'])['created']
                if linked['source_game_url']:
                    content['source_link_kind'] = json.loads(linked['content']).get('source_link_kind', 'manual')
            self.db.execute('INSERT OR IGNORE INTO sources VALUES(?,?,?,?)',(source,row['payload'],row['url'],content['created']))
            self.db.execute('''INSERT INTO reports VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
                content=excluded.content,source_game_url=COALESCE(reports.source_game_url,excluded.source_game_url)''',
                (report_id,source,game,seat,model,source_game_url,json.dumps(content,ensure_ascii=False)))
            auto_count = self.db.execute('SELECT COUNT(*) FROM study_items i JOIN reports r ON i.report=r.id WHERE r.game=? AND r.seat=? AND i.automatic=1',(game,seat)).fetchone()[0]
            for s in important[:3]:
                if auto_count >= 3: break
                if self.db.execute('SELECT 1 FROM study_items WHERE id=?',(s['id'],)).fetchone(): continue
                self.db.execute('INSERT INTO study_items(id,report,scene,automatic,manual,status,history,due) VALUES(?,?,?,?,?,?,?,?)',
                                (s['id'],report_id,json.dumps(s,ensure_ascii=False),1,0,'未学習','[]',tomorrow))
                auto_count += 1
            # Preserve locally studied candidates when another model already filled the
            # automatic quota. Existing items, states and history are never replaced.
            for ident in item_ids or []:
                self.db.execute('INSERT OR IGNORE INTO study_items(id,report,scene,automatic,manual,status,history,due) VALUES(?,?,?,?,?,?,?,?)',
                                (ident,report_id,json.dumps(byid[ident],ensure_ascii=False),0,1,'未学習','[]',tomorrow))
            if analysis_id is not None:
                entry = self.analysis_entry(analysis_id)
                if report_id not in entry['reports']: entry['reports'].append(report_id)
                self._put_analysis(entry)
            self.reconcile_mortal_sources()
        return {'id':report_id,'duplicate':bool(linked)}

    def reconcile_mortal_sources(self):
        try: from .mortal_sources import reconcile
        except ImportError: from mortal_sources import reconcile
        if self.db.in_transaction:
            return reconcile(self)
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            return reconcile(self)

    def state(self):
        self.reconcile_mortal_sources()
        reports=[]
        for row in self.db.execute('SELECT id,content,source_game_url FROM reports ORDER BY rowid DESC'):
            d=json.loads(row['content'])
            reports.append({k:d[k] for k in ('id','seat','model','model_name','rounds','created')} | {
                'engine':d.get('engine','NAGA'),'important_count':len(d['important']),'source_linked':bool(row['source_game_url'])})
        items=[]
        for row in self.db.execute('SELECT * FROM study_items ORDER BY rowid'):
            item=dict(row)
            item['history']=json.loads(item['history'])
            item['scene']=public_scene(json.loads(item['scene']))
            item['review_count']=self.db.execute("SELECT count(*) FROM review_events WHERE item=? AND kind='answer'",(item['id'],)).fetchone()[0]
            items.append(item)
        setup=self.db.execute("SELECT value FROM study_settings WHERE key='analysis_setup'").fetchone()
        return {'reports':reports,'items':items,'analysis_queue':self.analysis_entries(),'analysis_setup':bool(setup and setup[0]=='1'),'today':self.today(),'due_count':len(self._queue('scheduled')),
                'practice_count':len(self._queue('practice')),'session':self.study_current()}

    def detail(self, ident):
        row=self.db.execute('SELECT content,source_game_url FROM reports WHERE id=?',(ident,)).fetchone()
        if not row:
            raise ImportFailure('not_found')
        content=json.loads(row['content'])
        content['source_link_kind']=content.get('source_link_kind', 'manual') if row['source_game_url'] else 'unlinked'
        content['registered']=[r['id'] for r in self.db.execute('SELECT id FROM study_items')]
        content['manual']=[r['id'] for r in self.db.execute('SELECT id FROM study_items WHERE manual=1')]
        return content

    def hand_reveals(self, items):
        try:from .hand_reveal import replay_hands, scene_key
        except ImportError:from hand_reveal import replay_hands, scene_key
        result = {}
        for ident in {item['report'] for item in items}:
            row = self.db.execute('SELECT sources.payload FROM reports JOIN sources ON reports.source=sources.hash WHERE reports.id=?',(ident,)).fetchone()
            if not row: continue
            selected = [item for item in items if item['report'] == ident]
            try:
                projected = replay_hands(decode(row['payload']), [item['scene'] for item in selected])
                result.update({item['id']:projected[scene_key(item['scene'])] for item in selected if scene_key(item['scene']) in projected})
            except (ValueError,KeyError,IndexError,TypeError):
                continue
        return result

    def open_hands(self, item=None, report=None, round_index=None, event_index=None):
        if report:
            detail = self.detail(report)
            scene = next((s for s in [*detail['decisions'], *detail['timeline']]
                          if s['round_index'] == round_index and s['event_index'] == event_index
                          and (item is None or s.get('id') == item)), None)
            if scene is None: raise StudyFailure('hand_data_missing')
        else:
            row = self._item(item)
            report, scene = row['report'], json.loads(row['scene'])
        ident = scene.get('id') or 'timeline'
        hands = self.hand_reveals([{'id':ident,'report':report,'scene':scene}]).get(ident)
        if hands is None: raise StudyFailure('hand_data_missing')
        return {'hands':hands}

    def save(self, report_id, ident, saved):
        detail=self.detail(report_id)
        scene=next((s for s in detail['decisions'] if s['id']==ident),None)
        if scene is None or type(saved) is not bool:
            raise ImportFailure('not_a_decision')
        tomorrow=(self.moment().astimezone(timezone(timedelta(hours=9)))+timedelta(days=1)).date().isoformat()
        with self.db:
            if saved:
                self.db.execute('INSERT OR IGNORE INTO study_items(id,report,scene,automatic,manual,status,history,due) VALUES(?,?,?,?,?,?,?,?)',(ident,report_id,json.dumps(scene,ensure_ascii=False),0,1,'未学習','[]',tomorrow))
                self.db.execute('UPDATE study_items SET manual=1 WHERE id=?',(ident,))
            else:
                self.db.execute('UPDATE study_items SET manual=0 WHERE id=?',(ident,))
                self.db.execute("DELETE FROM study_items WHERE id=? AND automatic=0 AND manual=0 AND history='[]' AND NOT EXISTS(SELECT 1 FROM review_events WHERE item=study_items.id)",(ident,))
        return self.detail(report_id)

    def link_source(self, report_id, analysis_id):
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            entry = self.analysis_entry(analysis_id)
            row = self.db.execute('SELECT content,source_game_url FROM reports WHERE id=?', (report_id,)).fetchone()
            if not row:
                raise ImportFailure('invalid_request')
            if row['source_game_url'] and row['source_game_url'] != entry['url']:
                raise ImportFailure('source_conflict')
            content = json.loads(row['content'])
            content['source_link_kind'] = 'manual'
            self.db.execute('UPDATE reports SET source_game_url=?,content=? WHERE id=?',
                            (entry['url'], json.dumps(content,ensure_ascii=False), report_id))
            if report_id not in entry['reports']:
                entry['reports'].append(report_id)
            self._put_analysis(entry)
        return self.state()

    def phone_mortal_source(self, source, initial=False):
        own = self.db.execute("SELECT value FROM study_settings WHERE key='device'").fetchone()[0]
        if not (initial and source is None) and source != own:
            raise StudyFailure('different_source')
        return own

    def phone_mortal_inspect(self, data, source):
        own = self.phone_mortal_source(source, initial=True)
        if not isinstance(data, str) or len(data) > ((LIMIT+2)//3)*4:
            raise ImportFailure('size_limit')
        try:
            payload = base64.b64decode(data, validate=True)
        except ValueError:
            raise ImportFailure('invalid_json') from None
        if len(payload) > LIMIT: raise ImportFailure('size_limit')
        report = decode(payload)
        if report.get('engine') != 'Mortal': raise ImportFailure('inbox_mortal_only')
        return self.stage(payload, None) | {'source': own}

    def phone_mortal_register(self, token, source, analysis_id, created_at=None, item_ids=None):
        own = self.phone_mortal_source(source)
        row = self.db.execute('SELECT * FROM staging WHERE token=? AND created>?',
                              (token, time.time()-1800)).fetchone()
        if not row: raise ImportFailure('stage_expired')
        report = decode(row['payload'])
        if report.get('engine') != 'Mortal': raise ImportFailure('inbox_mortal_only')
        url = self.analysis_entry(analysis_id)['url'] if analysis_id is not None else None
        # The client cannot choose another seat, model, URL or filesystem path.
        result = self.commit_mortal(row, report, report['player_id'], 0, url, analysis_id, created_at, item_ids)
        return result | {'source': own}


def main():
    store=None
    try:
        request=json.loads(sys.stdin.buffer.read(30*1024*1024+1))
        store=Store(os.environ.get('KYOKULOOP_DB') or None)
        action=request.get('action')
        if action=='state':
            result=store.state()
        elif action=='inspect':
            if request.get('url'):
                payload,url=fetch_report(request['url'])
            else:
                payload,url=base64.b64decode(request.get('data',''),validate=True),None
            result=store.stage(payload,url)
        elif action=='commit':
            result=store.commit(request.get('token'),request.get('seat'),request.get('model'),request.get('source_url') or None,request.get('analysis_id'))
        elif action in ('inbox_status','inbox_config','inbox_scan'):
            try:from .mortal_inbox import MortalInbox
            except ImportError:from mortal_inbox import MortalInbox
            inbox=MortalInbox(store)
            if action=='inbox_config': result=inbox.configure(request.get('enabled'),request.get('folder'))
            elif action=='inbox_scan': result=inbox.scan()
            else: result=inbox.status()
        elif action=='report_link': result=store.link_source(request.get('report'),request.get('analysis_id'))
        elif action=='phone_mortal_inspect': result=store.phone_mortal_inspect(request.get('data'),request.get('source'))
        elif action=='phone_mortal_register': result=store.phone_mortal_register(request.get('token'),request.get('source'),request.get('analysis_id'),request.get('created_at'),request.get('item_ids'))
        elif action=='analysis_add': result=store.analysis_add(request.get('url'))
        elif action=='analysis_bulk': result=store.analysis_bulk(request.get('data'))
        elif action=='analysis_sync': result=store.analysis_receive(request.get('entries'))
        elif action=='analysis_requested': result=store.analysis_requested(request.get('id'),request.get('requested'))
        elif action=='analysis_setup': result=store.analysis_setup(request.get('seen'))
        elif action=='detail':
            result=store.detail(request.get('id'))
        elif action=='open_hands': result=store.open_hands(request.get('item'),request.get('report'),request.get('round_index'),request.get('event_index'))
        elif action=='save':
            result=store.save(request.get('report'),request.get('id'),request.get('saved'))
        elif action=='study_start': result=store.study_start(request.get('mode'))
        elif action=='study_current': result=store.study_current()
        elif action=='study_choice': result=store.study_choice(request.get('session'),request.get('answer'),request.get('choice'))
        elif action=='study_rate': result=store.study_rate(request.get('session'),request.get('item'),request.get('rating'),request.get('event'))
        elif action=='study_undo': result=store.study_undo(request.get('session'),request.get('event'))
        elif action=='study_skip': result=store.study_skip(request.get('session'))
        elif action=='study_control': result=store.study_control(request.get('item'),request.get('control'),request.get('event'))
        elif action=='study_undo_control': result=store.study_undo_control(request.get('original'),request.get('event'))
        elif action=='item_history': result=store.item_history(request.get('item'))
        elif action=='offline_pack': result=store.phone_pack()
        elif action=='phone_sync': result=store.phone_sync(request.get('payload'))
        elif action=='phone_backup_inspect':
            try:from .sync import inspect_phone_backup
            except ImportError:from sync import inspect_phone_backup
            result=inspect_phone_backup(store,request.get('backup'))[0]
        elif action=='phone_backup_restore':
            try:from .sync import restore_phone_backup
            except ImportError:from sync import restore_phone_backup
            result=restore_phone_backup(store,request.get('backup'),request.get('hash'))
        elif action=='backup_list': result=store.backup_list()
        elif action=='backup_create': result=store.backup_create()
        elif action=='backup_export': result=store.backup_export(request.get('name'))
        elif action=='backup_upload': result=store.backup_upload(request.get('data'))
        elif action=='backup_inspect': result=store.backup_inspect(request.get('name'))
        elif action=='backup_restore': result=store.backup_restore(request.get('name'),request.get('hash'))
        else:
            raise ImportFailure('invalid_request')
        print(json.dumps({'ok':True,'data':result},ensure_ascii=True))
    except (ImportFailure,StudyFailure) as exc:
        print(json.dumps({'ok':False,'error':str(exc)}))
    except Exception:
        # Never leak payloads, URLs, names, filesystem paths or tracebacks.
        print(json.dumps({'ok':False,'error':'storage_or_input_error'}))
    finally:
        if store:
            store.close()


if __name__=='__main__':
    # Optional local adapters import the same exception/codec definitions when
    # this file is launched as a script as well as when imported by tests.
    sys.modules.setdefault('p2_store', sys.modules[__name__])
    main()
