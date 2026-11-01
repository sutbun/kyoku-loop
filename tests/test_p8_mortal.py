"""Fictional Mortal exports only. No real reports, URLs, names or HTTP."""
import copy
import json
import math
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from test_p0_verify import fixture, tile
from tools.mortal_report import project, canonical_url
from tools.p2_store import Store, ImportFailure, fetch_report


def mortal_fixture(red_pair=False):
    original = fixture()
    raw = json.loads(original['custom_haihu'][0])[0]
    start = copy.deepcopy(original['pred'][0][0]['info']['msg'])
    if red_pair:
        raw[4][0] = 25
        start['tehais'][0][0] = '5p'
    events = [copy.deepcopy(e['info']['msg']) for e in original['pred'][0]]
    events[0] = start
    for e in events:
        e.pop('real_dahai',None)
        e.pop('pred_dahai',None)
    actual = events[2]
    hand = start['tehais'][0]+['5pr']
    choices = list(dict.fromkeys(hand))
    if red_pair:
        probabilities = {t:0.15/(len(choices)-2) for t in choices}
        probabilities.update({'5p':0.45,'5pr':0.4})
    else:
        probabilities = {t:0.01/(len(choices)-2) for t in choices}
        probabilities.update({'1m':0.7,'5pr':0.29})
    details = sorted([{'action':{'type':'dahai','actor':0,'pai':t,'tsumogiri':t=='5pr'},
                       'q_value':0.1*math.log(p),'prob':p} for t,p in probabilities.items()],key=lambda d:-d['prob'])
    end = {'type':'ryukyoku','deltas':[0,0,0,0]}
    entry = {'junme':1,'tiles_left':69,'last_actor':0,'tile':'5pr',
             'state':{'tehai':hand,'fuuros':[]},'at_self_chi_pon':False,'at_self_riichi':False,
             'at_opponent_kakan':False,'actual':actual,'expected':details[0]['action'],
             'details':details,'actual_index':next(i for i,d in enumerate(details) if d['action']==actual),
             'is_equal':False,'shanten':3,'at_furiten':False}
    return {'engine':'Mortal','version':'1.5.10','game_length':'Hanchan','player_id':0,
            'review':{'model_tag':'fictional-model','temperature':0.1,
                      'kyokus':[{'kyoku':0,'honba':0,'relative_scores':[25000]*4,'end_status':[end],'entries':[entry]}]},
            'split_logs':[{'name':['架空A','架空B','架空C','架空D'],'rule':{'aka':1},'log':[raw]}],
            'mjai_log':[{'type':'start_game'},*events,end,{'type':'end_kyoku'},{'type':'end_game'}]}


class MortalTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(dir='D:/dev-data/kyoku-loop/private')
        self.store=Store(Path(self.tmp.name)/'test.sqlite3')

    def tearDown(self):
        self.store.close()
        self.tmp.cleanup()

    def stage(self,r=None):
        return self.store.stage(json.dumps(r or mortal_fixture()).encode(),None)

    def test_result_urls_are_canonical_and_do_not_fetch_progress_or_untrusted_targets(self):
        ident='a'*16
        expected=f'https://mjai.ekyu.moe/report/{ident}.json'
        for url in [expected,f'https://mjai.ekyu.moe/progress?task={ident}',
                    f'https://mjai.ekyu.moe/killerducky/?data=/report/{ident}.json']:
            self.assertEqual(canonical_url(url),expected)
        for url in [f'https://u:p@mjai.ekyu.moe/progress?task={ident}',
                    f'https://mjai.ekyu.moe:443/progress?task={ident}',
                    f'https://mjai.ekyu.moe/progress?task={ident}&task={ident}',
                    'https://mjai.ekyu.moe/killerducky/?data=https://evil.invalid/a.json',
                    'https://evil.invalid/report/'+ident+'.json',expected+'#x']:
            with self.assertRaises(ValueError):canonical_url(url)
        with patch('tools.p2_store.urllib.request.build_opener') as opener:
            opener.return_value.open.side_effect=__import__('urllib.error').error.HTTPError(expected,403,'denied',{},None)
            with self.assertRaisesRegex(ImportFailure,'access_denied'):fetch_report(expected)
            self.assertEqual(opener.return_value.open.call_count,1)

    def test_target_is_fixed_and_new_engine_does_not_modify_naga_preference(self):
        self.store.db.execute("INSERT INTO study_settings VALUES('preferred_naga_type','retained')")
        self.store.db.commit()
        settings=list(self.store.db.execute('SELECT * FROM study_settings'))
        meta=self.stage()
        self.assertEqual((meta['engine'],meta['target_seat'],meta['preferred_model']),('Mortal',0,0))
        with self.assertRaises(ImportFailure):self.store.commit(meta['token'],1,0,None)
        self.assertEqual(self.store.state()['reports'],[])
        self.store.commit(meta['token'],0,0,None)
        self.assertEqual(settings,list(self.store.db.execute('SELECT * FROM study_settings')))

    def test_exact_red_and_normal_policy_is_not_collapsed_into_a_false_zero_gap(self):
        _,scenes,_=project(mortal_fixture(True))
        s=scenes[0]
        self.assertEqual((s['actual'],s['suggested']),('5pr','5p'))
        self.assertAlmostEqual(s['gap'],5.)
        self.assertAlmostEqual(sum(s['weights_percent']),100.)
        self.assertNotIn('tehais',s)

    def test_reimport_keeps_answers_due_session_and_ids_then_backup_restores(self):
        first=self.store.commit(self.stage()['token'],0,0,None)
        detail=self.store.detail(first['id'])
        self.assertEqual(detail['engine'],'Mortal')
        self.assertEqual(len(detail['decisions']),1)
        session=self.store.study_start('practice')
        for key in ('actual','suggested','gap','raw_weights','weights_percent','model_name'):
            self.assertNotIn(key,session['scene'])
        self.store.study_choice(session['id'],'5pr','choose')
        session=self.store.study_choice(session['id'],None,'confirm')
        self.assertEqual(session['scene']['suggested'],'1m')
        self.store.study_rate(session['id'],session['item_id'],'理解した','generated-answer')
        before=self.store.state()['items']
        again=self.store.commit(self.stage()['token'],0,0,None)
        self.assertTrue(again['duplicate'])
        self.assertEqual(first['id'],again['id'])
        self.assertEqual(before,self.store.state()['items'])
        pack=self.store.phone_pack()
        self.assertEqual(pack['items'][0]['scene']['engine'],'Mortal')
        self.assertNotIn('raw_weights',pack['items'][0]['scene'])
        saved=self.store.backup_create()
        plan=self.store.backup_inspect(saved['name'])
        self.assertEqual(plan['reports'],1)
        self.assertEqual(plan['events'],1)
        recovered=Store(Path(self.tmp.name)/'recovered'/'test.sqlite3')
        try:
            uploaded=recovered.backup_upload(self.store.backup_export(saved['name'])['data'])
            recovered.backup_restore(uploaded['name'],uploaded['hash'])
            self.assertEqual(before,recovered.state()['items'])
            self.assertEqual(recovered.state()['reports'][0]['engine'],'Mortal')
            self.assertTrue(recovered.study_current()['complete'])
        finally:recovered.close()

    def test_mutated_source_hand_action_probability_round_or_version_is_rejected_atomically(self):
        mutations=[
            lambda r:r.update(version='9.9.9'),
            lambda r:r['split_logs'][0]['log'][0][6].__setitem__(0,11),
            lambda r:r['review']['kyokus'][0]['entries'][0]['state']['tehai'].__setitem__(0,'C'),
            lambda r:r['review']['kyokus'][0]['entries'][0]['actual'].update(pai='C'),
            lambda r:r['review']['kyokus'][0]['entries'][0]['details'][0].update(prob=0.8),
            lambda r:r['review']['kyokus'][0].update(honba=1),
            lambda r:(r['split_logs'][0]['log'][0][2].__setitem__(0,11),r['mjai_log'][1].update(dora_marker='1m')),
            lambda r:r['review']['kyokus'][0]['entries'][0]['expected'].update(type='unknown'),
            lambda r:r['review']['kyokus'][0]['entries'].append(copy.deepcopy(r['review']['kyokus'][0]['entries'][0])),
        ]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                r=mortal_fixture();mutate(r)
                with self.assertRaises(ImportFailure):self.store.commit(self.stage(r)['token'],0,0,None)
                self.assertEqual(self.store.state()['reports'],[])


if __name__=='__main__':unittest.main()
