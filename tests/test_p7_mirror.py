import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from tools.p2_store import Store
from tools.backup_mirror import mirror_backup,sha


class MirrorTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir='D:/dev-data/kyoku-loop/private')
        self.root=Path(self.temp.name)
        self.store=Store(self.root/'app'/'test.sqlite3')
        self.copy=self.root/'copies'

    def tearDown(self):
        self.store.close();self.temp.cleanup()

    def configure(self, directory=None):
        (self.store.path.parent/'backup-settings.json').write_text(json.dumps({'directory':str(directory or self.copy)}),encoding='utf-8')

    def test_unconfigured_keeps_existing_local_backup(self):
        result=self.store.backup_create()
        self.assertEqual(result['mirror']['state'],'not_configured')
        self.assertTrue(self.store._backup_path(result['name']).is_file())

    def test_verified_additional_copy_can_be_restored(self):
        self.configure();result=self.store.backup_create()
        self.assertEqual(result['mirror']['state'],'saved')
        source=self.store._backup_path(result['name']);copy=self.copy/result['name']
        self.assertEqual(sha(source),sha(copy))
        db=sqlite3.connect(copy);self.assertEqual(db.execute('PRAGMA quick_check').fetchone()[0],'ok');db.close()
        self.assertEqual(self.store.backup_list()['mirror_folder'],str(self.copy))
        self.assertFalse(list(self.copy.glob('*.partial')))

    def test_copy_failure_preserves_local_snapshot(self):
        self.configure()
        with patch('tools.backup_mirror.sha',side_effect=['a','b']):result=self.store.backup_create()
        self.assertEqual(result['mirror']['state'],'failed')
        self.assertTrue(self.store._backup_path(result['name']).exists())
        self.assertEqual(list(self.copy.iterdir()),[])

    def test_invalid_destination_and_config_do_not_claim_copy(self):
        self.configure(self.store.path.parent/'nested')
        self.assertEqual(self.store.backup_create()['mirror']['state'],'failed')
        self.assertTrue(self.store.backup_list()['mirror_error'])
        (self.store.path.parent/'backup-settings.json').write_text('{invalid',encoding='utf-8')
        self.assertEqual(self.store.backup_create()['mirror']['state'],'failed')

    def test_existing_copy_is_never_overwritten(self):
        self.configure();result=self.store.backup_create()
        before=(self.copy/result['name']).read_bytes()
        self.assertEqual(mirror_backup(self.store.path,self.store._backup_path(result['name']))['state'],'failed')
        self.assertEqual((self.copy/result['name']).read_bytes(),before)


if __name__=='__main__':unittest.main()
