"""Question selection regressions using fictional in-memory state only."""
import sqlite3
import unittest

from tools.study import StudyMixin


class SelectionTests(unittest.TestCase):
    def setUp(self):
        self.store = StudyMixin()
        self.store.db = sqlite3.connect(':memory:')
        self.store.db.row_factory = sqlite3.Row
        self.store.today = lambda: '2026-11-05'
        self.store.db.executescript('''
            CREATE TABLE study_items(id TEXT,status TEXT,manual INTEGER,due TEXT,last_credit_day TEXT);
            CREATE TABLE review_events(item TEXT,kind TEXT,at TEXT);
        ''')
        self.store.db.executemany('INSERT INTO study_items VALUES(?,?,?,?,?)',
            [(str(n).zfill(3),'未学習',0,'2026-11-04','') for n in range(207)])

    def tearDown(self):
        self.store.db.close()

    def test_practice_does_not_repeat_the_low_count_five_after_they_are_completed(self):
        # Five new questions among many questions with a larger historical count.
        self.store.db.executemany('INSERT INTO review_events VALUES(?,?,?)',
            [(str(n).zfill(3),'answer','2026-11-01T00:00:00+00:00') for n in range(5,207) for _ in range(20)])
        first = [i['id'] for i in self.store._queue('practice')]
        self.store.db.executemany('INSERT INTO review_events VALUES(?,?,?)',
            [(ident,'answer','2026-11-05T00:00:00+00:00') for ident in first])
        second = [i['id'] for i in self.store._queue('practice')]
        self.assertTrue(set(first).isdisjoint(second))

    def test_scheduled_does_not_starve_older_unlearned_questions_behind_newer_review_deadlines(self):
        self.store.db.execute("UPDATE study_items SET status='復習中',due='2026-11-05' WHERE id<'005'")
        selected = self.store._queue('scheduled')
        self.assertTrue(all(i['due']=='2026-11-04' for i in selected))

    def test_practice_compares_answer_instants_across_timezone_offsets(self):
        self.store.db.execute("DELETE FROM study_items WHERE id>='002'")
        self.store.db.executemany('INSERT INTO review_events VALUES(?,?,?)', [
            ('000','answer','2026-11-05T08:00:00+09:00'),
            ('001','answer','2026-11-04T23:30:00Z'),
        ])
        self.assertEqual([i['id'] for i in self.store._queue('practice')],['000','001'])


if __name__ == '__main__':
    unittest.main()
