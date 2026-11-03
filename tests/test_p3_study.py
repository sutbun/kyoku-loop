import json
import tempfile
import copy
import sqlite3
import base64
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from test_p0_verify import fixture
from tools.p2_store import Store
from tools.study import StudyFailure

def five_fixture(count=5):
    report=fixture()
    raw=json.loads(report['custom_haihu'][0])
    raw[0][5]=[52]+list(range(41,41+count-1))
    raw[0][6]=[60]*count
    report['custom_haihu'][0]=json.dumps(raw)
    start,draw,discard=report['pred'][0]
    entries=[start]
    from tools.p0_verify import tile,tile_index
    for code in raw[0][5]:
        d=copy.deepcopy(draw);x=copy.deepcopy(discard);value=tile(code)
        d['info']['msg'].update(pai=value,real_dahai=value)
        weights=[0]*34;weights[0]=7000;weights[tile_index(value)]=2997
        d['dahai_pred']=[weights];x['info']['msg']['pai']=value
        entries.extend([d,x])
    report['pred']=[entries]
    return report


class StudyTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(dir='D:/dev-data/kyoku-loop/private')
        self.now=datetime(2026,1,1,16,0,tzinfo=timezone.utc)
        self.store=Store(Path(self.tmp.name)/'test.sqlite3',clock=lambda:self.now)
        stage=self.store.stage(json.dumps(fixture()).encode(),None)
        self.store.commit(stage['token'],0,0,None)
        self.item=self.store.state()['items'][0]['id']
        self.store.db.execute('UPDATE study_items SET due=?',('2026-01-02',))
        self.store.db.commit()

    def tearDown(self):
        self.store.close()
        self.tmp.cleanup()

    def answer(self,rating='理解した',mode='scheduled',event='event-1'):
        s=self.store.study_start(mode)
        self.store.study_choice(s['id'],'5pr','choose')
        self.store.study_choice(s['id'],None,'confirm')
        return self.store.study_rate(s['id'],self.item,rating,event)

    def test_question_hides_assessment_until_confirmation_and_reopens(self):
        session=self.store.study_start('scheduled')
        self.assertNotIn('actual',session['scene'])
        self.assertNotIn('raw_weights',session['scene'])
        self.store.study_choice(session['id'],'5pr','choose')
        path=self.store.path
        self.store.close()
        self.store=Store(path,clock=lambda:self.now)
        self.assertEqual(self.store.study_current()['selected'],'5pr')
        revealed=self.store.study_choice(session['id'],None,'confirm')
        self.assertEqual(revealed['scene']['actual'],'5pr')
        hidden=self.store.study_choice(session['id'],None,'rechoose')
        self.assertNotIn('suggested',hidden['scene'])

    def test_intervals_and_fifth_graduation(self):
        for n,days in enumerate([3,7,14,30,None],1):
            self.answer(event=f'answer-{n}')
            item=self.store.state()['items'][0]
            self.assertEqual(item['streak'],n)
            if days:
                expected=(self.now.astimezone(timezone(timedelta(hours=9))).date()+timedelta(days=days)).isoformat()
                self.assertEqual(item['due'],expected)
                self.now=datetime.fromisoformat(expected+'T01:00:00+09:00')
            else:
                self.assertEqual(item['status'],'習得済み')
                self.assertEqual(item['due'],'')

    def test_practice_and_duplicate_delivery_never_farm_streak(self):
        session=self.store.study_start('practice')
        self.store.study_choice(session['id'],'5pr','choose')
        self.store.study_choice(session['id'],None,'confirm')
        self.store.study_rate(session['id'],self.item,'理解した','same-event')
        self.store.study_rate(session['id'],self.item,'理解した','same-event')
        self.assertEqual(self.store.state()['items'][0]['streak'],0)
        self.assertEqual(len(self.store.item_history(self.item)['events']),1)
        with self.assertRaises(StudyFailure):
            self.store.study_rate(session['id'],self.item,'再復習','same-event')

    def test_undo_is_append_only_and_restores_due_and_question(self):
        completed=self.answer()
        self.assertTrue(completed['complete'])
        question=self.store.study_undo(completed['id'],'undo-1')
        self.assertTrue(question['revealed'])
        self.assertEqual(self.store.state()['items'][0]['streak'],0)
        self.assertEqual(self.store.state()['items'][0]['due'],'2026-01-02')
        self.assertEqual(len(self.store.item_history(self.item)['events']),2)
        self.store.study_undo(completed['id'],'undo-1')
        self.assertEqual(len(self.store.item_history(self.item)['events']),2)

    def test_retry_next_day_pause_resume_restart_preserve_history(self):
        self.answer('再復習')
        item=self.store.state()['items'][0]
        self.assertEqual(item['due'],'2026-01-03')
        self.store.study_control(self.item,'pause','pause-1')
        self.assertEqual(self.store.study_start('scheduled')['total'],0)
        self.store.study_control(self.item,'resume','resume-1')
        self.assertEqual(self.store.state()['items'][0]['status'],'復習中')
        self.assertGreaterEqual(self.store.state()['items'][0]['due'],'2026-01-02')
        before=self.store.state()['items'][0]['cycle']
        self.store.db.execute("UPDATE study_items SET status='習得済み',streak=5")
        self.store.db.commit()
        self.store.study_control(self.item,'restart','restart-1')
        self.assertNotEqual(self.store.state()['items'][0]['cycle'],before)
        self.assertEqual(self.store.state()['items'][0]['streak'],0)
        self.assertEqual(len(self.store.item_history(self.item)['events']),4)

    def test_jst_midnight_and_stale_session_cannot_change_item(self):
        self.now=datetime(2026,1,1,14,59,tzinfo=timezone.utc)
        self.assertEqual(self.store.study_start('scheduled')['total'],0)
        self.now+=timedelta(minutes=1)
        s=self.store.study_start('scheduled')
        self.assertEqual(s['total'],1)
        self.store.study_choice(s['id'],'5pr','choose')
        self.store.study_choice(s['id'],None,'confirm')
        self.store.study_control(self.item,'pause','other-change')
        with self.assertRaises(StudyFailure):
            self.store.study_rate(s['id'],self.item,'理解した','stale-answer')

    def test_backup_restores_missing_history_without_deleting_new_data(self):
        self.answer()
        backup=self.store.backup_create()
        self.store.study_control(self.item,'pause','later')
        plan=self.store.backup_inspect(backup['name'])
        result=self.store.backup_restore(backup['name'],plan['hash'])
        self.assertTrue(result['restored'])
        self.assertEqual(self.store.state()['items'][0]['status'],'保留')
        self.assertEqual(len(self.store.item_history(self.item)['events']),2)
        # A fresh target in the same named recovery folder can merge the copy.
        target=Store(Path(self.tmp.name)/'recovered.sqlite3',clock=lambda:self.now)
        try:
            target.backup_restore(backup['name'],plan['hash'])
            self.assertEqual(target.state()['items'][0]['streak'],1)
            self.assertEqual(len(target.item_history(self.item)['events']),1)
        finally: target.close()

    def test_queue_prioritizes_due_reviews_then_manual_new_then_auto_and_limits_five(self):
        s=self.store.stage(json.dumps(five_fixture(6)).encode(),None)
        r=self.store.commit(s['token'],0,0,None)
        detail=self.store.detail(r['id'])
        for scene in detail['decisions'][3:]: self.store.save(r['id'],scene['id'],True)
        ids=[s['id'] for s in detail['decisions']]
        self.store.db.execute('UPDATE study_items SET due=?',(self.store.today(),))
        self.store.db.execute("UPDATE study_items SET status='復習中' WHERE id=?",(ids[1],))
        self.store.db.commit()
        q=self.store.study_start('scheduled')
        self.assertEqual(q['total'],5)
        order=self.store._session(q['id'])['queue']
        self.assertEqual(order[0]['id'],ids[1])
        self.assertTrue(all(self.store._item(i['id'])['manual'] for i in order[1:4]))

    def test_same_day_practice_and_resume_cannot_add_second_scheduled_credit(self):
        self.answer()
        self.store.study_control(self.item,'pause','pause')
        self.store.study_control(self.item,'resume','resume')
        self.assertEqual(self.store.study_start('scheduled')['total'],0)
        self.answer(mode='practice',event='extra-practice')
        self.assertEqual(self.store.state()['items'][0]['streak'],1)

    def test_control_undo_preserves_event_and_allows_inflight_question(self):
        s=self.store.study_start('scheduled')
        event=self.store.study_control(self.item,'pause','pause')
        self.assertTrue(self.store.study_current()['stale'])
        self.store.study_undo_control(event['event'],'undo-pause')
        self.assertFalse(self.store.study_current()['stale'])
        self.assertEqual(len(self.store.item_history(self.item)['events']),2)

    def test_portable_backup_roundtrip_and_malformed_file_rejection(self):
        self.answer()
        name=self.store.backup_create()['name']
        exported=self.store.backup_export(name)
        uploaded=self.store.backup_upload(exported['data'])
        self.assertEqual(uploaded['events'],1)
        with self.assertRaises(StudyFailure): self.store.backup_upload(base64.b64encode(b'not a database').decode())
        p=self.store._backup_path(name)
        c=sqlite3.connect(p)
        c.execute("UPDATE study_items SET scene='{}'")
        c.commit();c.close()
        with self.assertRaises(StudyFailure): self.store.backup_inspect(name)

    def test_migration_preserves_legacy_data_and_copies_database_first(self):
        path=Path(self.tmp.name)/'legacy.sqlite3'
        c=sqlite3.connect(path)
        for table in ('sources','reports'):
            ddl=self.store.db.execute('SELECT sql FROM sqlite_master WHERE name=?',(table,)).fetchone()[0]
            c.execute(ddl)
            for row in self.store.db.execute(f'SELECT * FROM {table}'):
                c.execute(f'INSERT INTO {table} VALUES('+','.join('?' for _ in row)+')',tuple(row))
        c.execute('CREATE TABLE study_items(id TEXT PRIMARY KEY,report TEXT,scene TEXT,automatic INTEGER,manual INTEGER,status TEXT,history TEXT,due TEXT)')
        row=self.store.db.execute('SELECT id,report,scene,automatic,manual,status,history,due FROM study_items').fetchone()
        c.execute('INSERT INTO study_items VALUES(?,?,?,?,?,?,?,?)',tuple(row));c.commit();c.close()
        migrated=Store(path,clock=lambda:self.now)
        try:
            self.assertEqual(len(migrated.state()['items']),1)
            self.assertEqual(migrated.state()['items'][0]['streak'],0)
            self.assertEqual(len(list((path.parent/'backups').glob('pre-p3-*.sqlite3'))),1)
        finally: migrated.close()

    def test_grading_uses_one_instant_across_jst_midnight(self):
        s=self.store.study_start('scheduled')
        self.store.study_choice(s['id'],'5pr','choose')
        self.store.study_choice(s['id'],None,'confirm')
        calls=[]
        before=datetime(2026,1,2,14,59,59,999999,tzinfo=timezone.utc)
        def clock():
            calls.append(1)
            return before if len(calls)==1 else before+timedelta(microseconds=1)
        self.store.clock=clock
        self.store.study_rate(s['id'],self.item,'理解した','midnight')
        self.assertEqual(len(calls),1)
        event=self.store.db.execute('SELECT day,after_state FROM review_events WHERE id=?',('midnight',)).fetchone()
        self.assertEqual(event['day'],'2026-01-02')
        self.assertEqual(json.loads(event['after_state'])['due'],'2026-01-05')

    def test_failed_write_rolls_back_event_and_progress_then_same_id_can_retry(self):
        s=self.store.study_start('scheduled')
        self.store.study_choice(s['id'],'5pr','choose')
        self.store.study_choice(s['id'],None,'confirm')
        self.store.db.execute("CREATE TRIGGER fail_grade BEFORE UPDATE ON study_items BEGIN SELECT RAISE(ABORT,'test'); END")
        with self.assertRaises(sqlite3.Error): self.store.study_rate(s['id'],self.item,'理解した','retry')
        self.assertEqual(self.store.item_history(self.item)['events'],[])
        self.assertTrue(self.store.study_current()['revealed'])
        self.store.db.execute('DROP TRIGGER fail_grade')
        self.store.study_rate(s['id'],self.item,'理解した','retry')
        self.assertEqual(self.store.state()['items'][0]['streak'],1)

    def test_divergent_backup_history_is_rejected_without_merging(self):
        self.answer()
        path=Path(self.tmp.name)/'fork.sqlite3'
        c=sqlite3.connect(path);self.store.db.backup(c);c.close()
        fork=Store(path,clock=lambda:self.now)
        try:
            fork.study_control(self.item,'pause','branch-b')
            name=fork.backup_create()['name']
        finally: fork.close()
        self.store.study_control(self.item,'pause','branch-a')
        plan=self.store.backup_inspect(name)
        self.assertGreater(plan['conflicts'],0)
        with self.assertRaisesRegex(StudyFailure,'backup_conflict'): self.store.backup_restore(name,plan['hash'])
        self.assertEqual(len(self.store.item_history(self.item)['events']),2)

    def test_changed_backup_after_preview_is_not_applied(self):
        name=self.store.backup_create()['name']
        plan=self.store.backup_inspect(name)
        c=sqlite3.connect(self.store._backup_path(name))
        c.execute('PRAGMA application_id=123');c.close()
        with self.assertRaisesRegex(StudyFailure,'backup_changed'): self.store.backup_restore(name,plan['hash'])
        self.assertEqual(self.store.item_history(self.item)['events'],[])

    def test_malformed_resume_progress_in_backup_is_rejected(self):
        self.store.study_start('scheduled')
        name=self.store.backup_create()['name']
        c=sqlite3.connect(self.store._backup_path(name))
        row=c.execute('SELECT id,content FROM study_sessions').fetchone()
        content=json.loads(row[1]);del content['queue'][0]['revision']
        c.execute('UPDATE study_sessions SET content=? WHERE id=?',(json.dumps(content),row[0]))
        c.commit();c.close()
        with self.assertRaises(StudyFailure): self.store.backup_inspect(name)
        self.assertFalse(self.store.study_current()['stale'])


class PracticeRotationTests(unittest.TestCase):
    def test_completed_practice_rotates_to_unanswered_and_resume_is_preserved(self):
        with tempfile.TemporaryDirectory(dir='D:/dev-data/kyoku-loop/private') as temp:
            store=Store(Path(temp)/'practice.sqlite3')
            try:
                r=store.commit(store.stage(json.dumps(five_fixture(8)).encode(),None)['token'],0,0,None)
                for scene in store.detail(r['id'])['decisions']: store.save(r['id'],scene['id'],True)
                store.db.execute("UPDATE study_items SET due='2000-01-01'");store.db.commit()
                scheduled=[i['id'] for i in store._queue('scheduled')]
                self.assertEqual(len(scheduled),5)
                first=[i['id'] for i in store._queue('practice')]
                self.assertEqual(len(first),5)
                q=store.study_start('practice')
                self.assertEqual(store.study_start('practice')['id'],q['id'])
                for n in range(5):
                    store.study_choice(q['id'],q['scene']['own_hand'][0],'choose')
                    store.study_choice(q['id'],None,'confirm')
                    q=store.study_rate(q['id'],q['item_id'],'理解した',f'rotation-{n}')
                self.assertTrue(q['complete'])
                second=[i['id'] for i in store._queue('practice')]
                self.assertEqual(len(set(second)-set(first)),3)
                self.assertEqual([i['id'] for i in store._queue('scheduled')],scheduled)
                self.assertEqual(len(store.phone_pack()['items']),8)
            finally: store.close()


if __name__=='__main__': unittest.main()
