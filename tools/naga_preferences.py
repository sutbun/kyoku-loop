"""Remember a confirmed type name, never a report-local model index."""
KEY = 'preferred_naga_type'
DEFAULT = 'ニシキ'


def valid_name(value):
    return (isinstance(value, str) and 1 <= len(value) <= 100
            and value.strip() == value and value.isprintable())


def preferred_model(database, models):
    row = database.execute('SELECT value FROM study_settings WHERE key=?', (KEY,)).fetchone()
    name = row[0] if row and valid_name(row[0]) else DEFAULT
    matches = [int(index) for index, value in models.items()
               if index in ('0', '1') and value == name]
    return matches[0] if len(matches) == 1 else None


def remember_type(database, name):
    if valid_name(name):
        database.execute('INSERT INTO study_settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
                         (KEY, name))
