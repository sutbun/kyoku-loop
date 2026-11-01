"""Additional local backup copy; never moves or prunes the original snapshot."""
import hashlib
import json
import os
import secrets
import sqlite3
from pathlib import Path


def mirror_folder(database):
    config = database.parent / 'backup-settings.json'
    if not config.exists(): return None
    value = json.loads(config.read_text(encoding='utf-8-sig'))['directory']
    if not isinstance(value, str) or not Path(value).is_absolute(): raise ValueError('invalid_mirror')
    target = Path(value).resolve()
    if target == database.parent or database.parent in target.parents or target.drive.lower() == 'c:': raise ValueError('invalid_mirror')
    if any((p/'.git').exists() for p in (target, *target.parents)): raise ValueError('invalid_mirror')
    return target


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024*1024), b''): digest.update(chunk)
    return digest.hexdigest()


def mirror_backup(database, source):
    temporary = None
    try:
        folder = mirror_folder(database)
        if folder is None: return {'state':'not_configured'}
        folder.mkdir(parents=True, exist_ok=True)
        # Recheck after resolving newly created directories, including junctions.
        if mirror_folder(database) != folder: raise ValueError('changed_mirror')
        temporary = folder / ('.kyokuloop-'+secrets.token_hex(16)+'.partial')
        with source.open('rb') as src, temporary.open('xb') as dest:
            for chunk in iter(lambda: src.read(1024*1024), b''): dest.write(chunk)
            dest.flush();os.fsync(dest.fileno())
        fingerprint = sha(source)
        if sha(temporary) != fingerprint: raise ValueError('copy_mismatch')
        connection = sqlite3.connect(temporary.as_uri()+'?mode=ro', uri=True)
        try:
            if connection.execute('PRAGMA quick_check').fetchone()[0] != 'ok' or connection.execute('PRAGMA foreign_key_check').fetchone(): raise ValueError('invalid_copy')
        finally: connection.close()
        target = folder / source.name
        # Unique snapshot names normally avoid collisions. Never overwrite one.
        if target.exists(): raise FileExistsError()
        temporary.rename(target);temporary=None
        return {'state':'saved','folder':str(folder),'name':target.name,'sha256':fingerprint}
    except Exception:
        return {'state':'failed'}
    finally:
        if temporary is not None:
            try: temporary.unlink()
            except OSError: pass
