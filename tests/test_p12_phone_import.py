"""Private generated Mortal uploads. No real reports, HTTP or phone records."""
import base64
import json
import tempfile
import unittest
from pathlib import Path
from tools.p2_store import Store, ImportFailure
from tools.study import StudyFailure
from test_p8_mortal import mortal_fixture
from test_p0_verify import fixture


class PhoneImportTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir='D:/dev-data/kyoku-loop/private')
        self.store=Store(Path(self.temp.name)/'test.sqlite3')

    def tearDown(self):
        self.store.close();self.temp.cleanup()

    def upload(self, report=None, source=None):
        return self.store.phone_mortal_inspect(base64.b64encode(json.dumps(report or mortal_fixture()).encode()).decode(),source)

    def test_preview_is_not_registration_and_register_uses_fixed_json_seat_and_model(self):
        stage=self.upload()
        self.assertEqual(self.store.state()['reports'],[])
        self.assertEqual((stage['target_seat'],stage['models'][0]['name']),(0,'fictional-model'))
        result=self.store.phone_mortal_register(stage['token'],stage['source'],None)
        self.assertFalse(result['duplicate'])
        self.assertEqual(len(self.store.state()['items']),1)
        self.assertEqual(self.store.state()['reports'][0]['seat'],0)

    def test_retry_after_lost_registration_ack_does_not_add_rows_or_change_existing_history(self):
        stage=self.upload()
        first=self.store.phone_mortal_register(stage['token'],stage['source'],None)
        session=self.store.study_start('practice')
        self.store.study_choice(session['id'],'5pr','choose')
        self.store.study_choice(session['id'],None,'confirm')
        self.store.study_rate(session['id'],session['item_id'],'理解した','fictional-phone-import')
        before={t:[tuple(r) for r in self.store.db.execute('SELECT * FROM '+t)] for t in ('study_items','review_events','study_sessions')}
        second=self.store.phone_mortal_register(stage['token'],stage['source'],None)
        self.assertTrue(second['duplicate']);self.assertEqual(first['id'],second['id'])
        for t,rows in before.items():self.assertEqual(rows,[tuple(r) for r in self.store.db.execute('SELECT * FROM '+t)])

    def test_rejects_a_different_windows_source_on_inspect_and_register(self):
        with self.assertRaisesRegex(StudyFailure,'different_source'):self.upload(source='other-source')
        stage=self.upload()
        with self.assertRaisesRegex(StudyFailure,'different_source'):
            self.store.phone_mortal_register(stage['token'],'other-source',None)
        self.assertEqual(self.store.state()['reports'],[])

    def test_rejects_naga_in_both_upload_and_existing_stage(self):
        with self.assertRaisesRegex(ImportFailure,'inbox_mortal_only'):self.upload(fixture())
        stage=self.store.stage(json.dumps(fixture()).encode(),None)
        source=self.store.phone_pack()['source']
        with self.assertRaisesRegex(ImportFailure,'inbox_mortal_only'):
            self.store.phone_mortal_register(stage['token'],source,None)

    def test_manual_queue_link_or_unique_prior_link_only(self):
        url='https://game.mahjongsoul.com/?paipu=fictional-phone-result'
        self.store.analysis_add(url)
        stage=self.upload()
        self.store.phone_mortal_register(stage['token'],stage['source'],url.split('=')[1])
        self.assertEqual(len(self.store.analysis_entries()[0]['reports']),1)
        raw=mortal_fixture();raw['review']['model_tag']='fictional-other'
        stage=self.upload(raw)
        self.store.phone_mortal_register(stage['token'],stage['source'],None)
        self.assertTrue(all(r['source_linked'] for r in self.store.state()['reports']))
        self.assertEqual(len(self.store.state()['items']),1)

    def test_invalid_content_expired_token_and_unreconstructable_result_do_not_commit(self):
        for value in ('@@',base64.b64encode(b'<html>not JSON</html>').decode()):
            with self.assertRaisesRegex(ImportFailure,'invalid_json'):
                self.store.phone_mortal_inspect(value,None)
        raw=mortal_fixture();raw['mjai_log'][2]['pai']='9s'
        stage=self.upload(raw)
        with self.assertRaisesRegex(ImportFailure,'reconstruction_failed'):
            self.store.phone_mortal_register(stage['token'],stage['source'],None)
        with self.store.db:self.store.db.execute('UPDATE staging SET created=0')
        with self.assertRaisesRegex(ImportFailure,'stage_expired'):
            self.store.phone_mortal_register(stage['token'],stage['source'],None)
        self.assertEqual(self.store.state()['reports'],[])

    def test_oversized_base64_is_rejected_before_staging(self):
        with self.assertRaisesRegex(ImportFailure,'size_limit'):
            self.store.phone_mortal_inspect('A' * (((20*1024*1024+2)//3)*4+1),None)
        self.assertEqual(self.store.db.execute('SELECT count(*) FROM staging').fetchone()[0],0)


if __name__=='__main__':unittest.main()
