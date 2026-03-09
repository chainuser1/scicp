#!/usr/bin/env python3
"""Analyse ilocano.db for empty/missing verses vs English DB."""
import sqlite3, sys

DB_DIR = '/home/lotus_clan/Documents/Projects/scicp/resources/db'

# --- ilocano.db words table ---
con_ilo = sqlite3.connect(f'{DB_DIR}/ilocano.db')
cur_ilo = con_ilo.cursor()
cur_ilo.execute("""
    SELECT bookNum, chNum, verseNum, GROUP_CONCAT(word, ' ') AS txt
    FROM words
    GROUP BY bookNum, chNum, verseNum
    ORDER BY bookNum, chNum, verseNum
""")
ilo_rows = cur_ilo.fetchall()
con_ilo.close()

ilo_map  = {(b,c,v): t for b,c,v,t in ilo_rows}
empty    = {(b,c,v) for (b,c,v),t in ilo_map.items() if not t or not t.strip()}
short    = {(b,c,v) for (b,c,v),t in ilo_map.items() if t and 0 < len(t.strip()) < 5}

print(f"Total verse refs in ilocano.db : {len(ilo_map)}")
print(f"Empty / null                   : {len(empty)}")
print(f"Very short (< 5 chars)         : {len(short)}")

# --- English DB ---
con_en = sqlite3.connect(f'{DB_DIR}/lds-scriptures-sqlite.db')
cur_en = con_en.cursor()
cur_en.execute("SELECT COUNT(*) FROM verses")
en_total = cur_en.fetchone()[0]
cur_en.execute("SELECT MAX(id) FROM verses")
en_max_id = cur_en.fetchone()[0]
# Get all bible verse (book_num, ch_num, verse_num) from English
cur_en.execute("""
    SELECT b.id AS book_num, c.chapter_number, v.verse_number
    FROM verses v
    JOIN chapters c ON c.id = v.chapter_id
    JOIN books   b  ON b.id = c.book_id
    WHERE b.id <= 66
    ORDER BY b.id, c.chapter_number, v.verse_number
""")
en_refs = {(r[0], r[1], r[2]) for r in cur_en.fetchall()}
con_en.close()

print(f"\nEnglish DB total verses        : {en_total}")
print(f"English DB max verse id        : {en_max_id}")
print(f"English DB unique (b,c,v) refs : {len(en_refs)}")

missing_in_ilo = sorted(en_refs - set(ilo_map.keys()))
extra_in_ilo   = sorted(set(ilo_map.keys()) - en_refs)

print(f"\nRefs in English but missing from ilocano.db  : {len(missing_in_ilo)}")
print(f"Refs in ilocano.db but not in English        : {len(extra_in_ilo)}")

if empty:
    print(f"\nFirst 15 empty-text verses (bookNum, chNum, verseNum):")
    for ref in sorted(empty)[:15]:
        print(f"  {ref}")

if missing_in_ilo:
    print(f"\nFirst 15 missing refs (book, ch, verse):")
    for ref in missing_in_ilo[:15]:
        print(f"  {ref}")

# Dump full missing list to a file for the patching script
with open('/tmp/ilo_missing_verses.txt', 'w') as f:
    for b,c,v in sorted(set(missing_in_ilo) | empty):
        f.write(f"{b}\t{c}\t{v}\n")
print(f"\nFull missing+empty list → /tmp/ilo_missing_verses.txt ({len(missing_in_ilo)+len(empty)} entries)")
