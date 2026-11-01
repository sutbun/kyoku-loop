"""Private URL inbox. Stores references only; never requests a paid analysis."""
import json
import re
from datetime import datetime

try:
    from .study import StudyFailure
except ImportError:
    from study import StudyFailure

PREFIX = 'analysis:'
URL = r'https://game\.mahjongsoul\.com/\?paipu=([A-Za-z0-9_-]{10,200})'


def source_url(value):
    if not isinstance(value, str) or not re.fullmatch(URL, value.strip()):
        raise StudyFailure('invalid_source_url')
    return value.strip()


def validate_entry(value):
    if not isinstance(value, dict): raise StudyFailure('invalid_queue')
    url = source_url(value.get('url'))
    if value.get('id') != url.split('paipu=')[1]: raise StudyFailure('invalid_queue')
    try:
        at = datetime.fromisoformat(value['created'].replace('Z', '+00:00'))
        if at.tzinfo is None: raise ValueError()
    except (KeyError, TypeError, AttributeError, ValueError):
        raise StudyFailure('invalid_queue') from None
    return {'id': value['id'], 'url': url, 'created': value['created']}


def stored_entry(value):
    entry = validate_entry(value)
    if type(value.get('requested')) is not bool or not isinstance(value.get('reports'), list):
        raise StudyFailure('invalid_queue')
    if len(value['reports']) != len(set(value['reports'])) or any(not isinstance(r, str) or not re.fullmatch('[a-f0-9]{64}', r) for r in value['reports']):
        raise StudyFailure('invalid_queue')
    return entry | {'requested': value['requested'], 'reports': value['reports']}


class AnalysisQueueMixin:
    # Existing SQLite settings rows are included in a consistent SQLite backup.
    # A separate prefix avoids changing the study schema or original event log.
    def analysis_entries(self):
        return [self._analysis_view(stored_entry(json.loads(r[0]))) for r in self.db.execute(
            'SELECT value FROM study_settings WHERE key LIKE ? ORDER BY rowid', (PREFIX+'%',))]

    def _analysis_view(self, entry):
        entry['ready']=any(self.db.execute('''SELECT 1 FROM study_items i JOIN reports a ON i.report=a.id
            JOIN reports b ON a.game=b.game AND a.seat=b.seat WHERE b.id=? LIMIT 1''',(r,)).fetchone() for r in entry['reports'])
        return entry

    def analysis_entry(self, ident):
        if not isinstance(ident, str): raise StudyFailure('queue_not_found')
        row = self.db.execute('SELECT value FROM study_settings WHERE key=?', (PREFIX+ident,)).fetchone()
        if not row: raise StudyFailure('queue_not_found')
        return self._analysis_view(stored_entry(json.loads(row[0])))

    def _put_analysis(self, entry):
        self.db.execute('INSERT INTO study_settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
                        (PREFIX+entry['id'], json.dumps(stored_entry(entry), ensure_ascii=False)))

    def analysis_receive(self, entries):
        if not isinstance(entries, list) or len(entries) > 1000: raise StudyFailure('invalid_queue')
        valid = [validate_entry(e) for e in entries]
        if len({e['id'] for e in valid}) != len(valid): raise StudyFailure('invalid_queue')
        receipts = []
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            for entry in valid:
                self.db.execute('INSERT OR IGNORE INTO study_settings VALUES(?,?)',
                    (PREFIX+entry['id'], json.dumps(entry | {'requested':False, 'reports':[]}, ensure_ascii=False)))
                receipts.append(self.analysis_entry(entry['id']))
        # Only a committed transaction supplies a receipt. Original URL stays on phone.
        return {'entries':receipts, 'received_at':self.moment().isoformat()}

    def analysis_add(self, url):
        url = source_url(url)
        return self.analysis_receive([{'id':url.split('paipu=')[1], 'url':url, 'created':self.moment().isoformat()}])

    def analysis_requested(self, ident, requested):
        if type(requested) is not bool: raise StudyFailure('invalid_queue')
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            entry = self.analysis_entry(ident)
            entry['requested'] = requested
            self._put_analysis(entry)
        return entry

    def analysis_setup(self, seen):
        if type(seen) is not bool: raise StudyFailure('invalid_queue')
        with self.db:
            self.db.execute("INSERT INTO study_settings VALUES('analysis_setup',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", ('1' if seen else '0',))
        return {'seen':seen}
