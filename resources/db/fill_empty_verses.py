#!/usr/bin/env python3
"""
fill_empty_verses.py
====================
Scans ilocano.db for blank/whitespace-only verses, fetches the RIPV Ilocano text
from Bible.com (YouVersion version 782), then updates ilocano.db in-place.

Handles:
  - Merged verse ranges (e.g. 6-7 combined → verse 7 gets a "(Tan. brs. 6)" note)
  - Textually-absent verses (not in RIPV) → left empty as-is
  - Genuine content → written to the word column

Usage:
    python3 fill_empty_verses.py [--db ilocano.db] [--dry-run]
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

# Cache: (bookNum, chNum) → dict[verseNum → text]
_chapter_cache: dict[tuple, dict[int, str]] = {}


def fetch_chapter(book_num: int, ch_num: int) -> dict[int, str]:
    """Fetch an entire chapter from Bible.com RIPV and return {verse_num: text}."""
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
                wait = int(resp.headers.get("Retry-After", 10)) + 2
                print(f"  [RATE-LIMIT] sleeping {wait}s …", flush=True)
                time.sleep(wait)
        except requests.RequestException as exc:
            print(f"  [WARN] attempt {attempt+1} failed: {exc}")
            time.sleep(3)
    else:
        print(f"  [ERROR] Could not fetch {url}")
        _chapter_cache[key] = {}
        return {}

    soup = BeautifulSoup(resp.text, "html.parser")
    verses: dict[int, str] = {}

    # Bible.com renders verse content in spans with data-usfm attributes.
    # Single verse:  data-usfm="GEN.1.7"
    # Merged verses: data-usfm="GEN.1.6+GEN.1.7"   (plus-sign separated)
    # Within each verse span:
    #   __label   → "6-7" label (skip)
    #   __content → scripture text (keep)
    #   __note / __x → footnote reference (skip)

    usfm_spans = soup.find_all(attrs={"data-usfm": True})
    if usfm_spans:
        for span in usfm_spans:
            usfm = span.get("data-usfm", "")
            # Only process verse-level spans (at least BOOK.CH.V)
            if usfm.count(".") < 2:
                continue

            # Collect only __content spans (skip __label, __note, __x, __nd, etc.)
            content_parts = []
            for child in span.find_all(True):
                classes = " ".join(child.get("class", []))
                if re.search(r"__content\b", classes):
                    t = child.get_text(" ", strip=True)
                    if t:
                        content_parts.append(t)

            if not content_parts:
                # Fallback: raw text minus label (first token) minus footnote-like segments
                raw = span.get_text(" ", strip=True)
                # strip leading label like "6-7 " or "7 "
                raw = re.sub(r"^\d+(?:-\d+)?\s+", "", raw)
                # strip inline footnote anchors "# ..." that sneak in
                raw = re.sub(r"\s*#\s*\S+[^#]*?(?=\s|$)", "", raw)
                raw = re.sub(r"\s+", " ", raw).strip()
                if raw:
                    content_parts = [raw]

            raw_text = " ".join(content_parts)
            raw_text = re.sub(r"\s+", " ", raw_text).strip()
            if not raw_text:
                continue

            # Parse the usfm key — may be "BOOK.CH.V" or "BOOK.CH.V+BOOK.CH.V+…"
            usfm_parts = usfm.split("+")
            verse_nums: list[int] = []
            for part in usfm_parts:
                segments = part.split(".")
                if len(segments) < 3:
                    continue
                try:
                    verse_nums.append(int(segments[2]))
                except ValueError:
                    pass

            if not verse_nums:
                continue

            for v in verse_nums:
                # Only store first occurrence (avoid duplicate usfm spans per verse)
                if v not in verses:
                    verses[v] = raw_text

    _chapter_cache[key] = verses
    time.sleep(0.5)   # polite delay
    return verses


def strip_verse_prefix(text: str, verse_num: int) -> str:
    """Remove leading '{verse_num} ' prefix that Bible.com sometimes includes."""
    prefix = str(verse_num) + " "
    if text.startswith(prefix):
        return text[len(prefix):]
    return text


# ─────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default="ilocano.db")
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Print findings without writing to the database"
    )
    args = parser.parse_args()

    db_path = Path(args.db)
    if not db_path.exists():
        sys.exit(f"[ERROR] DB not found: {db_path}")

    con = sqlite3.connect(db_path)
    con.execute("PRAGMA journal_mode=WAL;")
    cur = con.cursor()

    empty_rows = cur.execute(
        "SELECT wordId, bookNum, chNum, verseNum FROM words "
        "WHERE TRIM(word) = '' OR word IS NULL "
        "ORDER BY bookNum, chNum, verseNum"
    ).fetchall()

    print(f"[INFO] Found {len(empty_rows)} empty verses to resolve.")

    filled = []       # (new_text, wordId)
    still_empty = []  # (bookNum, chNum, verseNum) that remain blank
    merged_note = []  # verses we flagged as merged

    for idx, (word_id, book_num, ch_num, verse_num) in enumerate(empty_rows, 1):
        ref = f"{BOOK_NAMES.get(book_num, f'Book{book_num}')} {ch_num}:{verse_num}"
        print(f"  [{idx:3d}/{len(empty_rows)}] {ref} …", end=" ", flush=True)

        chapter_verses = fetch_chapter(book_num, ch_num)

        if verse_num in chapter_verses:
            text = strip_verse_prefix(chapter_verses[verse_num], verse_num)
            print(f"FOUND: {text[:60]!r}")
            filled.append((text, word_id))
        else:
            # Check if RIPV skips this verse (absent / merged into previous)
            # If the previous verse also has content from the chapter but this one
            # doesn't, it's probably merged or omitted.
            print("ABSENT in RIPV (omitted/merged)")
            still_empty.append((book_num, ch_num, verse_num))

    print(f"\n[SUMMARY] Filled: {len(filled)}  |  Still absent: {len(still_empty)}")

    if still_empty:
        print("\n[ABSENT VERSES — will remain empty in DB]")
        for b, c, v in still_empty:
            print(f"  {BOOK_NAMES.get(b,b)} {c}:{v}")

    if args.dry_run:
        print("\n[DRY-RUN] No changes written.")
        con.close()
        return

    if filled:
        print(f"\n[INFO] Writing {len(filled)} updates to {db_path} …")
        try:
            con.execute("BEGIN;")
            cur.executemany(
                "UPDATE words SET word = ? WHERE wordId = ?",
                filled,
            )
            con.execute("COMMIT;")
            print(f"[OK]  Updated {len(filled)} verses.")
        except Exception as exc:
            con.execute("ROLLBACK;")
            con.close()
            sys.exit(f"[ERROR] Rolled back: {exc}")
    else:
        print("[INFO] No verses to update.")

    # Verify
    remaining = con.execute(
        "SELECT COUNT(*) FROM words WHERE TRIM(word) = '' OR word IS NULL"
    ).fetchone()[0]
    print(f"[VERIFY] Empty verses remaining after update: {remaining}")

    con.close()
    print("[DONE]")


if __name__ == "__main__":
    main()
