"""Fictional local files; never requests an analysis or changes the live DB."""
import gzip
import json
import tempfile
import unittest
from pathlib import Path
from tools.p2_store import Store, ImportFailure
from tools.mortal_inbox import MortalInbox
from test_p8_mortal import mortal_fixture
from test_p0_verify import fixture


class InboxTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir='D:/dev-data/kyoku-loop/private')
        self.root = Path(self.temp.name)
        self.store = Store(self.root / 'app' / 'test.sqlite3')
        self.inbox = MortalInbox(self.store)
        self.folder = self.root / 'inbox'
        self.inbox.configure(True, str(self.folder))

    def tearDown(self):
        self.store.close()
        self.temp.cleanup()

    def write(self, report=None, name='result.json'):
        data = json.dumps(report or mortal_fixture()).encode()
        if name.endswith('.gz'): data = gzip.compress(data)
        path = self.folder / name
        path.write_bytes(data)
        return path

    def complete(self, at=100):
        self.inbox.scan(at)
        return self.inbox.scan(at+4)

    def test_waits_for_completed_file_then_registers_fixed_seat_and_model_without_link_guess(self):
        self.store.analysis_add('https://game.mahjongsoul.com/?paipu=fictional-inbox-target')
        path = self.write()
        original = path.read_bytes()
        self.inbox.scan(100)
        self.inbox.scan(102)
        self.assertEqual(self.store.state()['reports'], [])
        state = self.inbox.scan(104)
        self.assertEqual(state['files'][0]['status'], 'imported')
        report = self.store.state()['reports'][0]
        self.assertEqual((report['seat'], report['model'], report['source_linked']), (0,0,False))
        self.assertEqual(len(self.store.state()['items']),1)
        self.assertEqual(path.read_bytes(), original)

    def test_partial_and_reconstruction_failure_do_not_create_reports_and_corrected_file_is_retried(self):
        path = self.folder / 'partial.json'
        path.write_bytes(b'{')
        self.assertEqual(self.complete()['files'][0]['status'], 'error')
        self.assertEqual(self.store.state()['reports'], [])
        raw = mortal_fixture()
        raw['mjai_log'][2]['pai'] = '9s'
        self.write(raw, 'invalid.json')
        self.complete(110)
        self.assertEqual(self.store.state()['reports'], [])
        self.write(name='partial.json')
        self.complete(120)
        self.assertEqual(len(self.store.state()['reports']),1)

    def test_restart_and_renamed_gzip_duplicates_preserve_answer_and_in_progress_session(self):
        self.write()
        self.complete()
        session = self.store.study_start('practice')
        self.store.study_choice(session['id'], session['scene']['own_hand'][0], 'choose')
        self.store.study_choice(session['id'], None, 'confirm')
        self.store.study_rate(session['id'], session['item_id'], '理解した', 'fictional-inbox-answer')
        session = self.store.study_start('practice')
        self.store.study_choice(session['id'], session['scene']['own_hand'][0], 'choose')
        tables = ('study_items','review_events','study_sessions')
        before = {t:[tuple(r) for r in self.store.db.execute('SELECT * FROM '+t)] for t in tables}
        self.write(name='copy.json.gz')
        restarted = MortalInbox(self.store)
        restarted.scan(110)
        restarted.scan(114)
        self.assertEqual(len(self.store.state()['reports']),1)
        for t in tables:
            self.assertEqual(before[t], [tuple(r) for r in self.store.db.execute('SELECT * FROM '+t)])
        self.assertTrue(any(f['status']=='duplicate' for f in restarted.status()['files']))

    def test_only_reuses_unique_previously_confirmed_full_game_and_seat_link(self):
        raw = mortal_fixture()
        self.store.analysis_add('https://game.mahjongsoul.com/?paipu=fictional-known-source')
        # analysis_add returns the queue; derive its stable id without guessing metadata.
        ident = self.store.analysis_entries()[0]['id']
        meta = self.store.stage(json.dumps(raw).encode(),None)
        self.store.commit(meta['token'],0,0,None,ident)
        raw['review']['model_tag'] = 'fictional-other-model'
        self.write(raw)
        self.complete()
        self.assertTrue(all(r['source_linked'] for r in self.store.state()['reports']))
        self.assertEqual(len(self.store.analysis_entry(ident)['reports']),2)
        self.assertEqual(len(self.store.state()['items']),1)

    def test_conflicting_existing_links_are_not_used_for_automatic_linking(self):
        for n in range(2):
            raw=mortal_fixture()
            raw['review']['model_tag']=f'fictional-{n}'
            url=f'https://game.mahjongsoul.com/?paipu=fictional-conflict-{n}'
            meta=self.store.stage(json.dumps(raw).encode(),None)
            self.store.commit(meta['token'],0,0,url)
        self.write()
        self.complete()
        self.assertFalse(self.store.state()['reports'][0]['source_linked'])

    def test_linking_later_keeps_history_and_rejects_replacement_source(self):
        self.write()
        self.complete()
        report=self.store.state()['reports'][0]['id']
        before=[tuple(r) for r in self.store.db.execute('SELECT * FROM study_items')]
        url='https://game.mahjongsoul.com/?paipu=fictional-manual-link'
        self.store.analysis_add(url)
        self.store.link_source(report,url.split('=')[1])
        self.assertTrue(self.store.state()['reports'][0]['source_linked'])
        self.assertEqual(before,[tuple(r) for r in self.store.db.execute('SELECT * FROM study_items')])
        self.store.analysis_add(url+'-other')
        with self.assertRaisesRegex(ImportFailure,'source_conflict'):
            self.store.link_source(report,(url+'-other').split('=')[1])

    def test_disabled_inbox_does_not_import_and_configuration_survives_restart(self):
        self.inbox.configure(False,str(self.folder))
        self.write()
        self.complete()
        self.assertEqual(self.store.state()['reports'],[])
        self.assertFalse(MortalInbox(self.store).status()['enabled'])
        self.inbox.configure(True,str(self.folder))
        self.complete()
        self.assertEqual(len(self.store.state()['reports']),1)

    def test_only_mortal_supported_files_and_no_subdirectories(self):
        self.write(fixture(),'naga.json')
        sub=self.folder/'sub'; sub.mkdir()
        (sub/'hidden.json').write_text(json.dumps(mortal_fixture()))
        self.write(name='unfinished.crdownload')
        state=self.complete()
        self.assertEqual(self.store.state()['reports'],[])
        self.assertEqual(state['files'][0]['error'],'inbox_mortal_only')

    def test_folder_boundaries_missing_folder_and_size_limit(self):
        for path in ['relative','E:/dev/kyoku-loop',str(self.store.path.parent),str(self.root)]:
            with self.assertRaisesRegex(ImportFailure,'invalid_inbox_folder'):
                self.inbox.configure(True,path)
        path=self.folder/'large.json'
        with path.open('wb') as f:f.truncate(20*1024*1024+1)
        self.assertEqual(self.complete()['files'][0]['error'],'size_limit')
        path.unlink(); self.folder.rmdir()
        self.assertEqual(self.inbox.status()['error'],'inbox_unavailable')

    def test_service_error_is_visible_and_requires_configuration_save_to_clear(self):
        self.inbox.failure.write_text('{"error":"inbox_service_error"}')
        self.assertEqual(self.inbox.status()['error'],'inbox_service_error')
        self.inbox.configure(True,str(self.folder))
        self.assertIsNone(self.inbox.status()['error'])

    def test_receipt_without_restored_report_does_not_skip_the_file(self):
        self.write()
        self.complete()
        self.store.close()
        # Model restoring an empty app DB while keeping the inbox ledger.
        (self.root/'app'/'test.sqlite3').unlink()
        self.store=Store(self.root/'app'/'test.sqlite3')
        self.inbox=MortalInbox(self.store)
        self.complete(110)
        self.assertEqual(len(self.store.state()['reports']),1)


if __name__ == '__main__': unittest.main()
