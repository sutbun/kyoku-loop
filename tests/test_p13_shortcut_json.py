"""Fictional duplicate round arrays observed after iPad dictionary conversion."""
import base64
import copy
import json
import tempfile
import unittest
from pathlib import Path

from tools.mortal_report import project, validate
from tools.p2_store import Store, ImportFailure, digest
from test_p8_mortal import mortal_fixture


def two_rounds():
    report = mortal_fixture()
    second = copy.deepcopy(report)
    second['mjai_log'][1]['honba'] = 1
    second['split_logs'][0]['log'][0][0][1] = 1
    second['review']['kyokus'][0]['honba'] = 1
    report['mjai_log'] = report['mjai_log'][:-1] + second['mjai_log'][1:]
    report['split_logs'] += second['split_logs']
    report['review']['kyokus'] += second['review']['kyokus']
    return report


def repeated_rounds(report):
    result = copy.deepcopy(report)
    full = [cell['log'][0] for cell in result['split_logs']]
    for cell in result['split_logs']:
        cell['log'] = copy.deepcopy(full)
    return result


class ShortcutJsonTests(unittest.TestCase):
    def test_exact_repeated_full_game_is_normalized_without_mutating_the_input(self):
        original = two_rounds()
        self.assertEqual(project(original)[0]['rounds'], 2)
        uploaded = repeated_rounds(original)
        before = digest(uploaded)
        decoded = validate(uploaded)
        self.assertEqual(decoded, original)
        self.assertEqual(digest(uploaded), before)
        self.assertEqual(project(uploaded), project(original))

    def test_phone_upload_of_both_encodings_keeps_one_report_and_existing_review_records(self):
        with tempfile.TemporaryDirectory(dir='D:/dev-data/kyoku-loop/private') as folder:
            store = Store(Path(folder)/'test.sqlite3')
            try:
                original = two_rounds()
                stage = store.stage(json.dumps(original).encode(), None)
                first = store.commit(stage['token'], 0, 0, None)
                session = store.study_start('practice')
                store.study_choice(session['id'], '5pr', 'choose')
                store.study_choice(session['id'], None, 'confirm')
                store.study_rate(session['id'], session['item_id'], '理解した', 'fictional-shortcut')
                tables = ('sources', 'reports', 'study_items', 'review_events', 'study_sessions', 'study_settings')
                before = {t:[tuple(row) for row in store.db.execute('SELECT * FROM '+t)] for t in tables}
                raw = json.dumps(repeated_rounds(original)).encode()
                uploaded = store.phone_mortal_inspect(base64.b64encode(raw).decode(), None)
                result = store.phone_mortal_register(uploaded['token'], uploaded['source'], None)
                self.assertTrue(result['duplicate'])
                self.assertEqual(result['id'], first['id'])
                for t in tables:
                    self.assertEqual(before[t], [tuple(row) for row in store.db.execute('SELECT * FROM '+t)])
            finally:
                store.close()

    def test_ambiguous_inconsistent_or_mixed_layouts_are_rejected(self):
        variants = []
        mixed = repeated_rounds(two_rounds())
        mixed['split_logs'][0]['log'] = mixed['split_logs'][0]['log'][:1]
        variants.append(mixed)
        inconsistent = repeated_rounds(two_rounds())
        inconsistent['split_logs'][1]['log'][0][4][0] = 47
        variants.append(inconsistent)
        changed_type = repeated_rounds(two_rounds())
        changed_type['split_logs'][1]['log'][0][0][0] = False  # False == 0 in Python, but not in JSON.
        variants.append(changed_type)
        wrong_count = repeated_rounds(two_rounds())
        for cell in wrong_count['split_logs']:
            cell['log'].append(copy.deepcopy(cell['log'][0]))
        variants.append(wrong_count)
        for raw in variants:
            with self.subTest(layout=[len(c['log']) for c in raw['split_logs']]):
                with self.assertRaisesRegex(ValueError, 'unsupported_format'):
                    validate(raw)

    def test_normalization_does_not_accept_wrong_round_order_or_mutated_gameplay(self):
        for mutation in ('order', 'tile', 'review'):
            raw = two_rounds()
            if mutation == 'order':
                raw['split_logs'].reverse()
            elif mutation == 'tile':
                raw['split_logs'][1]['log'][0][4][0] = 47
            else:
                raw['review']['kyokus'][1]['entries'][0]['state']['tehai'][0] = 'C'
            raw = repeated_rounds(raw)
            with self.subTest(mutation=mutation):
                with tempfile.TemporaryDirectory(dir='D:/dev-data/kyoku-loop/private') as folder:
                    store = Store(Path(folder)/'test.sqlite3')
                    try:
                        stage = store.stage(json.dumps(raw).encode(), None)
                        with self.assertRaisesRegex(ImportFailure, 'reconstruction_failed'):
                            store.commit(stage['token'], 0, 0, None)
                        self.assertEqual(store.state()['reports'], [])
                    finally:
                        store.close()


if __name__ == '__main__':
    unittest.main()
