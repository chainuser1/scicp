#!/usr/bin/env python3
"""
Database Migration Script: Convert simple Bible databases to LDS scriptures schema
Migrates from: words(wordId, word, bookNum, chNum, verseNum) with configuration
Migrates to: volumes → books → chapters → verses with metadata and views

Usage:
    python3 migrate_bible_schema.py --input cebu.db --output cebu_migrated.db --language Cebuano
    python3 migrate_bible_schema.py --input tagalog.db --output tagalog_migrated.db --language Tagalog
"""

import sqlite3
import argparse
import logging
from pathlib import Path
from typing import Optional, Tuple, Dict, List

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

# Standard Bible book order with metadata (English)
BIBLE_BOOKS = [
    # OT: Pentateuch
    {"num": 1, "title": "Genesis", "long_title": "The Book of Genesis", "short_title": "Gen"},
    {"num": 2, "title": "Exodus", "long_title": "The Book of Exodus", "short_title": "Ex"},
    {"num": 3, "title": "Leviticus", "long_title": "The Book of Leviticus", "short_title": "Lev"},
    {"num": 4, "title": "Numbers", "long_title": "The Book of Numbers", "short_title": "Num"},
    {"num": 5, "title": "Deuteronomy", "long_title": "The Book of Deuteronomy", "short_title": "Deut"},
    # OT: Historical
    {"num": 6, "title": "Joshua", "long_title": "The Book of Joshua", "short_title": "Josh"},
    {"num": 7, "title": "Judges", "long_title": "The Book of Judges", "short_title": "Judg"},
    {"num": 8, "title": "Ruth", "long_title": "The Book of Ruth", "short_title": "Ruth"},
    {"num": 9, "title": "1 Samuel", "long_title": "The First Book of Samuel", "short_title": "1 Sam"},
    {"num": 10, "title": "2 Samuel", "long_title": "The Second Book of Samuel", "short_title": "2 Sam"},
    {"num": 11, "title": "1 Kings", "long_title": "The First Book of the Kings", "short_title": "1 Kgs"},
    {"num": 12, "title": "2 Kings", "long_title": "The Second Book of the Kings", "short_title": "2 Kgs"},
    {"num": 13, "title": "1 Chronicles", "long_title": "The First Book of the Chronicles", "short_title": "1 Chr"},
    {"num": 14, "title": "2 Chronicles", "long_title": "The Second Book of the Chronicles", "short_title": "2 Chr"},
    {"num": 15, "title": "Ezra", "long_title": "The Book of Ezra", "short_title": "Ezra"},
    {"num": 16, "title": "Nehemiah", "long_title": "The Book of Nehemiah", "short_title": "Neh"},
    {"num": 17, "title": "Esther", "long_title": "The Book of Esther", "short_title": "Esth"},
    # OT: Wisdom/Poetry
    {"num": 18, "title": "Job", "long_title": "The Book of Job", "short_title": "Job"},
    {"num": 19, "title": "Psalms", "long_title": "The Book of Psalms", "short_title": "Ps"},
    {"num": 20, "title": "Proverbs", "long_title": "The Book of Proverbs", "short_title": "Prov"},
    {"num": 21, "title": "Ecclesiastes", "long_title": "The Book of Ecclesiastes", "short_title": "Eccl"},
    {"num": 22, "title": "Song of Solomon", "long_title": "The Song of Solomon", "short_title": "Song"},
    # OT: Prophetic
    {"num": 23, "title": "Isaiah", "long_title": "The Book of Isaiah", "short_title": "Isa"},
    {"num": 24, "title": "Jeremiah", "long_title": "The Book of Jeremiah", "short_title": "Jer"},
    {"num": 25, "title": "Lamentations", "long_title": "The Book of Lamentations", "short_title": "Lam"},
    {"num": 26, "title": "Ezekiel", "long_title": "The Book of Ezekiel", "short_title": "Ezek"},
    {"num": 27, "title": "Daniel", "long_title": "The Book of Daniel", "short_title": "Dan"},
    {"num": 28, "title": "Hosea", "long_title": "The Book of Hosea", "short_title": "Hos"},
    {"num": 29, "title": "Joel", "long_title": "The Book of Joel", "short_title": "Joel"},
    {"num": 30, "title": "Amos", "long_title": "The Book of Amos", "short_title": "Amos"},
    {"num": 31, "title": "Obadiah", "long_title": "The Book of Obadiah", "short_title": "Obad"},
    {"num": 32, "title": "Jonah", "long_title": "The Book of Jonah", "short_title": "Jonah"},
    {"num": 33, "title": "Micah", "long_title": "The Book of Micah", "short_title": "Micah"},
    {"num": 34, "title": "Nahum", "long_title": "The Book of Nahum", "short_title": "Nah"},
    {"num": 35, "title": "Habakkuk", "long_title": "The Book of Habakkuk", "short_title": "Hab"},
    {"num": 36, "title": "Zephaniah", "long_title": "The Book of Zephaniah", "short_title": "Zeph"},
    {"num": 37, "title": "Haggai", "long_title": "The Book of Haggai", "short_title": "Hag"},
    {"num": 38, "title": "Zechariah", "long_title": "The Book of Zechariah", "short_title": "Zech"},
    {"num": 39, "title": "Malachi", "long_title": "The Book of Malachi", "short_title": "Mal"},
    # NT: Gospels
    {"num": 40, "title": "Matthew", "long_title": "The Gospel According to Matthew", "short_title": "Matt"},
    {"num": 41, "title": "Mark", "long_title": "The Gospel According to Mark", "short_title": "Mark"},
    {"num": 42, "title": "Luke", "long_title": "The Gospel According to Luke", "short_title": "Luke"},
    {"num": 43, "title": "John", "long_title": "The Gospel According to John", "short_title": "John"},
    # NT: Acts and Paul
    {"num": 44, "title": "Acts", "long_title": "The Acts of the Apostles", "short_title": "Acts"},
    {"num": 45, "title": "Romans", "long_title": "The Epistle of Paul to the Romans", "short_title": "Rom"},
    {"num": 46, "title": "1 Corinthians", "long_title": "The First Epistle of Paul to the Corinthians", "short_title": "1 Cor"},
    {"num": 47, "title": "2 Corinthians", "long_title": "The Second Epistle of Paul to the Corinthians", "short_title": "2 Cor"},
    {"num": 48, "title": "Galatians", "long_title": "The Epistle of Paul to the Galatians", "short_title": "Gal"},
    {"num": 49, "title": "Ephesians", "long_title": "The Epistle of Paul to the Ephesians", "short_title": "Eph"},
    {"num": 50, "title": "Philippians", "long_title": "The Epistle of Paul to the Philippians", "short_title": "Phil"},
    {"num": 51, "title": "Colossians", "long_title": "The Epistle of Paul to the Colossians", "short_title": "Col"},
    {"num": 52, "title": "1 Thessalonians", "long_title": "The First Epistle of Paul to the Thessalonians", "short_title": "1 Thes"},
    {"num": 53, "title": "2 Thessalonians", "long_title": "The Second Epistle of Paul to the Thessalonians", "short_title": "2 Thes"},
    {"num": 54, "title": "1 Timothy", "long_title": "The First Epistle of Paul to Timothy", "short_title": "1 Tim"},
    {"num": 55, "title": "2 Timothy", "long_title": "The Second Epistle of Paul to Timothy", "short_title": "2 Tim"},
    {"num": 56, "title": "Titus", "long_title": "The Epistle of Paul to Titus", "short_title": "Titus"},
    {"num": 57, "title": "Philemon", "long_title": "The Epistle of Paul to Philemon", "short_title": "Phlm"},
    # NT: Hebrews and other epistles
    {"num": 58, "title": "Hebrews", "long_title": "The Epistle to the Hebrews", "short_title": "Heb"},
    {"num": 59, "title": "James", "long_title": "The Epistle of James", "short_title": "James"},
    {"num": 60, "title": "1 Peter", "long_title": "The First Epistle of Peter", "short_title": "1 Pet"},
    {"num": 61, "title": "2 Peter", "long_title": "The Second Epistle of Peter", "short_title": "2 Pet"},
    {"num": 62, "title": "1 John", "long_title": "The First Epistle of John", "short_title": "1 John"},
    {"num": 63, "title": "2 John", "long_title": "The Second Epistle of John", "short_title": "2 John"},
    {"num": 64, "title": "3 John", "long_title": "The Third Epistle of John", "short_title": "3 John"},
    {"num": 65, "title": "Jude", "long_title": "The Epistle of Jude", "short_title": "Jude"},
    # NT: Revelation
    {"num": 66, "title": "Revelation", "long_title": "The Revelation of John", "short_title": "Rev"},
]

# Cebuano book names — based on the Bugna Version (Ang Biblia, 1917/1936)
# and the Revised Cebuano Popular Version (RCPV).
# Keys are book numbers 1–66.
CEBUANO_BOOK_NAMES: Dict[int, Dict[str, str]] = {
    # OT: Pentateuch
    1:  {"title": "Genesis",      "long_title": "Ang Basahon sa Genesis",           "short_title": "Gen"},
    2:  {"title": "Exodo",        "long_title": "Ang Basahon sa Exodo",             "short_title": "Exo"},
    3:  {"title": "Levitico",     "long_title": "Ang Basahon sa Levitico",          "short_title": "Lev"},
    4:  {"title": "Numero",       "long_title": "Ang Basahon sa Numero",            "short_title": "Num"},
    5:  {"title": "Deuteronomio", "long_title": "Ang Basahon sa Deuteronomio",      "short_title": "Deu"},
    # OT: Historical
    6:  {"title": "Josue",        "long_title": "Ang Basahon ni Josue",             "short_title": "Jos"},
    7:  {"title": "Mga Hukom",    "long_title": "Ang Basahon sa Mga Hukom",         "short_title": "Huk"},
    8:  {"title": "Ruth",         "long_title": "Ang Basahon ni Ruth",              "short_title": "Rut"},
    9:  {"title": "1 Samuel",     "long_title": "Ang Unang Basahon ni Samuel",      "short_title": "1 Sam"},
    10: {"title": "2 Samuel",     "long_title": "Ang Ikaduhang Basahon ni Samuel",  "short_title": "2 Sam"},
    11: {"title": "1 Mga Hari",   "long_title": "Ang Unang Basahon sa Mga Hari",    "short_title": "1 Ha"},
    12: {"title": "2 Mga Hari",   "long_title": "Ang Ikaduhang Basahon sa Mga Hari","short_title": "2 Ha"},
    13: {"title": "1 Cronicas",   "long_title": "Ang Unang Basahon sa mga Cronicas","short_title": "1 Cr"},
    14: {"title": "2 Cronicas",   "long_title": "Ang Ikaduhang Basahon sa mga Cronicas","short_title": "2 Cr"},
    15: {"title": "Esdras",       "long_title": "Ang Basahon ni Esdras",            "short_title": "Esd"},
    16: {"title": "Nehemias",     "long_title": "Ang Basahon ni Nehemias",          "short_title": "Neh"},
    17: {"title": "Ester",        "long_title": "Ang Basahon ni Ester",             "short_title": "Est"},
    # OT: Wisdom/Poetry
    18: {"title": "Job",          "long_title": "Ang Basahon ni Job",               "short_title": "Job"},
    19: {"title": "Mga Salmo",    "long_title": "Ang Basahon sa Mga Salmo",         "short_title": "Sal"},
    20: {"title": "Mga Proverbio","long_title": "Ang Basahon sa Mga Proverbio",     "short_title": "Pro"},
    21: {"title": "Ecclesiastes", "long_title": "Ang Basahon sa Ecclesiastes",      "short_title": "Ecc"},
    22: {"title": "Awit sa mga Awit", "long_title": "Ang Awit sa mga Awit ni Solomon", "short_title": "Aw"},
    # OT: Prophetic
    23: {"title": "Isaias",       "long_title": "Ang Basahon ni Isaias",            "short_title": "Isa"},
    24: {"title": "Jeremias",     "long_title": "Ang Basahon ni Jeremias",          "short_title": "Jer"},
    25: {"title": "Mga Panaghoy", "long_title": "Ang Basahon sa Mga Panaghoy",      "short_title": "Pan"},
    26: {"title": "Ezequiel",     "long_title": "Ang Basahon ni Ezequiel",          "short_title": "Eze"},
    27: {"title": "Daniel",       "long_title": "Ang Basahon ni Daniel",            "short_title": "Dan"},
    28: {"title": "Oseas",        "long_title": "Ang Basahon ni Oseas",             "short_title": "Ose"},
    29: {"title": "Joel",         "long_title": "Ang Basahon ni Joel",              "short_title": "Joe"},
    30: {"title": "Amos",         "long_title": "Ang Basahon ni Amos",              "short_title": "Amo"},
    31: {"title": "Abdias",       "long_title": "Ang Basahon ni Abdias",            "short_title": "Abd"},
    32: {"title": "Jonas",        "long_title": "Ang Basahon ni Jonas",             "short_title": "Jon"},
    33: {"title": "Miqueas",      "long_title": "Ang Basahon ni Miqueas",           "short_title": "Miq"},
    34: {"title": "Nahum",        "long_title": "Ang Basahon ni Nahum",             "short_title": "Nah"},
    35: {"title": "Habacuc",      "long_title": "Ang Basahon ni Habacuc",           "short_title": "Hab"},
    36: {"title": "Sofonias",     "long_title": "Ang Basahon ni Sofonias",          "short_title": "Sof"},
    37: {"title": "Hageo",        "long_title": "Ang Basahon ni Hageo",             "short_title": "Hag"},
    38: {"title": "Zacarias",     "long_title": "Ang Basahon ni Zacarias",          "short_title": "Zac"},
    39: {"title": "Malaquias",    "long_title": "Ang Basahon ni Malaquias",         "short_title": "Mal"},
    # NT: Gospels
    40: {"title": "Mateo",        "long_title": "Ang Ebanghelyo ni Mateo",          "short_title": "Mat"},
    41: {"title": "Marcos",       "long_title": "Ang Ebanghelyo ni Marcos",         "short_title": "Mar"},
    42: {"title": "Lucas",        "long_title": "Ang Ebanghelyo ni Lucas",          "short_title": "Luc"},
    43: {"title": "Juan",         "long_title": "Ang Ebanghelyo ni Juan",           "short_title": "Jua"},
    # NT: Acts and Paul
    44: {"title": "Mga Buhat",    "long_title": "Ang Mga Buhat sa mga Apostoles",   "short_title": "Buh"},
    45: {"title": "Mga Romano",   "long_title": "Ang Sulat ni Pablo sa mga Romano",  "short_title": "Rom"},
    46: {"title": "1 Corinto",    "long_title": "Ang Unang Sulat ni Pablo sa mga Corinto",    "short_title": "1 Cor"},
    47: {"title": "2 Corinto",    "long_title": "Ang Ikaduhang Sulat ni Pablo sa mga Corinto", "short_title": "2 Cor"},
    48: {"title": "Galacia",      "long_title": "Ang Sulat ni Pablo sa mga Galacia",  "short_title": "Gal"},
    49: {"title": "Efeso",        "long_title": "Ang Sulat ni Pablo sa mga Efeso",    "short_title": "Efe"},
    50: {"title": "Filipos",      "long_title": "Ang Sulat ni Pablo sa mga Filipos",  "short_title": "Fil"},
    51: {"title": "Colosas",      "long_title": "Ang Sulat ni Pablo sa mga Colosas",  "short_title": "Col"},
    52: {"title": "1 Tesalonica", "long_title": "Ang Unang Sulat ni Pablo sa mga Tesalonica",    "short_title": "1 Tes"},
    53: {"title": "2 Tesalonica", "long_title": "Ang Ikaduhang Sulat ni Pablo sa mga Tesalonica", "short_title": "2 Tes"},
    54: {"title": "1 Timoteo",    "long_title": "Ang Unang Sulat ni Pablo kang Timoteo",    "short_title": "1 Tim"},
    55: {"title": "2 Timoteo",    "long_title": "Ang Ikaduhang Sulat ni Pablo kang Timoteo", "short_title": "2 Tim"},
    56: {"title": "Tito",         "long_title": "Ang Sulat ni Pablo kang Tito",       "short_title": "Tit"},
    57: {"title": "Filemon",      "long_title": "Ang Sulat ni Pablo kang Filemon",    "short_title": "Plm"},
    # NT: Hebrews and other epistles
    58: {"title": "Mga Hebreo",   "long_title": "Ang Sulat sa mga Hebreo",           "short_title": "Heb"},
    59: {"title": "Santiago",     "long_title": "Ang Sulat ni Santiago",              "short_title": "San"},
    60: {"title": "1 Pedro",      "long_title": "Ang Unang Sulat ni Pedro",           "short_title": "1 Ped"},
    61: {"title": "2 Pedro",      "long_title": "Ang Ikaduhang Sulat ni Pedro",       "short_title": "2 Ped"},
    62: {"title": "1 Juan",       "long_title": "Ang Unang Sulat ni Juan",            "short_title": "1 Jua"},
    63: {"title": "2 Juan",       "long_title": "Ang Ikaduhang Sulat ni Juan",        "short_title": "2 Jua"},
    64: {"title": "3 Juan",       "long_title": "Ang Ikatulong Sulat ni Juan",        "short_title": "3 Jua"},
    65: {"title": "Judas",        "long_title": "Ang Sulat ni Judas",                 "short_title": "Jud"},
    # NT: Revelation
    66: {"title": "Apocalipsis",  "long_title": "Ang Apocalipsis ni Juan",            "short_title": "Apo"},
}

# Tagalog book names — based on Ang Biblia (1905/1982 revision, PNBS)
# and the Magandang Balita Biblia (MBB / MBBTAG).
# Keys are book numbers 1–66.
TAGALOG_BOOK_NAMES: Dict[int, Dict[str, str]] = {
    # OT: Pentateuch
    1:  {"title": "Genesis",       "long_title": "Ang Aklat ng Genesis",              "short_title": "Gen"},
    2:  {"title": "Exodo",         "long_title": "Ang Aklat ng Exodo",                "short_title": "Exo"},
    3:  {"title": "Levitico",      "long_title": "Ang Aklat ng Levitico",             "short_title": "Lev"},
    4:  {"title": "Mga Bilang",    "long_title": "Ang Aklat ng Mga Bilang",           "short_title": "Bil"},
    5:  {"title": "Deuteronomio",  "long_title": "Ang Aklat ng Deuteronomio",         "short_title": "Deu"},
    # OT: Historical
    6:  {"title": "Josue",         "long_title": "Ang Aklat ni Josue",                "short_title": "Jos"},
    7:  {"title": "Mga Hukom",     "long_title": "Ang Aklat ng Mga Hukom",            "short_title": "Huk"},
    8:  {"title": "Ruth",          "long_title": "Ang Aklat ni Ruth",                 "short_title": "Rut"},
    9:  {"title": "1 Samuel",      "long_title": "Ang Unang Aklat ni Samuel",         "short_title": "1 Sam"},
    10: {"title": "2 Samuel",      "long_title": "Ang Ikalawang Aklat ni Samuel",     "short_title": "2 Sam"},
    11: {"title": "1 Mga Hari",    "long_title": "Ang Unang Aklat ng Mga Hari",       "short_title": "1 Ha"},
    12: {"title": "2 Mga Hari",    "long_title": "Ang Ikalawang Aklat ng Mga Hari",   "short_title": "2 Ha"},
    13: {"title": "1 Cronica",     "long_title": "Ang Unang Aklat ng mga Cronica",    "short_title": "1 Cr"},
    14: {"title": "2 Cronica",     "long_title": "Ang Ikalawang Aklat ng mga Cronica","short_title": "2 Cr"},
    15: {"title": "Ezra",          "long_title": "Ang Aklat ni Ezra",                 "short_title": "Ezr"},
    16: {"title": "Nehemias",      "long_title": "Ang Aklat ni Nehemias",             "short_title": "Neh"},
    17: {"title": "Ester",         "long_title": "Ang Aklat ni Ester",                "short_title": "Est"},
    # OT: Wisdom/Poetry
    18: {"title": "Job",           "long_title": "Ang Aklat ni Job",                  "short_title": "Job"},
    19: {"title": "Mga Awit",      "long_title": "Ang Aklat ng Mga Awit",             "short_title": "Aw"},
    20: {"title": "Mga Kawikaan",  "long_title": "Ang Aklat ng Mga Kawikaan",         "short_title": "Kaw"},
    21: {"title": "Mangangaral",   "long_title": "Ang Aklat ng Mangangaral",          "short_title": "Mng"},
    22: {"title": "Awit ng mga Awit", "long_title": "Ang Awit ng mga Awit ni Solomon","short_title": "AwAw"},
    # OT: Prophetic
    23: {"title": "Isaias",        "long_title": "Ang Aklat ni Isaias",               "short_title": "Isa"},
    24: {"title": "Jeremias",      "long_title": "Ang Aklat ni Jeremias",             "short_title": "Jer"},
    25: {"title": "Panaghoy",      "long_title": "Ang Aklat ng Panaghoy",             "short_title": "Pan"},
    26: {"title": "Ezekiel",       "long_title": "Ang Aklat ni Ezekiel",              "short_title": "Eze"},
    27: {"title": "Daniel",        "long_title": "Ang Aklat ni Daniel",               "short_title": "Dan"},
    28: {"title": "Oseas",         "long_title": "Ang Aklat ni Oseas",                "short_title": "Ose"},
    29: {"title": "Joel",          "long_title": "Ang Aklat ni Joel",                 "short_title": "Joe"},
    30: {"title": "Amos",          "long_title": "Ang Aklat ni Amos",                 "short_title": "Amo"},
    31: {"title": "Obadias",       "long_title": "Ang Aklat ni Obadias",              "short_title": "Oba"},
    32: {"title": "Jonas",         "long_title": "Ang Aklat ni Jonas",                "short_title": "Jon"},
    33: {"title": "Mikas",         "long_title": "Ang Aklat ni Mikas",                "short_title": "Mik"},
    34: {"title": "Nahum",         "long_title": "Ang Aklat ni Nahum",                "short_title": "Nah"},
    35: {"title": "Habakuk",       "long_title": "Ang Aklat ni Habakuk",              "short_title": "Hab"},
    36: {"title": "Zefanias",      "long_title": "Ang Aklat ni Zefanias",             "short_title": "Zef"},
    37: {"title": "Hagai",         "long_title": "Ang Aklat ni Hagai",                "short_title": "Hag"},
    38: {"title": "Zacarias",      "long_title": "Ang Aklat ni Zacarias",             "short_title": "Zac"},
    39: {"title": "Malakias",      "long_title": "Ang Aklat ni Malakias",             "short_title": "Mal"},
    # NT: Gospels
    40: {"title": "Mateo",         "long_title": "Ang Ebanghelyo ayon kay Mateo",     "short_title": "Mat"},
    41: {"title": "Marcos",        "long_title": "Ang Ebanghelyo ayon kay Marcos",    "short_title": "Mar"},
    42: {"title": "Lucas",         "long_title": "Ang Ebanghelyo ayon kay Lucas",     "short_title": "Luc"},
    43: {"title": "Juan",          "long_title": "Ang Ebanghelyo ayon kay Juan",      "short_title": "Jua"},
    # NT: Acts and Paul
    44: {"title": "Mga Gawa",      "long_title": "Ang Mga Gawa ng mga Apostol",       "short_title": "Gaw"},
    45: {"title": "Mga Romano",    "long_title": "Ang Sulat ni Pablo sa mga Romano",  "short_title": "Rom"},
    46: {"title": "1 Corinto",     "long_title": "Ang Unang Sulat ni Pablo sa mga Corinto",     "short_title": "1 Cor"},
    47: {"title": "2 Corinto",     "long_title": "Ang Ikalawang Sulat ni Pablo sa mga Corinto",  "short_title": "2 Cor"},
    48: {"title": "Galacia",       "long_title": "Ang Sulat ni Pablo sa mga Galacia", "short_title": "Gal"},
    49: {"title": "Efeso",         "long_title": "Ang Sulat ni Pablo sa mga Efeso",   "short_title": "Efe"},
    50: {"title": "Filipos",       "long_title": "Ang Sulat ni Pablo sa mga Filipos", "short_title": "Fil"},
    51: {"title": "Colosas",       "long_title": "Ang Sulat ni Pablo sa mga Colosas", "short_title": "Col"},
    52: {"title": "1 Tesalonica",  "long_title": "Ang Unang Sulat ni Pablo sa mga Tesalonica",    "short_title": "1 Tes"},
    53: {"title": "2 Tesalonica",  "long_title": "Ang Ikalawang Sulat ni Pablo sa mga Tesalonica", "short_title": "2 Tes"},
    54: {"title": "1 Timoteo",     "long_title": "Ang Unang Sulat ni Pablo kay Timoteo",    "short_title": "1 Tim"},
    55: {"title": "2 Timoteo",     "long_title": "Ang Ikalawang Sulat ni Pablo kay Timoteo", "short_title": "2 Tim"},
    56: {"title": "Tito",          "long_title": "Ang Sulat ni Pablo kay Tito",        "short_title": "Tit"},
    57: {"title": "Filemon",       "long_title": "Ang Sulat ni Pablo kay Filemon",    "short_title": "Plm"},
    # NT: Hebrews and other epistles
    58: {"title": "Mga Hebreo",    "long_title": "Ang Sulat sa mga Hebreo",           "short_title": "Heb"},
    59: {"title": "Santiago",      "long_title": "Ang Sulat ni Santiago",              "short_title": "San"},
    60: {"title": "1 Pedro",       "long_title": "Ang Unang Sulat ni Pedro",           "short_title": "1 Ped"},
    61: {"title": "2 Pedro",       "long_title": "Ang Ikalawang Sulat ni Pedro",       "short_title": "2 Ped"},
    62: {"title": "1 Juan",        "long_title": "Ang Unang Sulat ni Juan",            "short_title": "1 Jua"},
    63: {"title": "2 Juan",        "long_title": "Ang Ikalawang Sulat ni Juan",        "short_title": "2 Jua"},
    64: {"title": "3 Juan",        "long_title": "Ang Ikatlong Sulat ni Juan",         "short_title": "3 Jua"},
    65: {"title": "Judas",         "long_title": "Ang Sulat ni Judas",                 "short_title": "Jud"},
    # NT: Revelation
    66: {"title": "Apocalipsis",   "long_title": "Ang Apocalipsis ni Juan",            "short_title": "Apo"},
}

# Spanish book names — Reina-Valera tradition (RV1960 / RVR, Public Domain).
# Keys are book numbers 1–66.
SPANISH_BOOK_NAMES: Dict[int, Dict[str, str]] = {
    # OT: Pentateuch
    1:  {"title": "Génesis",          "long_title": "El Libro de Génesis",                   "short_title": "Gén"},
    2:  {"title": "Éxodo",            "long_title": "El Libro de Éxodo",                     "short_title": "Éx"},
    3:  {"title": "Levítico",         "long_title": "El Libro de Levítico",                  "short_title": "Lev"},
    4:  {"title": "Números",          "long_title": "El Libro de Números",                   "short_title": "Núm"},
    5:  {"title": "Deuteronomio",     "long_title": "El Libro de Deuteronomio",              "short_title": "Deut"},
    # OT: Historical
    6:  {"title": "Josué",            "long_title": "El Libro de Josué",                     "short_title": "Jos"},
    7:  {"title": "Jueces",           "long_title": "El Libro de Jueces",                    "short_title": "Jue"},
    8:  {"title": "Rut",              "long_title": "El Libro de Rut",                       "short_title": "Rut"},
    9:  {"title": "1 Samuel",         "long_title": "El Primer Libro de Samuel",             "short_title": "1 Sam"},
    10: {"title": "2 Samuel",         "long_title": "El Segundo Libro de Samuel",            "short_title": "2 Sam"},
    11: {"title": "1 Reyes",          "long_title": "El Primer Libro de los Reyes",          "short_title": "1 Rey"},
    12: {"title": "2 Reyes",          "long_title": "El Segundo Libro de los Reyes",         "short_title": "2 Rey"},
    13: {"title": "1 Crónicas",       "long_title": "El Primer Libro de las Crónicas",       "short_title": "1 Crón"},
    14: {"title": "2 Crónicas",       "long_title": "El Segundo Libro de las Crónicas",      "short_title": "2 Crón"},
    15: {"title": "Esdras",           "long_title": "El Libro de Esdras",                    "short_title": "Esd"},
    16: {"title": "Nehemías",         "long_title": "El Libro de Nehemías",                  "short_title": "Neh"},
    17: {"title": "Ester",            "long_title": "El Libro de Ester",                     "short_title": "Est"},
    # OT: Wisdom/Poetry
    18: {"title": "Job",              "long_title": "El Libro de Job",                       "short_title": "Job"},
    19: {"title": "Salmos",           "long_title": "El Libro de los Salmos",                "short_title": "Sal"},
    20: {"title": "Proverbios",       "long_title": "El Libro de Proverbios",                "short_title": "Prov"},
    21: {"title": "Eclesiastés",      "long_title": "El Libro de Eclesiastés",               "short_title": "Ecl"},
    22: {"title": "Cantares",         "long_title": "El Cantar de los Cantares",             "short_title": "Cant"},
    # OT: Prophetic
    23: {"title": "Isaías",           "long_title": "El Libro de Isaías",                    "short_title": "Is"},
    24: {"title": "Jeremías",         "long_title": "El Libro de Jeremías",                  "short_title": "Jer"},
    25: {"title": "Lamentaciones",    "long_title": "Las Lamentaciones de Jeremías",         "short_title": "Lam"},
    26: {"title": "Ezequiel",         "long_title": "El Libro de Ezequiel",                  "short_title": "Ez"},
    27: {"title": "Daniel",           "long_title": "El Libro de Daniel",                    "short_title": "Dan"},
    28: {"title": "Oseas",            "long_title": "El Libro de Oseas",                     "short_title": "Os"},
    29: {"title": "Joel",             "long_title": "El Libro de Joel",                      "short_title": "Joel"},
    30: {"title": "Amós",             "long_title": "El Libro de Amós",                      "short_title": "Am"},
    31: {"title": "Abdías",           "long_title": "El Libro de Abdías",                    "short_title": "Abd"},
    32: {"title": "Jonás",            "long_title": "El Libro de Jonás",                     "short_title": "Jon"},
    33: {"title": "Miqueas",          "long_title": "El Libro de Miqueas",                   "short_title": "Miq"},
    34: {"title": "Nahúm",            "long_title": "El Libro de Nahúm",                     "short_title": "Nah"},
    35: {"title": "Habacuc",          "long_title": "El Libro de Habacuc",                   "short_title": "Hab"},
    36: {"title": "Sofonías",         "long_title": "El Libro de Sofonías",                  "short_title": "Sof"},
    37: {"title": "Hageo",            "long_title": "El Libro de Hageo",                     "short_title": "Hag"},
    38: {"title": "Zacarías",         "long_title": "El Libro de Zacarías",                  "short_title": "Zac"},
    39: {"title": "Malaquías",        "long_title": "El Libro de Malaquías",                 "short_title": "Mal"},
    # NT: Gospels
    40: {"title": "Mateo",            "long_title": "El Evangelio según Mateo",              "short_title": "Mat"},
    41: {"title": "Marcos",           "long_title": "El Evangelio según Marcos",             "short_title": "Mar"},
    42: {"title": "Lucas",            "long_title": "El Evangelio según Lucas",              "short_title": "Luc"},
    43: {"title": "Juan",             "long_title": "El Evangelio según Juan",               "short_title": "Juan"},
    # NT: Acts and Paul
    44: {"title": "Hechos",           "long_title": "Los Hechos de los Apóstoles",           "short_title": "Hech"},
    45: {"title": "Romanos",          "long_title": "La Epístola a los Romanos",             "short_title": "Rom"},
    46: {"title": "1 Corintios",      "long_title": "Primera Epístola a los Corintios",      "short_title": "1 Cor"},
    47: {"title": "2 Corintios",      "long_title": "Segunda Epístola a los Corintios",      "short_title": "2 Cor"},
    48: {"title": "Gálatas",          "long_title": "La Epístola a los Gálatas",             "short_title": "Gál"},
    49: {"title": "Efesios",          "long_title": "La Epístola a los Efesios",             "short_title": "Ef"},
    50: {"title": "Filipenses",       "long_title": "La Epístola a los Filipenses",          "short_title": "Fil"},
    51: {"title": "Colosenses",       "long_title": "La Epístola a los Colosenses",          "short_title": "Col"},
    52: {"title": "1 Tesalonicenses", "long_title": "Primera Epístola a los Tesalonicenses", "short_title": "1 Tes"},
    53: {"title": "2 Tesalonicenses", "long_title": "Segunda Epístola a los Tesalonicenses", "short_title": "2 Tes"},
    54: {"title": "1 Timoteo",        "long_title": "Primera Epístola a Timoteo",            "short_title": "1 Tim"},
    55: {"title": "2 Timoteo",        "long_title": "Segunda Epístola a Timoteo",            "short_title": "2 Tim"},
    56: {"title": "Tito",             "long_title": "La Epístola a Tito",                    "short_title": "Tit"},
    57: {"title": "Filemón",          "long_title": "La Epístola a Filemón",                 "short_title": "Flm"},
    # NT: Hebrews and other epistles
    58: {"title": "Hebreos",          "long_title": "La Epístola a los Hebreos",             "short_title": "Heb"},
    59: {"title": "Santiago",         "long_title": "La Epístola de Santiago",               "short_title": "Sant"},
    60: {"title": "1 Pedro",          "long_title": "Primera Epístola de Pedro",             "short_title": "1 Ped"},
    61: {"title": "2 Pedro",          "long_title": "Segunda Epístola de Pedro",             "short_title": "2 Ped"},
    62: {"title": "1 Juan",           "long_title": "Primera Epístola de Juan",              "short_title": "1 Juan"},
    63: {"title": "2 Juan",           "long_title": "Segunda Epístola de Juan",              "short_title": "2 Juan"},
    64: {"title": "3 Juan",           "long_title": "Tercera Epístola de Juan",              "short_title": "3 Juan"},
    65: {"title": "Judas",            "long_title": "La Epístola de Judas",                  "short_title": "Jud"},
    # NT: Revelation
    66: {"title": "Apocalipsis",      "long_title": "El Apocalipsis de Juan",                "short_title": "Apoc"},
}

# Greek book names — monotonic Greek matching the Public Domain Greek Bible
# (Bible SuperSearch format, greek.db).
# Keys are book numbers 1–66.
GREEK_BOOK_NAMES: Dict[int, Dict[str, str]] = {
    # OT: Pentateuch
    1:  {"title": "Γένεσις",          "long_title": "Το Βιβλίο της Γένεσης",               "short_title": "Γεν"},
    2:  {"title": "Έξοδος",           "long_title": "Το Βιβλίο της Εξόδου",                "short_title": "Εξ"},
    3:  {"title": "Λευιτικό",         "long_title": "Το Βιβλίο του Λευιτικού",             "short_title": "Λεβ"},
    4:  {"title": "Αριθμοί",          "long_title": "Το Βιβλίο των Αριθμών",               "short_title": "Αρ"},
    5:  {"title": "Δευτερονόμιο",     "long_title": "Το Βιβλίο του Δευτερονομίου",         "short_title": "Δευτ"},
    # OT: Historical
    6:  {"title": "Ιησούς Ναυή",      "long_title": "Το Βιβλίο του Ιησού Ναυή",            "short_title": "Ιησ"},
    7:  {"title": "Κριτές",           "long_title": "Το Βιβλίο των Κριτών",                "short_title": "Κρ"},
    8:  {"title": "Ρούθ",             "long_title": "Το Βιβλίο της Ρούθ",                  "short_title": "Ρουθ"},
    9:  {"title": "Α' Βασιλειών",     "long_title": "Πρώτο Βιβλίο Βασιλειών",             "short_title": "Α' Βα"},
    10: {"title": "Β' Βασιλειών",     "long_title": "Δεύτερο Βιβλίο Βασιλειών",           "short_title": "Β' Βα"},
    11: {"title": "Γ' Βασιλειών",     "long_title": "Τρίτο Βιβλίο Βασιλειών",             "short_title": "Γ' Βα"},
    12: {"title": "Δ' Βασιλειών",     "long_title": "Τέταρτο Βιβλίο Βασιλειών",           "short_title": "Δ' Βα"},
    13: {"title": "Α' Χρονικών",      "long_title": "Πρώτο Βιβλίο Χρονικών",              "short_title": "Α'Χρ"},
    14: {"title": "Β' Χρονικών",      "long_title": "Δεύτερο Βιβλίο Χρονικών",            "short_title": "Β'Χρ"},
    15: {"title": "Εσδράς",           "long_title": "Το Βιβλίο του Εσδρά",                 "short_title": "Εσδρ"},
    16: {"title": "Νεεμίας",          "long_title": "Το Βιβλίο του Νεεμία",                "short_title": "Νεεμ"},
    17: {"title": "Εσθήρ",            "long_title": "Το Βιβλίο της Εσθήρ",                 "short_title": "Εσθ"},
    # OT: Wisdom/Poetry
    18: {"title": "Ιώβ",              "long_title": "Το Βιβλίο του Ιώβ",                   "short_title": "Ιωβ"},
    19: {"title": "Ψαλμοί",           "long_title": "Το Βιβλίο των Ψαλμών",                "short_title": "Ψαλ"},
    20: {"title": "Παροιμίες",        "long_title": "Το Βιβλίο των Παροιμιών",             "short_title": "Παρ"},
    21: {"title": "Εκκλησιαστής",     "long_title": "Το Βιβλίο του Εκκλησιαστή",           "short_title": "Εκκλ"},
    22: {"title": "Άσμα Ασμάτων",     "long_title": "Το Άσμα Ασμάτων του Σολομώντα",       "short_title": "Ασμ"},
    # OT: Prophetic
    23: {"title": "Ησαΐας",           "long_title": "Το Βιβλίο του Ησαΐα",                 "short_title": "Ησ"},
    24: {"title": "Ιερεμίας",         "long_title": "Το Βιβλίο του Ιερεμία",               "short_title": "Ιρμ"},
    25: {"title": "Θρήνοι",           "long_title": "Θρήνοι του Ιερεμία",                  "short_title": "Θρην"},
    26: {"title": "Ιεζεκιήλ",         "long_title": "Το Βιβλίο του Ιεζεκιήλ",              "short_title": "Ιζκ"},
    27: {"title": "Δανιήλ",           "long_title": "Το Βιβλίο του Δανιήλ",                "short_title": "Δαν"},
    28: {"title": "Ωσηέ",             "long_title": "Το Βιβλίο του Ωσηέ",                  "short_title": "Ωση"},
    29: {"title": "Ιωήλ",             "long_title": "Το Βιβλίο του Ιωήλ",                  "short_title": "Ιλ"},
    30: {"title": "Αμώς",             "long_title": "Το Βιβλίο του Αμώς",                  "short_title": "Αμ"},
    31: {"title": "Αβδιού",           "long_title": "Το Βιβλίο του Αβδιού",                "short_title": "Αβδ"},
    32: {"title": "Ιωνάς",            "long_title": "Το Βιβλίο του Ιωνά",                  "short_title": "Ιων"},
    33: {"title": "Μιχαίας",          "long_title": "Το Βιβλίο του Μιχαία",                "short_title": "Μιχ"},
    34: {"title": "Ναούμ",            "long_title": "Το Βιβλίο του Ναούμ",                 "short_title": "Ναμ"},
    35: {"title": "Αββακούμ",         "long_title": "Το Βιβλίο του Αββακούμ",              "short_title": "Αββ"},
    36: {"title": "Σοφονίας",         "long_title": "Το Βιβλίο του Σοφονία",               "short_title": "Σοφ"},
    37: {"title": "Αγγαίος",          "long_title": "Το Βιβλίο του Αγγαίου",               "short_title": "Αγγ"},
    38: {"title": "Ζαχαρίας",         "long_title": "Το Βιβλίο του Ζαχαρία",               "short_title": "Ζαχ"},
    39: {"title": "Μαλαχίας",         "long_title": "Το Βιβλίο του Μαλαχία",               "short_title": "Μαλ"},
    # NT: Gospels
    40: {"title": "Ματθαίος",         "long_title": "Κατά Ματθαίον Ευαγγέλιο",             "short_title": "Ματθ"},
    41: {"title": "Μάρκος",           "long_title": "Κατά Μάρκον Ευαγγέλιο",               "short_title": "Μαρκ"},
    42: {"title": "Λουκάς",           "long_title": "Κατά Λουκάν Ευαγγέλιο",               "short_title": "Λουκ"},
    43: {"title": "Ιωάννης",          "long_title": "Κατά Ιωάννην Ευαγγέλιο",              "short_title": "Ιωαν"},
    # NT: Acts and Paul
    44: {"title": "Πράξεις",          "long_title": "Πράξεις των Αποστόλων",               "short_title": "Πρξ"},
    45: {"title": "Ρωμαίους",         "long_title": "Επιστολή προς Ρωμαίους",              "short_title": "Ρωμ"},
    46: {"title": "Α' Κορινθίους",    "long_title": "Α' Επιστολή προς Κορινθίους",         "short_title": "Α'Κορ"},
    47: {"title": "Β' Κορινθίους",    "long_title": "Β' Επιστολή προς Κορινθίους",         "short_title": "Β'Κορ"},
    48: {"title": "Γαλάτας",          "long_title": "Επιστολή προς Γαλάτας",               "short_title": "Γαλ"},
    49: {"title": "Εφεσίους",         "long_title": "Επιστολή προς Εφεσίους",              "short_title": "Εφ"},
    50: {"title": "Φιλιππησίους",     "long_title": "Επιστολή προς Φιλιππησίους",          "short_title": "Φιλ"},
    51: {"title": "Κολοσσαείς",       "long_title": "Επιστολή προς Κολοσσαείς",            "short_title": "Κολ"},
    52: {"title": "Α' Θεσσαλονικείς", "long_title": "Α' Επιστολή προς Θεσσαλονικείς",     "short_title": "Α'Θεσ"},
    53: {"title": "Β' Θεσσαλονικείς", "long_title": "Β' Επιστολή προς Θεσσαλονικείς",     "short_title": "Β'Θεσ"},
    54: {"title": "Α' Τιμόθεο",       "long_title": "Α' Επιστολή προς Τιμόθεο",            "short_title": "Α'Τιμ"},
    55: {"title": "Β' Τιμόθεο",       "long_title": "Β' Επιστολή προς Τιμόθεο",            "short_title": "Β'Τιμ"},
    56: {"title": "Τίτο",             "long_title": "Επιστολή προς Τίτο",                  "short_title": "Τιτ"},
    57: {"title": "Φιλήμονα",         "long_title": "Επιστολή προς Φιλήμονα",              "short_title": "Φλμ"},
    # NT: Hebrews and other epistles
    58: {"title": "Εβραίους",         "long_title": "Επιστολή προς Εβραίους",              "short_title": "Εβρ"},
    59: {"title": "Ιάκωβος",          "long_title": "Επιστολή Ιακώβου",                    "short_title": "Ιακ"},
    60: {"title": "Α' Πέτρου",        "long_title": "Α' Επιστολή Πέτρου",                  "short_title": "Α'Πετ"},
    61: {"title": "Β' Πέτρου",        "long_title": "Β' Επιστολή Πέτρου",                  "short_title": "Β'Πετ"},
    62: {"title": "Α' Ιωάννου",       "long_title": "Α' Επιστολή Ιωάννου",                 "short_title": "Α'Ιω"},
    63: {"title": "Β' Ιωάννου",       "long_title": "Β' Επιστολή Ιωάννου",                 "short_title": "Β'Ιω"},
    64: {"title": "Γ' Ιωάννου",       "long_title": "Γ' Επιστολή Ιωάννου",                 "short_title": "Γ'Ιω"},
    65: {"title": "Ιούδας",           "long_title": "Επιστολή Ιούδα",                      "short_title": "Ιουδ"},
    # NT: Revelation
    66: {"title": "Αποκάλυψη",        "long_title": "Αποκάλυψη Ιωάννου",                   "short_title": "Απκ"},
}

# Volume-level display metadata.  Keyed by the lowercase --language argument.
# When a language is present here it takes precedence over the generic fallback.
VOLUME_META: Dict[str, Dict[str, str]] = {
    "cebuano": {
        "title":       "Cebuano Bible",
        "long_title":  "The Cebuano Bible",
        "subtitle":    "Cebuano",
        "short_title": "Cebuano",
    },
    "tagalog": {
        "title":       "Tagalog Bible",
        "long_title":  "The Tagalog Bible",
        "subtitle":    "Tagalog",
        "short_title": "Tagalog",
    },
    "greek": {
        "title":       "Ελληνική Βίβλος",
        "long_title":  "Η Ελληνική Βίβλος",
        "subtitle":    "Modern Greek",
        "short_title": "GR",
    },
    "spanish": {
        "title":       "Santa Biblia",
        "long_title":  "La Santa Biblia (Reina-Valera)",
        "subtitle":    "Spanish",
        "short_title": "Esp.",
    },
}


def get_book_names(book_num: int, language: str) -> Dict[str, str]:
    """
    Return the localized title, long_title, and short_title for a given book
    number and language.  Falls back to the English BIBLE_BOOKS entry when the
    language is not recognised, or when the book number is not found.
    """
    lang_key = language.strip().lower()
    if lang_key == "cebuano":
        names = CEBUANO_BOOK_NAMES.get(book_num)
    elif lang_key == "tagalog":
        names = TAGALOG_BOOK_NAMES.get(book_num)
    elif lang_key == "spanish":
        names = SPANISH_BOOK_NAMES.get(book_num)
    elif lang_key == "greek":
        names = GREEK_BOOK_NAMES.get(book_num)
    else:
        names = None

    if names:
        return names

    # Fallback: find the English entry
    for book in BIBLE_BOOKS:
        if book["num"] == book_num:
            return {
                "title":      book["title"],
                "long_title": book["long_title"],
                "short_title": book["short_title"],
            }
    return {"title": "Unknown", "long_title": "Unknown", "short_title": "Unk"}

def extract_verses_from_old_schema(input_db: str) -> Dict[Tuple[int, int, int], str]:
    """
    Extract verse text from old schema (Bible SuperSearch format).
    
    The old schema stores individual words indexed by bookNum, chNum, verseNum.
    This reconstructs the complete verse text by concatenating words in order.
    
    Returns dict: {(bookNum, chNum, verseNum): verse_text}
    """
    verses = {}
    
    try:
        conn = sqlite3.connect(input_db)
        cursor = conn.cursor()
        
        # Check if words table exists
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='words'")
        if not cursor.fetchone():
            logger.error("ERROR: 'words' table not found in database")
            logger.error("Ensure the database is from Bible SuperSearch format with a 'words' table")
            conn.close()
            return verses
        
        # Get all words, grouped by verse reference, maintaining word order
        # Using ROWID to preserve the original word order (crucial for verse reconstruction)
        cursor.execute("""
            SELECT bookNum, chNum, verseNum, GROUP_CONCAT(word, ' ') as verse_text
            FROM words
            GROUP BY bookNum, chNum, verseNum
            ORDER BY bookNum, chNum, verseNum
        """)
        
        row_count = 0
        for book_num, ch_num, verse_num, verse_text in cursor.fetchall():
            if verse_text:
                verses[(book_num, ch_num, verse_num)] = verse_text
                row_count += 1
        
        if row_count == 0:
            logger.warning("WARNING: No verses found in words table")
            logger.warning("The database may be empty or corrupted")
        
        logger.info(f"Successfully extracted {row_count} verses from words table")
        conn.close()
    except sqlite3.DatabaseError as e:
        logger.error(f"Database error reading words table: {e}")
        logger.error("Possible causes: corrupted database, wrong format, incompatible SQLite version")
    except Exception as e:
        logger.error(f"Unexpected error extracting verses: {e}")
    
    return verses


def get_configuration(input_db: str) -> Dict[str, str]:
    """Extract configuration metadata from old schema."""
    config = {
        "title": "Bible",
        "description": "Bible",
        "copyrights": "",
        "fonts": ""
    }
    
    try:
        conn = sqlite3.connect(input_db)
        cursor = conn.cursor()
        
        cursor.execute("SELECT * FROM configuration LIMIT 1")
        row = cursor.fetchone()
        if row:
            cols = cursor.description
            for i, col in enumerate(cols):
                if col[0] in config and row[i]:
                    config[col[0]] = row[i]
        
        conn.close()
    except Exception as e:
        logger.warning(f"Could not read configuration: {e}")
    
    return config


def create_new_schema(output_db: str) -> sqlite3.Connection:
    """Create the new LDS-compatible schema."""
    conn = sqlite3.connect(output_db)
    cursor = conn.cursor()
    
    # Create volumes table
    cursor.execute("""
    CREATE TABLE volumes (
        id INTEGER PRIMARY KEY,
        volume_title TEXT,
        volume_long_title TEXT,
        volume_subtitle TEXT,
        volume_short_title TEXT,
        volume_lds_url TEXT
    )
    """)
    
    # Create books table
    cursor.execute("""
    CREATE TABLE books (
        id INTEGER PRIMARY KEY,
        volume_id INTEGER REFERENCES volumes(id) ON DELETE CASCADE,
        book_title TEXT,
        book_long_title TEXT,
        book_subtitle TEXT,
        book_short_title TEXT,
        book_lds_url TEXT
    )
    """)
    
    # Create chapters table
    cursor.execute("""
    CREATE TABLE chapters (
        id INTEGER PRIMARY KEY,
        book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
        chapter_number INTEGER
    )
    """)
    
    # Create verses table
    cursor.execute("""
    CREATE TABLE verses (
        id INTEGER PRIMARY KEY,
        chapter_id INTEGER REFERENCES chapters(id) ON DELETE CASCADE,
        verse_number INTEGER,
        scripture_text TEXT
    )
    """)
    
    # Create configuration table for metadata
    cursor.execute("""
    CREATE TABLE configuration (
        revision INTEGER,
        fonts TEXT,
        title TEXT,
        description TEXT,
        copyrights TEXT
    )
    """)
    
    # Create scriptures view (same as LDS schema)
    cursor.execute("""
    CREATE VIEW scriptures AS 
    SELECT 
        volumes.id AS volume_id,
        books.id AS book_id,
        chapters.id AS chapter_id,
        verses.id AS verse_id,
        volume_title,
        book_title,
        volume_long_title,
        book_long_title,
        volume_subtitle,
        book_subtitle,
        volume_short_title,
        book_short_title,
        volume_lds_url,
        book_lds_url,
        chapter_number,
        verse_number,
        scripture_text,
        book_title || ' ' || chapter_number || ':' || verse_number AS verse_title,
        book_short_title || ' ' || chapter_number || ':' || verse_number AS verse_short_title
    FROM volumes
    INNER JOIN books ON books.volume_id = volumes.id
    INNER JOIN chapters ON chapters.book_id = books.id
    INNER JOIN verses ON verses.chapter_id = chapters.id
    ORDER BY volumes.id, books.id, chapters.id, verses.id
    """)
    
    conn.commit()
    return conn


def migrate_data(input_db: str, output_db: str, language: str) -> None:
    """Main migration function."""
    
    logger.info(f"Starting migration: {input_db} → {output_db}")
    logger.info(f"Language: {language}")
    
    # Extract data from old schema
    verses = extract_verses_from_old_schema(input_db)
    config = get_configuration(input_db)
    
    if not verses:
        logger.error("No verses found in source database. Cannot proceed.")
        logger.error("Ensure your database has a 'words' table or contains verse data.")
        return
    
    logger.info(f"Extracted {len(verses)} verses")
    
    # Create new schema
    conn = create_new_schema(output_db)
    cursor = conn.cursor()
    
    # Insert volume (single volume for Bible) — use VOLUME_META if available
    lang_key = language.strip().lower()
    vm = VOLUME_META.get(lang_key, {})
    volume_title       = vm.get("title",       f"{language} Bible")
    volume_long_title  = vm.get("long_title",  f"The {language} Bible")
    volume_subtitle    = vm.get("subtitle",    language)
    volume_short_title = vm.get("short_title", language)
    cursor.execute("""
    INSERT INTO volumes (id, volume_title, volume_long_title, volume_subtitle, volume_short_title)
    VALUES (1, ?, ?, ?, ?)
    """, (volume_title, volume_long_title, volume_subtitle, volume_short_title))

    logger.info(f"Created volume: {volume_title}")
    
    # Insert books and chapters with sequential IDs (like LDS standard)
    chapters_created = 0
    verses_inserted = 0
    next_chapter_id = 1
    next_verse_id = 1
    
    for book_meta in BIBLE_BOOKS:
        book_num = book_meta["num"]
        book_id = book_num  # Use book number as ID (1-66)
        
        localized = get_book_names(book_num, language)
        cursor.execute("""
        INSERT INTO books (id, volume_id, book_title, book_long_title, book_subtitle, book_short_title)
        VALUES (?, 1, ?, ?, ?, ?)
        """, (
            book_id,
            localized["title"],
            localized["long_title"],
            "",
            localized["short_title"]
        ))
        
        # Find all chapters for this book
        book_chapters = set()
        for (b, ch, v), text in verses.items():
            if b == book_num:
                book_chapters.add(ch)
        
        # Insert chapters and verses with sequential IDs
        for ch_num in sorted(book_chapters):
            chapter_id = next_chapter_id
            next_chapter_id += 1
            
            cursor.execute("""
            INSERT INTO chapters (id, book_id, chapter_number)
            VALUES (?, ?, ?)
            """, (chapter_id, book_id, ch_num))
            chapters_created += 1
            
            # Find all verses in this chapter
            for (b, ch, v), text in verses.items():
                if b == book_num and ch == ch_num:
                    verse_id = next_verse_id
                    next_verse_id += 1
                    
                    cursor.execute("""
                    INSERT INTO verses (id, chapter_id, verse_number, scripture_text)
                    VALUES (?, ?, ?, ?)
                    """, (verse_id, chapter_id, v, text))
                    verses_inserted += 1
    
    # Insert configuration
    cursor.execute("""
    INSERT INTO configuration (title, description, fonts, copyrights)
    VALUES (?, ?, ?, ?)
    """, (
        config.get("title", volume_title),
        config.get("description", f"The {language} Bible"),
        config.get("fonts", ""),
        config.get("copyrights", "")
    ))
    
    conn.commit()
    conn.close()
    
    logger.info(f"✓ Created {len(BIBLE_BOOKS)} books")
    logger.info(f"✓ Created {chapters_created} chapters")
    logger.info(f"✓ Inserted {verses_inserted} verses")
    logger.info(f"✓ Migration complete: {output_db}")


def main():
    parser = argparse.ArgumentParser(
        description="Migrate Bible databases to LDS scriptures schema"
    )
    parser.add_argument("--input", required=True, help="Input database file")
    parser.add_argument("--output", required=True, help="Output database file")
    parser.add_argument("--language", default="Bible", help="Language/name of Bible version")
    
    args = parser.parse_args()
    
    # Validate input
    if not Path(args.input).exists():
        logger.error(f"Input file not found: {args.input}")
        return
    
    if Path(args.output).exists():
        logger.warning(f"Output file will be overwritten: {args.output}")
    
    migrate_data(args.input, args.output, args.language)


if __name__ == "__main__":
    main()