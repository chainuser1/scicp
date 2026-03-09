#!/usr/bin/env python3
"""
scrape_lds_triple.py
====================
Scrapes the Triple Combination (Book of Mormon, Doctrine & Covenants, and
Pearl of Great Price) from the Church of Jesus Christ of Latter-day Saints
website for any supported language and writes a flat CSV file ready to be
passed directly to append_triple.py.

Usage (Spanish):
    python3 scrape_lds_triple.py --lang spa --output spanish_triple.csv

Usage (Modern Greek):
    python3 scrape_lds_triple.py --lang ell --output greek_triple.csv

Common LDS language codes:
    eng  English       spa  Spanish       ell  Modern Greek
    tgl  Tagalog       ceb  Cebuano       por  Portuguese
    fra  French        deu  German        ita  Italian
    nld  Dutch         rus  Russian       zho  Chinese (Simplified)

General options:
    --delay   FLOAT    Seconds to wait between HTTP requests (default: 1.0)
    --retries INT      Max retries on HTTP errors            (default: 3)
    --resume           If the --output CSV already exists, skip chapters
                       that are fully present and resume from where
                       the previous run stopped.
    --chapter-offset   INT   Starting chapter.id value (default: 1200)
    --verse-offset     INT   Starting verse.id   value (default: 32000)

CSV columns produced (identical to tagalog_triple_combination_mapped.csv):
    volume_id, volume_title, volume_long_title, volume_subtitle,
    volume_short_title, volume_lds_url,
    book_id, book_title, book_long_title, book_subtitle,
    book_short_title, book_lds_url,
    chapter_id, chapter_number, verse_id, verse_number, scripture_text

Notes:
  * Book ids start at 67 (after the 66 Bible books), volume ids at 2.
  * The script is intentionally polite: it sleeps --delay seconds between
    every chapter request and retries with exponential back-off on errors.
  * D&C Official Declarations (OD-1 and OD-2) are appended as sections 139
    and 140 so they sit sequentially after section 138.
"""

import argparse
import csv
import os
import re
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
# 1.  Canonical triple-combination structure
#     Each entry carries the LDS URL slug and chapter count.
#     Book IDs start at 67 (Bible occupies 1-66) and increment per book.
#     Volume IDs: 2 = Book of Mormon, 3 = D&C, 4 = Pearl of Great Price.
# ──────────────────────────────────────────────────────────────────────────────

TRIPLE_STRUCTURE: List[Dict] = [
    # ── Book of Mormon ─────────────────────────────────────────────────────
    {
        "volume": {
            "id":      2,
            "lds_url": "bofm",
            "names": {
                "default": {
                    "title":      "Book of Mormon",
                    "long_title": "The Book of Mormon",
                    "subtitle":   "Another Testament of Jesus Christ",
                    "short_title":"BoM",
                },
                "spa": {
                    "title":      "Libro de Mormon",
                    "long_title": "El Libro de Mormon",
                    "subtitle":   "Otro Testamento de Jesucristo",
                    "short_title":"LM",
                },
                "ell": {
                    "title":      "Vivlio tou Mormon",
                    "long_title": "To Vivlio tou Mormon",
                    "subtitle":   "Mia Akomi Martyria gia ton Iisou Christo",
                    "short_title":"VM",
                },
            },
        },
        "books": [
            # (book_id, url_slug, chapters, English defaults,
            #  spa_names, ell_names)
            # key: names dict mirrors volume names structure
            {"id": 67, "slug": "1-ne",   "canonical": "bofm", "chapters": 22,
             "names": {
                 "default": {"title":"1 Nephi",         "long_title":"The First Book of Nephi",          "subtitle":"His Reign and Ministry",   "short_title":"1 Ne"},
                 "spa":     {"title":"1 Nefi",           "long_title":"Primer Libro de Nefi",             "subtitle":"Su reinado y ministerio",  "short_title":"1 Ne"},
                 "ell":     {"title":"1 Nefi",           "long_title":"Proto Vivlio tou Nefi",            "subtitle":"",                         "short_title":"1 Νε"},
             }},
            {"id": 68, "slug": "2-ne",   "canonical": "bofm", "chapters": 33,
             "names": {
                 "default": {"title":"2 Nephi",         "long_title":"The Second Book of Nephi",         "subtitle":"An Account of the Death of Lehi","short_title":"2 Ne"},
                 "spa":     {"title":"2 Nefi",           "long_title":"Segundo Libro de Nefi",            "subtitle":"",                         "short_title":"2 Ne"},
                 "ell":     {"title":"2 Nefi",           "long_title":"Deftero Vivlio tou Nefi",          "subtitle":"",                         "short_title":"2 Νε"},
             }},
            {"id": 69, "slug": "jacob",  "canonical": "bofm", "chapters": 7,
             "names": {
                 "default": {"title":"Jacob",           "long_title":"The Book of Jacob",                "subtitle":"The Brother of Nephi",     "short_title":"Jac"},
                 "spa":     {"title":"Jacob",            "long_title":"El Libro de Jacob",                "subtitle":"El hermano de Nefi",       "short_title":"Jac"},
                 "ell":     {"title":"Iakobos",          "long_title":"Vivlio tou Iakovou",               "subtitle":"",                         "short_title":"Ιακ"},
             }},
            {"id": 70, "slug": "enos",   "canonical": "bofm", "chapters": 1,
             "names": {
                 "default": {"title":"Enos",            "long_title":"The Book of Enos",                 "subtitle":"",                         "short_title":"En"},
                 "spa":     {"title":"Enos",             "long_title":"El Libro de Enos",                 "subtitle":"",                         "short_title":"En"},
                 "ell":     {"title":"Enos",             "long_title":"Vivlio tou Enos",                  "subtitle":"",                         "short_title":"Εν"},
             }},
            {"id": 71, "slug": "jarom",  "canonical": "bofm", "chapters": 1,
             "names": {
                 "default": {"title":"Jarom",           "long_title":"The Book of Jarom",                "subtitle":"",                         "short_title":"Jar"},
                 "spa":     {"title":"Jarom",            "long_title":"El Libro de Jarom",                "subtitle":"",                         "short_title":"Jar"},
                 "ell":     {"title":"Iarom",            "long_title":"Vivlio tou Iarom",                 "subtitle":"",                         "short_title":"Ιαρ"},
             }},
            {"id": 72, "slug": "omni",   "canonical": "bofm", "chapters": 1,
             "names": {
                 "default": {"title":"Omni",            "long_title":"The Book of Omni",                 "subtitle":"",                         "short_title":"Om"},
                 "spa":     {"title":"Omni",             "long_title":"El Libro de Omni",                 "subtitle":"",                         "short_title":"Om"},
                 "ell":     {"title":"Omni",             "long_title":"Vivlio tou Omni",                  "subtitle":"",                         "short_title":"Ομ"},
             }},
            {"id": 73, "slug": "w-of-m", "canonical": "bofm", "chapters": 1,
             "names": {
                 "default": {"title":"Words of Mormon", "long_title":"The Words of Mormon",              "subtitle":"",                         "short_title":"W of M"},
                 "spa":     {"title":"Palabras de Mormon","long_title":"Las Palabras de Mormon",         "subtitle":"",                         "short_title":"Pal M"},
                 "ell":     {"title":"Logia tou Mormon", "long_title":"Ta Logia tou Mormon",              "subtitle":"",                         "short_title":"ΛΜ"},
             }},
            {"id": 74, "slug": "mosiah", "canonical": "bofm", "chapters": 29,
             "names": {
                 "default": {"title":"Mosiah",          "long_title":"The Book of Mosiah",               "subtitle":"",                         "short_title":"Mos"},
                 "spa":     {"title":"Mosiah",           "long_title":"El Libro de Mosiah",               "subtitle":"",                         "short_title":"Mos"},
                 "ell":     {"title":"Mosia",            "long_title":"Vivlio tou Mosia",                 "subtitle":"",                         "short_title":"Μωσ"},
             }},
            {"id": 75, "slug": "alma",   "canonical": "bofm", "chapters": 63,
             "names": {
                 "default": {"title":"Alma",            "long_title":"The Book of Alma",                 "subtitle":"The Son of Alma",          "short_title":"Alma"},
                 "spa":     {"title":"Alma",             "long_title":"El Libro de Alma",                 "subtitle":"El hijo de Alma",          "short_title":"Alma"},
                 "ell":     {"title":"Alma",             "long_title":"Vivlio tou Alma",                  "subtitle":"",                         "short_title":"Αλμ"},
             }},
            {"id": 76, "slug": "hel",    "canonical": "bofm", "chapters": 16,
             "names": {
                 "default": {"title":"Helaman",         "long_title":"The Book of Helaman",              "subtitle":"",                         "short_title":"Hel"},
                 "spa":     {"title":"Helaman",          "long_title":"El Libro de Helaman",              "subtitle":"",                         "short_title":"Hel"},
                 "ell":     {"title":"Elaman",           "long_title":"Vivlio tou Elaman",                "subtitle":"",                         "short_title":"Ελμ"},
             }},
            {"id": 77, "slug": "3-ne",   "canonical": "bofm", "chapters": 30,
             "names": {
                 "default": {"title":"3 Nephi",         "long_title":"The Third Book of Nephi",          "subtitle":"The Son of Nephi",         "short_title":"3 Ne"},
                 "spa":     {"title":"3 Nefi",           "long_title":"Tercer Libro de Nefi",             "subtitle":"El hijo de Nefi",          "short_title":"3 Ne"},
                 "ell":     {"title":"3 Nefi",           "long_title":"Trito Vivlio tou Nefi",            "subtitle":"",                         "short_title":"3 Νε"},
             }},
            {"id": 78, "slug": "4-ne",   "canonical": "bofm", "chapters": 1,
             "names": {
                 "default": {"title":"4 Nephi",         "long_title":"The Fourth Book of Nephi",         "subtitle":"A Descendant of Nephi",    "short_title":"4 Ne"},
                 "spa":     {"title":"4 Nefi",           "long_title":"Cuarto Libro de Nefi",             "subtitle":"",                         "short_title":"4 Ne"},
                 "ell":     {"title":"4 Nefi",           "long_title":"Tetarto Vivlio tou Nefi",          "subtitle":"",                         "short_title":"4 Νε"},
             }},
            {"id": 79, "slug": "morm",   "canonical": "bofm", "chapters": 9,
             "names": {
                 "default": {"title":"Mormon",          "long_title":"The Book of Mormon",               "subtitle":"",                         "short_title":"Morm"},
                 "spa":     {"title":"Mormon",           "long_title":"El Libro de Mormon",               "subtitle":"",                         "short_title":"Mor"},
                 "ell":     {"title":"Mormon",           "long_title":"Vivlio tou Mormon",                "subtitle":"",                         "short_title":"Μορμ"},
             }},
            {"id": 80, "slug": "ether",  "canonical": "bofm", "chapters": 15,
             "names": {
                 "default": {"title":"Ether",           "long_title":"The Book of Ether",                "subtitle":"",                         "short_title":"Eth"},
                 "spa":     {"title":"Eter",             "long_title":"El Libro de Eter",                 "subtitle":"",                         "short_title":"Eter"},
                 "ell":     {"title":"Ether",            "long_title":"Vivlio tou Ether",                 "subtitle":"",                         "short_title":"Εθρ"},
             }},
            {"id": 81, "slug": "moro",   "canonical": "bofm", "chapters": 10,
             "names": {
                 "default": {"title":"Moroni",          "long_title":"The Book of Moroni",               "subtitle":"",                         "short_title":"Moro"},
                 "spa":     {"title":"Moroni",           "long_title":"El Libro de Moroni",               "subtitle":"",                         "short_title":"Moro"},
                 "ell":     {"title":"Moroni",           "long_title":"Vivlio tou Moroni",                "subtitle":"",                         "short_title":"Μορν"},
             }},
        ],
    },

    # ── Doctrine and Covenants ─────────────────────────────────────────────
    {
        "volume": {
            "id":      3,
            "lds_url": "dc-testament",
            "names": {
                "default": {
                    "title":      "Doctrine and Covenants",
                    "long_title": "The Doctrine and Covenants",
                    "subtitle":   "",
                    "short_title":"D&C",
                },
                "spa": {
                    "title":      "Doctrina y Convenios",
                    "long_title": "La Doctrina y Convenios",
                    "subtitle":   "",
                    "short_title":"DyC",
                },
                "ell": {
                    "title":      "Dogma kai Diathikes",
                    "long_title": "To Dogma kai oi Diathikes",
                    "subtitle":   "",
                    "short_title":"ΔΔ",
                },
            },
        },
        "books": [
            # D&C is treated as a single "book"; each section = one chapter.
            # Sections 1-138 plus Official Declarations 1-2 (sections 139-140).
            {"id": 82, "slug": "dc",  "canonical": "dc-testament", "chapters": 138,
             "names": {
                 "default": {"title":"Doctrine and Covenants", "long_title":"The Doctrine and Covenants",  "subtitle":"","short_title":"D&C"},
                 "spa":     {"title":"Doctrina y Convenios",    "long_title":"La Doctrina y Convenios",     "subtitle":"","short_title":"DyC"},
                 "ell":     {"title":"Dogma kai Diathikes",     "long_title":"To Dogma kai oi Diathikes",   "subtitle":"","short_title":"ΔΔ"},
             }},
            # Official Declarations treated as a separate book so they can
            # be addressed as OD 1:1 and OD 2:1 in the scriptures view.
            {"id": 83, "slug": "od",  "canonical": "dc-testament", "chapters": 2,
             "names": {
                 "default": {"title":"Official Declarations", "long_title":"Official Declarations",        "subtitle":"","short_title":"OD"},
                 "spa":     {"title":"Declaraciones Oficiales","long_title":"Declaraciones Oficiales",      "subtitle":"","short_title":"DO"},
                 "ell":     {"title":"Episimes Dilosis",       "long_title":"Episimes Dilosis",              "subtitle":"","short_title":"ΕΔ"},
             }},
        ],
    },

    # ── Pearl of Great Price ───────────────────────────────────────────────
    {
        "volume": {
            "id":      4,
            "lds_url": "pgp",
            "names": {
                "default": {
                    "title":      "Pearl of Great Price",
                    "long_title": "The Pearl of Great Price",
                    "subtitle":   "",
                    "short_title":"PGP",
                },
                "spa": {
                    "title":      "Perla de Gran Precio",
                    "long_title": "La Perla de Gran Precio",
                    "subtitle":   "",
                    "short_title":"PGP",
                },
                "ell": {
                    "title":      "Polytimo Margaritari",
                    "long_title": "To Polytimo Margaritari",
                    "subtitle":   "",
                    "short_title":"ΠΜ",
                },
            },
        },
        "books": [
            {"id": 84, "slug": "moses",  "canonical": "pgp", "chapters": 8,
             "names": {
                 "default": {"title":"Moses",             "long_title":"The Book of Moses",                 "subtitle":"","short_title":"Moses"},
                 "spa":     {"title":"Moises",             "long_title":"El Libro de Moises",                "subtitle":"","short_title":"Mo"},
                 "ell":     {"title":"Moisis",             "long_title":"Vivlio tou Moisi",                  "subtitle":"","short_title":"Μωσ"},
             }},
            {"id": 85, "slug": "abr",    "canonical": "pgp", "chapters": 5,
             "names": {
                 "default": {"title":"Abraham",           "long_title":"The Book of Abraham",               "subtitle":"","short_title":"Abr"},
                 "spa":     {"title":"Abraham",            "long_title":"El Libro de Abraham",               "subtitle":"","short_title":"Ab"},
                 "ell":     {"title":"Abraam",             "long_title":"Vivlio tou Abraam",                 "subtitle":"","short_title":"Αβρ"},
             }},
            {"id": 86, "slug": "js-m",   "canonical": "pgp", "chapters": 1,
             "names": {
                 "default": {"title":"Joseph Smith—Matthew","long_title":"Joseph Smith—Matthew",             "subtitle":"","short_title":"JS-M"},
                 "spa":     {"title":"Jose Smith-Mateo",   "long_title":"Jose Smith-Mateo",                  "subtitle":"","short_title":"JS-M"},
                 "ell":     {"title":"Iosif Smith-Matthaios","long_title":"Iosif Smith-Matthaios",           "subtitle":"","short_title":"ΙΣΜ"},
             }},
            {"id": 87, "slug": "js-h",   "canonical": "pgp", "chapters": 1,
             "names": {
                 "default": {"title":"Joseph Smith—History","long_title":"Joseph Smith—History",             "subtitle":"","short_title":"JS-H"},
                 "spa":     {"title":"Jose Smith-Historia", "long_title":"Jose Smith-Historia",               "subtitle":"","short_title":"JS-H"},
                 "ell":     {"title":"Iosif Smith-Istoria", "long_title":"Iosif Smith-Istoria",               "subtitle":"","short_title":"ΙΣΙ"},
             }},
            {"id": 88, "slug": "a-of-f", "canonical": "pgp", "chapters": 1,
             "names": {
                 "default": {"title":"Articles of Faith",  "long_title":"The Articles of Faith",            "subtitle":"","short_title":"A of F"},
                 "spa":     {"title":"Articulos de Fe",     "long_title":"Los Articulos de Fe",              "subtitle":"","short_title":"AdF"},
                 "ell":     {"title":"Arthra Pisteos",      "long_title":"Ta Arthra Pisteos",                "subtitle":"","short_title":"ΑΠ"},
             }},
        ],
    },
]

# CSV columns — must exactly match what append_triple.py reads
CSV_COLUMNS = [
    "volume_id", "volume_title", "volume_long_title", "volume_subtitle",
    "volume_short_title", "volume_lds_url",
    "book_id", "book_title", "book_long_title", "book_subtitle",
    "book_short_title", "book_lds_url",
    "chapter_id", "chapter_number",
    "verse_id", "verse_number", "scripture_text",
]

BASE_URL = "https://www.churchofjesuschrist.org/study/scriptures"


# ──────────────────────────────────────────────────────────────────────────────
# 2.  Helpers
# ──────────────────────────────────────────────────────────────────────────────

def get_names(names_dict: Dict, lang: str) -> Dict:
    """Return the best-matching localised name dict for the given lang code."""
    return names_dict.get(lang, names_dict.get("default", {}))


def build_url(canonical: str, book_slug: str, chapter_or_section: int) -> str:
    return f"{BASE_URL}/{canonical}/{book_slug}/{chapter_or_section}"


def build_od_url(od_number: int) -> str:
    return f"{BASE_URL}/dc-testament/od/{od_number}"


def fetch_with_retry(url: str, lang: str, session: requests.Session,
                     delay: float, retries: int) -> Optional[str]:
    """Fetch a URL with retry / exponential back-off.  Returns HTML or None."""
    params = {"lang": lang}
    for attempt in range(1, retries + 1):
        try:
            resp = session.get(url, params=params, timeout=20)
            if resp.status_code == 200:
                time.sleep(delay)
                return resp.text
            if resp.status_code == 404:
                print(f"  [404] {url} — skipping")
                return None
            print(f"  [HTTP {resp.status_code}] {url}  (attempt {attempt}/{retries})")
        except requests.RequestException as exc:
            print(f"  [ERR] {url}: {exc}  (attempt {attempt}/{retries})")
        time.sleep(delay * (2 ** attempt))
    print(f"  [FAIL] Gave up after {retries} retries: {url}")
    return None


def extract_verses(html: str, url: str) -> List[Tuple[int, str]]:
    """
    Parse LDS website HTML and return a list of (verse_number, verse_text).

    The LDS website (churchofjesuschrist.org) renders scripture content
    server-side.  Each verse is a <p class="verse"> element containing a
    <sup class="verse-number"> child for the verse number.  After stripping
    that sup (and any other inline tags like <a> reference links), the
    remaining text is the clean verse content.

    Falls back to paragraph-level extraction for 'prose' sections (e.g.
    Official Declarations, introductory sections) that lack numbered verses.
    """
    soup = BeautifulSoup(html, "html.parser")

    # Primary strategy: <p class="verse">
    verse_tags = soup.find_all("p", class_="verse")
    if verse_tags:
        results = []
        for p in verse_tags:
            sup = p.find("sup", class_="verse-number")
            if sup:
                try:
                    v_num = int(sup.get_text(strip=True))
                except ValueError:
                    continue
                sup.decompose()
            else:
                # fallback: try data-aid or the <a> verse-ref
                aid = p.get("data-aid", "")
                m = re.search(r"\.(\d+)$", aid)
                v_num = int(m.group(1)) if m else len(results) + 1

            # Remove any remaining inline annotation links (they add noise)
            for a in p.find_all("a", class_=re.compile(r"note|ref|footnote")):
                a.decompose()

            text = p.get_text(separator=" ", strip=True)
            text = re.sub(r"\s+", " ", text).strip()
            if text:
                results.append((v_num, text))
        if results:
            return results

    # Secondary strategy: body-block paragraphs (prose content like ODs)
    body = (
        soup.find("div", class_="body-block")
        or soup.find("div", attrs={"class": lambda c: c and "content" in c})
        or soup.find("article")
    )
    if body:
        paragraphs = body.find_all("p")
        results = []
        for i, p in enumerate(paragraphs, start=1):
            # Skip headings, empty paras, footnote blocks
            if p.find(["h1", "h2", "h3", "h4"]):
                continue
            text = p.get_text(separator=" ", strip=True)
            text = re.sub(r"\s+", " ", text).strip()
            if len(text) < 10:
                continue
            results.append((i, text))
        if results:
            return results

    print(f"  [WARN] No verses/paragraphs found in {url}")
    return []


# ──────────────────────────────────────────────────────────────────────────────
# 3.  Resume support — read already-scraped (volume, book, chapter) combos
# ──────────────────────────────────────────────────────────────────────────────

def load_done_chapters(csv_path: Path) -> set:
    """Return a set of (chapter_id,) tuples already present in the CSV."""
    if not csv_path.exists():
        return set()
    done = set()
    with csv_path.open("r", encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            done.add(int(row["chapter_id"]))
    print(f"[RESUME] Found {len(done)} already-fetched chapter IDs in {csv_path}")
    return done


# ──────────────────────────────────────────────────────────────────────────────
# 4.  Main scrape loop
# ──────────────────────────────────────────────────────────────────────────────

def scrape(lang: str, output_path: Path, delay: float, retries: int,
           resume: bool, chapter_offset: int, verse_offset: int) -> None:

    done_chapters: set = load_done_chapters(output_path) if resume else set()

    # Open CSV (append if resume, otherwise overwrite)
    mode = "a" if (resume and output_path.exists()) else "w"
    fh = output_path.open(mode, encoding="utf-8", newline="")
    writer = csv.DictWriter(fh, fieldnames=CSV_COLUMNS)
    if mode == "w":
        writer.writeheader()

    session = requests.Session()
    session.headers.update({
        "User-Agent": (
            "Mozilla/5.0 (compatible; LDS-scripture-scraper/1.0; "
            "+https://github.com/your-org/scicp)"
        ),
        "Accept-Language": f"{lang},en-US;q=0.8",
    })

    chapter_id = chapter_offset
    verse_id   = verse_offset
    total_verses = 0
    total_chapters = 0
    skipped = 0

    # Pre-advance IDs past any already-scraped data in resume mode.
    # We do this by scanning the CSV for the max IDs used.
    if done_chapters:
        try:
            with output_path.open("r", encoding="utf-8", newline="") as rfh:
                reader = csv.DictReader(rfh)
                for row in reader:
                    chapter_id = max(chapter_id, int(row["chapter_id"]) + 1)
                    verse_id   = max(verse_id,   int(row["verse_id"])   + 1)
            print(f"[RESUME] Next chapter_id={chapter_id}, verse_id={verse_id}")
        except Exception:
            pass

    for volume_entry in TRIPLE_STRUCTURE:
        vol = volume_entry["volume"]
        vol_names = get_names(vol["names"], lang)

        vol_row_base = {
            "volume_id":         vol["id"],
            "volume_title":      vol_names["title"],
            "volume_long_title": vol_names["long_title"],
            "volume_subtitle":   vol_names.get("subtitle", ""),
            "volume_short_title":vol_names["short_title"],
            "volume_lds_url":    vol["lds_url"],
        }

        for book_entry in volume_entry["books"]:
            book_names = get_names(book_entry["names"], lang)
            book_lds_url = f"{vol['lds_url']}/{book_entry['slug']}"

            book_row_base = {
                "book_id":         book_entry["id"],
                "book_title":      book_names["title"],
                "book_long_title": book_names["long_title"],
                "book_subtitle":   book_names.get("subtitle", ""),
                "book_short_title":book_names["short_title"],
                "book_lds_url":    book_lds_url,
            }

            chapters_count = book_entry["chapters"]
            print(f"\n[{'bofm' if vol['id']==2 else 'dc' if vol['id']==3 else 'pgp'}] "
                  f"{book_names['title']} ({chapters_count} ch)")

            for ch_num in range(1, chapters_count + 1):
                # Build the URL correctly for D&C sections vs OD numbers
                if book_entry["slug"] == "dc":
                    url = build_url(book_entry["canonical"], "dc", ch_num)
                elif book_entry["slug"] == "od":
                    url = build_od_url(ch_num)
                else:
                    url = build_url(book_entry["canonical"], book_entry["slug"], ch_num)

                # Check resume: assign a preview chapter_id to look up
                preview_cid = chapter_id  # what this chapter WOULD get

                if preview_cid in done_chapters:
                    chapter_id += 1
                    skipped += 1
                    continue

                print(f"  Ch {ch_num:>3} /{chapters_count}  {url}?lang={lang}", end="  ", flush=True)

                html = fetch_with_retry(url, lang, session, delay, retries)
                if html is None:
                    chapter_id += 1
                    continue

                verses = extract_verses(html, url)
                if not verses:
                    chapter_id += 1
                    continue

                print(f"→ {len(verses)} verses")

                for v_num, v_text in verses:
                    row = {
                        **vol_row_base,
                        **book_row_base,
                        "chapter_id":    chapter_id,
                        "chapter_number":ch_num,
                        "verse_id":      verse_id,
                        "verse_number":  v_num,
                        "scripture_text":v_text,
                    }
                    writer.writerow(row)
                    verse_id    += 1
                    total_verses += 1

                chapter_id    += 1
                total_chapters += 1

                # Flush periodically in case of crash
                if total_chapters % 20 == 0:
                    fh.flush()

    fh.close()

    print(f"\n{'='*55}")
    print(f"  Language  : {lang}")
    print(f"  Output    : {output_path}")
    print(f"  Chapters  : {total_chapters}  (skipped {skipped} on resume)")
    print(f"  Verses    : {total_verses}")
    print(f"{'='*55}")
    print("\nDone!  Run append_triple.py to load the CSV into your database:")
    print(f"  python3 append_triple.py --db <your_migrated_bible.db> --csv {output_path}")


# ──────────────────────────────────────────────────────────────────────────────
# 5.  CLI
# ──────────────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Scrape LDS Triple Combination into a CSV for append_triple.py",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--lang",           required=True,
                        help="LDS language code, e.g. spa, ell, tgl, ceb")
    parser.add_argument("--output",         required=True,
                        help="Path for the output CSV file")
    parser.add_argument("--delay",          type=float, default=1.0,
                        help="Seconds between HTTP requests (default: 1.0)")
    parser.add_argument("--retries",        type=int,   default=3,
                        help="Max HTTP retries (default: 3)")
    parser.add_argument("--resume",         action="store_true",
                        help="Resume a previously interrupted scrape")
    parser.add_argument("--chapter-offset", type=int,   default=1200,
                        dest="chapter_offset",
                        help="Starting chapter ID offset (default: 1200)")
    parser.add_argument("--verse-offset",   type=int,   default=32000,
                        dest="verse_offset",
                        help="Starting verse ID offset   (default: 32000)")

    args = parser.parse_args()

    output_path = Path(args.output)
    if output_path.exists() and not args.resume:
        answer = input(f"[WARN] {output_path} exists.  Overwrite? [y/N] ").strip().lower()
        if answer != "y":
            print("Aborted.")
            return

    scrape(
        lang=args.lang,
        output_path=output_path,
        delay=args.delay,
        retries=args.retries,
        resume=args.resume,
        chapter_offset=args.chapter_offset,
        verse_offset=args.verse_offset,
    )


if __name__ == "__main__":
    main()
