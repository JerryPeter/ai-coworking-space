"""Minimal read-only sqlite3 CLI substitute (the sqlite3 binary is not installed).
Usage: sqlq.py DB_PATH '.schema' | 'SQL'
Opens the DB with mode=ro (URI) so it can never write. Independent of app code;
used only for cross-checking API output.
"""
import sqlite3, sys
from pathlib import Path

db, q = sys.argv[1], sys.argv[2]
con = sqlite3.connect(f"file:{Path(db).expanduser().resolve()}?mode=ro", uri=True)
if q.strip() == ".schema":
    for (sql,) in con.execute("select sql from sqlite_master where sql is not null order by type desc, name"):
        print(sql + ";")
elif q.strip() == ".tables":
    print(" ".join(r[0] for r in con.execute("select name from sqlite_master where type='table' order by name")))
else:
    for row in con.execute(q):
        print("|".join("" if v is None else str(v) for v in row))
