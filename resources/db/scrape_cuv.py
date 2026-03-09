#!/usr/bin/env python3
"""
scrape_cuv.py — Build chinese-scriptures-sqlite.db
====================================================
Scrapes the Chinese Union Version (CUV) Bible from BibleGateway, then
scrapes the LDS Triple Combination (Book of Mormon / D&C / Pearl of Great
Price) in Chinese from churchofjesuschrist.org.

The two sources complement each other perfectly:
  • BibleGateway has the complete 66-book Chinese CUV Bible.
  • The LDS website has the complete Chinese Triple Combination but only
    the Pentateuch of the Bible (Joshua onward redirects to the OT index).

Usage:
    python3 scrape_cuv.py
    python3 scrape_cuv.py --resume
    python3 scrape_cuv.py --version CUVMPS          # Simplified instead of Traditional
    python3 scrape_cuv.py --delay 1.5 --no-fts
    python3 scrape_cuv.py --output /path/to/out.db

Options:
    --output    Output .db file             (default: chinese-scriptures-sqlite.db)
    --version   BibleGateway version code   (default: CUVMPT — Traditional)
                Common alternatives: CUVMPS (Simplified), CUVT, CUVS
    --lang      LDS language code           (default: zho — Traditional Chinese)
    --delay     Seconds between requests    (default: 1.2)
    --retries   Max retries per request     (default: 4)
    --resume    Skip already-scraped chapters
    --no-fts    Skip FTS5 index build
    --bible-only  Stop after Bible; skip Triple Combination

ID boundaries (must match every other language DB in this project):
    Bible chapters : 1 – 1 189     Bible verses : 1 – 31 102
    Triple chapters: 1 190 – 1 776  Triple verses: 31 103 – 41 995
"""

import argparse
import re
import sqlite3
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Set

try:
    import requests
    from bs4 import BeautifulSoup, NavigableString, Tag
except ImportError:
    sys.exit(
        "[ERROR] Missing dependencies.  Install with:\n"
        "    pip install requests beautifulsoup4"
    )

# Import LDS Triple scraping helpers from the sibling script
# (avoids duplicating ~200 lines of tested code)
_here = Path(__file__).parent
sys.path.insert(0, str(_here))
from scrape_lds_full import (  # noqa: E402
    TRIPLE_BOOKS,
    fetch_with_retry   as _lds_fetch,
    extract_verses     as _lds_extract,
    fetch_toc_names,
    get_vol_names,
    VOLUME_NAMES,
    existing_ids,
)


# ──────────────────────────────────────────────────────────────────────────────
# 1.  Bible book definitions
#     title    — Traditional Chinese CUV book name (stored as book_title)
#     short    — abbreviated form
#     bg_name  — English name used in BibleGateway's ?search= param
#     chapters — chapter count for iteration
# ──────────────────────────────────────────────────────────────────────────────

BIBLE_BOOKS: List[Dict] = [
    # ── Old Testament ─────────────────────────────────────────────────────────
    {"num":  1, "title": "創世記",       "short": "創",   "bg_name": "Genesis",        "chapters":  50},
    {"num":  2, "title": "出埃及記",     "short": "出",   "bg_name": "Exodus",         "chapters":  40},
    {"num":  3, "title": "利未記",       "short": "利",   "bg_name": "Leviticus",      "chapters":  27},
    {"num":  4, "title": "民數記",       "short": "民",   "bg_name": "Numbers",        "chapters":  36},
    {"num":  5, "title": "申命記",       "short": "申",   "bg_name": "Deuteronomy",    "chapters":  34},
    {"num":  6, "title": "約書亞記",     "short": "書",   "bg_name": "Joshua",         "chapters":  24},
    {"num":  7, "title": "士師記",       "short": "士",   "bg_name": "Judges",         "chapters":  21},
    {"num":  8, "title": "路得記",       "short": "得",   "bg_name": "Ruth",           "chapters":   4},
    {"num":  9, "title": "撒母耳記上",   "short": "撒上", "bg_name": "1 Samuel",       "chapters":  31},
    {"num": 10, "title": "撒母耳記下",   "short": "撒下", "bg_name": "2 Samuel",       "chapters":  24},
    {"num": 11, "title": "列王紀上",     "short": "王上", "bg_name": "1 Kings",        "chapters":  22},
    {"num": 12, "title": "列王紀下",     "short": "王下", "bg_name": "2 Kings",        "chapters":  25},
    {"num": 13, "title": "歷代志上",     "short": "代上", "bg_name": "1 Chronicles",   "chapters":  29},
    {"num": 14, "title": "歷代志下",     "short": "代下", "bg_name": "2 Chronicles",   "chapters":  36},
    {"num": 15, "title": "以斯拉記",     "short": "拉",   "bg_name": "Ezra",           "chapters":  10},
    {"num": 16, "title": "尼希米記",     "short": "尼",   "bg_name": "Nehemiah",       "chapters":  13},
    {"num": 17, "title": "以斯帖記",     "short": "斯",   "bg_name": "Esther",         "chapters":  10},
    {"num": 18, "title": "約伯記",       "short": "伯",   "bg_name": "Job",            "chapters":  42},
    {"num": 19, "title": "詩篇",         "short": "詩",   "bg_name": "Psalms",         "chapters": 150},
    {"num": 20, "title": "箴言",         "short": "箴",   "bg_name": "Proverbs",       "chapters":  31},
    {"num": 21, "title": "傳道書",       "short": "傳",   "bg_name": "Ecclesiastes",   "chapters":  12},
    {"num": 22, "title": "雅歌",         "short": "歌",   "bg_name": "Song of Songs",  "chapters":   8},
    {"num": 23, "title": "以賽亞書",     "short": "賽",   "bg_name": "Isaiah",         "chapters":  66},
    {"num": 24, "title": "耶利米書",     "short": "耶",   "bg_name": "Jeremiah",       "chapters":  52},
    {"num": 25, "title": "耶利米哀歌",   "short": "哀",   "bg_name": "Lamentations",   "chapters":   5},
    {"num": 26, "title": "以西結書",     "short": "結",   "bg_name": "Ezekiel",        "chapters":  48},
    {"num": 27, "title": "但以理書",     "short": "但",   "bg_name": "Daniel",         "chapters":  12},
    {"num": 28, "title": "何西阿書",     "short": "何",   "bg_name": "Hosea",          "chapters":  14},
    {"num": 29, "title": "約珥書",       "short": "珥",   "bg_name": "Joel",           "chapters":   3},
    {"num": 30, "title": "阿摩司書",     "short": "摩",   "bg_name": "Amos",           "chapters":   9},
    {"num": 31, "title": "俄巴底亞書",   "short": "俄",   "bg_name": "Obadiah",        "chapters":   1},
    {"num": 32, "title": "約拿書",       "short": "拿",   "bg_name": "Jonah",          "chapters":   4},
    {"num": 33, "title": "彌迦書",       "short": "彌",   "bg_name": "Micah",          "chapters":   7},
    {"num": 34, "title": "那鴻書",       "short": "鴻",   "bg_name": "Nahum",          "chapters":   3},
    {"num": 35, "title": "哈巴谷書",     "short": "哈",   "bg_name": "Habakkuk",       "chapters":   3},
    {"num": 36, "title": "西番雅書",     "short": "番",   "bg_name": "Zephaniah",      "chapters":   3},
    {"num": 37, "title": "哈該書",       "short": "該",   "bg_name": "Haggai",         "chapters":   2},
    {"num": 38, "title": "撒迦利亞書",   "short": "亞",   "bg_name": "Zechariah",      "chapters":  14},
    {"num": 39, "title": "瑪拉基書",     "short": "瑪",   "bg_name": "Malachi",        "chapters":   4},
    # ── New Testament ─────────────────────────────────────────────────────────
    {"num": 40, "title": "馬太福音",     "short": "太",   "bg_name": "Matthew",        "chapters":  28},
    {"num": 41, "title": "馬可福音",     "short": "可",   "bg_name": "Mark",           "chapters":  16},
    {"num": 42, "title": "路加福音",     "short": "路",   "bg_name": "Luke",           "chapters":  24},
    {"num": 43, "title": "約翰福音",     "short": "約",   "bg_name": "John",           "chapters":  21},
    {"num": 44, "title": "使徒行傳",     "short": "徒",   "bg_name": "Acts",           "chapters":  28},
    {"num": 45, "title": "羅馬書",       "short": "羅",   "bg_name": "Romans",         "chapters":  16},
    {"num": 46, "title": "哥林多前書",   "short": "林前", "bg_name": "1 Corinthians",  "chapters":  16},
    {"num": 47, "title": "哥林多後書",   "short": "林後", "bg_name": "2 Corinthians",  "chapters":  13},
    {"num": 48, "title": "加拉太書",     "short": "加",   "bg_name": "Galatians",      "chapters":   6},
    {"num": 49, "title": "以弗所書",     "short": "弗",   "bg_name": "Ephesians",      "chapters":   6},
    {"num": 50, "title": "腓立比書",     "short": "腓",   "bg_name": "Philippians",    "chapters":   4},
    {"num": 51, "title": "歌羅西書",     "short": "西",   "bg_name": "Colossians",     "chapters":   4},
    {"num": 52, "title": "帖撒羅尼迦前書","short": "帖前","bg_name": "1 Thessalonians","chapters":   5},
    {"num": 53, "title": "帖撒羅尼迦後書","short": "帖後","bg_name": "2 Thessalonians","chapters":   3},
    {"num": 54, "title": "提摩太前書",   "short": "提前", "bg_name": "1 Timothy",      "chapters":   6},
    {"num": 55, "title": "提摩太後書",   "short": "提後", "bg_name": "2 Timothy",      "chapters":   4},
    {"num": 56, "title": "提多書",       "short": "多",   "bg_name": "Titus",          "chapters":   3},
    {"num": 57, "title": "腓利門書",     "short": "門",   "bg_name": "Philemon",       "chapters":   1},
    {"num": 58, "title": "希伯來書",     "short": "來",   "bg_name": "Hebrews",        "chapters":  13},
    {"num": 59, "title": "雅各書",       "short": "雅",   "bg_name": "James",          "chapters":   5},
    {"num": 60, "title": "彼得前書",     "short": "彼前", "bg_name": "1 Peter",        "chapters":   5},
    {"num": 61, "title": "彼得後書",     "short": "彼後", "bg_name": "2 Peter",        "chapters":   3},
    {"num": 62, "title": "約翰一書",     "short": "約一", "bg_name": "1 John",         "chapters":   5},
    {"num": 63, "title": "約翰二書",     "short": "約二", "bg_name": "2 John",         "chapters":   1},
    {"num": 64, "title": "約翰三書",     "short": "約三", "bg_name": "3 John",         "chapters":   1},
    {"num": 65, "title": "猶大書",       "short": "猶",   "bg_name": "Jude",           "chapters":   1},
    {"num": 66, "title": "啟示錄",       "short": "啟",   "bg_name": "Revelation",     "chapters":  22},
]

OT_BOOKS = [b for b in BIBLE_BOOKS if b["num"] <= 39]
NT_BOOKS = [b for b in BIBLE_BOOKS if b["num"] >= 40]

# Volume names (Traditional Chinese)
BIBLE_VOLUMES = [
    {"id": 1, "title": "舊約",     "long_title": "舊約全書",   "subtitle": "", "short": "舊約", "lds_url": "ot"},
    {"id": 2, "title": "新約全書", "long_title": "新約全書",   "subtitle": "", "short": "新約", "lds_url": "nt"},
]

# Triple Combination ID boundaries — must stay in sync across all project DBs
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


def get_max_verse_id(conn: sqlite3.Connection) -> int:
    try:
        return conn.execute("SELECT COALESCE(MAX(id), 0) FROM verses").fetchone()[0]
    except sqlite3.OperationalError:
        return 0


# ──────────────────────────────────────────────────────────────────────────────
# 3.  BibleGateway fetch + parse  (same DOM walk as scrape_nrsvue.py)
# ──────────────────────────────────────────────────────────────────────────────

_BG_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.7",
}


def fetch_bg_chapter(
    book_bg_name: str,
    chapter: int,
    version: str,
    session: requests.Session,
    delay: float,
    retries: int,
) -> Optional[str]:
    """Fetch one chapter from BibleGateway for the given version.  Returns HTML or None."""
    search = f"{book_bg_name} {chapter}"
    url = (
        "https://www.biblegateway.com/passage/"
        f"?search={requests.utils.quote(search)}&version={version}"
    )
    for attempt in range(retries + 1):
        try:
            time.sleep(delay if attempt == 0 else delay * (2 ** attempt))
            resp = session.get(url, headers=_BG_HEADERS, timeout=25)
            if resp.status_code == 404:
                print(f"\n  [404] {book_bg_name} {chapter}", flush=True)
                return None
            if resp.status_code == 429:
                wait = delay * (4 ** (attempt + 1))
                print(f"\n  [429] rate-limited — waiting {wait:.0f}s …", flush=True)
                time.sleep(wait)
                continue
            resp.raise_for_status()
            return resp.text
        except requests.RequestException as exc:
            if attempt < retries:
                print(f"\n  [warn] {book_bg_name} {chapter} attempt {attempt+1}: {exc}", flush=True)
            else:
                print(f"\n  [error] giving up on {book_bg_name} {chapter}: {exc}", flush=True)
                return None
    return None


def extract_bg_verses(html: str) -> Dict[int, str]:
    """
    Parse BibleGateway HTML for a single chapter.
    Uses the same stateful DOM walk as scrape_nrsvue.py —
    works for any BG version regardless of language.

    Returns {verse_number: verse_text}.
    """
    soup = BeautifulSoup(html, "html.parser")
    passage = soup.find("div", class_="passage-text")
    if not passage:
        return {}

    # Strip noise
    for el in passage.find_all(["h3", "h4", "h5", "h6"]):
        el.decompose()
    for cls in ["footnotes", "crossrefs", "full-chap-link",
                "publisher-info-bottom", "passage-other-trans", "passage-end-link"]:
        for el in passage.find_all(class_=cls):
            el.decompose()
    for el in passage.find_all("sup", attrs={"data-fn": True}):
        el.decompose()
    for el in passage.find_all("sup", class_="crossreference"):
        el.decompose()
    for el in passage.find_all("span", class_="sr-only"):
        el.decompose()

    verses: Dict[int, str] = {}
    current_v: Optional[int] = None
    parts: List[str] = []

    def flush() -> None:
        if current_v is not None and parts:
            text = re.sub(r"\s+", " ", "".join(parts)).strip()
            text = re.sub(r"^[\s¶*]+", "", text).strip()
            if text:
                verses[current_v] = text

    def walk(node) -> None:
        nonlocal current_v, parts
        if isinstance(node, NavigableString):
            if current_v is not None and str(node).strip():
                parts.append(str(node))
            return
        if not isinstance(node, Tag):
            return
        cls = node.get("class", [])
        if node.name == "span" and "chapternum" in cls:
            flush(); parts = []; current_v = 1
            return
        if node.name == "sup" and "versenum" in cls:
            flush(); parts = []
            m = re.search(r"\d+", node.get_text(strip=True))
            if m:
                current_v = int(m.group())
            return
        for child in node.children:
            walk(child)

    walk(passage)
    flush()
    return verses


# ──────────────────────────────────────────────────────────────────────────────
# 4.  Main scrape
# ──────────────────────────────────────────────────────────────────────────────

def scrape(
    output_path: str,
    bg_version:  str,
    lds_lang:    str,
    delay:       float,
    retries:     int,
    resume:      bool,
    build_fts:   bool,
    bible_only:  bool,
) -> None:
    db_path = Path(output_path)
    conn    = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    create_schema(conn)

    done_ids   = get_done_chapter_ids(conn) if resume else set()
    verse_id   = get_max_verse_id(conn)     if resume else 0
    chapter_id = 0  # incremented before first use → first chapter gets ID 1

    # Seed Bible volumes
    existing_vols = {r[0] for r in conn.execute("SELECT id FROM volumes")}
    for v in BIBLE_VOLUMES:
        if v["id"] not in existing_vols:
            conn.execute(
                "INSERT INTO volumes VALUES (?,?,?,?,?,?)",
                (v["id"], v["title"], v["long_title"], v["subtitle"], v["short"], v["lds_url"])
            )
    conn.commit()

    bg_session  = requests.Session()
    lds_session = requests.Session()
    lds_session.headers.update({
        "User-Agent":      "Mozilla/5.0 (LDS-Scripture-Scraper/2.0; educational use)",
        "Accept":          "text/html,application/xhtml+xml",
        "Accept-Language": f"{lds_lang},en;q=0.8",
    })

    total_books = len(BIBLE_BOOKS)

    # ── Phase 1: Old Testament ─────────────────────────────────────────────────
    print(f"\n{'='*64}")
    print(f"  PHASE 1 — Old Testament  ({bg_version} via BibleGateway)")
    print(f"{'='*64}")

    for bk in OT_BOOKS:
        book_id = bk["num"]  # 1–39
        ex_books = {r[0] for r in conn.execute("SELECT id FROM books")}
        if book_id not in ex_books:
            conn.execute(
                "INSERT INTO books VALUES (?,?,?,?,?,?,?)",
                (book_id, 1, bk["title"], bk["title"], "", bk["short"], "")
            )
            conn.commit()

        scraped_chs = skipped_chs = 0
        for ch_num in range(1, bk["chapters"] + 1):
            chapter_id += 1
            if chapter_id in done_ids:
                skipped_chs += 1
                continue

            conn.execute("INSERT OR IGNORE INTO chapters VALUES (?,?,?)",
                         (chapter_id, book_id, ch_num))

            print(f"\r  [{book_id:2d}/{total_books}] {bk['title']} {ch_num}/{bk['chapters']}"
                  f"  ch={chapter_id}  v={verse_id}", end="", flush=True)

            html = fetch_bg_chapter(bk["bg_name"], ch_num, bg_version, bg_session, delay, retries)
            if html:
                verses = extract_bg_verses(html)
                for v_num in sorted(verses):
                    verse_id += 1
                    conn.execute("INSERT INTO verses VALUES (?,?,?,?)",
                                 (verse_id, chapter_id, v_num, verses[v_num]))
                if verses:
                    scraped_chs += 1
                else:
                    print(f"\n  [warn] no verses: {bk['title']} {ch_num}", flush=True)
            else:
                print(f"\n  [skip] {bk['title']} {ch_num}", flush=True)
            conn.commit()

        label = f"✓ ({bk['chapters']} chapters)" if skipped_chs == bk["chapters"] \
                else f"✓ ({scraped_chs} chapters scraped)"
        print(f"\r  [{book_id:2d}/{total_books}] {bk['title']}  {label}{'':30}", flush=True)

    # ── Phase 2: New Testament ─────────────────────────────────────────────────
    print(f"\n{'='*64}")
    print(f"  PHASE 2 — New Testament  ({bg_version} via BibleGateway)")
    print(f"{'='*64}")

    for bk in NT_BOOKS:
        book_id = bk["num"]  # 40–66
        ex_books = {r[0] for r in conn.execute("SELECT id FROM books")}
        if book_id not in ex_books:
            conn.execute(
                "INSERT INTO books VALUES (?,?,?,?,?,?,?)",
                (book_id, 2, bk["title"], bk["title"], "", bk["short"], "")
            )
            conn.commit()

        scraped_chs = skipped_chs = 0
        for ch_num in range(1, bk["chapters"] + 1):
            chapter_id += 1
            if chapter_id in done_ids:
                skipped_chs += 1
                continue

            conn.execute("INSERT OR IGNORE INTO chapters VALUES (?,?,?)",
                         (chapter_id, book_id, ch_num))

            print(f"\r  [{book_id:2d}/{total_books}] {bk['title']} {ch_num}/{bk['chapters']}"
                  f"  ch={chapter_id}  v={verse_id}", end="", flush=True)

            html = fetch_bg_chapter(bk["bg_name"], ch_num, bg_version, bg_session, delay, retries)
            if html:
                verses = extract_bg_verses(html)
                for v_num in sorted(verses):
                    verse_id += 1
                    conn.execute("INSERT INTO verses VALUES (?,?,?,?)",
                                 (verse_id, chapter_id, v_num, verses[v_num]))
                if verses:
                    scraped_chs += 1
                else:
                    print(f"\n  [warn] no verses: {bk['title']} {ch_num}", flush=True)
            else:
                print(f"\n  [skip] {bk['title']} {ch_num}", flush=True)
            conn.commit()

        label = f"✓ ({bk['chapters']} chapters)" if skipped_chs == bk["chapters"] \
                else f"✓ ({scraped_chs} chapters scraped)"
        print(f"\r  [{book_id:2d}/{total_books}] {bk['title']}  {label}{'':30}", flush=True)

    print(f"\n  Bible complete — {verse_id:,} verses.", flush=True)

    # ── Phase 3: Triple Combination (LDS website, Chinese) ─────────────────────
    if not bible_only:
        print(f"\n{'='*64}")
        print(f"  PHASE 3 — Triple Combination  (LDS website, lang={lds_lang})")
        print(f"{'='*64}")

        # chapter_id at this point equals the last Bible chapter (1189).
        # The Triple must start at TRIPLE_CHAPTER_ID_START = 1190.
        # Sanity-check the counter; if resuming, fast-forward to the boundary.
        if chapter_id < TRIPLE_CHAPTER_ID_START - 1:
            print(f"  [warn] chapter_id counter is {chapter_id}; "
                  f"expected {TRIPLE_CHAPTER_ID_START - 1}. Adjusting.", flush=True)
            chapter_id = TRIPLE_CHAPTER_ID_START - 1

        toc_cache:     Dict[str, Dict[str, str]] = {}
        existing_vols  = existing_ids(conn, "volumes")
        existing_books = existing_ids(conn, "books")

        for book_def in TRIPLE_BOOKS:
            vol_id  = book_def["volume_id"]
            vol_can = book_def["canonical"]

            if vol_id not in existing_vols:
                vn = get_vol_names(vol_can, lds_lang)
                conn.execute(
                    "INSERT INTO volumes VALUES (?,?,?,?,?,?)",
                    (vol_id, vn.get("title"), vn.get("long_title"),
                     vn.get("subtitle", ""), vn.get("short_title"), vn.get("lds_url"))
                )
                conn.commit()
                existing_vols.add(vol_id)

            if vol_can not in toc_cache:
                print(f"  Fetching {vol_can} book names (lang={lds_lang}) …", flush=True)
                toc_cache[vol_can] = fetch_toc_names(
                    vol_can, lds_lang, lds_session, delay, retries
                )
                print(f"    → {len(toc_cache[vol_can])} entries")

            toc      = toc_cache[vol_can]
            loc_name = toc.get(book_def["slug"], book_def["title_en"])

            if book_def["id"] not in existing_books:
                conn.execute(
                    "INSERT INTO books VALUES (?,?,?,?,?,?,?)",
                    (book_def["id"], vol_id, loc_name, loc_name, "",
                     book_def["short"], book_def["lds_url"])
                )
                conn.commit()
                existing_books.add(book_def["id"])

            batch = 0
            for ch_num in range(1, book_def["chapters"] + 1):
                chapter_id += 1
                if chapter_id in done_ids:
                    continue

                lds_url = (
                    f"https://www.churchofjesuschrist.org"
                    f"/study/scriptures/{vol_can}/{book_def['slug']}/{ch_num}"
                )
                print(
                    f"\r  [{book_def['id']:2d}/87] {loc_name} {ch_num}/{book_def['chapters']}"
                    f"  ch={chapter_id}  v={verse_id}",
                    end="", flush=True
                )

                html = _lds_fetch(lds_url, lds_lang, lds_session, delay, retries)
                verse_pairs: List[Tuple[int, str]] = _lds_extract(html, lds_url) if html else []

                conn.execute("INSERT INTO chapters VALUES (?,?,?)",
                             (chapter_id, book_def["id"], ch_num))
                for v_num, v_text in verse_pairs:
                    verse_id += 1
                    conn.execute("INSERT INTO verses VALUES (?,?,?,?)",
                                 (verse_id, chapter_id, v_num, v_text))

                batch += 1
                if batch % 20 == 0:
                    conn.commit()

            conn.commit()
            print(
                f"\r  [{book_def['id']:2d}/87] {loc_name}"
                f"  ✓ ({book_def['chapters']} chapters){'':30}",
                flush=True
            )

        print(f"\n  Triple done — {verse_id:,} total verses.", flush=True)

    # ── Phase 4: FTS5 ──────────────────────────────────────────────────────────
    if build_fts:
        print(f"\n{'='*64}")
        print("  PHASE 4 — FTS5 full-text index")
        print(f"{'='*64}")
        apply_fts5(conn)

    conn.close()
    size_mb = db_path.resolve().stat().st_size / 1_048_576
    total_ch = chapter_id
    print(f"\n  Done.  {db_path.name}  ({size_mb:.1f} MB)")
    print(f"  Chapters: {total_ch:,}   Verses: {verse_id:,}\n")


# ──────────────────────────────────────────────────────────────────────────────
# 5.  CLI
# ──────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Build chinese-scriptures-sqlite.db from BibleGateway CUV + LDS Triple",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--output",     default="chinese-scriptures-sqlite.db", metavar="FILE",
                        help="Output SQLite file (default: chinese-scriptures-sqlite.db)")
    parser.add_argument("--version",    default="CUVMPT", metavar="CODE",
                        help="BibleGateway version code (default: CUVMPT — Traditional). "
                             "Use CUVMPS for Simplified.")
    parser.add_argument("--lang",       default="zho", metavar="CODE",
                        help="LDS language code for Triple Combination (default: zho)")
    parser.add_argument("--delay",      type=float, default=1.2, metavar="SEC",
                        help="Seconds between HTTP requests (default: 1.2)")
    parser.add_argument("--retries",    type=int,   default=4,   metavar="N",
                        help="Max retries per request (default: 4)")
    parser.add_argument("--resume",     action="store_true",
                        help="Skip chapters already present in the output DB")
    parser.add_argument("--no-fts",     action="store_true",
                        help="Skip FTS5 index build")
    parser.add_argument("--bible-only", action="store_true",
                        help="Stop after Bible; skip Triple Combination")
    args = parser.parse_args()

    print("\nChinese Scripture Scraper  (CUV Bible + LDS Triple)")
    print(f"  Output      : {args.output}")
    print(f"  BG version  : {args.version}")
    print(f"  LDS lang    : {args.lang}")
    print(f"  Delay       : {args.delay}s per request")
    print(f"  Retries     : {args.retries}")
    print(f"  Resume      : {args.resume}")
    print(f"  FTS5        : {'skip' if args.no_fts else 'build at end'}")
    print(f"  Triple      : {'skip (--bible-only)' if args.bible_only else 'scrape from LDS website'}")
    print()

    scrape(
        output_path = args.output,
        bg_version  = args.version,
        lds_lang    = args.lang,
        delay       = args.delay,
        retries     = args.retries,
        resume      = args.resume,
        build_fts   = not args.no_fts,
        bible_only  = args.bible_only,
    )
