import copy
import hashlib
import json
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from datetime import datetime, timezone, timedelta
from pathlib import Path

from tools.p2_store import Store
from tools.study import StudyFailure
from test_p0_verify import fixture


class SyncTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(dir='D:/dev-data/kyoku-loop/private')
        self.now=datetime(2026,1,2,1,tzinfo=timezone.utc)
        self.s=Store(Path(self.tmp.name)/'windows.sqlite3',clock=lambda:self.now)
        self.s.commit(self.s.stage(json.dumps(fixture()).encode(),None)['token'],0,0,None)
        self.item=self.s.state()['items'][0]['id']
        self.s.db.execute("UPDATE study_items SET due='2026-01-02'");self.s.db.commit()
        self.source=self.s.phone_pack()['source']

    def tearDown(self):
        self.s.close();self.tmp.cleanup()

    def phone(self, ident='phone-answer', device='phone-A', rating='理解した', at=None, mode='scheduled'):
        path=Path(self.tmp.name)/(ident+'.sqlite3')
        db=sqlite3.connect(path);self.s.db.backup(db);db.close()
        clone=Store(path,clock=lambda:at or self.now)
        try:
            q=clone.study_start(mode)
            clone.study_choice(q['id'],'5pr','choose');clone.study_choice(q['id'],None,'confirm')
            clone.study_rate(q['id'],self.item,rating,ident)
            raw=dict(clone.db.execute('SELECT * FROM review_events WHERE id=?',(ident,)).fetchone())
            for key in ('before_state','after_state'):raw[key]=json.loads(raw[key])
            raw.update(device=device,at=(at or self.now).isoformat().replace('+00:00','Z'),mode=mode,
                request=json.dumps({'action':'study_rate','session':q['id'],'item':self.item,'rating':rating},ensure_ascii=False,separators=(',',':')))
            return raw
        finally:clone.close()

    def sync(self,events):
        return self.s.phone_sync({'protocol':1,'source':self.source,'device':'phone-A','events':events})

    def test_commit_receipt_retry_and_changed_id_are_atomic(self):
        event=self.phone()
        first=self.sync([event]);second=self.sync([event])
        self.assertEqual(first['receipts'],second['receipts'])
        self.assertEqual(len(first['receipts']),1)
        self.assertEqual(self.s.state()['items'][0]['streak'],1)
        self.assertEqual(len(self.s.item_history(self.item)['events']),1)
        changed=copy.deepcopy(event);changed['rating']='再復習'
        with self.assertRaisesRegex(StudyFailure,'event_conflict'):self.sync([changed])
        self.assertEqual(self.s.state()['items'][0]['streak'],1)

    def test_branches_and_reverse_arrival_keep_both_and_credit_once(self):
        early=self.phone('early','phone-A',at=self.now-timedelta(minutes=1))
        late=self.phone('late','phone-B',rating='再復習',at=self.now)
        self.sync([late]);self.sync([early])
        history=self.s.item_history(self.item)['events']
        self.assertEqual([e['id'] for e in history],['early','late'])
        self.assertEqual([e['credited'] for e in history],[1,0])
        self.assertEqual(self.s.state()['items'][0]['streak'],1)
        self.assertEqual(self.s.state()['items'][0]['due'],'2026-01-05')

    def test_windows_and_phone_answers_merge_without_losing_local_retry_identity(self):
        phone=self.phone(at=self.now-timedelta(minutes=1))
        q=self.s.study_start('scheduled')
        self.s.study_choice(q['id'],'5pr','choose');self.s.study_choice(q['id'],None,'confirm')
        self.s.study_rate(q['id'],self.item,'理解した','windows-answer')
        self.sync([phone])
        self.s.study_rate(q['id'],self.item,'理解した','windows-answer')
        self.assertEqual(len(self.s.item_history(self.item)['events']),2)
        self.assertEqual(self.s.state()['items'][0]['streak'],1)

    def test_invalid_batch_source_future_and_wrong_tile_leave_no_events(self):
        event=self.phone()
        invalid=copy.deepcopy(event);invalid['id']='bad';invalid['answer']='not-a-tile'
        with self.assertRaises(StudyFailure):self.sync([event,invalid])
        self.assertEqual(self.s.item_history(self.item)['events'],[])
        with self.assertRaisesRegex(StudyFailure,'different_source'):
            self.s.phone_sync({'protocol':1,'source':'another','device':'phone-A','events':[event]})
        future=copy.deepcopy(event);future['at']=(self.now+timedelta(days=2)).isoformat();future['day']='2026-01-04'
        with self.assertRaisesRegex(StudyFailure,'clock_ahead'):self.sync([future])

    def test_receipts_survive_reopen_and_backup_restore_into_empty_database(self):
        event=self.phone();receipt=self.sync([event])['receipts']
        path=self.s.path;self.s.close();self.s=Store(path,clock=lambda:self.now)
        self.assertEqual(self.sync([event])['receipts'],receipt)
        backup=self.s.backup_create()['name'];exported=self.s.backup_export(backup)
        restored=Store(Path(self.tmp.name)/'restored.sqlite3',clock=lambda:self.now)
        try:
            plan=restored.backup_upload(exported['data']);restored.backup_restore(plan['name'],plan['hash'])
            result=restored.phone_sync({'protocol':1,'source':self.source,'device':'phone-A','events':[event]})
            self.assertEqual(result['receipts'],receipt)
            self.assertEqual(len(restored.item_history(self.item)['events']),1)
        finally:restored.close()

    def test_old_backup_does_not_conflict_with_recomputed_derived_states(self):
        early=self.phone('earlier','phone-A',at=self.now-timedelta(minutes=1))
        late=self.phone('later','phone-B',at=self.now)
        self.sync([late]);backup=self.s.backup_create()['name']
        self.sync([early]);plan=self.s.backup_inspect(backup)
        self.assertEqual(plan['conflicts'],0)
        self.s.backup_restore(backup,plan['hash'])
        self.assertEqual(len(self.s.item_history(self.item)['events']),2)
        self.assertEqual(self.s.state()['items'][0]['streak'],1)

    def test_p4_events_without_mode_and_causal_order_with_a_backwards_clock(self):
        first=self.phone('first',mode='practice');first.pop('mode')
        second=copy.deepcopy(first);second.update(id='second',at=(self.now-timedelta(minutes=1)).isoformat())
        second['before_state']=copy.deepcopy(first['after_state']);second['after_state']=dict(second['before_state'],revision=2)
        self.sync([second,first])
        self.assertEqual([e['id'] for e in self.s.item_history(self.item)['events']],['first','second'])
        self.assertEqual(self.s.state()['items'][0]['streak'],0)

    def test_a_stale_undo_retains_all_events_and_does_not_overwrite_another_device(self):
        first=self.phone('first',at=self.now-timedelta(minutes=2))
        other=self.phone('other','phone-B',at=self.now-timedelta(minutes=1))
        undo=copy.deepcopy(first);undo.update(id='undo-first',kind='undo',at=self.now.isoformat(),answer=None,rating=None,credited=0,undo_of='first')
        undo['before_state']=copy.deepcopy(first['after_state']);undo['after_state']=dict(first['before_state'],revision=2)
        self.sync([undo,other,first])
        events=self.s.item_history(self.item)['events']
        self.assertEqual(len(events),3);self.assertEqual(events[-1]['sync_reason'],'undo_conflict')
        self.assertFalse(events[0]['undone']);self.assertEqual(self.s.state()['items'][0]['streak'],1)

    def test_missing_predecessor_and_failed_replay_roll_back_an_entire_batch(self):
        event=self.phone()
        undo=copy.deepcopy(event);undo.update(id='undo',kind='undo',answer=None,rating=None,credited=0,undo_of='missing')
        with self.assertRaisesRegex(StudyFailure,'sync_dependency'):self.sync([event,undo])
        self.assertEqual(self.s.item_history(self.item)['events'],[])

    def test_windows_phone_file_preview_is_read_only_and_import_is_idempotent(self):
        from tools.sync import inspect_phone_backup,restore_phone_backup
        event=self.phone();backup={'schema':1,'device':'recovered','pack':self.s.phone_pack(),'events':[event]}
        plan,_=inspect_phone_backup(self.s,backup)
        self.assertEqual(plan['new'],1);self.assertEqual(self.s.item_history(self.item)['events'],[])
        with self.assertRaisesRegex(StudyFailure,'backup_changed'):restore_phone_backup(self.s,backup,'changed')
        restore_phone_backup(self.s,backup,plan['hash']);restore_phone_backup(self.s,backup,plan['hash'])
        self.assertEqual(len(self.s.item_history(self.item)['events']),1)

    def test_write_failure_after_projection_changes_rolls_back_all_original_rows(self):
        self.sync([self.phone('first')])
        incoming=self.phone('second','phone-B',mode='practice')
        before=[dict(r) for r in self.s.db.execute('SELECT * FROM review_events ORDER BY rowid')]
        state=self.s._snapshot_state(self.s._item(self.item))
        with patch.object(self.s,'_put_item',side_effect=sqlite3.OperationalError('generated disk full')):
            with self.assertRaises(sqlite3.OperationalError):self.sync([incoming])
        self.assertEqual([dict(r) for r in self.s.db.execute('SELECT * FROM review_events ORDER BY rowid')],before)
        self.assertEqual(self.s._snapshot_state(self.s._item(self.item)),state)


if __name__=='__main__':unittest.main()
