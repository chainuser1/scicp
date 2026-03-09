#!/usr/bin/env python3
"""
patch_ilocano_db.py
===================
Patches ilocano.db to have exactly 31,102 unique verse positions matching
the standard LDS Bible schema (as used in cebuano-scriptures-sqlite.db).

Steps performed:
  1. Remove French-language duplicate rows from books 61-66 (keep lowest wordId
     per verse position — that's the Ilocano row).
  2. Fetch the 581 verse positions that are missing from ilocano.db from the
     RIPV Bible (YouVersion version 782) and insert them.

After this script finishes, re-run migration.py to produce ilocano-scriptures-sqlite.db
with exactly 31,102 Bible verse IDs (1–31,102), keeping the Triple Combination
offset (verse_id 31,103+) intact.

Usage:
    python3 patch_ilocano_db.py [--ref-db cebuano-scriptures-sqlite.db] [--db ilocano.db] [--dry-run]
"""

import argparse
import re
import sqlite3
import sys
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

# ─────────────────────────────────────────────────────────────────
# Book number → Bible.com OSIS abbreviation (YouVersion)
# ─────────────────────────────────────────────────────────────────
BOOK_ABBR = {
    1: "GEN",   2: "EXO",   3: "LEV",   4: "NUM",   5: "DEU",
    6: "JOS",   7: "JDG",   8: "RUT",   9: "1SA",  10: "2SA",
   11: "1KI",  12: "2KI",  13: "1CH",  14: "2CH",  15: "EZR",
   16: "NEH",  17: "EST",  18: "JOB",  19: "PSA",  20: "PRO",
   21: "ECC",  22: "SNG",  23: "ISA",  24: "JER",  25: "LAM",
   26: "EZK",  27: "DAN",  28: "HOS",  29: "JOL",  30: "AMO",
   31: "OBA",  32: "JON",  33: "MIC",  34: "NAM",  35: "HAB",
   36: "ZEP",  37: "HAG",  38: "ZEC",  39: "MAL",
   40: "MAT",  41: "MRK",  42: "LUK",  43: "JHN",  44: "ACT",
   45: "ROM",  46: "1CO",  47: "2CO",  48: "GAL",  49: "EPH",
   50: "PHP",  51: "COL",  52: "1TH",  53: "2TH",  54: "1TI",
   55: "2TI",  56: "TIT",  57: "PHM",  58: "HEB",  59: "JAS",
   60: "1PE",  61: "2PE",  62: "1JN",  63: "2JN",  64: "3JN",
   65: "JUD",  66: "REV",
}

BOOK_NAMES = {
    1:"Genesis", 2:"Exodus", 3:"Leviticus", 4:"Numbers", 5:"Deuteronomy",
    6:"Joshua", 7:"Judges", 8:"Ruth", 9:"1 Samuel", 10:"2 Samuel",
    11:"1 Kings", 12:"2 Kings", 13:"1 Chronicles", 14:"2 Chronicles",
    15:"Ezra", 16:"Nehemiah", 17:"Esther", 18:"Job", 19:"Psalms",
    20:"Proverbs", 21:"Ecclesiastes", 22:"Song of Solomon", 23:"Isaiah",
    24:"Jeremiah", 25:"Lamentations", 26:"Ezekiel", 27:"Daniel",
    28:"Hosea", 29:"Joel", 30:"Amos", 31:"Obadiah", 32:"Jonah",
    33:"Micah", 34:"Nahum", 35:"Habakkuk", 36:"Zephaniah", 37:"Haggai",
    38:"Zechariah", 39:"Malachi", 40:"Matthew", 41:"Mark", 42:"Luke",
    43:"John", 44:"Acts", 45:"Romans", 46:"1 Corinthians",
    47:"2 Corinthians", 48:"Galatians", 49:"Ephesians", 50:"Philippians",
    51:"Colossians", 52:"1 Thessalonians", 53:"2 Thessalonians",
    54:"1 Timothy", 55:"2 Timothy", 56:"Titus", 57:"Philemon",
    58:"Hebrews", 59:"James", 60:"1 Peter", 61:"2 Peter", 62:"1 John",
    63:"2 John", 64:"3 John", 65:"Jude", 66:"Revelation",
}

RIPV_VERSION = 782
SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/122.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
})
_chapter_cache: dict[tuple, dict[int, str]] = {}


def fetch_chapter(book_num: int, ch_num: int) -> dict[int, str]:
    """Fetch a full RIPV chapter from Bible.com. Returns {verse_num: text}."""
    key = (book_num, ch_num)
    if key in _chapter_cache:
        return _chapter_cache[key]

    abbr = BOOK_ABBR[book_num]
    url = f"https://www.bible.com/bible/{RIPV_VERSION}/{abbr}.{ch_num}.RIPV"

    for attempt in range(3):
        try:
            resp = SESSION.get(url, timeout=20)
            if resp.status_code == 200:
                break
            if resp.status_code == 429:
                wait = int(resp.headers.get("Retry-After", 15)) + 2
                print(f"    [RATE-LIMIT] sleeping {wait}s …", flush=True)
                time.sleep(wait)
        except requests.RequestException as exc:
            print(f"    [WARN] attempt {attempt+1}: {exc}")
            time.sleep(4)
    else:
        _chapter_cache[key] = {}
        return {}

    soup = BeautifulSoup(resp.text, "html.parser")
    verses: dict[int, str] = {}

    for span in soup.find_all(attrs={"data-usfm": True}):
        usfm = span.get("data-usfm", "")
        if usfm.count(".") < 2:
            continue

        # Collect only __content class children (skip __label, __note, __x)
        content_parts = []
        for child in span.find_all(True):
            classes = " ".join(child.get("class", []))
            if re.search(r"__content\b", classes):
                t = child.get_text(" ", strip=True)
                if t:
                    content_parts.append(t)

        if not content_parts:
            raw = span.get_text(" ", strip=True)
            raw = re.sub(r"^\d+(?:-\d+)?\s+", "", raw)
            raw = re.sub(r"\s+", " ", raw).strip()
            if raw:
                content_parts = [raw]

        raw_text = " ".join(content_parts)
        raw_text = re.sub(r"\s+", " ", raw_text).strip()
        if not raw_text:
            continue

        usfm_parts = usfm.split("+")
        verse_nums: list[int] = []
        for part in usfm_parts:
            segs = part.split(".")
            if len(segs) >= 3:
                try:
                    verse_nums.append(int(segs[2]))
                except ValueError:
                    pass

        for v in verse_nums:
            if v not in verses:
                verses[v] = raw_text

    _chapter_cache[key] = verses
    time.sleep(0.5)
    return verses


# ─────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db",     default="ilocano.db")
    parser.add_argument("--ref-db", default="cebuano-scriptures-sqlite.db")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    db_path  = Path(args.db)
    ref_path = Path(args.ref_db)
    for p in (db_path, ref_path):
        if not p.exists():
            sys.exit(f"[ERROR] File not found: {p}")

    # ── 1. Load the 31,102 standard positions from the reference DB ──────────
    print(f"[INFO] Loading standard positions from {ref_path} …")
    ref_con = sqlite3.connect(ref_path)
    ref_cur = ref_con.cursor()
    std_positions: dict[tuple, int] = {}   # (book_id, ch, v) -> verse_id
    for bid, ch, v, vid in ref_cur.execute("""
        SELECT b.id, c.chapter_number, ve.verse_number, ve.id
        FROM volumes vl
        JOIN books b ON b.volume_id = vl.id
        JOIN chapters c ON c.book_id = b.id
        JOIN verses ve ON ve.chapter_id = c.id
        WHERE vl.id = 1
        ORDER BY ve.id
    """).fetchall():
        std_positions[(bid, ch, v)] = vid
    ref_con.close()
    print(f"[INFO] Standard positions loaded: {len(std_positions)}")

    # ── 2. Load existing ilocano.db positions ────────────────────────────────
    ilo_con = sqlite3.connect(db_path)
    ilo_con.execute("PRAGMA journal_mode=WAL;")
    ilo_cur = ilo_con.cursor()

    ilo_positions: set[tuple] = set()
    for b, c, v in ilo_cur.execute(
        "SELECT DISTINCT bookNum, chNum, verseNum FROM words"
    ).fetchall():
        ilo_positions.add((b, c, v))
    print(f"[INFO] Ilocano unique positions: {len(ilo_positions)}")

    missing = sorted(
        [(b, c, v) for (b, c, v) in std_positions if (b, c, v) not in ilo_positions]
    )
    print(f"[INFO] Missing positions: {len(missing)}")

    # ── 3. Identify French-duplicate rows to DELETE ──────────────────────────
    print("[INFO] Finding French-duplicate rows in books 61-66 …")
    dupes_to_delete = []
    rows = ilo_cur.execute("""
        SELECT bookNum, chNum, verseNum, MIN(wordId) as keep_id
        FROM words
        GROUP BY bookNum, chNum, verseNum
        HAVING COUNT(*) > 1
    """).fetchall()
    for b, c, v, keep_id in rows:
        # Fetch all wordIds for this position, delete everything except keep_id
        all_ids = [r[0] for r in ilo_cur.execute(
            "SELECT wordId FROM words WHERE bookNum=? AND chNum=? AND verseNum=?",
            (b, c, v)
        ).fetchall()]
        for wid in all_ids:
            if wid != keep_id:
                dupes_to_delete.append(wid)
    print(f"[INFO] French-duplicate rows to delete: {len(dupes_to_delete)}")

    # ── 4. Fetch missing verses from RIPV ────────────────────────────────────
    print(f"[INFO] Fetching {len(missing)} missing verse positions from RIPV …")
    inserts: list[tuple] = []    # (bookNum, chNum, verseNum, text)
    still_missing: list[tuple] = []

    for idx, (b, c, v) in enumerate(missing, 1):
        ref = f"{BOOK_NAMES.get(b, f'book{b}')} {c}:{v}"
        print(f"  [{idx:3d}/{len(missing)}] {ref} …", end=" ", flush=True)
        ch_verses = fetch_chapter(b, c)
        if v in ch_verses:
            txt = ch_verses[v]
            print(f"FOUND: {txt[:60]!r}")
            inserts.append((b, c, v, txt))
        else:
            print("ABSENT")
            still_missing.append((b, c, v))
            inserts.append((b, c, v, ""))  # insert empty placeholder to hold the position

    # ── 5. Compute the next wordId to use for insertions ─────────────────────
    max_wid = ilo_cur.execute("SELECT MAX(wordId) FROM words").fetchone()[0] or 0

    # ── 6. Apply changes ─────────────────────────────────────────────────────
    if args.dry_run:
        print("\n[DRY-RUN] No changes written.")
        ilo_con.close()
        return

    try:
        ilo_con.execute("BEGIN;")

        # Delete French duplicate rows
        if dupes_to_delete:
            ilo_cur.executemany(
                "DELETE FROM words WHERE wordId = ?",
                [(wid,) for wid in dupes_to_delete],
            )
            print(f"[OK]  Deleted {len(dupes_to_delete)} French-duplicate rows.")

        # Insert missing verse positions
        if inserts:
            for i, (b, c, v, txt) in enumerate(inserts):
                max_wid += 1
                ilo_cur.execute(
                    "INSERT INTO words (wordId, word, bookNum, chNum, verseNum) VALUES (?,?,?,?,?)",
                    (max_wid, txt, b, c, v),
                )
            print(f"[OK]  Inserted {len(inserts)} missing position(s).")

        ilo_con.execute("COMMIT;")
    except Exception as exc:
        ilo_con.execute("ROLLBACK;")
        ilo_con.close()
        sys.exit(f"[ERROR] Rolled back: {exc}")

    # ── 7. Verify ─────────────────────────────────────────────────────────────
    new_unique = ilo_cur.execute(
        "SELECT COUNT(*) FROM (SELECT DISTINCT bookNum, chNum, verseNum FROM words)"
    ).fetchone()[0]
    new_total = ilo_cur.execute("SELECT COUNT(*) FROM words").fetchone()[0]

    print(f"\n[VERIFY] Unique verse positions: {new_unique}  (target: 31102)")
    print(f"[VERIFY] Total rows:             {new_total}")
    if still_missing:
        print(f"[INFO]  {len(still_missing)} positions absent in RIPV — inserted as empty placeholders")

    ilo_con.close()
    print("[DONE] ilocano.db is ready for re-migration.")


if __name__ == "__main__":
    main()
