#!/usr/bin/env python3
"""
scrape_japanese_aligned.py
==========================
Builds a KJV-aligned Japanese scripture database.

Sources
-------
  Bible (OT + NT) : BibleGateway — JERV (Japanese Easy-to-Read Version)
                    URL: https://www.biblegateway.com/passage/?search=...&version=JERV&interface=print
  Triple Combo    : Church of Jesus Christ website
                    URL: https://www.churchofjesuschrist.org/study/scriptures/...?lang=jpn

Alignment
---------
  The KJV DB is used as the TEMPLATE.  For every one of KJV's 41,995 verses the
  script looks up the Japanese text by (book_id, chapter_number, verse_number).
  Extra verses that exist only in the Japanese source (e.g. numbered Psalm
  headings) are silently dropped.  Missing verses become empty strings so the
  final DB has exactly 41,995 rows with the SAME verse_ids as the KJV DB.

Usage
-----
  python3 scrape_japanese_aligned.py
  python3 scrape_japanese_aligned.py --delay 1.5 --resume
  python3 scrape_japanese_aligned.py --bible-only
  python3 scrape_japanese_aligned.py --triple-only --resume

Options
-------
  --delay N       Seconds between HTTP requests  (default: 1.0)
  --retries N     Max retries per page            (default: 4)
  --resume        Skip chapters already saved to the raw cache
  --bible-only    Scrape Bible (volumes 1-2) only
  --triple-only   Scrape Triple Combo (volumes 3-5) only; implies --resume
  --no-fts        Skip building the FTS5 index
  --raw-cache F   Path to the JSON raw-text cache (default: ja_raw_cache.json)
  --output F      Output DB path (default: japanese-scriptures-sqlite.db)
  --kjv-db F      Path to the KJV reference DB (default: lds-scriptures-sqlite.db)
"""

import argparse
import json
import re
import sqlite3
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    sys.exit(
        "[ERROR] Missing dependencies.  Install with:\n"
        "    pip install requests beautifulsoup4"
    )


# ──────────────────────────────────────────────────────────────────────────────
# 1.  Bible book list  (66 books, identical structure to scrape_lds_full.py)
# ──────────────────────────────────────────────────────────────────────────────

BIBLE_BOOKS: List[Dict] = [
    # ── Old Testament ──────────────────────────────────────────────────────────
    {"id":  1, "canonical": "ot", "slug": "gen",   "bg_name": "Genesis",       "chapters":  50},
    {"id":  2, "canonical": "ot", "slug": "ex",    "bg_name": "Exodus",        "chapters":  40},
    {"id":  3, "canonical": "ot", "slug": "lev",   "bg_name": "Leviticus",     "chapters":  27},
    {"id":  4, "canonical": "ot", "slug": "num",   "bg_name": "Numbers",       "chapters":  36},
    {"id":  5, "canonical": "ot", "slug": "deut",  "bg_name": "Deuteronomy",   "chapters":  34},
    {"id":  6, "canonical": "ot", "slug": "josh",  "bg_name": "Joshua",        "chapters":  24},
    {"id":  7, "canonical": "ot", "slug": "judg",  "bg_name": "Judges",        "chapters":  21},
    {"id":  8, "canonical": "ot", "slug": "ruth",  "bg_name": "Ruth",          "chapters":   4},
    {"id":  9, "canonical": "ot", "slug": "1-sam", "bg_name": "1 Samuel",      "chapters":  31},
    {"id": 10, "canonical": "ot", "slug": "2-sam", "bg_name": "2 Samuel",      "chapters":  24},
    {"id": 11, "canonical": "ot", "slug": "1-kgs", "bg_name": "1 Kings",       "chapters":  22},
    {"id": 12, "canonical": "ot", "slug": "2-kgs", "bg_name": "2 Kings",       "chapters":  25},
    {"id": 13, "canonical": "ot", "slug": "1-chr", "bg_name": "1 Chronicles",  "chapters":  29},
    {"id": 14, "canonical": "ot", "slug": "2-chr", "bg_name": "2 Chronicles",  "chapters":  36},
    {"id": 15, "canonical": "ot", "slug": "ezra",  "bg_name": "Ezra",          "chapters":  10},
    {"id": 16, "canonical": "ot", "slug": "neh",   "bg_name": "Nehemiah",      "chapters":  13},
    {"id": 17, "canonical": "ot", "slug": "esth",  "bg_name": "Esther",        "chapters":  10},
    {"id": 18, "canonical": "ot", "slug": "job",   "bg_name": "Job",           "chapters":  42},
    {"id": 19, "canonical": "ot", "slug": "ps",    "bg_name": "Psalms",        "chapters": 150},
    {"id": 20, "canonical": "ot", "slug": "prov",  "bg_name": "Proverbs",      "chapters":  31},
    {"id": 21, "canonical": "ot", "slug": "eccl",  "bg_name": "Ecclesiastes",  "chapters":  12},
    {"id": 22, "canonical": "ot", "slug": "song",  "bg_name": "Song of Solomon","chapters":  8},
    {"id": 23, "canonical": "ot", "slug": "isa",   "bg_name": "Isaiah",        "chapters":  66},
    {"id": 24, "canonical": "ot", "slug": "jer",   "bg_name": "Jeremiah",      "chapters":  52},
    {"id": 25, "canonical": "ot", "slug": "lam",   "bg_name": "Lamentations",  "chapters":   5},
    {"id": 26, "canonical": "ot", "slug": "ezek",  "bg_name": "Ezekiel",       "chapters":  48},
    {"id": 27, "canonical": "ot", "slug": "dan",   "bg_name": "Daniel",        "chapters":  12},
    {"id": 28, "canonical": "ot", "slug": "hosea", "bg_name": "Hosea",         "chapters":  14},
    {"id": 29, "canonical": "ot", "slug": "joel",  "bg_name": "Joel",          "chapters":   3},
    {"id": 30, "canonical": "ot", "slug": "amos",  "bg_name": "Amos",          "chapters":   9},
    {"id": 31, "canonical": "ot", "slug": "obad",  "bg_name": "Obadiah",       "chapters":   1},
    {"id": 32, "canonical": "ot", "slug": "jonah", "bg_name": "Jonah",         "chapters":   4},
    {"id": 33, "canonical": "ot", "slug": "micah", "bg_name": "Micah",         "chapters":   7},
    {"id": 34, "canonical": "ot", "slug": "nahum", "bg_name": "Nahum",         "chapters":   3},
    {"id": 35, "canonical": "ot", "slug": "hab",   "bg_name": "Habakkuk",      "chapters":   3},
    {"id": 36, "canonical": "ot", "slug": "zeph",  "bg_name": "Zephaniah",     "chapters":   3},
    {"id": 37, "canonical": "ot", "slug": "hag",   "bg_name": "Haggai",        "chapters":   2},
    {"id": 38, "canonical": "ot", "slug": "zech",  "bg_name": "Zechariah",     "chapters":  14},
    {"id": 39, "canonical": "ot", "slug": "mal",   "bg_name": "Malachi",       "chapters":   4},
    # ── New Testament ──────────────────────────────────────────────────────────
    {"id": 40, "canonical": "nt", "slug": "matt",   "bg_name": "Matthew",      "chapters": 28},
    {"id": 41, "canonical": "nt", "slug": "mark",   "bg_name": "Mark",         "chapters": 16},
    {"id": 42, "canonical": "nt", "slug": "luke",   "bg_name": "Luke",         "chapters": 24},
    {"id": 43, "canonical": "nt", "slug": "john",   "bg_name": "John",         "chapters": 21},
    {"id": 44, "canonical": "nt", "slug": "acts",   "bg_name": "Acts",         "chapters": 28},
    {"id": 45, "canonical": "nt", "slug": "rom",    "bg_name": "Romans",       "chapters": 16},
    {"id": 46, "canonical": "nt", "slug": "1-cor",  "bg_name": "1 Corinthians","chapters": 16},
    {"id": 47, "canonical": "nt", "slug": "2-cor",  "bg_name": "2 Corinthians","chapters": 13},
    {"id": 48, "canonical": "nt", "slug": "gal",    "bg_name": "Galatians",    "chapters":  6},
    {"id": 49, "canonical": "nt", "slug": "eph",    "bg_name": "Ephesians",    "chapters":  6},
    {"id": 50, "canonical": "nt", "slug": "philip", "bg_name": "Philippians",  "chapters":  4},
    {"id": 51, "canonical": "nt", "slug": "col",    "bg_name": "Colossians",   "chapters":  4},
    {"id": 52, "canonical": "nt", "slug": "1-thes", "bg_name": "1+Thessalonians","chapters": 5},
    {"id": 53, "canonical": "nt", "slug": "2-thes", "bg_name": "2+Thessalonians","chapters": 3},
    {"id": 54, "canonical": "nt", "slug": "1-tim",  "bg_name": "1+Timothy",    "chapters":  6},
    {"id": 55, "canonical": "nt", "slug": "2-tim",  "bg_name": "2+Timothy",    "chapters":  4},
    {"id": 56, "canonical": "nt", "slug": "titus",  "bg_name": "Titus",        "chapters":  3},
    {"id": 57, "canonical": "nt", "slug": "philem", "bg_name": "Philemon",     "chapters":  1},
    {"id": 58, "canonical": "nt", "slug": "heb",    "bg_name": "Hebrews",      "chapters": 13},
    {"id": 59, "canonical": "nt", "slug": "james",  "bg_name": "James",        "chapters":  5},
    {"id": 60, "canonical": "nt", "slug": "1-pet",  "bg_name": "1+Peter",      "chapters":  5},
    {"id": 61, "canonical": "nt", "slug": "2-pet",  "bg_name": "2+Peter",      "chapters":  3},
    {"id": 62, "canonical": "nt", "slug": "1-jn",   "bg_name": "1+John",       "chapters":  5},
    {"id": 63, "canonical": "nt", "slug": "2-jn",   "bg_name": "2+John",       "chapters":  1},
    {"id": 64, "canonical": "nt", "slug": "3-jn",   "bg_name": "3+John",       "chapters":  1},
    {"id": 65, "canonical": "nt", "slug": "jude",   "bg_name": "Jude",         "chapters":  1},
    {"id": 66, "canonical": "nt", "slug": "rev",    "bg_name": "Revelation",   "chapters": 22},
]

# Triple Combination books (IDs 67–87)
TRIPLE_BOOKS: List[Dict] = [
    {"volume_id": 3, "id": 67, "canonical": "bofm", "slug": "1-ne",   "lds_url": "bofm/1-ne",       "chapters": 22},
    {"volume_id": 3, "id": 68, "canonical": "bofm", "slug": "2-ne",   "lds_url": "bofm/2-ne",       "chapters": 33},
    {"volume_id": 3, "id": 69, "canonical": "bofm", "slug": "jacob",  "lds_url": "bofm/jacob",      "chapters":  7},
    {"volume_id": 3, "id": 70, "canonical": "bofm", "slug": "enos",   "lds_url": "bofm/enos",       "chapters":  1},
    {"volume_id": 3, "id": 71, "canonical": "bofm", "slug": "jarom",  "lds_url": "bofm/jarom",      "chapters":  1},
    {"volume_id": 3, "id": 72, "canonical": "bofm", "slug": "omni",   "lds_url": "bofm/omni",       "chapters":  1},
    {"volume_id": 3, "id": 73, "canonical": "bofm", "slug": "w-of-m", "lds_url": "bofm/w-of-m",     "chapters":  1},
    {"volume_id": 3, "id": 74, "canonical": "bofm", "slug": "mosiah", "lds_url": "bofm/mosiah",     "chapters": 29},
    {"volume_id": 3, "id": 75, "canonical": "bofm", "slug": "alma",   "lds_url": "bofm/alma",       "chapters": 63},
    {"volume_id": 3, "id": 76, "canonical": "bofm", "slug": "hel",    "lds_url": "bofm/hel",        "chapters": 16},
    {"volume_id": 3, "id": 77, "canonical": "bofm", "slug": "3-ne",   "lds_url": "bofm/3-ne",       "chapters": 30},
    {"volume_id": 3, "id": 78, "canonical": "bofm", "slug": "4-ne",   "lds_url": "bofm/4-ne",       "chapters":  1},
    {"volume_id": 3, "id": 79, "canonical": "bofm", "slug": "morm",   "lds_url": "bofm/morm",       "chapters":  9},
    {"volume_id": 3, "id": 80, "canonical": "bofm", "slug": "ether",  "lds_url": "bofm/ether",      "chapters": 15},
    {"volume_id": 3, "id": 81, "canonical": "bofm", "slug": "moro",   "lds_url": "bofm/moro",       "chapters": 10},
    {"volume_id": 4, "id": 82, "canonical": "dc-testament", "slug": "dc", "lds_url": "dc-testament/dc", "chapters": 138},
    {"volume_id": 5, "id": 83, "canonical": "pgp",  "slug": "moses",  "lds_url": "pgp/moses",       "chapters":  8},
    {"volume_id": 5, "id": 84, "canonical": "pgp",  "slug": "abr",    "lds_url": "pgp/abr",         "chapters":  5},
    {"volume_id": 5, "id": 85, "canonical": "pgp",  "slug": "js-m",   "lds_url": "pgp/js-m",        "chapters":  1},
    {"volume_id": 5, "id": 86, "canonical": "pgp",  "slug": "js-h",   "lds_url": "pgp/js-h",        "chapters":  1},
    {"volume_id": 5, "id": 87, "canonical": "pgp",  "slug": "a-of-f", "lds_url": "pgp/a-of-f",      "chapters":  1},
]

BG_BASE   = "https://www.biblegateway.com/passage/"
LDS_BASE  = "https://www.churchofjesuschrist.org/study/scriptures"
BG_VERSION = "JLB"  # Japanese Living Bible — covers full OT + NT on BibleGateway


# ──────────────────────────────────────────────────────────────────────────────
# 2.  HTTP helpers
# ──────────────────────────────────────────────────────────────────────────────

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
}


def fetch(url: str, params: dict, session: requests.Session,
          delay: float, retries: int) -> Optional[str]:
    """Fetch URL with exponential back-off. Returns HTML or None."""
    from urllib.parse import urlsplit
    for attempt in range(1, retries + 1):
        try:
            resp = session.get(url, params=params, headers=HEADERS, timeout=25)
            if resp.status_code == 200:
                # Detect silent redirects (chapter not available)
                req_path = urlsplit(resp.request.url).path.rstrip("/")
                res_path = urlsplit(resp.url).path.rstrip("/")
                if req_path != res_path:
                    print(f"  [REDIRECT] → {resp.url}  skipping")
                    return None
                resp.encoding = "utf-8"
                time.sleep(delay)
                return resp.text
            if resp.status_code == 404:
                print(f"  [404] {url}")
                return None
            print(f"  [HTTP {resp.status_code}] attempt {attempt}/{retries}")
        except requests.RequestException as exc:
            print(f"  [ERR] {exc}  attempt {attempt}/{retries}")
        time.sleep(delay * (2 ** attempt))
    print(f"  [FAIL] gave up: {url}")
    return None


# ──────────────────────────────────────────────────────────────────────────────
# 3.  BibleGateway parser
#
#  BibleGateway renders verse spans as:
#    <span class="text Gen-1-1"><span class="chapternum">1 </span>verse one text</span>
#    <span class="text Gen-1-2"><sup class="versenum">2 </sup>verse two text</span>
#    <span class="text Gen-1-4-Gen-1-5"><sup class="versenum">4-5 </sup>merged text</span>
#
#  For merged verses (e.g. JLB Gen 1:4-5) the same text is stored for each
#  verse number in the range so KJV verse 4 AND verse 5 both get content.
# ──────────────────────────────────────────────────────────────────────────────

def parse_bg_chapter(html: str) -> Dict[int, str]:
    """Return {verse_number: text} from a BibleGateway passage page."""
    soup = BeautifulSoup(html, "html.parser")
    result: Dict[int, str] = {}

    passage = soup.find("div", class_="passage-text")
    if not passage:
        return result

    # All verse-content spans share class "text"
    for span in passage.find_all("span", class_="text"):
        # ── Determine verse number(s) ──────────────────────────────────────────
        chapternum = span.find("span", class_="chapternum")
        versenum   = span.find("sup",  class_="versenum")

        if chapternum:
            verse_nums = [1]
            chapternum.decompose()          # remove from text
        elif versenum:
            raw = versenum.get_text(strip=True)   # e.g. "4-5" or "2"
            nums = re.findall(r"\d+", raw)
            if not nums:
                continue
            start = int(nums[0])
            end   = int(nums[-1]) if len(nums) > 1 else start
            verse_nums = list(range(start, end + 1))
            versenum.decompose()            # remove from text
        else:
            # Spans without either marker are section headings — skip.
            continue

        # ── Strip footnotes / crossrefs ────────────────────────────────────────
        for fn in span.find_all(["sup", "a"], class_=re.compile(r"footnote|crossref")):
            fn.decompose()

        # ── Extract cleaned text ───────────────────────────────────────────────
        text = " ".join(span.get_text(" ").split()).strip()
        if text:
            for vn in verse_nums:
                result[vn] = text

    return result


# ──────────────────────────────────────────────────────────────────────────────
# 4.  LDS website parser  (churchofjesuschrist.org)
#
#  The LDS site Japanese HTML structure:
#    <p class="verse" ...>
#      <span class="verse-number">1</span>
#      わたし<a class="study-note-ref" ...><sup class="marker">①</sup>ニーファイ</a>は
#      <ruby><rb>善</rb><rt>よ</rt></ruby>い ...
#    </p>
#
#  verse-number  : <span class="verse-number">  (not <sup>)
#  furigana      : <ruby><rb>kanji</rb><rt>reading</rt></ruby>  → keep rb, drop rt
#  footnote refs : <a class="study-note-ref">  with nested <sup class="marker">
# ──────────────────────────────────────────────────────────────────────────────

def parse_lds_chapter(html: str) -> Dict[int, str]:
    """Return {verse_number: text} from an LDS study library chapter page."""
    soup = BeautifulSoup(html, "html.parser")
    result: Dict[int, str] = {}

    verse_tags = soup.find_all("p", class_="verse")
    if not verse_tags:
        # Fallback: body-block paragraphs (intro sections, etc.)
        body = soup.find("div", class_=re.compile(r"body-block"))
        if body:
            for i, p in enumerate(body.find_all("p"), 1):
                text = " ".join(p.get_text(" ").split()).strip()
                if text:
                    result[i] = text
        return result

    for v in verse_tags:
        # ── Verse number ──────────────────────────────────────────────────────
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

        # ── Strip study-note markers <sup class="marker"> ─────────────────────
        for marker in v.find_all("sup", class_="marker"):
            marker.decompose()

        # ── Unwrap ruby elements — keep <rb> text, drop <rt> readings ─────────
        for ruby in v.find_all("ruby"):
            rb = ruby.find("rb")
            if rb:
                ruby.replace_with(rb.get_text())
            else:
                ruby.unwrap()

        # ── Unwrap remaining inline anchors (study-note-ref links) ────────────
        for a in v.find_all("a"):
            a.unwrap()

        text = " ".join(v.get_text("").split()).strip()
        if text:
            result[vnum] = text

    return result


# ──────────────────────────────────────────────────────────────────────────────
# 5.  Scrape routines
# ──────────────────────────────────────────────────────────────────────────────

# raw_cache key: "bible:book_id:chapter" or "lds:slug:chapter"
RawCache = Dict[str, Dict[int, str]]   # key → {verse_num: text}


def scrape_bible(raw_cache: RawCache, session: requests.Session,
                 delay: float, retries: int, resume: bool) -> None:
    """Scrape OT + NT from BibleGateway JERV, populate raw_cache."""
    print("\n═══════════════════════════════════════")
    print(f"  Scraping Bible from BibleGateway ({BG_VERSION})")
    print("═══════════════════════════════════════")

    for book in BIBLE_BOOKS:
        bid = book["id"]
        for ch in range(1, book["chapters"] + 1):
            key = f"bible:{bid}:{ch}"
            if resume and key in raw_cache:
                continue
            print(f"  {book['bg_name']} {ch} …", end=" ", flush=True)
            html = fetch(
                BG_BASE,
                {"search": f"{book['bg_name']} {ch}",
                 "version": BG_VERSION,
                 "interface": "print"},
                session, delay, retries,
            )
            if not html:
                print("SKIP")
                raw_cache[key] = {}
                continue
            verses = parse_bg_chapter(html)
            raw_cache[key] = verses
            print(f"{len(verses)} verses")


def scrape_triple(raw_cache: RawCache, session: requests.Session,
                  delay: float, retries: int, resume: bool) -> None:
    """Scrape Triple Combination from LDS website (lang=jpn), populate raw_cache."""
    print("\n═══════════════════════════════════════")
    print("  Scraping Triple Combination from churchofjesuschrist.org (jpn)")
    print("═══════════════════════════════════════")

    for book in TRIPLE_BOOKS:
        for ch in range(1, book["chapters"] + 1):
            key = f"lds:{book['slug']}:{ch}"
            if resume and key in raw_cache:
                continue
            lds_path = book["lds_url"]
            chapter_slug = str(ch) if book["slug"] != "dc" else str(ch)
            url = f"{LDS_BASE}/{lds_path}/{chapter_slug}"
            print(f"  {book['slug']} {ch} …", end=" ", flush=True)
            html = fetch(url, {"lang": "jpn"}, session, delay, retries)
            if not html:
                print("SKIP")
                raw_cache[key] = {}
                continue
            verses = parse_lds_chapter(html)
            raw_cache[key] = verses
            print(f"{len(verses)} verses")


# ──────────────────────────────────────────────────────────────────────────────
# 6.  DB schema
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
    scripture_text,
    verse_title,
    content='scriptures',
    content_rowid='verse_id'
);
INSERT INTO scriptures_fts(rowid, scripture_text, verse_title)
    SELECT verse_id, scripture_text, verse_title FROM scriptures;
"""


# ──────────────────────────────────────────────────────────────────────────────
# 7.  Build DB from KJV template + raw cache
# ──────────────────────────────────────────────────────────────────────────────

def build_db(kjv_db_path: str, raw_cache: RawCache,
             output_path: str, fts: bool) -> None:
    """
    Iterate every verse in the KJV DB and write the Japanese text.
    verse_ids / chapter_ids / book_ids / volume_ids all match KJV exactly.
    Any extra verses in the scraped data that don't exist in KJV are ignored.
    Any KJV verse without a scraped Japanese text becomes an empty string.
    """
    print("\n═══════════════════════════════════════")
    print(f"  Building aligned DB: {output_path}")
    print("═══════════════════════════════════════")

    kjv = sqlite3.connect(kjv_db_path)
    kjv.row_factory = sqlite3.Row

    out = sqlite3.connect(output_path)
    out.executescript(SCHEMA_SQL)
    out.commit()

    # ── Volumes ───────────────────────────────────────────────────────────────
    VOLUME_META = {
        1: ("聖書（旧約）", "聖書（旧約聖書）", "", "旧約", "ot"),
        2: ("聖書（新約）", "聖書（新約聖書）", "", "新約", "nt"),
        3: ("モルモン書", "モルモン書", "もう一つのイエス・キリストの証", "モルモン書", "bofm"),
        4: ("教義と聖約", "教義と聖約", "", "D&C", "dc-testament"),
        5: ("高価なる真珠", "高価なる真珠", "", "PGP", "pgp"),
    }
    for vid, (title, long_title, subtitle, short_title, lds_url) in VOLUME_META.items():
        out.execute(
            "INSERT OR IGNORE INTO volumes VALUES (?,?,?,?,?,?)",
            (vid, title, long_title, subtitle, short_title, lds_url),
        )

    # ── Books from KJV ────────────────────────────────────────────────────────
    for row in kjv.execute("SELECT * FROM books ORDER BY id"):
        out.execute(
            "INSERT OR IGNORE INTO books VALUES (?,?,?,?,?,?,?)",
            (row["id"], row["volume_id"], row["book_title"], row["book_long_title"],
             row["book_subtitle"], row["book_short_title"], row["book_lds_url"]),
        )

    # ── Chapters + Verses  (KJV as template) ─────────────────────────────────
    missed = 0
    total  = 0

    for chap in kjv.execute("SELECT * FROM chapters ORDER BY id"):
        out.execute(
            "INSERT OR IGNORE INTO chapters VALUES (?,?,?)",
            (chap["id"], chap["book_id"], chap["chapter_number"]),
        )

    # Determine cache key prefix per book
    book_to_cache_prefix: Dict[int, str] = {}
    for b in BIBLE_BOOKS:
        book_to_cache_prefix[b["id"]] = f"bible:{b['id']}"
    for b in TRIPLE_BOOKS:
        book_to_cache_prefix[b["id"]] = f"lds:{b['slug']}"

    # Fetch all KJV verses with their chapter/book context
    kjv_verses = kjv.execute(
        """
        SELECT verses.id, verses.chapter_id, verses.verse_number,
               chapters.chapter_number, chapters.book_id
        FROM verses
        JOIN chapters ON chapters.id = verses.chapter_id
        ORDER BY verses.id
        """
    ).fetchall()

    batch = []
    for v in kjv_verses:
        total += 1
        bid   = v["book_id"]
        ch_n  = v["chapter_number"]
        v_n   = v["verse_number"]
        prefix = book_to_cache_prefix.get(bid, "")
        key    = f"{prefix}:{ch_n}"
        chapter_data = raw_cache.get(key, {})
        text = chapter_data.get(v_n, "")
        if not text:
            missed += 1
        batch.append((v["id"], v["chapter_id"], v_n, text))

        if len(batch) >= 500:
            out.executemany(
                "INSERT OR IGNORE INTO verses VALUES (?,?,?,?)", batch
            )
            batch.clear()

    if batch:
        out.executemany("INSERT OR IGNORE INTO verses VALUES (?,?,?,?)", batch)

    out.commit()
    print(f"  Wrote {total} verses  ({missed} empty / not found in source)")

    # ── FTS ───────────────────────────────────────────────────────────────────
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
    parser.add_argument("--delay",       type=float, default=1.0)
    parser.add_argument("--retries",     type=int,   default=4)
    parser.add_argument("--resume",      action="store_true")
    parser.add_argument("--bible-only",  action="store_true")
    parser.add_argument("--triple-only", action="store_true")
    parser.add_argument("--no-fts",      action="store_true")
    parser.add_argument("--raw-cache",   default="ja_raw_cache.json")
    parser.add_argument("--output",      default="japanese-scriptures-sqlite.db")
    parser.add_argument("--kjv-db",      default="lds-scriptures-sqlite.db")
    args = parser.parse_args()

    db_dir = Path(__file__).parent
    output_path   = str(db_dir / args.output)
    kjv_db_path   = str(db_dir / args.kjv_db)
    raw_cache_path = str(db_dir / args.raw_cache)

    if not Path(kjv_db_path).exists():
        sys.exit(f"[ERROR] KJV DB not found: {kjv_db_path}")

    # Load or init raw cache
    raw_cache: RawCache = {}
    if Path(raw_cache_path).exists():
        print(f"Loading raw cache from {raw_cache_path} …")
        with open(raw_cache_path, "r", encoding="utf-8") as f:
            raw = json.load(f)
        # JSON serialises integer dict keys as strings; convert back to int.
        raw_cache = {k: {int(vk): vv for vk, vv in v.items()} for k, v in raw.items()}
        print(f"  {len(raw_cache)} chapters already cached.")

    session = requests.Session()
    session.headers.update(HEADERS)

    do_bible  = not args.triple_only
    do_triple = not args.bible_only
    resume    = args.resume or args.triple_only

    try:
        if do_bible:
            scrape_bible(raw_cache, session, args.delay, args.retries, resume)
            # Save progress after each volume
            with open(raw_cache_path, "w", encoding="utf-8") as f:
                json.dump(raw_cache, f, ensure_ascii=False)
            print(f"\nRaw cache saved → {raw_cache_path}")

        if do_triple:
            scrape_triple(raw_cache, session, args.delay, args.retries, resume)
            with open(raw_cache_path, "w", encoding="utf-8") as f:
                json.dump(raw_cache, f, ensure_ascii=False)
            print(f"\nRaw cache saved → {raw_cache_path}")

    except KeyboardInterrupt:
        print("\n[INTERRUPTED] Saving raw cache …")
        with open(raw_cache_path, "w", encoding="utf-8") as f:
            json.dump(raw_cache, f, ensure_ascii=False)
        print(f"  Saved → {raw_cache_path}")
        print("  Re-run with --resume to continue.")
        sys.exit(1)

    # Build the aligned DB
    build_db(kjv_db_path, raw_cache, output_path, fts=not args.no_fts)


if __name__ == "__main__":
    main()
