import argparse
import pandas as pd
import requests
from bs4 import BeautifulSoup
import time
import re

# --- 1. METADATA TRANSLATION DICTIONARIES ---

# ── Cebuano ──────────────────────────────────────────────────────────────────
CEBUANO_VOLUMES = {
    "Book of Mormon": {"long": "Ang Basahon ni Mormon", "short": "BoM", "subtitle": "Usa pa ka Tigsulat ni Jesucristo"},
    "Doctrine and Covenants": {"long": "Ang Mga Doktrina ug mga Kasabutan", "short": "D ug K", "subtitle": ""},
    "Pearl of Great Price": {"long": "Ang Mutya sa Daku nga Bili", "short": "MdB", "subtitle": ""}
}

CEBUANO_BOOKS = {
    "1 Nephi": {"title": "1 Nephi", "long": "Ang Unang Basahon ni Nephi", "short": "1 Ne."},
    "2 Nephi": {"title": "2 Nephi", "long": "Ang Ikaduhang Basahon ni Nephi", "short": "2 Ne."},
    "Jacob": {"title": "Jacob", "long": "Ang Basahon ni Jacob", "short": "Jac."},
    "Enos": {"title": "Enos", "long": "Ang Basahon ni Enos", "short": "Enos"},
    "Jarom": {"title": "Jarom", "long": "Ang Basahon ni Jarom", "short": "Jarom"},
    "Omni": {"title": "Omni", "long": "Ang Basahon ni Omni", "short": "Omni"},
    "Words of Mormon": {"title": "Mga Sulti ni Mormon", "long": "Ang Mga Sulti ni Mormon", "short": "S. ni M."},
    "Mosiah": {"title": "Mosiah", "long": "Ang Basahon ni Mosiah", "short": "Mosiah"},
    "Alma": {"title": "Alma", "long": "Ang Basahon ni Alma", "short": "Alma"},
    "Helaman": {"title": "Helaman", "long": "Ang Basahon ni Helaman", "short": "Hel."},
    "3 Nephi": {"title": "3 Nephi", "long": "Ikatulong Nephi", "short": "3 Ne."},
    "4 Nephi": {"title": "4 Nephi", "long": "Ikaupat nga Nephi", "short": "4 Ne."},
    "Mormon": {"title": "Mormon", "long": "Ang Basahon ni Mormon", "short": "Morm."},
    "Ether": {"title": "Ether", "long": "Ang Basahon ni Ether", "short": "Ether"},
    "Moroni": {"title": "Moroni", "long": "Ang Basahon ni Moroni", "short": "Moro."},
    "Doctrine and Covenants": {"title": "Mga Doktrina ug mga Kasabutan", "long": "Ang Mga Doktrina ug mga Kasabutan", "short": "D ug K"},
    "Moses": {"title": "Moises", "long": "Mga Pinili gikan sa Basahon ni Moises", "short": "Moises"},
    "Abraham": {"title": "Abraham", "long": "Ang Basahon ni Abraham", "short": "Abr."},
    "Joseph Smith--Matthew": {"title": "Joseph Smith—Mateo", "long": "Joseph Smith—Mateo", "short": "JS—M"},
    "Joseph Smith--History": {"title": "Joseph Smith—Kasaysayan", "long": "Joseph Smith—Kasaysayan", "short": "JS—K"},
    "Articles of Faith": {"title": "Mga Artikulo sa Pagtoo", "long": "Ang Mga Artikulo sa Pagtoo", "short": "A. sa P."}
}

# ── Spanish ───────────────────────────────────────────────────────────────────
SPANISH_VOLUMES = {
    "Book of Mormon": {"long": "El Libro de Mormón", "short": "LdM", "subtitle": "Otro Testamento de Jesucristo"},
    "Doctrine and Covenants": {"long": "La Doctrina y los Convenios", "short": "DyC", "subtitle": ""},
    "Pearl of Great Price": {"long": "La Perla de Gran Precio", "short": "PGP", "subtitle": ""}
}

SPANISH_BOOKS = {
    "1 Nephi": {"title": "1 Nefi", "long": "El Primer Libro de Nefi", "short": "1 Ne."},
    "2 Nephi": {"title": "2 Nefi", "long": "El Segundo Libro de Nefi", "short": "2 Ne."},
    "Jacob": {"title": "Jacob", "long": "El Libro de Jacob", "short": "Jac."},
    "Enos": {"title": "Enós", "long": "El Libro de Enós", "short": "Enós"},
    "Jarom": {"title": "Jarom", "long": "El Libro de Jarom", "short": "Jarom"},
    "Omni": {"title": "Omni", "long": "El Libro de Omni", "short": "Omni"},
    "Words of Mormon": {"title": "Palabras de Mormón", "long": "Las Palabras de Mormón", "short": "Pal. de M."},
    "Mosiah": {"title": "Mosíah", "long": "El Libro de Mosíah", "short": "Mos."},
    "Alma": {"title": "Alma", "long": "El Libro de Alma", "short": "Alma"},
    "Helaman": {"title": "Helamán", "long": "El Libro de Helamán", "short": "Hel."},
    "3 Nephi": {"title": "3 Nefi", "long": "El Tercer Libro de Nefi", "short": "3 Ne."},
    "4 Nephi": {"title": "4 Nefi", "long": "El Cuarto Libro de Nefi", "short": "4 Ne."},
    "Mormon": {"title": "Mormón", "long": "El Libro de Mormón", "short": "Morm."},
    "Ether": {"title": "Éter", "long": "El Libro de Éter", "short": "Éter"},
    "Moroni": {"title": "Moroni", "long": "El Libro de Moroni", "short": "Moro."},
    "Doctrine and Covenants": {"title": "Doctrina y Convenios", "long": "La Doctrina y los Convenios", "short": "DyC"},
    "Moses": {"title": "Moisés", "long": "Selecciones del Libro de Moisés", "short": "Moisés"},
    "Abraham": {"title": "Abraham", "long": "El Libro de Abraham", "short": "Abr."},
    "Joseph Smith--Matthew": {"title": "José Smith—Mateo", "long": "José Smith—Mateo", "short": "JS—M"},
    "Joseph Smith--History": {"title": "José Smith—Historia", "long": "José Smith—Historia", "short": "JS—H"},
    "Articles of Faith": {"title": "Los Artículos de Fe", "long": "Los Artículos de Fe", "short": "Art. de Fe"}
}

# ── Greek ─────────────────────────────────────────────────────────────────────
GREEK_VOLUMES = {
    "Book of Mormon": {"long": "Το Βιβλίο του Μόρμωνα", "short": "ΒΜ", "subtitle": "Ένα άλλο Μαρτύριο του Ιησού Χριστού"},
    "Doctrine and Covenants": {"long": "Δόγματα και Διαθήκες", "short": "ΔΔ", "subtitle": ""},
    "Pearl of Great Price": {"long": "Η Μεγαλότιμη Μαργαριτάρα", "short": "ΜΜΒ", "subtitle": ""}
}

GREEK_BOOKS = {
    "1 Nephi": {"title": "1 Νεφί", "long": "Πρώτο Βιβλίο του Νεφί", "short": "1 Νεφ."},
    "2 Nephi": {"title": "2 Νεφί", "long": "Δεύτερο Βιβλίο του Νεφί", "short": "2 Νεφ."},
    "Jacob": {"title": "Ιακώβ", "long": "Βιβλίο του Ιακώβ", "short": "Ιακ."},
    "Enos": {"title": "Ενώς", "long": "Βιβλίο του Ενώς", "short": "Ενώς"},
    "Jarom": {"title": "Ιαρώμ", "long": "Βιβλίο του Ιαρώμ", "short": "Ιαρ."},
    "Omni": {"title": "Ομνί", "long": "Βιβλίο του Ομνί", "short": "Ομνί"},
    "Words of Mormon": {"title": "Λόγια του Μόρμωνα", "long": "Τα Λόγια του Μόρμωνα", "short": "Λόγ. Μ."},
    "Mosiah": {"title": "Μωσίας", "long": "Βιβλίο του Μωσία", "short": "Μωσ."},
    "Alma": {"title": "Άλμα", "long": "Βιβλίο του Άλμα", "short": "Άλμα"},
    "Helaman": {"title": "Χελαμάν", "long": "Βιβλίο του Χελαμάν", "short": "Χελ."},
    "3 Nephi": {"title": "3 Νεφί", "long": "Τρίτο Βιβλίο του Νεφί", "short": "3 Νεφ."},
    "4 Nephi": {"title": "4 Νεφί", "long": "Τέταρτο Βιβλίο του Νεφί", "short": "4 Νεφ."},
    "Mormon": {"title": "Μόρμων", "long": "Βιβλίο του Μόρμωνα", "short": "Μορμ."},
    "Ether": {"title": "Αιθήρ", "long": "Βιβλίο του Αιθήρα", "short": "Αιθ."},
    "Moroni": {"title": "Μορωνί", "long": "Βιβλίο του Μορωνί", "short": "Μορ."},
    "Doctrine and Covenants": {"title": "Δόγματα και Διαθήκες", "long": "Δόγματα και Διαθήκες", "short": "ΔΔ"},
    "Moses": {"title": "Μωϋσής", "long": "Αποσπάσματα από το Βιβλίο του Μωϋσή", "short": "Μωυσ."},
    "Abraham": {"title": "Αβραάμ", "long": "Βιβλίο του Αβραάμ", "short": "Αβρ."},
    "Joseph Smith--Matthew": {"title": "Ιωσήφ Σμιθ—Ματθαίος", "long": "Ιωσήφ Σμιθ—Ματθαίος", "short": "ΙΣ—Μτ"},
    "Joseph Smith--History": {"title": "Ιωσήφ Σμιθ—Ιστορία", "long": "Ιωσήφ Σμιθ—Ιστορία", "short": "ΙΣ—Ι"},
    "Articles of Faith": {"title": "Τα Άρθρα της Πίστεως", "long": "Τα Άρθρα της Πίστεως", "short": "Άρθ. Π."}
}

# ── Language registry ─────────────────────────────────────────────────────────
LANG_META = {
    "ceb": {"volumes": CEBUANO_VOLUMES, "books": CEBUANO_BOOKS, "lds_code": "ceb"},
    "spa": {"volumes": SPANISH_VOLUMES, "books": SPANISH_BOOKS, "lds_code": "spa"},
    "ell": {"volumes": GREEK_VOLUMES,   "books": GREEK_BOOKS,   "lds_code": "ell"},
}


def fetch_chapter_verses(volume_url, book_url, chapter_number, lang_code):
    """Scrapes a single chapter from the Church website and returns a dictionary of verses."""
    url = f"https://www.churchofjesuschrist.org/study/scriptures/{volume_url}/{book_url}/{chapter_number}?lang={lang_code}"

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    }

    response = requests.get(url, headers=headers)
    if response.status_code != 200:
        print(f"  [!] Failed to fetch {url} (Status: {response.status_code})")
        return {}

    soup = BeautifulSoup(response.text, 'html.parser')
    verses_dict = {}

    verse_paragraphs = soup.find_all('p', class_='verse')

    for p in verse_paragraphs:
        verse_num_tag = p.find('span', class_='verse-number')
        if not verse_num_tag:
            continue

        verse_num = int(verse_num_tag.text.strip())
        verse_num_tag.decompose()

        for sup in p.find_all('sup'):
            sup.decompose()
        for marker in p.find_all('span', class_='marker'):
            marker.decompose()

        clean_text = p.get_text(separator=' ', strip=True)
        verses_dict[verse_num] = clean_text

    return verses_dict


def build_triple_csv(english_csv_path, output_csv_path, lang):
    meta = LANG_META[lang]
    VOL_DICT  = meta["volumes"]
    BOOK_DICT = meta["books"]
    lds_code  = meta["lds_code"]

    print(f"PHASE 1: Loading English Schema (lang={lang}, lds_code={lds_code})...")
    df = pd.read_csv(english_csv_path)
    triple_df = df[df['volume_id'].isin([3, 4, 5])].copy()

    text_cols = [
        'volume_title', 'volume_long_title', 'volume_subtitle', 'volume_short_title',
        'book_title', 'book_long_title', 'book_subtitle', 'book_short_title',
        'verse_title', 'verse_short_title', 'scripture_text'
    ]
    for col in text_cols:
        if col in triple_df.columns:
            triple_df[col] = triple_df[col].astype(str)

    triple_df['scripture_text'] = ""

    print("PHASE 2: Translating Metadata & Scraping Text...")

    unique_chapters = triple_df[['volume_lds_url', 'book_lds_url', 'chapter_number']].drop_duplicates()
    total_chapters = len(unique_chapters)
    print(f"Found {total_chapters} chapters to scrape. Starting network requests...")

    for i, (_, chap_row) in enumerate(unique_chapters.iterrows(), 1):
        vol_url  = chap_row['volume_lds_url']
        book_url = chap_row['book_lds_url']
        chap_num = chap_row['chapter_number']

        print(f"  Scraping {book_url} Chapter {chap_num} ({i}/{total_chapters})...")

        scraped_verses = fetch_chapter_verses(vol_url, book_url, chap_num, lds_code)

        mask = (triple_df['volume_lds_url'] == vol_url) & \
               (triple_df['book_lds_url'] == book_url) & \
               (triple_df['chapter_number'] == chap_num)

        for index, row in triple_df[mask].iterrows():
            verse_num = int(row['verse_number'])
            eng_book  = row['book_title']
            eng_vol   = row['volume_title']

            # Translate Volume Metadata
            if eng_vol in VOL_DICT:
                triple_df.at[index, 'volume_long_title']  = VOL_DICT[eng_vol]['long']
                triple_df.at[index, 'volume_short_title'] = VOL_DICT[eng_vol]['short']
                triple_df.at[index, 'volume_subtitle']    = VOL_DICT[eng_vol]['subtitle']

            # Translate Book Metadata
            if eng_book in BOOK_DICT:
                loc_book = BOOK_DICT[eng_book]
                triple_df.at[index, 'book_title']       = loc_book['title']
                triple_df.at[index, 'book_long_title']  = loc_book['long']
                triple_df.at[index, 'book_short_title'] = loc_book['short']
                triple_df.at[index, 'verse_title']       = f"{loc_book['title']} {chap_num}:{verse_num}"
                triple_df.at[index, 'verse_short_title'] = f"{loc_book['short']} {chap_num}:{verse_num}"

            # Insert Scraped Text
            if verse_num in scraped_verses:
                triple_df.at[index, 'scripture_text'] = scraped_verses[verse_num]
            else:
                triple_df.at[index, 'scripture_text'] = f"[NOT FOUND ON WEB: Verse {verse_num}]"

        # time.sleep(0.5)

    triple_df.to_csv(output_csv_path, index=False, encoding='utf-8')
    print(f"\n✅ Success! Scraped and exported clean CSV to {output_csv_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build a localized Triple Combination CSV from the LDS website.")
    parser.add_argument("--lang",    required=True, choices=list(LANG_META.keys()),
                        help="Language code: ceb, spa, ell")
    parser.add_argument("--eng-csv", default="lds-scriptures.csv",
                        help="Path to English LDS scriptures CSV (default: lds-scriptures.csv)")
    parser.add_argument("--out-csv", default=None,
                        help="Output CSV path (default: <lang>_triple.csv)")
    args = parser.parse_args()

    out_csv = args.out_csv or f"{args.lang}_triple.csv"
    build_triple_csv(args.eng_csv, out_csv, args.lang)
