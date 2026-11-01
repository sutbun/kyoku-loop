import copy
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from tools.p2_store import Store, ImportFailure
from tools.study import StudyFailure
from tools.analysis_queue import source_url
from tools.sync import inspect_phone_backup, restore_phone_backup
from test_p0_verify import fixture

URL='https://game.mahjongsoul.com/?paipu=260101-fictional-game_a123'
OTHER='https://game.mahjongsoul.com/?paipu=260101-fictional-other_a123'


class QueueTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir='D:/dev-data/kyoku-loop/private')
        self.store=Store(Path(self.temp.name)/'test.sqlite3')

    def tearDown(self):
        self.store.close()
        self.temp.cleanup()

    def commit(self, url=URL):
        e=self.store.analysis_add(url)['entries'][0]
        stage=self.store.stage(json.dumps(fixture()).encode(),None)
        return self.store.commit(stage['token'],0,0,url,e['id'])

    def test_strict_url_no_requests_or_auth(self):
        self.assertEqual(source_url(' '+URL+' '),URL)
        for value in [OTHER.replace('https:','http:'),URL+'&x=1',URL+'#x',URL.replace('game.','game.evil.'),URL.replace('/?',':443/?'),URL.replace('paipu=','other='),URL.replace('fictional','fiction%61l'),None]:
            with self.assertRaises(StudyFailure):source_url(value)
        with patch('urllib.request.OpenerDirector.open',side_effect=AssertionError('network forbidden')):
            self.store.analysis_add(URL)

    def test_received_then_retried_deduplicates_after_restart(self):
        e=self.store.analysis_add(URL)['entries'][0]
        self.store.analysis_requested(e['id'],True)
        path=self.store.path;self.store.close();self.store=Store(path)
        incoming={k:e[k] for k in ('id','url','created')}
        incoming['created']='2026-01-01T00:00:00Z'
        for _ in range(2):
            response=self.store.analysis_receive([incoming])
            self.assertTrue(response['entries'][0]['requested'])
            self.assertEqual(response['entries'][0]['created'],e['created'])
        self.assertEqual(len(self.store.state()['analysis_queue']),1)
        self.assertFalse(self.store.state()['reports'])

    def test_invalid_batch_is_atomic(self):
        e={'id':URL.split('=')[1],'url':URL,'created':'2026-01-01T00:00:00Z'}
        for bad in [dict(e,id='wrong'),dict(e,created='bad'),dict(e,url=OTHER)]:
            with self.assertRaises(StudyFailure):self.store.analysis_receive([e,bad])
            self.assertEqual(self.store.analysis_entries(),[])
        with self.assertRaises(StudyFailure):self.store.analysis_receive([e,e])

    def test_explicit_link_duplicate_and_conflict_preserve_items(self):
        result=self.commit()
        e=self.store.analysis_entries()[0]
        self.assertEqual(e['reports'],[result['id']])
        before=[dict(r) for r in self.store.db.execute('SELECT * FROM study_items')]
        self.assertTrue(self.commit()['duplicate'])
        other=self.store.analysis_add(OTHER)['entries'][0]
        stage=self.store.stage(json.dumps(fixture()).encode(),None)
        with self.assertRaises(ImportFailure):self.store.commit(stage['token'],0,0,OTHER,other['id'])
        self.assertEqual(other,self.store.analysis_entry(other['id']))
        self.assertEqual(before,[dict(r) for r in self.store.db.execute('SELECT * FROM study_items')])
        with self.assertRaises(ImportFailure):self.store.commit(stage['token'],0,0,OTHER,e['id'])

    def test_failed_link_rolls_back_report_and_items(self):
        e=self.store.analysis_add(URL)['entries'][0]
        stage=self.store.stage(json.dumps(fixture()).encode(),None)
        with patch.object(self.store,'_put_analysis',side_effect=sqlite3.OperationalError('disk full')):
            with self.assertRaises(sqlite3.Error):self.store.commit(stage['token'],0,0,URL,e['id'])
        self.assertEqual(self.store.analysis_entry(e['id']),e)
        self.assertEqual(self.store.state()['reports'],[])
        self.assertEqual(self.store.state()['items'],[])

    def test_report_without_candidates_is_not_study_ready(self):
        with patch('tools.p2_store.rank_decisions',return_value=[]):self.commit()
        self.assertTrue(self.store.analysis_entries()[0]['reports'])
        self.assertFalse(self.store.analysis_entries()[0]['ready'])

    def test_backup_restores_queue_links_and_keeps_newer_local_declaration(self):
        result=self.commit()
        e=self.store.analysis_entries()[0]
        self.store.analysis_requested(e['id'],True)
        self.store.analysis_setup(True)
        backup=self.store.backup_create()
        plan=self.store.backup_inspect(backup['name'])
        self.store.analysis_requested(e['id'],False)
        self.store.backup_restore(backup['name'],plan['hash'])
        self.assertFalse(self.store.analysis_entry(e['id'])['requested'])
        recovered=Store(Path(self.temp.name)/'recovered.sqlite3')
        try:
            # Shared private directory lets the ordinary backup importer select it.
            plan=recovered.backup_inspect(backup['name'])
            recovered.backup_restore(backup['name'],plan['hash'])
            self.assertEqual(recovered.analysis_entries()[0]['reports'],[result['id']])
            self.assertTrue(recovered.state()['analysis_setup'])
        finally:recovered.close()

    def test_url_only_phone_backup_and_invalid_queue(self):
        backup={'schema':1,'device':'fictional-phone','pack':None,'events':[],
                'analysis_queue':[{'id':URL.split('=')[1],'url':URL,'created':'2026-01-01T00:00:00Z'}]}
        plan,_=inspect_phone_backup(self.store,backup)
        self.assertEqual(plan['urls'],1)
        restore_phone_backup(self.store,backup,plan['hash'])
        restore_phone_backup(self.store,backup,plan['hash'])
        self.assertEqual(len(self.store.analysis_entries()),1)
        broken=copy.deepcopy(backup);broken['analysis_queue'][0]['url']=OTHER
        with self.assertRaises(StudyFailure):inspect_phone_backup(self.store,broken)


if __name__=='__main__':unittest.main()
