"""
fix_verse_prefix.py
===================
Strips leading verse numbers from scripture_text in a SQLite scripture database.
Only removes a leading "{verse_number} " prefix (number + space) from each verse.
Safe to re-run (idempotent).

Usage:
    python fix_verse_prefix.py --db <database.db>
"""

import argparse
import sqlite3
from pathlib import Path
import sys

parser = argparse.ArgumentParser(description="Strip leading verse numbers from scripture_text.")
parser.add_argument("--db", required=True, help="Path to the SQLite database")
args = parser.parse_args()

db_path = Path(args.db)
if not db_path.exists():
    sys.exit(f"[ERROR] Database not found: {db_path}")

con = sqlite3.connect(db_path)
cur = con.cursor()

# Inspect a sample to understand the prefix pattern
sample = cur.execute(
    "SELECT id, verse_number, scripture_text FROM verses WHERE id > 31100 LIMIT 5"
).fetchall()
print("[INFO] Sample rows (before fix):")
for row in sample:
    print(f"  id={row[0]} verse_number={row[1]} text_prefix={repr(row[2][:30])}")

# Fetch all verses that have a leading "{verse_number} " prefix
affected = cur.execute(
    "SELECT id, verse_number, scripture_text FROM verses"
).fetchall()

to_fix = []
for row_id, verse_num, text in affected:
    prefix = str(verse_num) + " "
    if text.startswith(prefix):
        to_fix.append((text[len(prefix):], row_id))

print(f"\n[INFO] Found {len(to_fix)} verses with a leading number prefix.")

if not to_fix:
    print("[SKIP] Nothing to fix.")
    con.close()
    sys.exit(0)

try:
    con.execute("BEGIN;")
    cur.executemany("UPDATE verses SET scripture_text = ? WHERE id = ?", to_fix)
    con.execute("COMMIT;")
    print(f"[OK]   Updated {len(to_fix)} verses.")
except Exception as exc:
    con.execute("ROLLBACK;")
    con.close()
    sys.exit(f"[ERROR] Rolled back: {exc}")

# Verify sample after fix
sample_after = cur.execute(
    "SELECT id, verse_number, scripture_text FROM verses WHERE id > 31100 LIMIT 5"
).fetchall()
print("\n[INFO] Sample rows (after fix):")
for row in sample_after:
    print(f"  id={row[0]} verse_number={row[1]} text_prefix={repr(row[2][:50])}")

con.close()
print("\n[DONE] Fix complete.")
