#!/usr/bin/env python3
"""
scrape_lds_triple.py
====================
Scrapes the Triple Combination (Book of Mormon, Doctrine & Covenants, and
Pearl of Great Price) from the Church of Jesus Christ of Latter-day Saints
website for any supported language and writes a flat CSV file ready to be
passed directly to append_triple.py.

Usage (Spanish):
    python3 scrape_lds_triple.py --lang spa --output spanish_triple.csv \\
        --chapter-offset 1190 --verse-offset 31103

Usage (Modern Greek):
    python3 scrape_lds_triple.py --lang ell --output greek_triple.csv \\
        --chapter-offset 1190 --verse-offset 31103

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
    --chapter-offset   INT   Starting chapter.id value (default: 1190)
    --verse-offset     INT   Starting verse.id   value (default: 31103)

CSV columns produced (identical to tagalog_triple_combination_mapped.csv):
    volume_id, volume_title, volume_long_title, volume_subtitle,
    volume_short_title, volume_lds_url,
    book_id, book_title, book_long_title, book_subtitle,
    book_short_title, book_lds_url,
    chapter_id, chapter_number, verse_id, verse_number, scripture_text

Notes:
  * Book ids start at 67 (after the 66 Bible books), volume ids at 3
    (volumes 1-2 are OT/NT in English; the migrated language DBs use
    volume 1 for the combined Bible).
  * Volume 3 = Book of Mormon (books 67-81)
  * Volume 4 = Doctrine and Covenants (book 82)
  * Volume 5 = Pearl of Great Price (books 83-87)
  * The script is intentionally polite: it sleeps --delay seconds between
    every chapter request and retries with exponential back-off on errors.
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
#     Volume IDs: 3 = Book of Mormon, 4 = D&C, 5 = Pearl of Great Price.
# ──────────────────────────────────────────────────────────────────────────────

TRIPLE_STRUCTURE: List[Dict] = [
    # ── Book of Mormon ─────────────────────────────────────────────────────
    {
        "volume": {
            "id":      3,
            "lds_url": "bofm",
            "names": {
                "default": {
                    "title":      "Book of Mormon",
                    "long_title": "The Book of Mormon",
                    "subtitle":   "Another Testament of Jesus Christ",
                    "short_title":"BoM",
                },
                "spa": {
                    "title":      "Libro de Mormón",
                    "long_title": "El Libro de Mormón",
                    "subtitle":   "Otro Testamento de Jesucristo",
                    "short_title":"LM",
                },
                "ell": {
                    "title":      "Βιβλίο του Μορμών",
                    "long_title": "Το Βιβλίο του Μορμών",
                    "subtitle":   "Μια Ακόμη Μαρτυρία για τον Ιησού Χριστό",
                    "short_title":"ΒΜ",
                },
            },
        },
        "books": [
            {"id": 67, "slug": "1-ne",   "canonical": "bofm", "chapters": 22,
             "names": {
                 "default": {"title":"1 Nephi",          "long_title":"The First Book of Nephi",           "subtitle":"His Reign and Ministry",   "short_title":"1 Ne"},
                 "spa":     {"title":"1 Nefi",            "long_title":"Primer Libro de Nefi",              "subtitle":"Su reinado y ministerio",  "short_title":"1 Ne"},
                 "ell":     {"title":"1 Νεφί",            "long_title":"Πρώτο Βιβλίο του Νεφί",            "subtitle":"",                         "short_title":"1 Νε"},
             }},
            {"id": 68, "slug": "2-ne",   "canonical": "bofm", "chapters": 33,
             "names": {
                 "default": {"title":"2 Nephi",          "long_title":"The Second Book of Nephi",          "subtitle":"An Account of the Death of Lehi","short_title":"2 Ne"},
                 "spa":     {"title":"2 Nefi",            "long_title":"Segundo Libro de Nefi",             "subtitle":"",                         "short_title":"2 Ne"},
                 "ell":     {"title":"2 Νεφί",            "long_title":"Δεύτερο Βιβλίο του Νεφί",          "subtitle":"",                         "short_title":"2 Νε"},
             }},
            {"id": 69, "slug": "jacob",  "canonical": "bofm", "chapters": 7,
             "names": {
                 "default": {"title":"Jacob",            "long_title":"The Book of Jacob",                 "subtitle":"The Brother of Nephi",     "short_title":"Jac"},
                 "spa":     {"title":"Jacob",             "long_title":"El Libro de Jacob",                 "subtitle":"El hermano de Nefi",       "short_title":"Jac"},
                 "ell":     {"title":"Ιακώβ",             "long_title":"Βιβλίο του Ιακώβ",                  "subtitle":"",                         "short_title":"Ιακ"},
             }},
            {"id": 70, "slug": "enos",   "canonical": "bofm", "chapters": 1,
             "names": {
                 "default": {"title":"Enos",             "long_title":"The Book of Enos",                  "subtitle":"",                         "short_title":"En"},
                 "spa":     {"title":"Enos",              "long_title":"El Libro de Enos",                  "subtitle":"",                         "short_title":"En"},
                 "ell":     {"title":"Ενώς",              "long_title":"Βιβλίο του Ενώς",                   "subtitle":"",                         "short_title":"Εν"},
             }},
            {"id": 71, "slug": "jarom",  "canonical": "bofm", "chapters": 1,
             "names": {
                 "default": {"title":"Jarom",            "long_title":"The Book of Jarom",                 "subtitle":"",                         "short_title":"Jar"},
                 "spa":     {"title":"Jarom",             "long_title":"El Libro de Jarom",                 "subtitle":"",                         "short_title":"Jar"},
                 "ell":     {"title":"Ιαρώμ",             "long_title":"Βιβλίο του Ιαρώμ",                  "subtitle":"",                         "short_title":"Ιαρ"},
             }},
            {"id": 72, "slug": "omni",   "canonical": "bofm", "chapters": 1,
             "names": {
                 "default": {"title":"Omni",             "long_title":"The Book of Omni",                  "subtitle":"",                         "short_title":"Om"},
                 "spa":     {"title":"Omni",              "long_title":"El Libro de Omni",                  "subtitle":"",                         "short_title":"Om"},
                 "ell":     {"title":"Ομνί",              "long_title":"Βιβλίο του Ομνί",                   "subtitle":"",                         "short_title":"Ομ"},
             }},
            {"id": 73, "slug": "w-of-m", "canonical": "bofm", "chapters": 1,
             "names": {
                 "default": {"title":"Words of Mormon",  "long_title":"The Words of Mormon",               "subtitle":"",                         "short_title":"W of M"},
                 "spa":     {"title":"Palabras de Mormón","long_title":"Las Palabras de Mormón",            "subtitle":"",                         "short_title":"Pal M"},
                 "ell":     {"title":"Λόγια του Μορμών", "long_title":"Τα Λόγια του Μορμών",               "subtitle":"",                         "short_title":"ΛΜ"},
             }},
            {"id": 74, "slug": "mosiah", "canonical": "bofm", "chapters": 29,
             "names": {
                 "default": {"title":"Mosiah",           "long_title":"The Book of Mosiah",                "subtitle":"",                         "short_title":"Mos"},
                 "spa":     {"title":"Mosiah",            "long_title":"El Libro de Mosiah",                "subtitle":"",                         "short_title":"Mos"},
                 "ell":     {"title":"Μωσία",             "long_title":"Βιβλίο του Μωσία",                  "subtitle":"",                         "short_title":"Μωσ"},
             }},
            {"id": 75, "slug": "alma",   "canonical": "bofm", "chapters": 63,
             "names": {
                 "default": {"title":"Alma",             "long_title":"The Book of Alma",                  "subtitle":"The Son of Alma",          "short_title":"Alma"},
                 "spa":     {"title":"Alma",              "long_title":"El Libro de Alma",                  "subtitle":"El hijo de Alma",          "short_title":"Alma"},
                 "ell":     {"title":"Άλμα",              "long_title":"Βιβλίο του Άλμα",                   "subtitle":"",                         "short_title":"Αλμ"},
             }},
            {"id": 76, "slug": "hel",    "canonical": "bofm", "chapters": 16,
             "names": {
                 "default": {"title":"Helaman",          "long_title":"The Book of Helaman",               "subtitle":"",                         "short_title":"Hel"},
                 "spa":     {"title":"Helamán",           "long_title":"El Libro de Helamán",               "subtitle":"",                         "short_title":"Hel"},
                 "ell":     {"title":"Ελαμάν",            "long_title":"Βιβλίο του Ελαμάν",                 "subtitle":"",                         "short_title":"Ελμ"},
             }},
            {"id": 77, "slug": "3-ne",   "canonical": "bofm", "chapters": 30,
             "names": {
                 "default": {"title":"3 Nephi",          "long_title":"The Third Book of Nephi",           "subtitle":"The Son of Nephi",         "short_title":"3 Ne"},
                 "spa":     {"title":"3 Nefi",            "long_title":"Tercer Libro de Nefi",              "subtitle":"El hijo de Nefi",          "short_title":"3 Ne"},
                 "ell":     {"title":"3 Νεφί",            "long_title":"Τρίτο Βιβλίο του Νεφί",            "subtitle":"",                         "short_title":"3 Νε"},
             }},
            {"id": 78, "slug": "4-ne",   "canonical": "bofm", "chapters": 1,
             "names": {
                 "default": {"title":"4 Nephi",          "long_title":"The Fourth Book of Nephi",          "subtitle":"A Descendant of Nephi",    "short_title":"4 Ne"},
                 "spa":     {"title":"4 Nefi",            "long_title":"Cuarto Libro de Nefi",              "subtitle":"",                         "short_title":"4 Ne"},
                 "ell":     {"title":"4 Νεφί",            "long_title":"Τέταρτο Βιβλίο του Νεφί",          "subtitle":"",                         "short_title":"4 Νε"},
             }},
            {"id": 79, "slug": "morm",   "canonical": "bofm", "chapters": 9,
             "names": {
                 "default": {"title":"Mormon",           "long_title":"The Book of Mormon",                "subtitle":"",                         "short_title":"Morm"},
                 "spa":     {"title":"Mormón",            "long_title":"El Libro de Mormón",                "subtitle":"",                         "short_title":"Mor"},
                 "ell":     {"title":"Μορμών",            "long_title":"Βιβλίο του Μορμών",                 "subtitle":"",                         "short_title":"Μορμ"},
             }},
            {"id": 80, "slug": "ether",  "canonical": "bofm", "chapters": 15,
             "names": {
                 "default": {"title":"Ether",            "long_title":"The Book of Ether",                 "subtitle":"",                         "short_title":"Eth"},
                 "spa":     {"title":"Éter",              "long_title":"El Libro de Éter",                  "subtitle":"",                         "short_title":"Éter"},
                 "ell":     {"title":"Εθήρ",              "long_title":"Βιβλίο του Εθήρ",                   "subtitle":"",                         "short_title":"Εθρ"},
             }},
            {"id": 81, "slug": "moro",   "canonical": "bofm", "chapters": 10,
             "names": {
                 "default": {"title":"Moroni",           "long_title":"The Book of Moroni",                "subtitle":"",                         "short_title":"Moro"},
                 "spa":     {"title":"Moroni",            "long_title":"El Libro de Moroni",                "subtitle":"",                         "short_title":"Moro"},
                 "ell":     {"title":"Μορόνι",            "long_title":"Βιβλίο του Μορόνι",                 "subtitle":"",                         "short_title":"Μορν"},
             }},
        ],
    },

    # ── Doctrine and Covenants ─────────────────────────────────────────────
    {
        "volume": {
            "id":      4,
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
                    "title":      "Διδαχή και Διαθήκες",
                    "long_title": "Η Διδαχή και οι Διαθήκες",
                    "subtitle":   "",
                    "short_title":"ΔΔ",
                },
            },
        },
        "books": [
            # D&C is treated as a single "book"; each section = one chapter.
            {"id": 82, "slug": "dc", "canonical": "dc-testament", "chapters": 138,
             "names": {
                 "default": {"title":"Doctrine and Covenants", "long_title":"The Doctrine and Covenants",   "subtitle":"","short_title":"D&C"},
                 "spa":     {"title":"Doctrina y Convenios",    "long_title":"La Doctrina y Convenios",      "subtitle":"","short_title":"DyC"},
                 "ell":     {"title":"Διδαχή και Διαθήκες",    "long_title":"Η Διδαχή και οι Διαθήκες",    "subtitle":"","short_title":"ΔΔ"},
             }},
        ],
    },

    # ── Pearl of Great Price ───────────────────────────────────────────────
    {
        "volume": {
            "id":      5,
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
                    "title":      "Πολύτιμη Μαργαρίτα",
                    "long_title": "Η Πολύτιμη Μαργαρίτα",
                    "subtitle":   "",
                    "short_title":"ΠΜ",
                },
            },
        },
        "books": [
            {"id": 83, "slug": "moses",  "canonical": "pgp", "chapters": 8,
             "names": {
                 "default": {"title":"Moses",              "long_title":"The Book of Moses",                 "subtitle":"","short_title":"Moses"},
                 "spa":     {"title":"Moisés",              "long_title":"El Libro de Moisés",                "subtitle":"","short_title":"Mo"},
                 "ell":     {"title":"Μωυσής",              "long_title":"Βιβλίο του Μωυσή",                  "subtitle":"","short_title":"Μωσ"},
             }},
            {"id": 84, "slug": "abr",    "canonical": "pgp", "chapters": 5,
             "names": {
                 "default": {"title":"Abraham",            "long_title":"The Book of Abraham",               "subtitle":"","short_title":"Abr"},
                 "spa":     {"title":"Abraham",             "long_title":"El Libro de Abraham",               "subtitle":"","short_title":"Ab"},
                 "ell":     {"title":"Αβραάμ",              "long_title":"Βιβλίο του Αβραάμ",                 "subtitle":"","short_title":"Αβρ"},
             }},
            {"id": 85, "slug": "js-m",   "canonical": "pgp", "chapters": 1,
             "names": {
                 "default": {"title":"Joseph Smith—Matthew", "long_title":"Joseph Smith—Matthew",             "subtitle":"","short_title":"JS-M"},
                 "spa":     {"title":"José Smith—Mateo",     "long_title":"José Smith—Mateo",                  "subtitle":"","short_title":"JS-M"},
                 "ell":     {"title":"Ιωσήφ Σμιθ—Ματθαίος", "long_title":"Ιωσήφ Σμιθ—Ματθαίος",             "subtitle":"","short_title":"ΙΣΜ"},
             }},
            {"id": 86, "slug": "js-h",   "canonical": "pgp", "chapters": 1,
             "names": {
                 "default": {"title":"Joseph Smith—History", "long_title":"Joseph Smith—History",             "subtitle":"","short_title":"JS-H"},
                 "spa":     {"title":"José Smith—Historia",  "long_title":"José Smith—Historia",               "subtitle":"","short_title":"JS-H"},
                 "ell":     {"title":"Ιωσήφ Σμιθ—Ιστορία",  "long_title":"Ιωσήφ Σμιθ—Ιστορία",               "subtitle":"","short_title":"ΙΣΙ"},
             }},
            {"id": 87, "slug": "a-of-f", "canonical": "pgp", "chapters": 1,
             "names": {
                 "default": {"title":"Articles of Faith",   "long_title":"The Articles of Faith",            "subtitle":"","short_title":"A of F"},
                 "spa":     {"title":"Artículos de Fe",      "long_title":"Los Artículos de Fe",               "subtitle":"","short_title":"AdF"},
                 "ell":     {"title":"Άρθρα Πίστεως",        "long_title":"Τα Άρθρα Πίστεως",                  "subtitle":"","short_title":"ΑΠ"},
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


def fetch_with_retry(url: str, lang: str, session: requests.Session,
                     delay: float, retries: int) -> Optional[str]:
    """Fetch a URL with retry / exponential back-off.  Returns HTML or None."""
    params = {"lang": lang}
    for attempt in range(1, retries + 1):
        try:
            resp = session.get(url, params=params, timeout=20)
            if resp.status_code == 200:
                resp.encoding = "utf-8"   # LDS site is UTF-8; requests may default to ISO-8859-1
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
    introductory sections) that lack numbered verses.
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
                # fallback: try data-aid or sequential numbering
                aid = p.get("data-aid", "")
                m = re.search(r"\.(\d+)$", aid)
                v_num = int(m.group(1)) if m else len(results) + 1

            # Strip only the reference marker superscripts inside annotation links;
            # the <a> element itself may contain actual scripture words, so keep it.
            for sup in p.find_all("sup", class_=re.compile(r"marker|note|ref")):
                sup.decompose()

            text = p.get_text(separator=" ", strip=True)
            text = re.sub(r"\s+", " ", text).strip()
            if text:
                results.append((v_num, text))
        if results:
            return results

    # Secondary strategy: body-block paragraphs (prose content)
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
# 3.  Resume support — read already-scraped chapter IDs
# ──────────────────────────────────────────────────────────────────────────────

def load_done_chapters(csv_path: Path) -> set:
    """Return a set of chapter_id ints already present in the CSV."""
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
            "Mozilla/5.0 (compatible; LDS-scripture-scraper/1.0)"
        ),
        "Accept-Language": f"{lang},en-US;q=0.8",
    })

    chapter_id = chapter_offset
    verse_id   = verse_offset
    total_verses = 0
    total_chapters = 0
    skipped = 0

    # Pre-advance IDs past any already-scraped data in resume mode.
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

    vol_labels = {3: "bofm", 4: "dc", 5: "pgp"}

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
            label = vol_labels.get(vol["id"], str(vol["id"]))
            print(f"\n[{label}] {book_names['title']} ({chapters_count} ch)")

            for ch_num in range(1, chapters_count + 1):
                url = build_url(book_entry["canonical"], book_entry["slug"], ch_num)

                # Check resume
                preview_cid = chapter_id
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
    parser.add_argument("--chapter-offset", type=int,   default=1190,
                        dest="chapter_offset",
                        help="Starting chapter ID offset (default: 1190)")
    parser.add_argument("--verse-offset",   type=int,   default=31103,
                        dest="verse_offset",
                        help="Starting verse ID offset   (default: 31103)")

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
