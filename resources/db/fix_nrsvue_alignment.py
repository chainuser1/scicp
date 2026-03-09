#!/usr/bin/env python3
"""
fix_nrsvue_alignment.py
=======================
Rebuilds the Bible portion of nrsvue-scriptures-sqlite.db so every verse
carries the same verse_id as its KJV counterpart in lds-scriptures-sqlite.db.

Why this is needed
------------------
NRSVUE omits 16 NT verses that KJV includes (Matthew 17:21, Mark 7:16 …)
and adds 2 verses that KJV lacks.  Because verse_ids were assigned
sequentially during scraping, every verse that follows a missing verse has a
verse_id that is off-by-N compared to what the backend expects when it looks
up "this verse_id in NRSVUE".

Fix strategy
------------
1. Read the KJV verse list (Bible only, volumes 1‑2) as the authoritative
   (verse_id, book_id, chapter_number, verse_number) sequence.
2. Build a look-up from (book_id, chapter_number, verse_number) → NRSVUE text
   using the current (mis-aligned) NRSVUE rows.
3. Delete all misaligned NRSVUE Bible verse rows.
4. Re-insert using KJV verse_ids and matching NRSVUE text.
   • Verses present in KJV but absent in NRSVUE → empty scripture_text.
   • NRSVUE-only verses (no KJV match) → dropped (they have no verse_id slot).
5. Rebuild the FTS5 index.
"""

import sqlite3
import sys
from pathlib import Path

HERE = Path(__file__).parent
LDS_PATH    = HERE / 'lds-scriptures-sqlite.db'
NRSVUE_PATH = HERE / 'nrsvue-scriptures-sqlite.db'


def main():
    if not LDS_PATH.exists():
        sys.exit(f'[ERROR] KJV source not found: {LDS_PATH}')
    if not NRSVUE_PATH.exists():
        sys.exit(f'[ERROR] NRSVUE DB not found: {NRSVUE_PATH}')

    lds    = sqlite3.connect(str(LDS_PATH))
    nrsvue = sqlite3.connect(str(NRSVUE_PATH))
    nrsvue.execute('PRAGMA journal_mode=WAL')
    nrsvue.execute('PRAGMA synchronous=NORMAL')

    # ── Step 1: KJV authoritative Bible verse list ────────────────────────────
    print('Reading KJV Bible verse list …')
    kjv_rows = lds.execute("""
        SELECT v.id, b.id, c.id, c.chapter_number, v.verse_number
        FROM   verses v
        JOIN   chapters c ON c.id = v.chapter_id
        JOIN   books    b ON b.id = c.book_id
        WHERE  b.volume_id IN (1, 2)
        ORDER  BY v.id
    """).fetchall()
    print(f'  KJV Bible verses: {len(kjv_rows):,}')

    # ── Step 2: NRSVUE current text look-up ───────────────────────────────────
    print('Reading current NRSVUE Bible text …')
    nrsvue_rows = nrsvue.execute("""
        SELECT b.id, c.chapter_number, v.verse_number, v.scripture_text
        FROM   verses v
        JOIN   chapters c ON c.id = v.chapter_id
        JOIN   books    b ON b.id = c.book_id
        WHERE  b.volume_id IN (1, 2)
    """).fetchall()
    nrsvue_text = {}
    for book_id, ch_num, v_num, text in nrsvue_rows:
        nrsvue_text[(book_id, ch_num, v_num)] = text or ''
    print(f'  NRSVUE Bible verses (current): {len(nrsvue_rows):,}')

    # ── Step 3: Build NRSVUE chapter_id look-up ───────────────────────────────
    nrsvue_chapter_ids = {}
    for row in nrsvue.execute("""
        SELECT b.id, c.chapter_number, c.id
        FROM   chapters c
        JOIN   books    b ON b.id = c.book_id
        WHERE  b.volume_id IN (1, 2)
    """).fetchall():
        nrsvue_chapter_ids[(row[0], row[1])] = row[2]

    # ── Step 4: Delete misaligned NRSVUE Bible verses ─────────────────────────
    print('Deleting current NRSVUE Bible verses …')
    nrsvue.execute("""
        DELETE FROM verses
        WHERE chapter_id IN (
            SELECT c.id FROM chapters c
            JOIN books b ON b.id = c.book_id
            WHERE b.volume_id IN (1, 2)
        )
    """)

    # ── Step 5: Re-insert with KJV-aligned verse_ids ──────────────────────────
    print('Re-inserting with KJV-aligned verse_ids …')
    inserted   = 0
    empty_fill = 0

    for kjv_vid, book_id, _kjv_ch_id, ch_num, v_num in kjv_rows:
        chapter_id = nrsvue_chapter_ids.get((book_id, ch_num))
        if chapter_id is None:
            print(f'  [WARN] No NRSVUE chapter for book_id={book_id} ch={ch_num}')
            continue

        text = nrsvue_text.get((book_id, ch_num, v_num), '')
        if not text:
            empty_fill += 1

        nrsvue.execute(
            'INSERT INTO verses (id, chapter_id, verse_number, scripture_text) VALUES (?,?,?,?)',
            (kjv_vid, chapter_id, v_num, text)
        )
        inserted += 1

    nrsvue.commit()
    print(f'  Inserted {inserted:,} verses ({empty_fill:,} KJV-only filled with empty text)')

    # ── Step 6: Verify Triple is still intact ─────────────────────────────────
    triple_count = nrsvue.execute("""
        SELECT COUNT(*) FROM verses v
        JOIN chapters c ON c.id = v.chapter_id
        JOIN books b ON b.id = c.book_id
        WHERE b.volume_id IN (3, 4, 5)
    """).fetchone()[0]
    total = nrsvue.execute('SELECT COUNT(*) FROM verses').fetchone()[0]
    print(f'  Triple verses intact: {triple_count:,}')
    print(f'  Total verses: {total:,}  (expected ~41,995)')

    # ── Step 7: Spot-check alignment ─────────────────────────────────────────
    print('\nSpot-checking alignment …')
    checks = [
        (1,     'Genesis 1:1'),
        (23145, 'last OT verse'),
        (23146, 'first NT verse (Matthew 1:1)'),
        (31102, 'last NT verse (Revelation 22:21)'),
        (31103, '1 Nephi 1:1'),
        (41995, 'Articles of Faith 1:13'),
    ]
    for vid, label in checks:
        kjv_row = lds.execute(
            'SELECT book_title, chapter_number, verse_number FROM scriptures WHERE verse_id=?', (vid,)
        ).fetchone()
        nrsvue_row = nrsvue.execute(
            'SELECT book_title, chapter_number, verse_number FROM scriptures WHERE verse_id=?', (vid,)
        ).fetchone()
        kjv_ref    = f'{kjv_row[0]} {kjv_row[1]}:{kjv_row[2]}'    if kjv_row    else 'MISSING'
        nrsvue_ref = f'{nrsvue_row[0]} {nrsvue_row[1]}:{nrsvue_row[2]}' if nrsvue_row else 'MISSING'
        status = '✓' if kjv_ref == nrsvue_ref else '✗ MISMATCH'
        print(f'  verse_id {vid:6d} ({label}): KJV={kjv_ref}  NRSVUE={nrsvue_ref}  {status}')

    # ── Step 8: Rebuild FTS5 ─────────────────────────────────────────────────
    print('\nRebuilding FTS5 index …')
    try:
        nrsvue.execute("INSERT INTO scriptures_fts(scriptures_fts) VALUES('delete-all')")
        nrsvue.execute("""
            INSERT INTO scriptures_fts(verse_id, scripture_text, verse_title, book_title,
                                        chapter_number, verse_number)
            SELECT verse_id, scripture_text, verse_title, book_title, chapter_number, verse_number
            FROM   scriptures
        """)
        nrsvue.commit()
        print('  FTS5 rebuilt.')
    except Exception as e:
        print(f'  [WARN] FTS rebuild skipped: {e}')

    print('\nDone.')
    nrsvue.close()
    lds.close()


if __name__ == '__main__':
    main()
