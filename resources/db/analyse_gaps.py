#!/usr/bin/env python3
"""Analyse ilocano.db gaps vs English LDS Bible DB."""
import sqlite3
import sys

DB_DIR = '/home/lotus_clan/Documents/Projects/scicp/resources/db'
OUT_FILE = '/home/lotus_clan/Documents/Projects/scicp/resources/db/ilo_gaps.txt'

# ilocano words table
con_ilo = sqlite3.connect(f'{DB_DIR}/ilocano.db', timeout=30)
cur = con_ilo.cursor()
cur.execute("""
    SELECT bookNum, chNum, verseNum, GROUP_CONCAT(word, ' ') AS txt
    FROM words
    GROUP BY bookNum, chNum, verseNum
    ORDER BY bookNum, chNum, verseNum
""")
ilo_rows = cur.fetchall()
con_ilo.close()

ilo_map = {(b,c,v): t for b,c,v,t in ilo_rows}
empty = {(b,c,v) for (b,c,v),t in ilo_map.items() if not t or not t.strip()}

# English DB
con_en = sqlite3.connect(f'{DB_DIR}/lds-scriptures-sqlite.db', timeout=30)
cur_en = con_en.cursor()
cur_en.execute("""
    SELECT b.id, c.chapter_number, v.verse_number
    FROM verses v
    JOIN chapters c ON c.id = v.chapter_id
    JOIN books b ON b.id = c.book_id
    WHERE b.id <= 66
    ORDER BY b.id, c.chapter_number, v.verse_number
""")
en_refs = {(r[0], r[1], r[2]) for r in cur_en.fetchall()}
total_en = len(en_refs)
con_en.close()

missing = sorted(en_refs - set(ilo_map.keys()))
all_gaps = sorted(set(missing) | empty)

print(f"ilocano.db verse refs: {len(ilo_map)}")
print(f"ilocano empty text: {len(empty)}")
print(f"English DB Bible verses: {total_en}")
print(f"Missing from ilocano: {len(missing)}")
print(f"Total gaps (missing+empty): {len(all_gaps)}")
print("\nFirst 20 gaps:")
for g in all_gaps[:20]:
    print(f"  book={g[0]} ch={g[1]} v={g[2]}")

# Save gaps
with open(OUT_FILE, 'w') as f:
    for b,c,v in all_gaps:
        f.write(f"{b},{c},{v}\n")
print(f"\nSaved {len(all_gaps)} gaps to {OUT_FILE}")

# Book summary
from collections import Counter
book_gap_counts = Counter(b for b,c,v in all_gaps)
print("\nBooks with gaps (bookNum: count):")
for bk in sorted(book_gap_counts):
    print(f"  book {bk:>2}: {book_gap_counts[bk]} gaps")
