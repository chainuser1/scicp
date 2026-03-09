#!/usr/bin/env python3
"""
patch_ilocano_verses.py
-----------------------
1. Compares ilocano.db words table against the English lds-scriptures-sqlite.db
   to find verses that are completely missing or have empty/whitespace text.
2. Scrapes each missing verse from churchofjesuschrist.org (lang=ilo).
3. Inserts the scraped words into ilocano.db so the subsequent migration
   produces 31 102 Bible verses with sequential IDs matching all other language DBs.

Usage:
    python3 patch_ilocano_verses.py [--dry-run]
"""

import argparse
import sqlite3
import time
import sys
from pathlib import Path

import requests
from bs4 import BeautifulSoup

# ── Config ─────────────────────────────────────────────────────────────────────
DB_DIR   = Path(__file__).parent
ILO_DB   = DB_DIR / 'ilocano.db'
ENG_DB   = DB_DIR / 'lds-scriptures-sqlite.db'
BASE_URL = 'https://www.churchofjesuschrist.org/study/scriptures'
DELAY    = 0.5      # seconds between unique chapter requests
RETRIES  = 3

# Book number (1-66) → (volume_path, lds_slug)
BOOK_SLUGS = {
    # Old Testament  (volume = ot)
     1: ('ot','gen'),   2: ('ot','ex'),    3: ('ot','lev'),   4: ('ot','num'),
     5: ('ot','deut'),  6: ('ot','josh'),  7: ('ot','judg'),  8: ('ot','ruth'),
     9: ('ot','1-sam'),10: ('ot','2-sam'),11: ('ot','1-kgs'),12: ('ot','2-kgs'),
    13: ('ot','1-chr'),14: ('ot','2-chr'),15: ('ot','ezra'), 16: ('ot','neh'),
    17: ('ot','esth'), 18: ('ot','job'),  19: ('ot','ps'),   20: ('ot','prov'),
    21: ('ot','eccl'), 22: ('ot','song'), 23: ('ot','isa'),  24: ('ot','jer'),
    25: ('ot','lam'),  26: ('ot','ezek'), 27: ('ot','dan'),  28: ('ot','hos'),
    29: ('ot','joel'), 30: ('ot','amos'), 31: ('ot','obad'), 32: ('ot','jonah'),
    33: ('ot','micah'),34: ('ot','nahum'),35: ('ot','hab'),  36: ('ot','zeph'),
    37: ('ot','hag'),  38: ('ot','zech'), 39: ('ot','mal'),
    # New Testament  (volume = nt)
    40: ('nt','matt'),  41: ('nt','mark'), 42: ('nt','luke'),  43: ('nt','john'),
    44: ('nt','acts'),  45: ('nt','rom'),  46: ('nt','1-cor'), 47: ('nt','2-cor'),
    48: ('nt','gal'),   49: ('nt','eph'),  50: ('nt','philip'),51: ('nt','col'),
    52: ('nt','1-thes'),53: ('nt','2-thes'),54: ('nt','1-tim'),55: ('nt','2-tim'),
    56: ('nt','titus'), 57: ('nt','philem'),58: ('nt','heb'), 59: ('nt','james'),
    60: ('nt','1-pet'), 61: ('nt','2-pet'),62: ('nt','1-jn'),  63: ('nt','2-jn'),
    64: ('nt','3-jn'),  65: ('nt','jude'), 66: ('nt','rev'),
}

SESSION = requests.Session()
SESSION.headers.update({
    'User-Agent': 'Mozilla/5.0 (compatible; LDS-ilo-patcher/1.0)',
    'Accept-Language': 'ilo,en-US;q=0.8',
})

# ── Helpers ────────────────────────────────────────────────────────────────────
def fetch_chapter_verses(vol: str, slug: str, chapter: int) -> dict[int, str]:
    """Fetch all verses for a chapter. Returns {verse_num: text}."""
    url = f'{BASE_URL}/{vol}/{slug}/{chapter}'
    for attempt in range(RETRIES):
        try:
            resp = SESSION.get(url, params={'lang': 'ilo'}, timeout=15)
            resp.encoding = 'utf-8'
            if resp.status_code == 404:
                return {}
            resp.raise_for_status()
            break
        except Exception as exc:
            if attempt == RETRIES - 1:
                print(f'    [WARN] failed {url}: {exc}', file=sys.stderr)
                return {}
            time.sleep(2 ** attempt)

    soup = BeautifulSoup(resp.text, 'html.parser')
    result = {}
    for p in soup.find_all('p', class_='verse'):
        sup = p.find('sup', class_='verse-number')
        if not sup:
            continue
        try:
            vnum = int(sup.get_text(strip=True))
        except ValueError:
            continue
        sup.decompose()
        # Remove footnote markers
        for s in p.find_all('sup', class_=lambda c: c and any(
                x in c for x in ('marker', 'note', 'ref'))):
            s.decompose()
        text = p.get_text(separator=' ', strip=True)
        if text:
            result[vnum] = text
    return result


def find_gaps(dry_run: bool = False):
    print('Opening databases …')
    con_ilo = sqlite3.connect(str(ILO_DB), timeout=60)
    con_eng = sqlite3.connect(str(ENG_DB), timeout=60)

    # --- ilocano words: grouped verses ------------------------------------------
    print('Reading ilocano.db words …')
    cur_ilo = con_ilo.cursor()
    cur_ilo.execute("""
        SELECT bookNum, chNum, verseNum, GROUP_CONCAT(word, ' ') AS txt
        FROM words
        GROUP BY bookNum, chNum, verseNum
        ORDER BY bookNum, chNum, verseNum
    """)
    ilo_rows = cur_ilo.fetchall()
    ilo_map  = {(b, c, v): t for b, c, v, t in ilo_rows}
    empty    = {(b, c, v) for (b, c, v), t in ilo_map.items() if not t or not t.strip()}
    print(f'  Verse refs in ilocano.db : {len(ilo_map):,}')
    print(f'  Empty text entries       : {len(empty):,}')

    # --- English DB: Bible verse refs -------------------------------------------
    print('Reading English DB …')
    cur_eng = con_eng.cursor()
    cur_eng.execute("""
        SELECT b.id, c.chapter_number, v.verse_number
        FROM verses v
        JOIN chapters c ON c.id = v.chapter_id
        JOIN books    b ON b.id = c.book_id
        WHERE b.id <= 66
        ORDER BY b.id, c.chapter_number, v.verse_number
    """)
    en_refs = {(r[0], r[1], r[2]) for r in cur_eng.fetchall()}
    print(f'  English Bible verses     : {len(en_refs):,}')

    missing = sorted(en_refs - set(ilo_map.keys()))
    all_gaps = sorted(set(missing) | empty)
    print(f'\nMissing from ilocano      : {len(missing):,}')
    print(f'Empty text in ilocano     : {len(empty):,}')
    print(f'Total gaps to fill        : {len(all_gaps):,}')

    if not all_gaps:
        print('\nNo gaps found — nothing to patch.')
        con_ilo.close()
        con_eng.close()
        return

    # Group gaps by (bookNum, chNum) to batch chapter fetches
    chap_gaps: dict[tuple, list[int]] = {}
    for b, c, v in all_gaps:
        chap_gaps.setdefault((b, c), []).append(v)

    print(f'\nUnique chapters to scrape : {len(chap_gaps):,}')

    if dry_run:
        print('\n[DRY RUN] — would scrape these chapters:')
        for (b, c), vs in sorted(chap_gaps.items())[:20]:
            slug_info = BOOK_SLUGS.get(b, ('??', '??'))
            print(f'  Book {b:>2} ({slug_info[0]}/{slug_info[1]}) ch {c}  → {len(vs)} verse(s)')
        con_ilo.close()
        con_eng.close()
        return

    # --- Patch ---------------------------------------------------------------
    cur_ilo.execute('SELECT MAX(wordId) FROM words')
    next_id = (cur_ilo.fetchone()[0] or 0) + 1
    patched = 0
    skipped = 0
    last_fetch_time = 0.0

    for idx, ((b, c), missing_verses) in enumerate(sorted(chap_gaps.items()), 1):
        if b not in BOOK_SLUGS:
            print(f'  [SKIP] Book {b} not in slug map', file=sys.stderr)
            skipped += len(missing_verses)
            continue
        vol, slug = BOOK_SLUGS[b]

        # Rate-limit chapter fetches
        elapsed = time.time() - last_fetch_time
        if elapsed < DELAY:
            time.sleep(DELAY - elapsed)

        print(f'  [{idx}/{len(chap_gaps)}] {vol}/{slug} ch {c} — fetching …', end='', flush=True)
        chapter_data = fetch_chapter_verses(vol, slug, c)
        last_fetch_time = time.time()

        if not chapter_data:
            print(f'  no verses returned (404 or parse failure)', flush=True)
            skipped += len(missing_verses)
            continue

        inserts = []
        for v in missing_verses:
            text = chapter_data.get(v, '').strip()
            if not text:
                print(f'\n    [MISS] {vol}/{slug} {c}:{v} not found in scraped page', file=sys.stderr)
                skipped += 1
                continue
            for word in text.split(' '):
                if word:
                    inserts.append((next_id, word, b, c, v))
                    next_id += 1
            patched += 1

        if inserts:
            # Remove any existing empty rows for these verse keys first
            for v in missing_verses:
                cur_ilo.execute(
                    'DELETE FROM words WHERE bookNum=? AND chNum=? AND verseNum=?',
                    (b, c, v)
                )
            cur_ilo.executemany(
                'INSERT INTO words (wordId, word, bookNum, chNum, verseNum) VALUES (?,?,?,?,?)',
                inserts
            )
            con_ilo.commit()

        filled = [v for v in missing_verses if v in chapter_data]
        print(f' → filled {len(filled)}/{len(missing_verses)} verse(s)')

    con_ilo.close()
    con_eng.close()
    print(f'\nDone. Patched {patched} verses, skipped {skipped}.')
    print('Next step: delete ilocano-scriptures-sqlite.db and re-run migration.py')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true',
                        help='Show what would be patched without writing to DB')
    args = parser.parse_args()
    find_gaps(dry_run=args.dry_run)
