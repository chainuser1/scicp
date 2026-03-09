#!/usr/bin/env python3
"""
scrape_lds_full.py
==================
Scrapes the complete Standard Works (Bible + Triple Combination) from the
Church of Jesus Christ of Latter-day Saints website **for any language** and
builds a complete SQLite database in the project's LDS scriptures schema.

The script is self-contained: localised book names are fetched live from the
LDS website TOC pages, so no hardcoded translations are needed beyond the
volume metadata included below.

Usage (Japanese):
    python3 scrape_lds_full.py --lang jpn --output japanese-scriptures-sqlite.db

Usage (Simplified Chinese):
    python3 scrape_lds_full.py --lang zho --output chinese-scriptures-sqlite.db

Usage (resume an interrupted run):
    python3 scrape_lds_full.py --lang jpn --output japanese-scriptures-sqlite.db --resume

Usage (Bible only — Triple Combination separately):
    python3 scrape_lds_full.py --lang jpn --output japanese-scriptures-sqlite.db --bible-only
    python3 scrape_lds_full.py --lang jpn --output japanese-scriptures-sqlite.db --triple-only --resume

Common LDS language codes
    jpn  Japanese              zho  Chinese (Simplified)
    eng  English               spa  Spanish
    ell  Modern Greek          tgl  Tagalog / Filipino
    ceb  Cebuano               ilo  Ilocano (RIPV)
    por  Portuguese            fra  French
    deu  German                kor  Korean
    rus  Russian               ara  Arabic

Options:
    --lang        LDS language code  (required)
    --output      Output .db path    (required)
    --delay       Seconds between requests  (default: 1.0)
    --retries     Max HTTP retries          (default: 3)
    --resume      Skip chapters already present in the DB
    --no-fts      Skip building the FTS5 full-text search index
    --bible-only  Only scrape the Bible (volumes 1–2)
    --triple-only Only scrape the Triple Combination (volumes 3–5)
                  Requires --resume and an existing DB with the Bible already in it.

Output schema (identical to all other project .db files):
    volumes → books → chapters → verses
    scriptures  VIEW (joined, read-only)
    scriptures_fts  FTS5 virtual table

ID boundaries (standard across all project DBs):
    Bible chapters : 1 – 1 189     Bible verses : 1 – 31 102
    Triple chapters: 1 190 – 1 776  Triple verses: 31 103 – 41 995
"""

import argparse
import re
import sqlite3
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    sys.exit(
        "[ERROR] Missing dependencies.  Install with:\n"
        "    pip install requests beautifulsoup4"
    )


# ──────────────────────────────────────────────────────────────────────────────
# 1.  Bible structure — 66 books, LDS URL slugs, KJV chapter counts
# ──────────────────────────────────────────────────────────────────────────────

BIBLE_BOOKS: List[Dict] = [
    # ── Old Testament (canonical = "ot") ──────────────────────────────────────
    {"num":  1, "canonical": "ot", "slug": "gen",   "chapters":  50, "short": "Gen",    "title_en": "Genesis"},
    {"num":  2, "canonical": "ot", "slug": "ex",    "chapters":  40, "short": "Ex",     "title_en": "Exodus"},
    {"num":  3, "canonical": "ot", "slug": "lev",   "chapters":  27, "short": "Lev",    "title_en": "Leviticus"},
    {"num":  4, "canonical": "ot", "slug": "num",   "chapters":  36, "short": "Num",    "title_en": "Numbers"},
    {"num":  5, "canonical": "ot", "slug": "deut",  "chapters":  34, "short": "Deut",   "title_en": "Deuteronomy"},
    {"num":  6, "canonical": "ot", "slug": "josh",  "chapters":  24, "short": "Josh",   "title_en": "Joshua"},
    {"num":  7, "canonical": "ot", "slug": "judg",  "chapters":  21, "short": "Judg",   "title_en": "Judges"},
    {"num":  8, "canonical": "ot", "slug": "ruth",  "chapters":   4, "short": "Ruth",   "title_en": "Ruth"},
    {"num":  9, "canonical": "ot", "slug": "1-sam", "chapters":  31, "short": "1 Sam",  "title_en": "1 Samuel"},
    {"num": 10, "canonical": "ot", "slug": "2-sam", "chapters":  24, "short": "2 Sam",  "title_en": "2 Samuel"},
    {"num": 11, "canonical": "ot", "slug": "1-kgs", "chapters":  22, "short": "1 Kgs",  "title_en": "1 Kings"},
    {"num": 12, "canonical": "ot", "slug": "2-kgs", "chapters":  25, "short": "2 Kgs",  "title_en": "2 Kings"},
    {"num": 13, "canonical": "ot", "slug": "1-chr", "chapters":  29, "short": "1 Chr",  "title_en": "1 Chronicles"},
    {"num": 14, "canonical": "ot", "slug": "2-chr", "chapters":  36, "short": "2 Chr",  "title_en": "2 Chronicles"},
    {"num": 15, "canonical": "ot", "slug": "ezra",  "chapters":  10, "short": "Ezra",   "title_en": "Ezra"},
    {"num": 16, "canonical": "ot", "slug": "neh",   "chapters":  13, "short": "Neh",    "title_en": "Nehemiah"},
    {"num": 17, "canonical": "ot", "slug": "esth",  "chapters":  10, "short": "Esth",   "title_en": "Esther"},
    {"num": 18, "canonical": "ot", "slug": "job",   "chapters":  42, "short": "Job",    "title_en": "Job"},
    {"num": 19, "canonical": "ot", "slug": "ps",    "chapters": 150, "short": "Ps",     "title_en": "Psalms"},
    {"num": 20, "canonical": "ot", "slug": "prov",  "chapters":  31, "short": "Prov",   "title_en": "Proverbs"},
    {"num": 21, "canonical": "ot", "slug": "eccl",  "chapters":  12, "short": "Eccl",   "title_en": "Ecclesiastes"},
    {"num": 22, "canonical": "ot", "slug": "song",  "chapters":   8, "short": "Song",   "title_en": "Song of Solomon"},
    {"num": 23, "canonical": "ot", "slug": "isa",   "chapters":  66, "short": "Isa",    "title_en": "Isaiah"},
    {"num": 24, "canonical": "ot", "slug": "jer",   "chapters":  52, "short": "Jer",    "title_en": "Jeremiah"},
    {"num": 25, "canonical": "ot", "slug": "lam",   "chapters":   5, "short": "Lam",    "title_en": "Lamentations"},
    {"num": 26, "canonical": "ot", "slug": "ezek",  "chapters":  48, "short": "Ezek",   "title_en": "Ezekiel"},
    {"num": 27, "canonical": "ot", "slug": "dan",   "chapters":  12, "short": "Dan",    "title_en": "Daniel"},
    {"num": 28, "canonical": "ot", "slug": "hosea", "chapters":  14, "short": "Hos",    "title_en": "Hosea"},
    {"num": 29, "canonical": "ot", "slug": "joel",  "chapters":   3, "short": "Joel",   "title_en": "Joel"},
    {"num": 30, "canonical": "ot", "slug": "amos",  "chapters":   9, "short": "Amos",   "title_en": "Amos"},
    {"num": 31, "canonical": "ot", "slug": "obad",  "chapters":   1, "short": "Obad",   "title_en": "Obadiah"},
    {"num": 32, "canonical": "ot", "slug": "jonah", "chapters":   4, "short": "Jonah",  "title_en": "Jonah"},
    {"num": 33, "canonical": "ot", "slug": "micah", "chapters":   7, "short": "Micah",  "title_en": "Micah"},
    {"num": 34, "canonical": "ot", "slug": "nahum", "chapters":   3, "short": "Nah",    "title_en": "Nahum"},
    {"num": 35, "canonical": "ot", "slug": "hab",   "chapters":   3, "short": "Hab",    "title_en": "Habakkuk"},
    {"num": 36, "canonical": "ot", "slug": "zeph",  "chapters":   3, "short": "Zeph",   "title_en": "Zephaniah"},
    {"num": 37, "canonical": "ot", "slug": "hag",   "chapters":   2, "short": "Hag",    "title_en": "Haggai"},
    {"num": 38, "canonical": "ot", "slug": "zech",  "chapters":  14, "short": "Zech",   "title_en": "Zechariah"},
    {"num": 39, "canonical": "ot", "slug": "mal",   "chapters":   4, "short": "Mal",    "title_en": "Malachi"},
    # ── New Testament (canonical = "nt") ──────────────────────────────────────
    {"num": 40, "canonical": "nt", "slug": "matt",   "chapters": 28, "short": "Matt",   "title_en": "Matthew"},
    {"num": 41, "canonical": "nt", "slug": "mark",   "chapters": 16, "short": "Mark",   "title_en": "Mark"},
    {"num": 42, "canonical": "nt", "slug": "luke",   "chapters": 24, "short": "Luke",   "title_en": "Luke"},
    {"num": 43, "canonical": "nt", "slug": "john",   "chapters": 21, "short": "John",   "title_en": "John"},
    {"num": 44, "canonical": "nt", "slug": "acts",   "chapters": 28, "short": "Acts",   "title_en": "Acts"},
    {"num": 45, "canonical": "nt", "slug": "rom",    "chapters": 16, "short": "Rom",    "title_en": "Romans"},
    {"num": 46, "canonical": "nt", "slug": "1-cor",  "chapters": 16, "short": "1 Cor",  "title_en": "1 Corinthians"},
    {"num": 47, "canonical": "nt", "slug": "2-cor",  "chapters": 13, "short": "2 Cor",  "title_en": "2 Corinthians"},
    {"num": 48, "canonical": "nt", "slug": "gal",    "chapters":  6, "short": "Gal",    "title_en": "Galatians"},
    {"num": 49, "canonical": "nt", "slug": "eph",    "chapters":  6, "short": "Eph",    "title_en": "Ephesians"},
    {"num": 50, "canonical": "nt", "slug": "philip", "chapters":  4, "short": "Philip", "title_en": "Philippians"},
    {"num": 51, "canonical": "nt", "slug": "col",    "chapters":  4, "short": "Col",    "title_en": "Colossians"},
    {"num": 52, "canonical": "nt", "slug": "1-thes", "chapters":  5, "short": "1 Thes", "title_en": "1 Thessalonians"},
    {"num": 53, "canonical": "nt", "slug": "2-thes", "chapters":  3, "short": "2 Thes", "title_en": "2 Thessalonians"},
    {"num": 54, "canonical": "nt", "slug": "1-tim",  "chapters":  6, "short": "1 Tim",  "title_en": "1 Timothy"},
    {"num": 55, "canonical": "nt", "slug": "2-tim",  "chapters":  4, "short": "2 Tim",  "title_en": "2 Timothy"},
    {"num": 56, "canonical": "nt", "slug": "titus",  "chapters":  3, "short": "Titus",  "title_en": "Titus"},
    {"num": 57, "canonical": "nt", "slug": "philem", "chapters":  1, "short": "Phlm",   "title_en": "Philemon"},
    {"num": 58, "canonical": "nt", "slug": "heb",    "chapters": 13, "short": "Heb",    "title_en": "Hebrews"},
    {"num": 59, "canonical": "nt", "slug": "james",  "chapters":  5, "short": "James",  "title_en": "James"},
    {"num": 60, "canonical": "nt", "slug": "1-pet",  "chapters":  5, "short": "1 Pet",  "title_en": "1 Peter"},
    {"num": 61, "canonical": "nt", "slug": "2-pet",  "chapters":  3, "short": "2 Pet",  "title_en": "2 Peter"},
    {"num": 62, "canonical": "nt", "slug": "1-jn",   "chapters":  5, "short": "1 Jn",   "title_en": "1 John"},
    {"num": 63, "canonical": "nt", "slug": "2-jn",   "chapters":  1, "short": "2 Jn",   "title_en": "2 John"},
    {"num": 64, "canonical": "nt", "slug": "3-jn",   "chapters":  1, "short": "3 Jn",   "title_en": "3 John"},
    {"num": 65, "canonical": "nt", "slug": "jude",   "chapters":  1, "short": "Jude",   "title_en": "Jude"},
    {"num": 66, "canonical": "nt", "slug": "rev",    "chapters": 22, "short": "Rev",    "title_en": "Revelation"},
]


# ──────────────────────────────────────────────────────────────────────────────
# 2.  Triple Combination structure — 21 books (IDs 67–87), volumes 3–5.
#     Chapter counts are canonical and language-agnostic.
# ──────────────────────────────────────────────────────────────────────────────

TRIPLE_BOOKS: List[Dict] = [
    # ── Book of Mormon (volume_id = 3) ────────────────────────────────────────
    {"volume_id": 3, "canonical": "bofm",         "id": 67, "slug": "1-ne",   "chapters": 22, "lds_url": "bofm/1-ne",    "short": "1 Ne",   "title_en": "1 Nephi",              "long_en": "The First Book of Nephi"},
    {"volume_id": 3, "canonical": "bofm",         "id": 68, "slug": "2-ne",   "chapters": 33, "lds_url": "bofm/2-ne",    "short": "2 Ne",   "title_en": "2 Nephi",              "long_en": "The Second Book of Nephi"},
    {"volume_id": 3, "canonical": "bofm",         "id": 69, "slug": "jacob",  "chapters":  7, "lds_url": "bofm/jacob",   "short": "Jacob",  "title_en": "Jacob",                "long_en": "The Book of Jacob"},
    {"volume_id": 3, "canonical": "bofm",         "id": 70, "slug": "enos",   "chapters":  1, "lds_url": "bofm/enos",    "short": "Enos",   "title_en": "Enos",                 "long_en": "The Book of Enos"},
    {"volume_id": 3, "canonical": "bofm",         "id": 71, "slug": "jarom",  "chapters":  1, "lds_url": "bofm/jarom",   "short": "Jarom",  "title_en": "Jarom",                "long_en": "The Book of Jarom"},
    {"volume_id": 3, "canonical": "bofm",         "id": 72, "slug": "omni",   "chapters":  1, "lds_url": "bofm/omni",    "short": "Omni",   "title_en": "Omni",                 "long_en": "The Book of Omni"},
    {"volume_id": 3, "canonical": "bofm",         "id": 73, "slug": "w-of-m", "chapters":  1, "lds_url": "bofm/w-of-m",  "short": "W of M", "title_en": "Words of Mormon",      "long_en": "The Words of Mormon"},
    {"volume_id": 3, "canonical": "bofm",         "id": 74, "slug": "mosiah", "chapters": 29, "lds_url": "bofm/mosiah",  "short": "Mosiah", "title_en": "Mosiah",               "long_en": "The Book of Mosiah"},
    {"volume_id": 3, "canonical": "bofm",         "id": 75, "slug": "alma",   "chapters": 63, "lds_url": "bofm/alma",    "short": "Alma",   "title_en": "Alma",                 "long_en": "The Book of Alma"},
    {"volume_id": 3, "canonical": "bofm",         "id": 76, "slug": "hel",    "chapters": 16, "lds_url": "bofm/hel",     "short": "Hel",    "title_en": "Helaman",              "long_en": "The Book of Helaman"},
    {"volume_id": 3, "canonical": "bofm",         "id": 77, "slug": "3-ne",   "chapters": 30, "lds_url": "bofm/3-ne",    "short": "3 Ne",   "title_en": "3 Nephi",              "long_en": "The Third Book of Nephi"},
    {"volume_id": 3, "canonical": "bofm",         "id": 78, "slug": "4-ne",   "chapters":  1, "lds_url": "bofm/4-ne",    "short": "4 Ne",   "title_en": "4 Nephi",              "long_en": "The Fourth Book of Nephi"},
    {"volume_id": 3, "canonical": "bofm",         "id": 79, "slug": "morm",   "chapters":  9, "lds_url": "bofm/morm",    "short": "Morm",   "title_en": "Mormon",               "long_en": "The Book of Mormon"},
    {"volume_id": 3, "canonical": "bofm",         "id": 80, "slug": "ether",  "chapters": 15, "lds_url": "bofm/ether",   "short": "Ether",  "title_en": "Ether",                "long_en": "The Book of Ether"},
    {"volume_id": 3, "canonical": "bofm",         "id": 81, "slug": "moro",   "chapters": 10, "lds_url": "bofm/moro",    "short": "Moro",   "title_en": "Moroni",               "long_en": "The Book of Moroni"},
    # ── Doctrine and Covenants (volume_id = 4) ────────────────────────────────
    # Single "book"; each of the 138 sections = one chapter.
    {"volume_id": 4, "canonical": "dc-testament", "id": 82, "slug": "dc",     "chapters": 138, "lds_url": "dc-testament/dc", "short": "D&C",  "title_en": "Doctrine and Covenants", "long_en": "The Doctrine and Covenants"},
    # ── Pearl of Great Price (volume_id = 5) ──────────────────────────────────
    {"volume_id": 5, "canonical": "pgp",          "id": 83, "slug": "moses",  "chapters":  8, "lds_url": "pgp/moses",    "short": "Moses",  "title_en": "Moses",                "long_en": "The Book of Moses"},
    {"volume_id": 5, "canonical": "pgp",          "id": 84, "slug": "abr",    "chapters":  5, "lds_url": "pgp/abr",      "short": "Abr",    "title_en": "Abraham",              "long_en": "The Book of Abraham"},
    {"volume_id": 5, "canonical": "pgp",          "id": 85, "slug": "js-m",   "chapters":  1, "lds_url": "pgp/js-m",     "short": "JS-M",   "title_en": "Joseph Smith—Matthew", "long_en": "Joseph Smith—Matthew"},
    {"volume_id": 5, "canonical": "pgp",          "id": 86, "slug": "js-h",   "chapters":  1, "lds_url": "pgp/js-h",     "short": "JS-H",   "title_en": "Joseph Smith—History", "long_en": "Joseph Smith—History"},
    {"volume_id": 5, "canonical": "pgp",          "id": 87, "slug": "a-of-f", "chapters":  1, "lds_url": "pgp/a-of-f",   "short": "A of F", "title_en": "Articles of Faith",    "long_en": "The Articles of Faith"},
]


# ──────────────────────────────────────────────────────────────────────────────
# 3.  Localised volume names.
#     Book names are fetched live from the LDS website TOC pages.
# ──────────────────────────────────────────────────────────────────────────────

VOLUME_NAMES: Dict[str, Dict] = {
    "bible": {
        "default": {"title": "Holy Bible",          "long_title": "The Holy Bible",                "subtitle": "",  "short_title": "Bible",        "lds_url": "bible"},
        "jpn":     {"title": "聖書",                 "long_title": "聖書",                           "subtitle": "",  "short_title": "聖書",          "lds_url": "bible"},
        "zho":     {"title": "圣经",                 "long_title": "圣经",                           "subtitle": "",  "short_title": "圣经",          "lds_url": "bible"},
        "spa":     {"title": "Santa Biblia",         "long_title": "La Santa Biblia",               "subtitle": "",  "short_title": "Biblia",       "lds_url": "bible"},
        "ell":     {"title": "Αγία Γραφή",           "long_title": "Η Αγία Γραφή",                  "subtitle": "",  "short_title": "ΑΓ",           "lds_url": "bible"},
        "ilo":     {"title": "Biblia",               "long_title": "Ti Biblia (RIPV)",              "subtitle": "",  "short_title": "Biblia",       "lds_url": "bible"},
        "por":     {"title": "Bíblia Sagrada",       "long_title": "A Bíblia Sagrada",              "subtitle": "",  "short_title": "Bíblia",       "lds_url": "bible"},
        "fra":     {"title": "Sainte Bible",         "long_title": "La Sainte Bible",               "subtitle": "",  "short_title": "Bible",        "lds_url": "bible"},
        "deu":     {"title": "Heilige Bibel",        "long_title": "Die Heilige Bibel",             "subtitle": "",  "short_title": "Bibel",        "lds_url": "bible"},
        "kor":     {"title": "성경",                  "long_title": "성경",                           "subtitle": "",  "short_title": "성경",          "lds_url": "bible"},
        "rus":     {"title": "Библия",               "long_title": "Библия",                        "subtitle": "",  "short_title": "Библия",       "lds_url": "bible"},
    },
    "bofm": {
        "default": {"title": "Book of Mormon",       "long_title": "The Book of Mormon",            "subtitle": "Another Testament of Jesus Christ",        "short_title": "BoM",          "lds_url": "bofm"},
        "jpn":     {"title": "モルモン書",             "long_title": "モルモン書",                      "subtitle": "もう一つのイエス・キリストの証",             "short_title": "モルモン書",    "lds_url": "bofm"},
        "zho":     {"title": "摩门经",                "long_title": "摩门经",                         "subtitle": "耶稣基督的另一部约书",                      "short_title": "摩门经",       "lds_url": "bofm"},
        "spa":     {"title": "Libro de Mormón",      "long_title": "El Libro de Mormón",            "subtitle": "Otro Testamento de Jesucristo",             "short_title": "LM",           "lds_url": "bofm"},
        "ell":     {"title": "Βιβλίο του Μορμών",    "long_title": "Το Βιβλίο του Μορμών",          "subtitle": "Μια Ακόμη Μαρτυρία για τον Ιησού Χριστό", "short_title": "ΒΜ",           "lds_url": "bofm"},
        "por":     {"title": "Livro de Mórmon",      "long_title": "O Livro de Mórmon",             "subtitle": "Outro Testamento de Jesus Cristo",          "short_title": "LM",           "lds_url": "bofm"},
        "fra":     {"title": "Livre de Mormon",      "long_title": "Le Livre de Mormon",            "subtitle": "Un autre témoignage de Jésus-Christ",       "short_title": "LM",           "lds_url": "bofm"},
        "deu":     {"title": "Buch Mormon",          "long_title": "Das Buch Mormon",               "subtitle": "Ein weiteres Testament von Jesus Christus", "short_title": "BM",           "lds_url": "bofm"},
        "kor":     {"title": "몰몬경",                "long_title": "몰몬경",                          "subtitle": "예수 그리스도의 또 다른 성약",                "short_title": "몰몬경",       "lds_url": "bofm"},
        "rus":     {"title": "Книга Мормона",        "long_title": "Книга Мормона",                 "subtitle": "Ещё одно свидетельство об Иисусе Христе",  "short_title": "КМ",           "lds_url": "bofm"},
    },
    "dc-testament": {
        "default": {"title": "Doctrine and Covenants",  "long_title": "The Doctrine and Covenants",  "subtitle": "",  "short_title": "D&C",          "lds_url": "dc-testament"},
        "jpn":     {"title": "教義と聖約",              "long_title": "教義と聖約",                    "subtitle": "",  "short_title": "D&C",          "lds_url": "dc-testament"},
        "zho":     {"title": "教义和圣约",              "long_title": "教义和圣约",                    "subtitle": "",  "short_title": "D&C",          "lds_url": "dc-testament"},
        "spa":     {"title": "Doctrina y Convenios",    "long_title": "La Doctrina y los Convenios", "subtitle": "",  "short_title": "DyC",          "lds_url": "dc-testament"},
        "ell":     {"title": "Διδαχή και Διαθήκες",    "long_title": "Η Διδαχή και οι Διαθήκες",    "subtitle": "",  "short_title": "ΔΔ",           "lds_url": "dc-testament"},
        "por":     {"title": "Doutrina e Convênios",    "long_title": "A Doutrina e os Convênios",   "subtitle": "",  "short_title": "DyC",          "lds_url": "dc-testament"},
        "fra":     {"title": "Doctrine et Alliances",   "long_title": "La Doctrine et les Alliances","subtitle": "",  "short_title": "D&A",          "lds_url": "dc-testament"},
        "deu":     {"title": "Lehre und Bündnisse",     "long_title": "Lehre und Bündnisse",         "subtitle": "",  "short_title": "LuB",          "lds_url": "dc-testament"},
        "kor":     {"title": "교리와 성약",              "long_title": "교리와 성약",                   "subtitle": "",  "short_title": "교성",          "lds_url": "dc-testament"},
        "rus":     {"title": "Учение и Заветы",         "long_title": "Учение и Заветы",             "subtitle": "",  "short_title": "УиЗ",          "lds_url": "dc-testament"},
    },
    "pgp": {
        "default": {"title": "Pearl of Great Price",  "long_title": "The Pearl of Great Price",    "subtitle": "",  "short_title": "PGP",          "lds_url": "pgp"},
        "jpn":     {"title": "高価なる真珠",            "long_title": "高価なる真珠",                  "subtitle": "",  "short_title": "PGP",          "lds_url": "pgp"},
        "zho":     {"title": "无价珍珠",               "long_title": "无价珍珠",                     "subtitle": "",  "short_title": "PGP",          "lds_url": "pgp"},
        "spa":     {"title": "Perla de Gran Precio",   "long_title": "La Perla de Gran Precio",     "subtitle": "",  "short_title": "PGP",          "lds_url": "pgp"},
        "ell":     {"title": "Πολύτιμος Λίθος",        "long_title": "Ο Πολύτιμος Λίθος",           "subtitle": "",  "short_title": "ΠΛ",           "lds_url": "pgp"},
        "por":     {"title": "Pérola de Grande Valor", "long_title": "A Pérola de Grande Valor",    "subtitle": "",  "short_title": "PGV",          "lds_url": "pgp"},
        "fra":     {"title": "Perle de Grand Prix",    "long_title": "La Perle de Grand Prix",      "subtitle": "",  "short_title": "PGP",          "lds_url": "pgp"},
        "deu":     {"title": "Köstliche Perle",        "long_title": "Die Köstliche Perle",         "subtitle": "",  "short_title": "KP",           "lds_url": "pgp"},
        "kor":     {"title": "값진 진주",               "long_title": "값진 진주",                    "subtitle": "",  "short_title": "값진 진주",      "lds_url": "pgp"},
        "rus":     {"title": "Дорогоценная Жемчужина","long_title": "Дорогоценная Жемчужина",       "subtitle": "",  "short_title": "ДЖ",           "lds_url": "pgp"},
    },
}

BASE_URL = "https://www.churchofjesuschrist.org/study/scriptures"


# ──────────────────────────────────────────────────────────────────────────────
# 4.  Helpers
# ──────────────────────────────────────────────────────────────────────────────

def get_vol_names(canonical_key: str, lang: str) -> Dict:
    """Return the best-matching localised volume name dict."""
    vols = VOLUME_NAMES.get(canonical_key, {})
    return vols.get(lang, vols.get("default", {}))


def fetch_with_retry(url: str, lang: str, session: requests.Session,
                     delay: float, retries: int) -> Optional[str]:
    """Fetch a URL with exponential back-off.  Returns HTML text or None."""
    params = {"lang": lang}
    for attempt in range(1, retries + 1):
        try:
            resp = session.get(url, params=params, timeout=20)
            if resp.status_code == 200:
                resp.encoding = "utf-8"
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
    Parse an LDS scripture chapter page and return [(verse_num, verse_text), ...].

    Primary strategy  : <p class="verse"> with <sup class="verse-number">
    Fallback strategy : body-block <p> tags for prose / intro sections
    """
    soup = BeautifulSoup(html, "html.parser")

    verse_tags = soup.find_all("p", class_="verse")
    if verse_tags:
        results: List[Tuple[int, str]] = []
        for p in verse_tags:
            sup = p.find("sup", class_="verse-number")
            if sup:
                try:
                    v_num = int(sup.get_text(strip=True))
                except ValueError:
                    continue
                sup.decompose()
            else:
                aid = p.get("data-aid", "")
                m   = re.search(r"\.(\d+)$", aid)
                v_num = int(m.group(1)) if m else len(results) + 1

            # Strip reference-marker superscripts inside scripture text
            for sup in p.find_all("sup", class_=re.compile(r"marker|note|ref")):
                sup.decompose()

            text = re.sub(r"\s+", " ", p.get_text(separator=" ", strip=True)).strip()
            if text:
                results.append((v_num, text))
        if results:
            return results

    # Fallback: body-block paragraphs (used for prose intro sections)
    body = (
        soup.find("div", class_="body-block")
        or soup.find("div", attrs={"class": lambda c: c and "content" in c})
        or soup.find("article")
    )
    if body:
        results = []
        for i, p in enumerate(body.find_all("p"), start=1):
            if p.find(["h1", "h2", "h3", "h4"]):
                continue
            text = re.sub(r"\s+", " ", p.get_text(separator=" ", strip=True)).strip()
            if len(text) >= 10:
                results.append((i, text))
        if results:
            return results

    print(f"  [WARN] No verses found in {url}")
    return []


def fetch_toc_names(canonical: str, lang: str, session: requests.Session,
                    delay: float, retries: int) -> Dict[str, str]:
    """
    Fetch localised book names from an LDS volume TOC page.
    Matches only book-level links (/study/scriptures/{canonical}/{slug})
    and excludes chapter-level links (/study/scriptures/{canonical}/{slug}/1).

    Returns {slug -> localised_name}.
    """
    url  = f"{BASE_URL}/{canonical}"
    html = fetch_with_retry(url, lang, session, delay, retries)
    if not html:
        return {}

    soup    = BeautifulSoup(html, "html.parser")
    names: Dict[str, str] = {}
    # Match exact book links — must NOT have a trailing /digit segment
    pattern = re.compile(
        rf"^(?:https://www\.churchofjesuschrist\.org)?/study/scriptures"
        rf"/{re.escape(canonical)}/([^/?#/]+)$"
    )
    for a in soup.find_all("a", href=True):
        href = a["href"].split("?")[0].rstrip("/")
        m    = pattern.match(href)
        if m:
            slug = m.group(1)
            if slug not in names:
                text = a.get_text(strip=True)
                # Reject empty strings, bare digits, and implausibly long strings
                if text and not text.isdigit() and len(text) <= 80:
                    names[slug] = text

    return names


# ──────────────────────────────────────────────────────────────────────────────
# 5.  Database helpers
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
        pass   # view already exists when resuming
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


def existing_ids(conn: sqlite3.Connection, table: str) -> Set[int]:
    try:
        return {r[0] for r in conn.execute(f"SELECT id FROM {table}")}
    except sqlite3.OperationalError:
        return set()


# ──────────────────────────────────────────────────────────────────────────────
# 6.  Main scrape function
# ──────────────────────────────────────────────────────────────────────────────

def scrape(lang: str, output_path: str, delay: float, retries: int,
           resume: bool, no_fts: bool, bible_only: bool, triple_only: bool) -> None:

    out       = Path(output_path)
    db_exists = out.exists()

    if triple_only and not (db_exists and resume):
        sys.exit(
            "[ERROR] --triple-only requires an existing DB and --resume.\n"
            "        Run without --triple-only first to scrape the Bible."
        )

    conn = sqlite3.connect(output_path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")

    if not (resume and db_exists):
        # Fresh run — drop any partial tables from a previous failed attempt
        conn.executescript("""
            DROP TABLE IF EXISTS scriptures_fts;
            DROP VIEW  IF EXISTS scriptures;
            DROP TABLE IF EXISTS verses;
            DROP TABLE IF EXISTS chapters;
            DROP TABLE IF EXISTS books;
            DROP TABLE IF EXISTS volumes;
            DROP TABLE IF EXISTS configuration;
        """)

    create_schema(conn)

    # Resume state: which chapter IDs already have rows in the DB?
    # chapter_id starts at 1 and counts sequentially, skipping done IDs.
    # verse_id continues from the highest existing ID + 1.
    done_ids  = get_done_chapter_ids(conn) if (resume and db_exists) else set()
    verse_id  = get_max_verse_id(conn) + 1 if (resume and db_exists) else 1
    chapter_id = 1   # always count from 1; done chapters are skipped in-loop

    session = requests.Session()
    session.headers.update({
        "User-Agent":      "Mozilla/5.0 (LDS-Scripture-Scraper/2.0; educational use)",
        "Accept":          "text/html,application/xhtml+xml",
        "Accept-Language": f"{lang},en;q=0.8",
    })

    # ── Phase 1: Bible ────────────────────────────────────────────────────────
    if not triple_only:
        print(f"\n{'='*64}")
        print(f"  PHASE 1 — Bible  (lang={lang})")
        print(f"{'='*64}")

        # Insert volume 1 (entire Bible) if not already present
        if 1 not in existing_ids(conn, "volumes"):
            vn = get_vol_names("bible", lang)
            conn.execute(
                "INSERT INTO volumes VALUES (?,?,?,?,?,?)",
                (1, vn.get("title", "Holy Bible"), vn.get("long_title", "The Holy Bible"),
                 vn.get("subtitle", ""), vn.get("short_title", "Bible"), vn.get("lds_url", "bible"))
            )
            conn.execute(
                "INSERT INTO configuration VALUES (?,?,?,?,?)",
                (1, "UTF-8", vn.get("title", "Holy Bible"),
                 f"{lang} scriptures", "© The Church of Jesus Christ of Latter-day Saints")
            )
            conn.commit()

        # Fetch localised book names from OT and NT TOC pages
        print("  Fetching OT book names from LDS website …", flush=True)
        ot_names = fetch_toc_names("ot", lang, session, delay, retries)
        print(f"    → {len(ot_names)} OT names retrieved")

        print("  Fetching NT book names from LDS website …", flush=True)
        nt_names = fetch_toc_names("nt", lang, session, delay, retries)
        print(f"    → {len(nt_names)} NT names retrieved")

        existing_books = existing_ids(conn, "books")

        for book_def in BIBLE_BOOKS:
            toc      = ot_names if book_def["canonical"] == "ot" else nt_names
            loc_name = toc.get(book_def["slug"], book_def["title_en"])
            lds_url  = f"{book_def['canonical']}/{book_def['slug']}"

            if book_def["num"] not in existing_books:
                conn.execute(
                    "INSERT INTO books VALUES (?,?,?,?,?,?,?)",
                    (book_def["num"], 1, loc_name, loc_name, "",
                     book_def["short"], lds_url)
                )
                conn.commit()

            batch = 0
            for ch_num in range(1, book_def["chapters"] + 1):
                ch_id      = chapter_id
                chapter_id += 1   # always advance the counter

                if ch_id in done_ids:
                    continue      # already in DB — skip

                url  = f"{BASE_URL}/{book_def['canonical']}/{book_def['slug']}/{ch_num}"
                print(
                    f"  [{book_def['num']:2}/66] {loc_name} {ch_num}/{book_def['chapters']}"
                    f"  ch={ch_id}  v={verse_id}",
                    end="\r", flush=True
                )

                html        = fetch_with_retry(url, lang, session, delay, retries)
                verse_pairs = extract_verses(html, url) if html else []

                conn.execute("INSERT INTO chapters VALUES (?,?,?)", (ch_id, book_def["num"], ch_num))
                for v_num, v_text in verse_pairs:
                    conn.execute("INSERT INTO verses VALUES (?,?,?,?)",
                                 (verse_id, ch_id, v_num, v_text))
                    verse_id += 1

                batch += 1
                if batch % 20 == 0:
                    conn.commit()

            conn.commit()
            print(
                f"  [{book_def['num']:2}/66] {loc_name}"
                f"  ✓ ({book_def['chapters']} chapters)"
                + " " * 30
            )

        print(f"\n  Bible done.  chapter_id counter={chapter_id-1}  verse_id counter={verse_id-1}")

    # ── Phase 2: Triple Combination ───────────────────────────────────────────
    if not bible_only:
        print(f"\n{'='*64}")
        print(f"  PHASE 2 — Triple Combination  (lang={lang})")
        print(f"{'='*64}")

        toc_cache:     Dict[str, Dict[str, str]] = {}
        prev_vol_id:   Optional[int] = None
        existing_vols  = existing_ids(conn, "volumes")
        existing_books = existing_ids(conn, "books")

        for book_def in TRIPLE_BOOKS:
            vol_id  = book_def["volume_id"]
            vol_can = book_def["canonical"]

            # Insert the volume the first time a book in it appears
            if vol_id not in existing_vols:
                vn = get_vol_names(vol_can, lang)
                conn.execute(
                    "INSERT INTO volumes VALUES (?,?,?,?,?,?)",
                    (vol_id, vn.get("title"), vn.get("long_title"),
                     vn.get("subtitle", ""), vn.get("short_title"), vn.get("lds_url"))
                )
                conn.commit()
                existing_vols.add(vol_id)

            # Lazily populate the TOC name cache for this canonical
            if vol_can not in toc_cache:
                print(f"  Fetching {vol_can} book names from LDS website …", flush=True)
                toc_cache[vol_can] = fetch_toc_names(vol_can, lang, session, delay, retries)
                print(f"    → {len(toc_cache[vol_can])} entries retrieved")

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
                ch_id      = chapter_id
                chapter_id += 1

                if ch_id in done_ids:
                    continue

                url  = f"{BASE_URL}/{vol_can}/{book_def['slug']}/{ch_num}"
                print(
                    f"  [{book_def['id']:2}/87] {loc_name} {ch_num}/{book_def['chapters']}"
                    f"  ch={ch_id}  v={verse_id}",
                    end="\r", flush=True
                )

                html        = fetch_with_retry(url, lang, session, delay, retries)
                verse_pairs = extract_verses(html, url) if html else []

                conn.execute("INSERT INTO chapters VALUES (?,?,?)", (ch_id, book_def["id"], ch_num))
                for v_num, v_text in verse_pairs:
                    conn.execute("INSERT INTO verses VALUES (?,?,?,?)",
                                 (verse_id, ch_id, v_num, v_text))
                    verse_id += 1

                batch += 1
                if batch % 20 == 0:
                    conn.commit()

            conn.commit()
            print(
                f"  [{book_def['id']:2}/87] {loc_name}"
                f"  ✓ ({book_def['chapters']} chapters)"
                + " " * 30
            )

        print(f"\n  Triple done.  chapter_id counter={chapter_id-1}  verse_id counter={verse_id-1}")

    # ── Phase 3: FTS5 ─────────────────────────────────────────────────────────
    if not no_fts:
        apply_fts5(conn)

    # Summary
    total_vols = conn.execute("SELECT COUNT(*) FROM volumes").fetchone()[0]
    total_books = conn.execute("SELECT COUNT(*) FROM books").fetchone()[0]
    total_ch   = conn.execute("SELECT COUNT(*) FROM chapters").fetchone()[0]
    total_vs   = conn.execute("SELECT COUNT(*) FROM verses").fetchone()[0]

    print(f"\n{'='*64}")
    print(f"  Done!")
    print(f"  Volumes : {total_vols}   Books : {total_books}")
    print(f"  Chapters: {total_ch:,}   Verses: {total_vs:,}")
    print(f"  Output  : {output_path}")
    print(f"{'='*64}\n")

    conn.close()


# ──────────────────────────────────────────────────────────────────────────────
# 7.  CLI entry point
# ──────────────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Scrape complete LDS Standard Works and build a SQLite scriptures DB.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 scrape_lds_full.py --lang jpn --output japanese-scriptures-sqlite.db\n"
            "  python3 scrape_lds_full.py --lang zho --output chinese-scriptures-sqlite.db\n"
            "  python3 scrape_lds_full.py --lang jpn --output japanese-scriptures-sqlite.db --resume\n"
        ),
    )
    parser.add_argument("--lang",        required=True,  help="LDS language code (e.g. jpn, zho)")
    parser.add_argument("--output",      required=True,  help="Output SQLite file path")
    parser.add_argument("--delay",       type=float, default=1.0, metavar="SEC",
                        help="Seconds between HTTP requests (default: 1.0)")
    parser.add_argument("--retries",     type=int,   default=3,   metavar="N",
                        help="Max HTTP retries per request (default: 3)")
    parser.add_argument("--resume",      action="store_true",
                        help="Resume an interrupted run — skip already-present chapters")
    parser.add_argument("--no-fts",      action="store_true",
                        help="Skip building the FTS5 full-text search index")
    parser.add_argument("--bible-only",  action="store_true",
                        help="Only scrape the Bible (volumes 1/Bible)")
    parser.add_argument("--triple-only", action="store_true",
                        help="Only scrape the Triple Combination (volumes 3–5)")

    args = parser.parse_args()

    if args.bible_only and args.triple_only:
        parser.error("--bible-only and --triple-only are mutually exclusive.")

    print(f"\nLDS Scripture Scraper  v2.0")
    print(f"  Language    : {args.lang}")
    print(f"  Output      : {args.output}")
    print(f"  Delay       : {args.delay}s per request")
    print(f"  Retries     : {args.retries}")
    print(f"  Resume      : {args.resume}")
    print(f"  FTS5        : {'skip' if args.no_fts else 'build at end'}")
    print(f"  Scope       : {'bible only' if args.bible_only else 'triple only' if args.triple_only else 'full (bible + triple)'}")
    print()

    scrape(
        lang        = args.lang,
        output_path = args.output,
        delay       = args.delay,
        retries     = args.retries,
        resume      = args.resume,
        no_fts      = args.no_fts,
        bible_only  = args.bible_only,
        triple_only = args.triple_only,
    )


if __name__ == "__main__":
    main()
