#!/usr/bin/env python3
"""Build stay.db (SQLite, ready to upload to Turso) from Supabase CSV exports.

Usage:
    python build_db.py <csv_folder> [output.db]

Put one CSV per table in <csv_folder>, named after the table
(properties.csv, rooms.csv, beds.csv, tenants.csv, ...). Missing files are skipped.
schema_sqlite.sql must sit next to this script.
"""
import csv, json, os, re, sqlite3, sys
from datetime import datetime, timezone

# parents first, so foreign keys are satisfied
ORDER = ["properties", "rooms", "beds", "tenants", "bed_reservations", "calls",
         "complaints", "feedback", "payments", "property_staff", "visits",
         "webhook_secrets"]

TS_COLS = {  # timestamptz columns -> normalised to UTC ISO-8601
    "properties": ["created_at"], "rooms": ["created_at"], "tenants": ["created_at"],
    "bed_reservations": ["expires_at", "created_at"], "calls": ["created_at"],
    "complaints": ["created_at"], "feedback": ["created_at"], "payments": ["created_at"],
    "property_staff": ["created_at"], "visits": ["visit_at", "created_at"],
    "webhook_secrets": ["created_at"],
}
BOOL_COLS = {"beds": ["occupied"], "calls": ["needs_follow_up"]}
ARRAY_COLS = {"tenants": ["id_doc_paths"]}


def norm_ts(v):
    s = v.strip()
    m = re.match(r"^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}(?::?\d{2})?)?$", s)
    if not m:
        return s
    date, time, frac, tz = m.groups()
    if tz is None or tz == "Z":
        offset = "+00:00"
    else:
        offset = tz if ":" in tz else (tz + ":00" if len(tz) == 3 else tz[:3] + ":" + tz[3:])
    dt = datetime.fromisoformat(f"{date}T{time}{frac or ''}{offset}").astimezone(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def norm_bool(v):
    return 1 if v.strip().lower() in ("t", "true", "1", "yes") else 0


def norm_array(v):
    s = v.strip()
    if s.startswith("["):
        return s
    if s in ("", "{}"):
        return "[]"
    if s.startswith("{") and s.endswith("}"):
        items = next(csv.reader([s[1:-1]], skipinitialspace=True))
        return json.dumps([i for i in items])
    return json.dumps([s])


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    folder = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else "stay.db"
    here = os.path.dirname(os.path.abspath(__file__))
    if os.path.exists(out):
        os.remove(out)
    db = sqlite3.connect(out)
    db.executescript(open(os.path.join(here, "schema_sqlite.sql"), encoding="utf-8").read())
    db.execute("PRAGMA foreign_keys = ON")

    for table in ORDER:
        path = os.path.join(folder, table + ".csv")
        if not os.path.exists(path):
            print(f"{table:18} (no csv - skipped)")
            continue
        info = {r[1]: r for r in db.execute(f"PRAGMA table_info({table})")}  # name -> row
        with open(path, newline="", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            cols = [c for c in reader.fieldnames if c in info]
            unknown = [c for c in reader.fieldnames if c not in info]
            if unknown:
                print(f"{table}: ignoring unknown columns {unknown}")
            sql = f'INSERT INTO "{table}" ({",".join(chr(34)+c+chr(34) for c in cols)}) VALUES ({",".join("?"*len(cols))})'
            n = 0
            for row in reader:
                vals = []
                for c in cols:
                    v = row[c]
                    notnull, ctype = info[c][3], info[c][2]
                    if v is None or v == "" or v.upper() == "NULL":
                        if notnull and ctype == "TEXT":
                            v = "[]" if c in ARRAY_COLS.get(table, []) else ""
                        else:
                            v = None
                    elif c in TS_COLS.get(table, []):
                        v = norm_ts(v)
                    elif c in BOOL_COLS.get(table, []):
                        v = norm_bool(v)
                    elif c in ARRAY_COLS.get(table, []):
                        v = norm_array(v)
                    vals.append(v)
                db.execute(sql, vals)
                n += 1
        print(f"{table:18} {n} rows")
    db.commit()

    bad = db.execute("PRAGMA foreign_key_check").fetchall()
    print("foreign key problems:", bad if bad else "none")
    print("integrity:", db.execute("PRAGMA integrity_check").fetchall()[0][0])
    # Turso upload requires WAL mode (stored in the file header)
    print("journal_mode:", db.execute("PRAGMA journal_mode=WAL").fetchall()[0][0])
    db.commit()
    db.close()  # closing the last connection merges the WAL into the .db file
    print("wrote", out)


if __name__ == "__main__":
    main()
