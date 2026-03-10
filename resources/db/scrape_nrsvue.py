#!/usr/bin/env python3
"""
scrape_nrsvue.py — Build nrsvue-scriptures-sqlite.db

Scrapes NRSVUE Bible text (66 books) from BibleGateway, then copies
Triple Combination rows (Book of Mormon / D&C / Pearl of Great Price)
from the existing KJV LDS database so the schema stays complete and all
verse_ids remain consistent with every other language DB in this project.

verse_id alignment
------------------
NRSVUE omits ~18 NT verses that KJV includes (Matthew 17:21, Mark 7:16,
etc.).  Instead of a sequential counter, this scraper loads the KJV verse
map and assigns verse_ids to match the KJV exactly:

  * NRSVUE verses present in KJV  -> assigned the matching KJV verse_id
  * KJV verses absent in NRSVUE   -> inserted with empty scripture_text
  * NRSVUE-only verses (no KJV slot) -> silently dropped

This makes the DB self-consistent without any post-hoc alignment script.

Usage:
    python3 scrape_nrsvue.py
    python3 scrape_nrsvue.py --resume
    python3 scrape_nrsvue.py --delay 1.5 --output nrsvue-scriptures-sqlite.db
    python3 scrape_nrsvue.py --kjv-source lds-scriptures-sqlite.db

Options:
    --output      Output DB file path        (default: nrsvue-scriptures-sqlite.db)
    --kjv-source  KJV source DB for Triple + verse_id map (default: lds-scriptures-sqlite.db)
    --delay       Seconds between requests   (default: 1.2)
    --retries     Max retries per request    (default: 4)
    --resume      Skip already-scraped chapters
    --no-fts      Skip FTS5 index build
    --bible-only  Stop after Bible; skip Triple copy
"""

import argparse
import re
import sqlite3
import sys
import time
from pathlib import Path
from typing import Dict, Optional, Set

try:
    import requests
    from bs4 import BeautifulSoup, NavigableString, Tag
except ImportError:
    sys.exit(
        "[ERROR] Missing dependencies.  Install with:\n"
        "    pip install requests beautifulsoup4"
    )


# ──────────────────────────────────────────────────────────────────────────────
# 1.  Bible book definitions
#     bg_name  — name BibleGateway accepts in the ?search= param
#     title    — display name stored as book_title  (NRSVUE naming)
#     short    — stored as book_short_title
#     chapters — chapter count for iteration
# ──────────────────────────────────────────────────────────────────────────────

BIBLE_BOOKS = [
    # ── Old Testament ─────────────────────────────────────────────────────────
    {"num":  1, "bg_name": "Genesis",        "title": "Genesis",          "short": "Gen",    "chapters":  50},
    {"num":  2, "bg_name": "Exodus",         "title": "Exodus",           "short": "Ex",     "chapters":  40},
    {"num":  3, "bg_name": "Leviticus",      "title": "Leviticus",        "short": "Lev",    "chapters":  27},
    {"num":  4, "bg_name": "Numbers",        "title": "Numbers",          "short": "Num",    "chapters":  36},
    {"num":  5, "bg_name": "Deuteronomy",    "title": "Deuteronomy",      "short": "Deut",   "chapters":  34},
    {"num":  6, "bg_name": "Joshua",         "title": "Joshua",           "short": "Josh",   "chapters":  24},
    {"num":  7, "bg_name": "Judges",         "title": "Judges",           "short": "Judg",   "chapters":  21},
    {"num":  8, "bg_name": "Ruth",           "title": "Ruth",             "short": "Ruth",   "chapters":   4},
    {"num":  9, "bg_name": "1 Samuel",       "title": "1 Samuel",         "short": "1 Sam",  "chapters":  31},
    {"num": 10, "bg_name": "2 Samuel",       "title": "2 Samuel",         "short": "2 Sam",  "chapters":  24},
    {"num": 11, "bg_name": "1 Kings",        "title": "1 Kings",          "short": "1 Kgs",  "chapters":  22},
    {"num": 12, "bg_name": "2 Kings",        "title": "2 Kings",          "short": "2 Kgs",  "chapters":  25},
    {"num": 13, "bg_name": "1 Chronicles",   "title": "1 Chronicles",     "short": "1 Chr",  "chapters":  29},
    {"num": 14, "bg_name": "2 Chronicles",   "title": "2 Chronicles",     "short": "2 Chr",  "chapters":  36},
    {"num": 15, "bg_name": "Ezra",           "title": "Ezra",             "short": "Ezra",   "chapters":  10},
    {"num": 16, "bg_name": "Nehemiah",       "title": "Nehemiah",         "short": "Neh",    "chapters":  13},
    {"num": 17, "bg_name": "Esther",         "title": "Esther",           "short": "Esth",   "chapters":  10},
    {"num": 18, "bg_name": "Job",            "title": "Job",              "short": "Job",    "chapters":  42},
    {"num": 19, "bg_name": "Psalms",         "title": "Psalms",           "short": "Ps",     "chapters": 150},
    {"num": 20, "bg_name": "Proverbs",       "title": "Proverbs",         "short": "Prov",   "chapters":  31},
    {"num": 21, "bg_name": "Ecclesiastes",   "title": "Ecclesiastes",     "short": "Eccl",   "chapters":  12},
    {"num": 22, "bg_name": "Song of Songs",  "title": "Song of Songs",    "short": "Song",   "chapters":   8},
    {"num": 23, "bg_name": "Isaiah",         "title": "Isaiah",           "short": "Isa",    "chapters":  66},
    {"num": 24, "bg_name": "Jeremiah",       "title": "Jeremiah",         "short": "Jer",    "chapters":  52},
    {"num": 25, "bg_name": "Lamentations",   "title": "Lamentations",     "short": "Lam",    "chapters":   5},
    {"num": 26, "bg_name": "Ezekiel",        "title": "Ezekiel",          "short": "Ezek",   "chapters":  48},
    {"num": 27, "bg_name": "Daniel",         "title": "Daniel",           "short": "Dan",    "chapters":  12},
    {"num": 28, "bg_name": "Hosea",          "title": "Hosea",            "short": "Hos",    "chapters":  14},
    {"num": 29, "bg_name": "Joel",           "title": "Joel",             "short": "Joel",   "chapters":   3},
    {"num": 30, "bg_name": "Amos",           "title": "Amos",             "short": "Amos",   "chapters":   9},
    {"num": 31, "bg_name": "Obadiah",        "title": "Obadiah",          "short": "Obad",   "chapters":   1},
    {"num": 32, "bg_name": "Jonah",          "title": "Jonah",            "short": "Jonah",  "chapters":   4},
    {"num": 33, "bg_name": "Micah",          "title": "Micah",            "short": "Micah",  "chapters":   7},
    {"num": 34, "bg_name": "Nahum",          "title": "Nahum",            "short": "Nah",    "chapters":   3},
    {"num": 35, "bg_name": "Habakkuk",       "title": "Habakkuk",         "short": "Hab",    "chapters":   3},
    {"num": 36, "bg_name": "Zephaniah",      "title": "Zephaniah",        "short": "Zeph",   "chapters":   3},
    {"num": 37, "bg_name": "Haggai",         "title": "Haggai",           "short": "Hag",    "chapters":   2},
    {"num": 38, "bg_name": "Zechariah",      "title": "Zechariah",        "short": "Zech",   "chapters":  14},
    {"num": 39, "bg_name": "Malachi",        "title": "Malachi",          "short": "Mal",    "chapters":   4},
    # ── New Testament ─────────────────────────────────────────────────────────
    {"num": 40, "bg_name": "Matthew",        "title": "Matthew",          "short": "Matt",   "chapters":  28},
    {"num": 41, "bg_name": "Mark",           "title": "Mark",             "short": "Mark",   "chapters":  16},
    {"num": 42, "bg_name": "Luke",           "title": "Luke",             "short": "Luke",   "chapters":  24},
    {"num": 43, "bg_name": "John",           "title": "John",             "short": "John",   "chapters":  21},
    {"num": 44, "bg_name": "Acts",           "title": "Acts",             "short": "Acts",   "chapters":  28},
    {"num": 45, "bg_name": "Romans",         "title": "Romans",           "short": "Rom",    "chapters":  16},
    {"num": 46, "bg_name": "1 Corinthians",  "title": "1 Corinthians",    "short": "1 Cor",  "chapters":  16},
    {"num": 47, "bg_name": "2 Corinthians",  "title": "2 Corinthians",    "short": "2 Cor",  "chapters":  13},
    {"num": 48, "bg_name": "Galatians",      "title": "Galatians",        "short": "Gal",    "chapters":   6},
    {"num": 49, "bg_name": "Ephesians",      "title": "Ephesians",        "short": "Eph",    "chapters":   6},
    {"num": 50, "bg_name": "Philippians",    "title": "Philippians",      "short": "Philip", "chapters":   4},
    {"num": 51, "bg_name": "Colossians",     "title": "Colossians",       "short": "Col",    "chapters":   4},
    {"num": 52, "bg_name": "1 Thessalonians","title": "1 Thessalonians",  "short": "1 Thes", "chapters":   5},
    {"num": 53, "bg_name": "2 Thessalonians","title": "2 Thessalonians",  "short": "2 Thes", "chapters":   3},
    {"num": 54, "bg_name": "1 Timothy",      "title": "1 Timothy",        "short": "1 Tim",  "chapters":   6},
    {"num": 55, "bg_name": "2 Timothy",      "title": "2 Timothy",        "short": "2 Tim",  "chapters":   4},
    {"num": 56, "bg_name": "Titus",          "title": "Titus",            "short": "Titus",  "chapters":   3},
    {"num": 57, "bg_name": "Philemon",       "title": "Philemon",         "short": "Phlm",   "chapters":   1},
    {"num": 58, "bg_name": "Hebrews",        "title": "Hebrews",          "short": "Heb",    "chapters":  13},
    {"num": 59, "bg_name": "James",          "title": "James",            "short": "James",  "chapters":   5},
    {"num": 60, "bg_name": "1 Peter",        "title": "1 Peter",          "short": "1 Pet",  "chapters":   5},
    {"num": 61, "bg_name": "2 Peter",        "title": "2 Peter",          "short": "2 Pet",  "chapters":   3},
    {"num": 62, "bg_name": "1 John",         "title": "1 John",           "short": "1 Jn",   "chapters":   5},
    {"num": 63, "bg_name": "2 John",         "title": "2 John",           "short": "2 Jn",   "chapters":   1},
    {"num": 64, "bg_name": "3 John",         "title": "3 John",           "short": "3 Jn",   "chapters":   1},
    {"num": 65, "bg_name": "Jude",           "title": "Jude",             "short": "Jude",   "chapters":   1},
    {"num": 66, "bg_name": "Revelation",     "title": "Revelation",       "short": "Rev",    "chapters":  22},
]

OT_BOOKS = [b for b in BIBLE_BOOKS if b["num"] <= 39]
NT_BOOKS = [b for b in BIBLE_BOOKS if b["num"] >= 40]

# ── Volume definitions (Bible only; Triple is copied from KJV) ───────────────
VOLUMES = [
    {"id": 1, "title": "Old Testament",  "long_title": "The Old Testament",  "subtitle": "", "short": "OT", "lds_url": "ot"},
    {"id": 2, "title": "New Testament",  "long_title": "The New Testament",  "subtitle": "", "short": "NT", "lds_url": "nt"},
]

# ID boundaries (must match lds-scriptures-sqlite.db exactly)
TRIPLE_BOOK_ID_START    = 67
TRIPLE_CHAPTER_ID_START = 1190
TRIPLE_VERSE_ID_START   = 31103


# ──────────────────────────────────────────────────────────────────────────────
# 2.  Database schema  (identical to every other language DB in this project)
# ──────────────────────────────────────────────────────────────────────────────

_CREATE_SCHEMA = """
CREATE TABLE IF NOT EXISTS volumes (
    id                 INTEGER PRIMARY KEY,
    volume_title       TEXT,
    volume_long_title  TEXT,
    volume_subtitle    TEXT,
    volume_short_title TEXT,
    volume_lds_url     TEXT
);
CREATE TABLE IF NOT EXISTS books (
    id               INTEGER PRIMARY KEY,
    volume_id        INTEGER REFERENCES volumes(id) ON DELETE CASCADE,
    book_title       TEXT,
    book_long_title  TEXT,
    book_subtitle    TEXT,
    book_short_title TEXT,
    book_lds_url     TEXT
);
CREATE TABLE IF NOT EXISTS chapters (
    id             INTEGER PRIMARY KEY,
    book_id        INTEGER REFERENCES books(id) ON DELETE CASCADE,
    chapter_number INTEGER
);
CREATE TABLE IF NOT EXISTS verses (
    id             INTEGER PRIMARY KEY,
    chapter_id     INTEGER REFERENCES chapters(id) ON DELETE CASCADE,
    verse_number   INTEGER,
    scripture_text TEXT
);
CREATE TABLE IF NOT EXISTS configuration (
    revision    INTEGER,
    fonts       TEXT,
    title       TEXT,
    description TEXT,
    copyrights  TEXT
);
"""

_CREATE_VIEW = """
CREATE VIEW scriptures AS
SELECT
    volumes.id          AS volume_id,
    books.id            AS book_id,
    chapters.id         AS chapter_id,
    verses.id           AS verse_id,
    volume_title,       book_title,
    volume_long_title,  book_long_title,
    volume_subtitle,    book_subtitle,
    volume_short_title, book_short_title,
    volume_lds_url,     book_lds_url,
    chapter_number,     verse_number,     scripture_text,
    book_title  || ' ' || chapter_number || ':' || verse_number AS verse_title,
    book_short_title || ' ' || chapter_number || ':' || verse_number AS verse_short_title
FROM volumes
INNER JOIN books    ON books.volume_id   = volumes.id
INNER JOIN chapters ON chapters.book_id  = books.id
INNER JOIN verses   ON verses.chapter_id = chapters.id
ORDER BY volumes.id, books.id, chapters.id, verses.id;
"""


def create_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(_CREATE_SCHEMA)
    try:
        conn.execute(_CREATE_VIEW)
    except sqlite3.OperationalError:
        pass  # view already exists when resuming
    conn.commit()


def apply_fts5(conn: sqlite3.Connection) -> None:
    print("  Building FTS5 index …", flush=True)
    conn.executescript("""
        DROP TABLE IF EXISTS scriptures_fts;
        CREATE VIRTUAL TABLE scriptures_fts USING fts5(
            verse_id       UNINDEXED,
            scripture_text,
            verse_title,
            book_title,
            chapter_number UNINDEXED,
            verse_number   UNINDEXED,
            content        = 'scriptures',
            content_rowid  = 'verse_id'
        );
        INSERT INTO scriptures_fts
               (verse_id, scripture_text, verse_title, book_title, chapter_number, verse_number)
        SELECT  verse_id, scripture_text, verse_title, book_title, chapter_number, verse_number
        FROM    scriptures;
        INSERT INTO scriptures_fts(scriptures_fts) VALUES('optimize');
    """)
    conn.commit()
    print("  FTS5 index built.", flush=True)


def get_done_chapter_ids(conn: sqlite3.Connection) -> Set[int]:
    try:
        return {r[0] for r in conn.execute("SELECT id FROM chapters")}
    except sqlite3.OperationalError:
        return set()


def load_kjv_verse_map(kjv_path: str) -> Dict[tuple, list]:
    """
    Load the KJV verse list for Bible books (volumes 1-2).
    Returns {(book_id, chapter_number): [(verse_id, verse_number), ...]}
    ordered by verse_number within each chapter.
    """
    kjv = sqlite3.connect(kjv_path)
    rows = kjv.execute("""
        SELECT v.id, b.id, c.chapter_number, v.verse_number
        FROM   verses v
        JOIN   chapters c ON c.id = v.chapter_id
        JOIN   books    b ON b.id = c.book_id
        WHERE  b.volume_id IN (1, 2)
        ORDER  BY v.id
    """).fetchall()
    kjv.close()
    result: Dict[tuple, list] = {}
    for verse_id, book_id, ch_num, v_num in rows:
        key = (book_id, ch_num)
        if key not in result:
            result[key] = []
        result[key].append((verse_id, v_num))
    return result


# ──────────────────────────────────────────────────────────────────────────────
# 3.  HTTP fetch
# ──────────────────────────────────────────────────────────────────────────────

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


def fetch_chapter(
    book_bg_name: str,
    chapter: int,
    session: requests.Session,
    delay: float,
    retries: int,
) -> Optional[str]:
    """Fetch one chapter from BibleGateway NRSVUE. Returns HTML string or None."""
    search = f"{book_bg_name} {chapter}"
    url = f"https://www.biblegateway.com/passage/?search={requests.utils.quote(search)}&version=NRSVUE"

    for attempt in range(retries + 1):
        try:
            time.sleep(delay if attempt == 0 else delay * (2 ** attempt))
            resp = session.get(url, headers=_HEADERS, timeout=20)
            if resp.status_code == 404:
                print(f"  [404] {book_bg_name} {chapter}", flush=True)
                return None
            if resp.status_code == 429:
                wait = delay * (4 ** (attempt + 1))
                print(f"  [429] rate-limited — waiting {wait:.0f}s …", flush=True)
                time.sleep(wait)
                continue
            resp.raise_for_status()
            return resp.text
        except requests.RequestException as exc:
            if attempt < retries:
                print(f"  [warn] {book_bg_name} {chapter} attempt {attempt+1}: {exc}", flush=True)
            else:
                print(f"  [error] giving up on {book_bg_name} {chapter}: {exc}", flush=True)
                return None
    return None


# ──────────────────────────────────────────────────────────────────────────────
# 4.  HTML verse extraction
# ──────────────────────────────────────────────────────────────────────────────

def extract_verses(html: str) -> Dict[int, str]:
    """
    Parse BibleGateway HTML for one chapter.
    Returns {verse_number: verse_text} with clean prose strings.

    BibleGateway structure (simplified):
        <div class="passage-text">
          ...
          <p class="chapter-1">
            <span class="chapternum">1 </span>In the beginning...
            <sup class="versenum">2 </sup>the earth was...
          </p>
          ...
        </div>
    """
    soup = BeautifulSoup(html, "html.parser")

    passage = soup.find("div", class_="passage-text")
    if not passage:
        return {}

    # ── Strip noise ────────────────────────────────────────────────────────────
    # Section headings
    for el in passage.find_all(["h3", "h4", "h5", "h6"]):
        el.decompose()
    # Footnote / crossref blocks
    for cls in ["footnotes", "crossrefs", "full-chap-link",
                "publisher-info-bottom", "passage-other-trans",
                "passage-end-link"]:
        for el in passage.find_all(class_=cls):
            el.decompose()
    # Inline footnote superscripts
    for el in passage.find_all("sup", attrs={"data-fn": True}):
        el.decompose()
    for el in passage.find_all("sup", class_="crossreference"):
        el.decompose()
    # Screen-reader spans (e.g. "Verse 1", "Chapter 1" hidden labels)
    for el in passage.find_all("span", class_="sr-only"):
        el.decompose()
    # ──────────────────────────────────────────────────────────────────────────

    verses: Dict[int, str] = {}
    current_v: Optional[int] = None
    parts = []

    def flush() -> None:
        if current_v is not None and parts:
            text = re.sub(r"\s+", " ", "".join(parts)).strip()
            # Trim leading punctuation artifacts (BG sometimes has stray ¶ or *)
            text = re.sub(r"^[\s¶\*]+", "", text).strip()
            if text:
                verses[current_v] = text

    def walk(node) -> None:
        nonlocal current_v, parts

        if isinstance(node, NavigableString):
            if current_v is not None:
                s = str(node)
                if s.strip():
                    parts.append(s)
            return

        if not isinstance(node, Tag):
            return

        cls = node.get("class", [])

        # ── Verse 1: announced by <span class="chapternum"> ───────────────────
        if node.name == "span" and "chapternum" in cls:
            flush()
            parts = []
            current_v = 1
            return  # don't recurse — we don't want the chapter number as text

        # ── Verses 2+: announced by <sup class="versenum"> ────────────────────
        if node.name == "sup" and "versenum" in cls:
            flush()
            parts = []
            raw = node.get_text(strip=True)
            m = re.search(r"\d+", raw)
            if m:
                current_v = int(m.group())
            return  # don't recurse — we don't want the verse number as text

        # Recurse
        for child in node.children:
            walk(child)

    walk(passage)
    flush()
    return verses


# ──────────────────────────────────────────────────────────────────────────────
# 5.  Triple Combination copy
# ──────────────────────────────────────────────────────────────────────────────

def copy_triple_from_kjv(conn: sqlite3.Connection, kjv_path: str) -> None:
    """
    Copy volumes 3-5 (BOM / D&C / PGP) and their books/chapters/verses
    verbatim from the KJV LDS DB.  verse_ids stay identical so the backend
    verse_id lookup works the same for NRSVUE as for every other language.
    """
    print(f"\n  Copying Triple Combination from {Path(kjv_path).name} …", flush=True)
    kjv = sqlite3.connect(kjv_path)
    kjv_cur = kjv.cursor()

    # ── Volumes 3-5 ───────────────────────────────────────────────────────────
    rows = kjv_cur.execute(
        "SELECT id, volume_title, volume_long_title, volume_subtitle, "
        "       volume_short_title, volume_lds_url FROM volumes WHERE id >= 3"
    ).fetchall()
    conn.executemany(
        "INSERT OR IGNORE INTO volumes VALUES (?,?,?,?,?,?)", rows
    )

    # ── Books ─────────────────────────────────────────────────────────────────
    rows = kjv_cur.execute(
        "SELECT id, volume_id, book_title, book_long_title, book_subtitle, "
        "       book_short_title, book_lds_url FROM books WHERE id >= ?",
        (TRIPLE_BOOK_ID_START,)
    ).fetchall()
    conn.executemany(
        "INSERT OR IGNORE INTO books VALUES (?,?,?,?,?,?,?)", rows
    )

    # ── Chapters ──────────────────────────────────────────────────────────────
    rows = kjv_cur.execute(
        "SELECT id, book_id, chapter_number FROM chapters WHERE id >= ?",
        (TRIPLE_CHAPTER_ID_START,)
    ).fetchall()
    conn.executemany(
        "INSERT OR IGNORE INTO chapters VALUES (?,?,?)", rows
    )

    # ── Verses (batch for performance) ────────────────────────────────────────
    batch_size = 2000
    offset = 0
    total = 0
    while True:
        rows = kjv_cur.execute(
            "SELECT id, chapter_id, verse_number, scripture_text "
            "FROM verses WHERE id >= ? LIMIT ? OFFSET ?",
            (TRIPLE_VERSE_ID_START, batch_size, offset)
        ).fetchall()
        if not rows:
            break
        conn.executemany(
            "INSERT OR IGNORE INTO verses VALUES (?,?,?,?)", rows
        )
        conn.commit()
        total += len(rows)
        offset += batch_size

    kjv.close()
    print(f"  Copied {total:,} Triple Combination verses.", flush=True)


# ──────────────────────────────────────────────────────────────────────────────
# 6.  Main scrape
# ──────────────────────────────────────────────────────────────────────────────

def scrape(
    output_path: str,
    kjv_source: str,
    delay: float,
    retries: int,
    resume: bool,
    build_fts: bool,
    bible_only: bool,
) -> None:
    db_path = Path(output_path)
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    create_schema(conn)

    done_ids   = get_done_chapter_ids(conn) if resume else set()
    chapter_id = 0  # always counts from 0 upward; incremented before use

    # Load KJV verse map for Bible-wide verse_id alignment
    kjv_path = Path(kjv_source)
    if not kjv_path.exists():
        sys.exit(f"[ERROR] KJV source not found: {kjv_path}\n"
                 "        Required to build the verse_id map before scraping.")
    print(f"  Loading KJV verse map from {kjv_path.name} …", flush=True)
    kjv_verse_map = load_kjv_verse_map(str(kjv_path))
    kjv_bible_total = sum(len(v) for v in kjv_verse_map.values())
    print(f"  KJV Bible chapters: {len(kjv_verse_map):,}  verses: {kjv_bible_total:,}", flush=True)

    # ──────────────────────────────────────────────────────────────────────────
    # Seed volumes if not present
    existing_vols = {r[0] for r in conn.execute("SELECT id FROM volumes")}
    for v in VOLUMES:
        if v["id"] not in existing_vols:
            conn.execute(
                "INSERT INTO volumes VALUES (?,?,?,?,?,?)",
                (v["id"], v["title"], v["long_title"], v["subtitle"], v["short"], v["lds_url"])
            )
    conn.commit()

    session = requests.Session()
    total_books = len(BIBLE_BOOKS)

    print("\n" + "=" * 64)
    print("  PHASE 1 — Old Testament  (NRSVUE via BibleGateway)")
    print("=" * 64)

    for bk in OT_BOOKS:
        book_num  = bk["num"]
        book_id   = book_num          # 1-39
        vol_id    = 1                 # Old Testament

        # Insert book row if needed
        existing_books = {r[0] for r in conn.execute("SELECT id FROM books")}
        if book_id not in existing_books:
            conn.execute(
                "INSERT INTO books VALUES (?,?,?,?,?,?,?)",
                (book_id, vol_id, bk["title"], bk["title"], "", bk["short"], "")
            )
            conn.commit()

        scraped_chs = 0
        skipped_chs = 0

        for ch_num in range(1, bk["chapters"] + 1):
            chapter_id += 1

            if chapter_id in done_ids:
                skipped_chs += 1
                print(f"\r  [{book_num:2d}/{total_books}] {bk['title']}  ✓ ({bk['chapters']} chapters) ", flush=True, end="")
                continue

            # Insert chapter row
            conn.execute(
                "INSERT OR IGNORE INTO chapters VALUES (?,?,?)",
                (chapter_id, book_id, ch_num)
            )

            # Fetch
            print(f"\r  [{book_num:2d}/{total_books}] {bk['title']} {ch_num}/{bk['chapters']}  ch={chapter_id}", end="", flush=True)
            html = fetch_chapter(bk["bg_name"], ch_num, session, delay, retries)

            kjv_chapter = kjv_verse_map.get((book_id, ch_num), [])
            scraped = extract_verses(html) if html else {}
            if html and not scraped:
                print(f"\n  [warn] no verses extracted for {bk['title']} {ch_num}", flush=True)
            elif not html:
                print(f"\n  [skip] {bk['title']} {ch_num} — no content, inserting {len(kjv_chapter)} placeholder rows", flush=True)
            for kjv_vid, v_num in kjv_chapter:
                conn.execute(
                    "INSERT OR IGNORE INTO verses VALUES (?,?,?,?)",
                    (kjv_vid, chapter_id, v_num, scraped.get(v_num, ''))
                )
            if scraped:
                scraped_chs += 1

            conn.commit()

        if skipped_chs == bk["chapters"]:
            print(f"\r  [{book_num:2d}/{total_books}] {bk['title']}  ✓ ({bk['chapters']} chapters) {'':30}", flush=True)
        else:
            print(f"\r  [{book_num:2d}/{total_books}] {bk['title']}  ✓ ({scraped_chs} chapters scraped) {'':30}", flush=True)

    print("\n" + "=" * 64)
    print("  PHASE 2 — New Testament  (NRSVUE via BibleGateway)")
    print("=" * 64)

    for bk in NT_BOOKS:
        book_num = bk["num"]
        book_id  = book_num          # 40-66
        vol_id   = 2                 # New Testament

        existing_books = {r[0] for r in conn.execute("SELECT id FROM books")}
        if book_id not in existing_books:
            conn.execute(
                "INSERT INTO books VALUES (?,?,?,?,?,?,?)",
                (book_id, vol_id, bk["title"], bk["title"], "", bk["short"], "")
            )
            conn.commit()

        scraped_chs = 0
        skipped_chs = 0

        for ch_num in range(1, bk["chapters"] + 1):
            chapter_id += 1

            if chapter_id in done_ids:
                skipped_chs += 1
                print(f"\r  [{book_num:2d}/{total_books}] {bk['title']}  ✓ ({bk['chapters']} chapters) ", flush=True, end="")
                continue

            conn.execute(
                "INSERT OR IGNORE INTO chapters VALUES (?,?,?)",
                (chapter_id, book_id, ch_num)
            )

            print(f"\r  [{book_num:2d}/{total_books}] {bk['title']} {ch_num}/{bk['chapters']}  ch={chapter_id}", end="", flush=True)
            html = fetch_chapter(bk["bg_name"], ch_num, session, delay, retries)

            kjv_chapter = kjv_verse_map.get((book_id, ch_num), [])
            scraped = extract_verses(html) if html else {}
            if html and not scraped:
                print(f"\n  [warn] no verses extracted for {bk['title']} {ch_num}", flush=True)
            elif not html:
                print(f"\n  [skip] {bk['title']} {ch_num} — no content, inserting {len(kjv_chapter)} placeholder rows", flush=True)
            for kjv_vid, v_num in kjv_chapter:
                conn.execute(
                    "INSERT OR IGNORE INTO verses VALUES (?,?,?,?)",
                    (kjv_vid, chapter_id, v_num, scraped.get(v_num, ''))
                )
            if scraped:
                scraped_chs += 1

            conn.commit()

        if skipped_chs == bk["chapters"]:
            print(f"\r  [{book_num:2d}/{total_books}] {bk['title']}  ✓ ({bk['chapters']} chapters) {'':30}", flush=True)
        else:
            print(f"\r  [{book_num:2d}/{total_books}] {bk['title']}  ✓ ({scraped_chs} chapters scraped) {'':30}", flush=True)

    bible_verse_count = conn.execute("SELECT COUNT(*) FROM verses").fetchone()[0]
    print(f"\n  Bible complete — {bible_verse_count:,} verses total (expected {kjv_bible_total:,}).", flush=True)

    # ──────────────────────────────────────────────────────────────────────────
    # Phase 3 — Copy Triple Combination from KJV (unless --bible-only)
    # ──────────────────────────────────────────────────────────────────────────
    if not bible_only:
        print("\n" + "=" * 64)
        print("  PHASE 3 — Triple Combination  (copied verbatim from KJV DB)")
        print("=" * 64)

        copy_triple_from_kjv(conn, str(kjv_path))

    # ──────────────────────────────────────────────────────────────────────────
    # Phase 4 — FTS5
    # ──────────────────────────────────────────────────────────────────────────
    if build_fts:
        print("\n" + "=" * 64)
        print("  PHASE 4 — FTS5 full-text index")
        print("=" * 64)
        apply_fts5(conn)

    conn.close()
    size_mb = db_path.stat().st_size / 1_048_576
    print(f"\n  Done.  {db_path.name}  ({size_mb:.1f} MB)\n", flush=True)


# ──────────────────────────────────────────────────────────────────────────────
# 7.  CLI
# ──────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Build nrsvue-scriptures-sqlite.db from BibleGateway + KJV Triple",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--output",     default="nrsvue-scriptures-sqlite.db", metavar="FILE",
                        help="Output SQLite file (default: nrsvue-scriptures-sqlite.db)")
    parser.add_argument("--kjv-source", default="lds-scriptures-sqlite.db",    metavar="FILE",
                        help="KJV DB for Triple Combination + verse_id alignment map (default: lds-scriptures-sqlite.db)")
    parser.add_argument("--delay",      type=float, default=1.2, metavar="SEC",
                        help="Seconds between HTTP requests (default: 1.2)")
    parser.add_argument("--retries",    type=int,   default=4,   metavar="N",
                        help="Max retries per request (default: 4)")
    parser.add_argument("--resume",     action="store_true",
                        help="Skip chapters already present in the output DB")
    parser.add_argument("--no-fts",     action="store_true",
                        help="Skip FTS5 index build")
    parser.add_argument("--bible-only", action="store_true",
                        help="Stop after Bible; skip Triple Combination copy")
    args = parser.parse_args()

    print("\nNRSVUE Scripture Scraper")
    print(f"  Output      : {args.output}")
    print(f"  KJV source  : {args.kjv_source}")
    print(f"  Delay       : {args.delay}s per request")
    print(f"  Retries     : {args.retries}")
    print(f"  Resume      : {args.resume}")
    print(f"  FTS5        : {'skip' if args.no_fts else 'build at end'}")
    print(f"  Triple      : {'skip (--bible-only)' if args.bible_only else 'copy from KJV'}")

    scrape(
        output_path=args.output,
        kjv_source=args.kjv_source,
        delay=args.delay,
        retries=args.retries,
        resume=args.resume,
        build_fts=not args.no_fts,
        bible_only=args.bible_only,
    )
