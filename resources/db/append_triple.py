"""
append_triple_combination.py
============================
Appends the Tagalog Triple Combination (Book of Mormon, D&C, Pearl of Great Price)
into an existing Tagalog Bible SQLite database.

Usage:
    python append_triple_combination.py \
        --db   tagalog_bible.db \
        --csv  tagalog_triple_combination_mapped.csv

The script is SAFE to re-run: it checks for existing records before inserting,
so you will never get duplicate volumes, books, chapters, or verses.
"""

import argparse
import csv
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path


# ──────────────────────────────────────────────
# 1. CLI arguments
# ──────────────────────────────────────────────
parser = argparse.ArgumentParser(description="Append Triple Combination to a Tagalog Bible DB.")
parser.add_argument("--db",  required=True, help="Path to your existing tagalog_bible.db")
parser.add_argument("--csv", required=True, help="Path to tagalog_triple_combination_mapped.csv")
args = parser.parse_args()

db_path  = Path(args.db)
csv_path = Path(args.csv)

if not db_path.exists():
    sys.exit(f"[ERROR] Database not found: {db_path}")
if not csv_path.exists():
    sys.exit(f"[ERROR] CSV file not found: {csv_path}")


# ──────────────────────────────────────────────
# 2. Read and organise the CSV
# ──────────────────────────────────────────────
print(f"[INFO] Reading CSV: {csv_path}")

# We rebuild the four normalised tables from the flat CSV.
# Keyed by the ORIGINAL ids in the CSV so we can detect duplicates.
volumes  = {}   # volume_id  -> dict
books    = {}   # book_id    -> dict
chapters = {}   # chapter_id -> dict
verses   = []   # list of dicts (always leaf-level, de-duplicated by verse_id)
seen_verse_ids = set()

with open(csv_path, newline="", encoding="utf-8") as fh:
    reader = csv.DictReader(fh)
    for row in reader:
        vid = int(row["volume_id"])
        bid = int(row["book_id"])
        cid = int(row["chapter_id"])
        veid = int(row["verse_id"])

        if vid not in volumes:
            volumes[vid] = {
                "id":                vid,
                "volume_title":      row["volume_title"],
                "volume_long_title": row["volume_long_title"],
                "volume_subtitle":   row["volume_subtitle"],
                "volume_short_title":row["volume_short_title"],
                "volume_lds_url":    row["volume_lds_url"],
            }

        if bid not in books:
            books[bid] = {
                "id":             bid,
                "volume_id":      vid,
                "book_title":     row["book_title"],
                "book_long_title":row["book_long_title"],
                "book_subtitle":  row["book_subtitle"],
                "book_short_title":row["book_short_title"],
                "book_lds_url":   row["book_lds_url"],
            }

        if cid not in chapters:
            chapters[cid] = {
                "id":             cid,
                "book_id":        bid,
                "chapter_number": int(row["chapter_number"]),
            }

        if veid not in seen_verse_ids:
            seen_verse_ids.add(veid)
            verses.append({
                "id":             veid,
                "chapter_id":     cid,
                "verse_number":   int(row["verse_number"]),
                "scripture_text": row["scripture_text"],
            })

print(f"[INFO] Parsed  → {len(volumes)} volumes, {len(books)} books, "
      f"{len(chapters)} chapters, {len(verses)} verses")


# ──────────────────────────────────────────────
# 3. Connect to the existing database
# ──────────────────────────────────────────────
print(f"[INFO] Connecting to database: {db_path}")
con = sqlite3.connect(db_path)
con.execute("PRAGMA foreign_keys = ON;")
cur = con.cursor()

# Verify the expected schema tables exist
required_tables = {"volumes", "books", "chapters", "verses"}
existing_tables = {row[0] for row in cur.execute(
    "SELECT name FROM sqlite_master WHERE type='table';")}

missing = required_tables - existing_tables
if missing:
    con.close()
    sys.exit(f"[ERROR] Database is missing tables: {missing}\n"
             "Make sure you are pointing to the correct .db file.")


# ──────────────────────────────────────────────
# 4. Helper: fetch existing IDs to avoid duplicates
# ──────────────────────────────────────────────
existing_volume_ids  = {r[0] for r in cur.execute("SELECT id FROM volumes;")}
existing_book_ids    = {r[0] for r in cur.execute("SELECT id FROM books;")}
existing_chapter_ids = {r[0] for r in cur.execute("SELECT id FROM chapters;")}
existing_verse_ids   = {r[0] for r in cur.execute("SELECT id FROM verses;")}

print(f"[INFO] Existing DB → "
      f"{len(existing_volume_ids)} volumes, {len(existing_book_ids)} books, "
      f"{len(existing_chapter_ids)} chapters, {len(existing_verse_ids)} verses")


# ──────────────────────────────────────────────
# 5. Insert — skipping rows that already exist
# ──────────────────────────────────────────────
try:
    con.execute("BEGIN;")

    # 5a. Volumes
    new_volumes = [v for v in volumes.values() if v["id"] not in existing_volume_ids]
    if new_volumes:
        cur.executemany(
            """INSERT INTO volumes
               (id, volume_title, volume_long_title, volume_subtitle,
                volume_short_title, volume_lds_url)
               VALUES (:id, :volume_title, :volume_long_title, :volume_subtitle,
                       :volume_short_title, :volume_lds_url)""",
            new_volumes,
        )
        print(f"[OK]   Inserted {len(new_volumes)} new volume(s).")
    else:
        print("[SKIP] All volumes already present.")

    # 5b. Books
    new_books = [b for b in books.values() if b["id"] not in existing_book_ids]
    if new_books:
        cur.executemany(
            """INSERT INTO books
               (id, volume_id, book_title, book_long_title, book_subtitle,
                book_short_title, book_lds_url)
               VALUES (:id, :volume_id, :book_title, :book_long_title, :book_subtitle,
                       :book_short_title, :book_lds_url)""",
            new_books,
        )
        print(f"[OK]   Inserted {len(new_books)} new book(s).")
    else:
        print("[SKIP] All books already present.")

    # 5c. Chapters
    new_chapters = [c for c in chapters.values() if c["id"] not in existing_chapter_ids]
    if new_chapters:
        cur.executemany(
            """INSERT INTO chapters (id, book_id, chapter_number)
               VALUES (:id, :book_id, :chapter_number)""",
            new_chapters,
        )
        print(f"[OK]   Inserted {len(new_chapters)} new chapter(s).")
    else:
        print("[SKIP] All chapters already present.")

    # 5d. Verses
    new_verses = [v for v in verses if v["id"] not in existing_verse_ids]
    if new_verses:
        cur.executemany(
            """INSERT INTO verses (id, chapter_id, verse_number, scripture_text)
               VALUES (:id, :chapter_id, :verse_number, :scripture_text)""",
            new_verses,
        )
        print(f"[OK]   Inserted {len(new_verses)} new verse(s).")
    else:
        print("[SKIP] All verses already present.")

    con.execute("COMMIT;")
    print("\n[SUCCESS] All data committed successfully.")

except Exception as exc:
    con.execute("ROLLBACK;")
    con.close()
    sys.exit(f"[ERROR] Transaction rolled back due to: {exc}")


# ──────────────────────────────────────────────
# 6. Verification query
# ──────────────────────────────────────────────
print("\n[INFO] Final database summary:")
print("-" * 50)
for row in cur.execute("""
    SELECT v.volume_title,
           COUNT(DISTINCT b.id)  AS books,
           COUNT(DISTINCT c.id)  AS chapters,
           COUNT(DISTINCT ve.id) AS verses
    FROM   volumes  v
    JOIN   books    b  ON b.volume_id  = v.id
    JOIN   chapters c  ON c.book_id    = b.id
    JOIN   verses   ve ON ve.chapter_id= c.id
    GROUP  BY v.id, v.volume_title
    ORDER  BY v.id;
"""):
    print(f"  {row[0]:<35} | {row[1]:>3} books | {row[2]:>4} chapters | {row[3]:>6} verses")
print("-" * 50)

con.close()
print("\n[DONE] Database update complete.")