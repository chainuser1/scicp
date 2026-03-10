#!/usr/bin/env python3
"""
scrape_waray_aligned.py
=======================
Builds a KJV-aligned Waray scripture database.

Sources
-------
  Bible (OT + NT) : beblia.com — Samarenyo Bible (1984)
                    URL: https://beblia.com/Bible?Language=Waray&Book={n}&Chapter={n}
                    Requires Playwright + Chromium (Blazor SPA, JS-rendered)
                    Verse element: <span class="verseTextText" id="VerseText{N}">
  Triple Combo    : Church of Jesus Christ website (lang=war)
                    URL: https://www.churchofjesuschrist.org/study/scriptures/...?lang=war
                    All 21 books (BoM + D&C + PGP) are attempted; verses not found
                    in the Waray source receive "missing" as the placeholder text.

Alignment
---------
  The KJV DB is used as the TEMPLATE — exactly 41,995 rows with the same
  verse_ids as the KJV DB.  Any verse not found in the Waray source receives
  "missing" as its scripture_text.

Setup
-----
  python3 -m playwright install chromium   # one-time
  pip install beautifulsoup4 requests       # if not already installed

Usage
-----
  python3 scrape_waray_aligned.py
  python3 scrape_waray_aligned.py --resume
  python3 scrape_waray_aligned.py --bible-only
  python3 scrape_waray_aligned.py --triple-only --resume
  python3 scrape_waray_aligned.py --no-fts

Options
-------
  --delay N       Seconds between page loads  (default: 1.5)
  --retries N     Max retries per page        (default: 4)
  --resume        Skip chapters already in the raw cache
  --bible-only    Scrape Bible (volumes 1-2) only
  --triple-only   Scrape Triple Combo (volumes 3-5) only; implies --resume
  --no-fts        Skip building the FTS5 index
  --raw-cache F   Path to JSON raw-text cache (default: war_raw_cache.json)
  --output F      Output DB path             (default: waray-scriptures-sqlite.db)
  --kjv-db F      Path to KJV reference DB   (default: lds-scriptures-sqlite.db)
  --missing T     Placeholder for unavailable verses (default: missing)
"""

import argparse
import json
import re
import sqlite3
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    sys.exit("[ERROR] Run: pip install requests beautifulsoup4")

try:
    from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
    _PLAYWRIGHT_OK = True
except ImportError:
    _PLAYWRIGHT_OK = False


# ──────────────────────────────────────────────────────────────────────────────
# 1.  Book lists
# ──────────────────────────────────────────────────────────────────────────────

BIBLE_BOOKS: List[Dict] = [
    {"id":  1, "slug": "gen",   "chapters":  50},
    {"id":  2, "slug": "ex",    "chapters":  40},
    {"id":  3, "slug": "lev",   "chapters":  27},
    {"id":  4, "slug": "num",   "chapters":  36},
    {"id":  5, "slug": "deut",  "chapters":  34},
    {"id":  6, "slug": "josh",  "chapters":  24},
    {"id":  7, "slug": "judg",  "chapters":  21},
    {"id":  8, "slug": "ruth",  "chapters":   4},
    {"id":  9, "slug": "1-sam", "chapters":  31},
    {"id": 10, "slug": "2-sam", "chapters":  24},
    {"id": 11, "slug": "1-kgs", "chapters":  22},
    {"id": 12, "slug": "2-kgs", "chapters":  25},
    {"id": 13, "slug": "1-chr", "chapters":  29},
    {"id": 14, "slug": "2-chr", "chapters":  36},
    {"id": 15, "slug": "ezra",  "chapters":  10},
    {"id": 16, "slug": "neh",   "chapters":  13},
    {"id": 17, "slug": "esth",  "chapters":  10},
    {"id": 18, "slug": "job",   "chapters":  42},
    {"id": 19, "slug": "ps",    "chapters": 150},
    {"id": 20, "slug": "prov",  "chapters":  31},
    {"id": 21, "slug": "eccl",  "chapters":  12},
    {"id": 22, "slug": "song",  "chapters":   8},
    {"id": 23, "slug": "isa",   "chapters":  66},
    {"id": 24, "slug": "jer",   "chapters":  52},
    {"id": 25, "slug": "lam",   "chapters":   5},
    {"id": 26, "slug": "ezek",  "chapters":  48},
    {"id": 27, "slug": "dan",   "chapters":  12},
    {"id": 28, "slug": "hosea", "chapters":  14},
    {"id": 29, "slug": "joel",  "chapters":   3},
    {"id": 30, "slug": "amos",  "chapters":   9},
    {"id": 31, "slug": "obad",  "chapters":   1},
    {"id": 32, "slug": "jonah", "chapters":   4},
    {"id": 33, "slug": "micah", "chapters":   7},
    {"id": 34, "slug": "nahum", "chapters":   3},
    {"id": 35, "slug": "hab",   "chapters":   3},
    {"id": 36, "slug": "zeph",  "chapters":   3},
    {"id": 37, "slug": "hag",   "chapters":   2},
    {"id": 38, "slug": "zech",  "chapters":  14},
    {"id": 39, "slug": "mal",   "chapters":   4},
    {"id": 40, "slug": "matt",  "chapters":  28},
    {"id": 41, "slug": "mark",  "chapters":  16},
    {"id": 42, "slug": "luke",  "chapters":  24},
    {"id": 43, "slug": "john",  "chapters":  21},
    {"id": 44, "slug": "acts",  "chapters":  28},
    {"id": 45, "slug": "rom",   "chapters":  16},
    {"id": 46, "slug": "1-cor", "chapters":  16},
    {"id": 47, "slug": "2-cor", "chapters":  13},
    {"id": 48, "slug": "gal",   "chapters":   6},
    {"id": 49, "slug": "eph",   "chapters":   6},
    {"id": 50, "slug": "philip","chapters":   4},
    {"id": 51, "slug": "col",   "chapters":   4},
    {"id": 52, "slug": "1-thes","chapters":   5},
    {"id": 53, "slug": "2-thes","chapters":   3},
    {"id": 54, "slug": "1-tim", "chapters":   6},
    {"id": 55, "slug": "2-tim", "chapters":   4},
    {"id": 56, "slug": "titus", "chapters":   3},
    {"id": 57, "slug": "philem","chapters":   1},
    {"id": 58, "slug": "heb",   "chapters":  13},
    {"id": 59, "slug": "james", "chapters":   5},
    {"id": 60, "slug": "1-pet", "chapters":   5},
    {"id": 61, "slug": "2-pet", "chapters":   3},
    {"id": 62, "slug": "1-jn",  "chapters":   5},
    {"id": 63, "slug": "2-jn",  "chapters":   1},
    {"id": 64, "slug": "3-jn",  "chapters":   1},
    {"id": 65, "slug": "jude",  "chapters":   1},
    {"id": 66, "slug": "rev",   "chapters":  22},
]

# Full Triple Combination — BoM + D&C + PGP.
# All books are attempted from LDS website (lang=war).
# Verses not found will receive the missing placeholder.
TRIPLE_BOOKS: List[Dict] = [
    # Book of Mormon
    {"id": 67, "lds_url": "bofm/1-ne",   "chapters": 22},
    {"id": 68, "lds_url": "bofm/2-ne",   "chapters": 33},
    {"id": 69, "lds_url": "bofm/jacob",  "chapters":  7},
    {"id": 70, "lds_url": "bofm/enos",   "chapters":  1},
    {"id": 71, "lds_url": "bofm/jarom",  "chapters":  1},
    {"id": 72, "lds_url": "bofm/omni",   "chapters":  1},
    {"id": 73, "lds_url": "bofm/w-of-m", "chapters":  1},
    {"id": 74, "lds_url": "bofm/mosiah", "chapters": 29},
    {"id": 75, "lds_url": "bofm/alma",   "chapters": 63},
    {"id": 76, "lds_url": "bofm/hel",    "chapters": 16},
    {"id": 77, "lds_url": "bofm/3-ne",   "chapters": 30},
    {"id": 78, "lds_url": "bofm/4-ne",   "chapters":  1},
    {"id": 79, "lds_url": "bofm/morm",   "chapters":  9},
    {"id": 80, "lds_url": "bofm/ether",  "chapters": 15},
    {"id": 81, "lds_url": "bofm/moro",   "chapters": 10},
    # Doctrine and Covenants
    {"id": 82, "lds_url": "dc-testament/dc", "chapters": 138},
    # Pearl of Great Price
    {"id": 83, "lds_url": "pgp/moses",   "chapters":  8},
    {"id": 84, "lds_url": "pgp/abr",     "chapters":  5},
    {"id": 85, "lds_url": "pgp/js-m",    "chapters":  1},
    {"id": 86, "lds_url": "pgp/js-h",    "chapters":  1},
    {"id": 87, "lds_url": "pgp/a-of-f",  "chapters":  1},
]

BEBLIA_BASE = "https://beblia.com/Bible"
LDS_BASE    = "https://www.churchofjesuschrist.org/study/scriptures"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


# ──────────────────────────────────────────────────────────────────────────────
# 2.  Parsers
# ──────────────────────────────────────────────────────────────────────────────

def parse_beblia_chapter(html: str) -> Dict[int, str]:
    """
    Parse a rendered beblia.com chapter page.

    Structure:
      <span class="verseTextText" id="VerseText{N}"
            title="BookName Ch:VNum - verse text - Waray Bible 1984">
        verse text
      </span>

    Verse number is extracted from the title attribute ("Ch:VNum") so that
    Psalm-heading verses (which have a different Chapter:Verse reference) are
    correctly identified rather than relying on a sequential VerseText{N} index.
    """
    soup = BeautifulSoup(html, "html.parser")
    result: Dict[int, str] = {}
    for span in soup.find_all("span", class_="verseTextText"):
        title = span.get("title", "")
        # title format: "Genesis 1:1 - text here - Waray Bible 1984"
        m = re.search(r"\b\d+:(\d+)\b", title)
        if not m:
            continue
        vnum = int(m.group(1))
        if vnum <= 0:
            continue
        text = " ".join(span.get_text(" ").split()).strip()
        # Fallback: extract text from title if inner text is empty
        if not text:
            tm = re.match(r".+?\s+\d+:\d+\s+-\s+(.+?)\s+-\s+", title)
            if tm:
                text = tm.group(1).strip()
        if text:
            result[vnum] = text
    return result


def parse_lds_chapter(html: str) -> Dict[int, str]:
    """
    Parse a churchofjesuschrist.org chapter page (lang=war).

    Structure mirrors Japanese — <p class="verse"> with
    <span class="verse-number">{N}</span> as the first child.
    """
    soup = BeautifulSoup(html, "html.parser")
    result: Dict[int, str] = {}

    verse_tags = soup.find_all("p", class_="verse")
    if not verse_tags:
        return result

    for v in verse_tags:
        vnum_span = v.find("span", class_="verse-number")
        if not vnum_span:
            continue
        m = re.search(r"\d+", vnum_span.get_text())
        if not m:
            continue
        vnum = int(m.group())
        if vnum <= 0:
            continue
        vnum_span.decompose()

        # Strip footnote markers
        for sup in v.find_all("sup", class_="marker"):
            sup.decompose()
        # Unwrap study-note anchors
        for a in v.find_all("a"):
            a.unwrap()

        text = " ".join(v.get_text("").split()).strip()
        if text:
            result[vnum] = text

    return result


# ──────────────────────────────────────────────────────────────────────────────
# 3.  HTTP helper (requests — LDS only)
# ──────────────────────────────────────────────────────────────────────────────

def fetch_http(url: str, params: dict, session: requests.Session,
               delay: float, retries: int) -> Optional[str]:
    for attempt in range(1, retries + 1):
        try:
            resp = session.get(url, params=params, headers=HEADERS, timeout=25)
            if resp.status_code == 200:
                resp.encoding = "utf-8"
                time.sleep(delay)
                return resp.text
            if resp.status_code == 404:
                return None
            print(f"  [HTTP {resp.status_code}] attempt {attempt}/{retries}")
        except requests.RequestException as exc:
            print(f"  [ERR] {exc}  attempt {attempt}/{retries}")
        time.sleep(delay * (2 ** attempt))
    print(f"  [FAIL] {url}")
    return None


# ──────────────────────────────────────────────────────────────────────────────
# 4.  Playwright scraper — beblia.com Bible
# ──────────────────────────────────────────────────────────────────────────────

RawCache = Dict[str, Dict[int, str]]


def scrape_bible_beblia(raw_cache: RawCache, delay: float,
                        retries: int, resume: bool) -> None:
    if not _PLAYWRIGHT_OK:
        sys.exit(
            "[ERROR] Playwright not importable.\n"
            "  Run: python3 -m playwright install chromium"
        )

    print("\n═══════════════════════════════════════")
    print("  Scraping Bible from beblia.com (Samarenyo Bible 1984)")
    print("═══════════════════════════════════════")

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        ctx     = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            )
        )
        page = ctx.new_page()

        for book in BIBLE_BOOKS:
            bid = book["id"]
            for ch in range(1, book["chapters"] + 1):
                key = f"bible:{bid}:{ch}"
                if resume and key in raw_cache:
                    continue

                url  = BEBLIA_BASE
                qstr = f"Language=Waray&Book={bid}&Chapter={ch}"
                full_url = f"{url}?{qstr}"

                print(f"  Book {bid} ch {ch} …", end=" ", flush=True)

                verses: Dict[int, str] = {}
                for attempt in range(1, retries + 1):
                    try:
                        page.goto(full_url, timeout=30000,
                                  wait_until="domcontentloaded")
                        # Wait for at least one verse span to load
                        page.wait_for_selector(
                            "span.verseTextText", timeout=20000
                        )
                        html   = page.content()
                        verses = parse_beblia_chapter(html)
                        break
                    except PWTimeout:
                        # Chapter may not exist in Waray — check for title
                        try:
                            title = page.title()
                        except Exception:
                            title = ""
                        if "Beblia" in title:
                            print(f"[TIMEOUT attempt {attempt}]", end=" ")
                            time.sleep(delay * attempt)
                        else:
                            break
                    except Exception as exc:
                        print(f"[ERR {exc} attempt {attempt}]", end=" ")
                        time.sleep(delay * attempt)

                raw_cache[key] = verses
                print(f"{len(verses)} verses")
                time.sleep(delay)

        browser.close()


# ──────────────────────────────────────────────────────────────────────────────
# 5.  LDS scraper — Waray BoM (selected chapters only)
# ──────────────────────────────────────────────────────────────────────────────

def scrape_triple_lds(raw_cache: RawCache, session: requests.Session,
                      delay: float, retries: int, resume: bool) -> None:
    print("\n═══════════════════════════════════════")
    print("  Scraping Triple Combination from LDS website (lang=war)")
    print("  (BoM + D&C + PGP — verses not found will use the missing placeholder)")
    print("═══════════════════════════════════════")

    for book in TRIPLE_BOOKS:
        for ch in range(1, book["chapters"] + 1):
            key = f"lds:{book['lds_url'].split('/')[-1]}:{ch}"
            if resume and key in raw_cache:
                continue

            url = f"{LDS_BASE}/{book['lds_url']}/{ch}"
            print(f"  {book['lds_url']} {ch} …", end=" ", flush=True)

            html = fetch_http(url, {"lang": "war"}, session, delay, retries)
            if not html:
                print("SKIP (HTTP fail)")
                raw_cache[key] = {}
                continue

            verses = parse_lds_chapter(html)
            raw_cache[key] = verses
            if verses:
                print(f"{len(verses)} verses")
            else:
                print("0 verses (not available in Waray)")


# ──────────────────────────────────────────────────────────────────────────────
# 6.  DB schema  (identical to other language DBs)
# ──────────────────────────────────────────────────────────────────────────────

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS volumes (
    id                INTEGER PRIMARY KEY,
    volume_title      TEXT,
    volume_long_title TEXT,
    volume_subtitle   TEXT,
    volume_short_title TEXT,
    volume_lds_url    TEXT
);
CREATE TABLE IF NOT EXISTS books (
    id               INTEGER PRIMARY KEY,
    volume_id        INTEGER REFERENCES volumes(id),
    book_title       TEXT,
    book_long_title  TEXT,
    book_subtitle    TEXT,
    book_short_title TEXT,
    book_lds_url     TEXT
);
CREATE TABLE IF NOT EXISTS chapters (
    id             INTEGER PRIMARY KEY,
    book_id        INTEGER REFERENCES books(id),
    chapter_number INTEGER
);
CREATE TABLE IF NOT EXISTS verses (
    id             INTEGER PRIMARY KEY,
    chapter_id     INTEGER REFERENCES chapters(id),
    verse_number   INTEGER,
    scripture_text TEXT
);
CREATE VIEW IF NOT EXISTS scriptures AS
SELECT
    volumes.id AS volume_id,
    books.id   AS book_id,
    chapters.id AS chapter_id,
    verses.id  AS verse_id,
    volume_title, book_title,
    volume_long_title, book_long_title,
    volume_subtitle, book_subtitle,
    volume_short_title, book_short_title,
    volume_lds_url, book_lds_url,
    chapter_number, verse_number, scripture_text,
    book_title || ' ' || chapter_number || ':' || verse_number AS verse_title,
    book_short_title || ' ' || chapter_number || ':' || verse_number AS verse_short_title
FROM volumes
INNER JOIN books    ON books.volume_id   = volumes.id
INNER JOIN chapters ON chapters.book_id  = books.id
INNER JOIN verses   ON verses.chapter_id = chapters.id
ORDER BY volumes.id, books.id, chapters.id, verses.id;
"""

FTS_SQL = """
CREATE VIRTUAL TABLE IF NOT EXISTS scriptures_fts USING fts5(
    scripture_text, verse_title,
    content='scriptures', content_rowid='verse_id'
);
INSERT INTO scriptures_fts(rowid, scripture_text, verse_title)
    SELECT verse_id, scripture_text, verse_title FROM scriptures;
"""

VOLUME_META = {
    1: ("Bugna Version (Samarenyo)", "Bugna Version — Samarenyo Bible (1984)", "", "Sam.", "ot"),
    2: ("Bagong Tipan (Samarenyo)",  "Bagong Tipan — Samarenyo Bible (1984)", "", "Sam. NT", "nt"),
    3: ("Libro ni Mormon",  "Libro ni Mormon", "Lain pa nga Saksi ni Jesukristo", "LNM", "bofm"),
    4: ("Doktrina ug mga Pakigsaad", "Doktrina ug mga Pakigsaad", "", "D&P", "dc-testament"),
    5: ("Mahalon nga Perlas", "Mahalon nga Perlas", "", "MP", "pgp"),
}


# ──────────────────────────────────────────────────────────────────────────────
# 7.  Build aligned DB
# ──────────────────────────────────────────────────────────────────────────────

def build_db(kjv_db_path: str, raw_cache: RawCache,
             output_path: str, fts: bool, missing: str) -> None:
    print("\n═══════════════════════════════════════")
    print(f"  Building aligned DB: {output_path}")
    print(f"  Missing-verse placeholder: '{missing}'")
    print("═══════════════════════════════════════")

    kjv = sqlite3.connect(kjv_db_path)
    kjv.row_factory = sqlite3.Row
    out = sqlite3.connect(output_path)
    out.executescript(SCHEMA_SQL)
    out.commit()

    # Volumes
    for vid, (title, long_title, subtitle, short_title, lds_url) in VOLUME_META.items():
        out.execute(
            "INSERT OR IGNORE INTO volumes VALUES (?,?,?,?,?,?)",
            (vid, title, long_title, subtitle, short_title, lds_url),
        )

    # Books (copy from KJV)
    for row in kjv.execute("SELECT * FROM books ORDER BY id"):
        out.execute(
            "INSERT OR IGNORE INTO books VALUES (?,?,?,?,?,?,?)",
            (row["id"], row["volume_id"], row["book_title"], row["book_long_title"],
             row["book_subtitle"], row["book_short_title"], row["book_lds_url"]),
        )

    # Chapters (copy from KJV)
    for chap in kjv.execute("SELECT * FROM chapters ORDER BY id"):
        out.execute(
            "INSERT OR IGNORE INTO chapters VALUES (?,?,?)",
            (chap["id"], chap["book_id"], chap["chapter_number"]),
        )

    # Build cache key prefix map
    bible_prefix:  Dict[int, str] = {b["id"]: f"bible:{b['id']}" for b in BIBLE_BOOKS}
    triple_prefix: Dict[int, str] = {
        b["id"]: f"lds:{b['lds_url'].split('/')[-1]}" for b in TRIPLE_BOOKS
    }

    total = 0
    missing_count = 0
    batch = []

    kjv_verses = kjv.execute(
        """
        SELECT verses.id, verses.chapter_id, verses.verse_number,
               chapters.chapter_number, chapters.book_id
        FROM verses
        JOIN chapters ON chapters.id = verses.chapter_id
        ORDER BY verses.id
        """
    ).fetchall()

    for v in kjv_verses:
        total += 1
        bid  = v["book_id"]
        ch_n = v["chapter_number"]
        v_n  = v["verse_number"]

        if bid in bible_prefix:
            key = f"{bible_prefix[bid]}:{ch_n}"
        elif bid in triple_prefix:
            key = f"{triple_prefix[bid]}:{ch_n}"
        else:
            key = ""
        chapter_data = raw_cache.get(key, {})
        text = chapter_data.get(v_n, "")
        if not text:
            text = missing
            missing_count += 1

        batch.append((v["id"], v["chapter_id"], v_n, text))
        if len(batch) >= 500:
            out.executemany("INSERT OR IGNORE INTO verses VALUES (?,?,?,?)", batch)
            batch.clear()

    if batch:
        out.executemany("INSERT OR IGNORE INTO verses VALUES (?,?,?,?)", batch)
    out.commit()

    print(f"  Wrote {total} verses  ({missing_count} marked '{missing}')")

    if fts:
        print("  Building FTS5 index …")
        out.executescript(FTS_SQL)
        out.commit()
        print("  FTS5 done.")

    kjv.close()
    out.close()
    print(f"\n  ✓  Database written to  {output_path}")


# ──────────────────────────────────────────────────────────────────────────────
# 8.  Main
# ──────────────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--delay",       type=float, default=1.5)
    parser.add_argument("--retries",     type=int,   default=4)
    parser.add_argument("--resume",      action="store_true")
    parser.add_argument("--bible-only",  action="store_true")
    parser.add_argument("--triple-only", action="store_true")
    parser.add_argument("--no-fts",      action="store_true")
    parser.add_argument("--raw-cache",   default="war_raw_cache.json")
    parser.add_argument("--output",      default="waray-scriptures-sqlite.db")
    parser.add_argument("--kjv-db",      default="lds-scriptures-sqlite.db")
    parser.add_argument("--missing",     default="missing")
    args = parser.parse_args()

    db_dir         = Path(__file__).parent
    output_path    = str(db_dir / args.output)
    kjv_db_path    = str(db_dir / args.kjv_db)
    raw_cache_path = str(db_dir / args.raw_cache)

    if not Path(kjv_db_path).exists():
        sys.exit(f"[ERROR] KJV DB not found: {kjv_db_path}")

    raw_cache: RawCache = {}
    if Path(raw_cache_path).exists():
        print(f"Loading raw cache from {raw_cache_path} …")
        with open(raw_cache_path, "r", encoding="utf-8") as f:
            raw = json.load(f)
        raw_cache = {k: {int(vk): vv for vk, vv in v.items()} for k, v in raw.items()}
        print(f"  {len(raw_cache)} chapters already cached.")

    session = requests.Session()
    session.headers.update(HEADERS)

    do_bible  = not args.triple_only
    do_triple = not args.bible_only
    resume    = args.resume or args.triple_only

    def save_cache():
        with open(raw_cache_path, "w", encoding="utf-8") as f:
            json.dump(raw_cache, f, ensure_ascii=False)
        print(f"  Raw cache saved → {raw_cache_path}")

    try:
        if do_bible:
            scrape_bible_beblia(raw_cache, args.delay, args.retries, resume)
            save_cache()

        if do_triple:
            scrape_triple_lds(raw_cache, session, args.delay, args.retries, resume)
            save_cache()

    except KeyboardInterrupt:
        print("\n[INTERRUPTED] Saving raw cache …")
        save_cache()
        print("  Re-run with --resume to continue.")
        sys.exit(1)

    build_db(kjv_db_path, raw_cache, output_path, fts=not args.no_fts,
             missing=args.missing)


if __name__ == "__main__":
    main()
