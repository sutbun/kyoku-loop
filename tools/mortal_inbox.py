"""Opt-in, local-only Mortal inbox. Originals are read, never moved or deleted."""
import hashlib
import json
import os
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

DEFAULT_FOLDER = 'D:/dev-data/kyoku-loop/private/mortal-inbox'


class MortalInbox:
    def __init__(self, store):
        self.store = store
        self.settings = store.path.parent / 'mortal-inbox-settings.json'
        self.index = store.path.parent / 'mortal-inbox.sqlite3'
        self.failure = store.path.parent / 'mortal-inbox-error.json'

    def config(self):
        if not self.settings.exists():
            return {'enabled': False, 'folder': DEFAULT_FOLDER}
        return json.loads(self.settings.read_text(encoding='utf-8'))

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.index, timeout=30)
        db.row_factory = sqlite3.Row
        db.execute('''CREATE TABLE IF NOT EXISTS files(
            path TEXT PRIMARY KEY, signature TEXT, seen REAL, status TEXT,
            hash TEXT, report TEXT, error TEXT, updated REAL)''')
        try:
            with db:
                yield db
        finally:
            db.close()

    def folder(self, value):
        try:
            from .p2_store import ROOT, ImportFailure
        except ImportError:
            from p2_store import ROOT, ImportFailure
        if not isinstance(value, str) or not value.strip() or not Path(value).is_absolute():
            raise ImportFailure('invalid_inbox_folder')
        folder = Path(value.strip()).resolve()
        if (ROOT.resolve() not in folder.parents or folder == self.store.path.parent
                or self.store.path.parent in folder.parents
                or folder in self.store.path.parent.parents
                or any((p / '.git').exists() for p in [folder, *folder.parents])):
            raise ImportFailure('invalid_inbox_folder')
        return folder

    def configure(self, enabled, folder):
        try:
            from .p2_store import ImportFailure
        except ImportError:
            from p2_store import ImportFailure
        if type(enabled) is not bool:
            raise ImportFailure('invalid_request')
        folder = self.folder(folder)
        if enabled:
            folder.mkdir(parents=True, exist_ok=True)
            self.folder(str(folder))
        config = {'enabled': enabled, 'folder': str(folder)}
        # API requests are serialized with scans by the inbox SQLite lock.
        with self.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            temp = self.settings.with_suffix('.tmp')
            temp.write_text(json.dumps(config), encoding='utf-8')
            os.replace(temp, self.settings)
            if self.failure.exists(): self.failure.unlink()
        return self.status()

    def status(self):
        config = self.config()
        files = []
        if self.index.exists():
            with self.connection() as db:
                files = [dict(r) for r in db.execute(
                    'SELECT path,status,report,error FROM files ORDER BY updated DESC LIMIT 20')]
        unavailable = config['enabled'] and not Path(config['folder']).is_dir()
        error = 'inbox_service_error' if self.failure.exists() else 'inbox_unavailable' if unavailable else None
        return {**config, 'error': error, 'files': [{'name': Path(r['path']).name,
                                   **{k: v for k, v in r.items() if k != 'path'}} for r in files]}

    def known_source(self, report):
        try:
            from .p2_store import digest
        except ImportError:
            from p2_store import digest
        game = digest([s['log'] for s in report['split_logs']])
        urls = {r[0] for r in self.store.db.execute(
            'SELECT source_game_url FROM reports WHERE game=? AND seat=? AND source_game_url IS NOT NULL',
            (game, report['player_id'])) if r[0]}
        # Only previously explicit links with identical full game and seat qualify.
        if len(urls) != 1:
            return None, None
        url = next(iter(urls))
        entry = next((e for e in self.store.analysis_entries() if e['url'] == url), None)
        return url, entry['id'] if entry else None

    def scan(self, now=None):
        try:
            from .p2_store import decode, LIMIT, ImportFailure
        except ImportError:
            from p2_store import decode, LIMIT, ImportFailure
        now = time.time() if now is None else now
        if not self.config()['enabled']:
            return self.status()
        with self.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            config = self.config()  # Disabling must take effect before the next commit.
            if not config['enabled']:
                return self.status()
            folder = self.folder(config['folder'])
            # No recursion, network access, hidden browser state, or archive extraction.
            try:
                paths = []
                with os.scandir(folder) as entries:
                    for e in entries:
                        if e.name.lower().endswith(('.json', '.json.gz')) and not e.is_symlink() and e.is_file(follow_symlinks=False):
                            paths.append(Path(e.path))
            except OSError:
                raise ImportFailure('inbox_unavailable') from None
            processed = 0
            for path in paths:
                try:
                    before = path.stat()
                    if path.resolve().parent != folder:
                        continue
                    signature = f'{before.st_mtime_ns}:{before.st_size}'
                    old = db.execute('SELECT * FROM files WHERE path=?', (str(path),)).fetchone()
                    missing_report = old and old['status'] in ('imported','duplicate') and not self.store.db.execute('SELECT 1 FROM reports WHERE id=?', (old['report'],)).fetchone()
                    if not old or old['signature'] != signature or missing_report:
                        db.execute('INSERT OR REPLACE INTO files VALUES(?,?,?,?,?,?,?,?)',
                                   (str(path), signature, now, 'waiting', None, None, None, now))
                        continue
                    if old['status'] != 'waiting' or now - old['seen'] < 3 or processed >= 2:
                        continue
                    processed += 1
                    if before.st_size > LIMIT:
                        raise ImportFailure('size_limit')
                    with path.open('rb') as f:
                        payload = f.read(LIMIT + 1)
                    after = path.stat()
                    if len(payload) > LIMIT:
                        raise ImportFailure('size_limit')
                    if (before.st_mtime_ns, before.st_size) != (after.st_mtime_ns, after.st_size) or path.resolve().parent != folder:
                        continue
                    report = decode(payload)
                    if report.get('engine') != 'Mortal':
                        raise ImportFailure('inbox_mortal_only')
                    digest = hashlib.sha256(payload).hexdigest()
                    previous = db.execute("SELECT report FROM files WHERE hash=? AND status IN ('imported','duplicate')", (digest,)).fetchone()
                    if previous and self.store.db.execute('SELECT 1 FROM reports WHERE id=?', (previous['report'],)).fetchone():
                        result = {'id': previous['report'], 'duplicate': True}
                    else:
                        source, ident = self.known_source(report)
                        staged = self.store.stage(payload, None)
                        result = self.store.commit(staged['token'], report['player_id'], 0, source, ident)
                        with self.store.db:
                            self.store.db.execute('DELETE FROM staging WHERE token=?', (staged['token'],))
                    db.execute('UPDATE files SET status=?,hash=?,report=?,error=NULL,updated=? WHERE path=?',
                               ('duplicate' if result['duplicate'] else 'imported', digest, result['id'], now, str(path)))
                except (ValueError, OSError, KeyError, TypeError) as exc:
                    # Only public, fixed error codes are exposed. No raw exception text.
                    error = exception_code(exc)
                    db.execute('UPDATE files SET status=?,error=?,updated=? WHERE path=?', ('error', error, now, str(path)))
        return self.status()


def exception_code(exc):
    code = str(exc)
    return code if code in {'invalid_json', 'size_limit', 'unsupported_format', 'unsupported_rule',
                           'unsupported_model', 'reconstruction_failed', 'inbox_mortal_only',
                           'source_conflict'} else 'inbox_file_error'
