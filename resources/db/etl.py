import pandas as pd
import requests
from bs4 import BeautifulSoup
import time
import re

# --- 1. METADATA TRANSLATION DICTIONARIES ---
CEBUANO_VOLUMES = {
    "Book of Mormon": {"title": "Basahon ni Mormon", "long": "Ang Basahon ni Mormon", "short": "BoM", "subtitle": "Usa pa ka Tigsulat ni Jesucristo"},
    "Doctrine and Covenants": {"title": "Mga Doktrina ug mga Kasabutan", "long": "Ang Mga Doktrina ug mga Kasabutan", "short": "D ug K", "subtitle": ""},
    "Pearl of Great Price": {"title": "Mutya sa Daku nga Bili", "long": "Ang Mutya sa Daku nga Bili", "short": "MdB", "subtitle": ""}
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

def fetch_chapter_verses(volume_url, book_url, chapter_number):
    """Scrapes a single chapter from the Church website and returns a dictionary of verses."""
    # Build the official URL for the Cebuano scriptures
    url = f"https://www.churchofjesuschrist.org/study/scriptures/{volume_url}/{book_url}/{chapter_number}?lang=ceb"
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    }
    
    response = requests.get(url, headers=headers)
    if response.status_code != 200:
        print(f"  [!] Failed to fetch {url} (Status: {response.status_code})")
        return {}

    soup = BeautifulSoup(response.text, 'html.parser')
    verses_dict = {}
    
    # The Church website wraps verses in <p> tags with the class "verse"
    verse_paragraphs = soup.find_all('p', class_='verse')
    
    for p in verse_paragraphs:
        # Extract the verse number
        verse_num_tag = p.find('span', class_='verse-number')
        if not verse_num_tag:
            continue
            
        verse_num = int(verse_num_tag.text.strip())
        
        # Remove the verse number span from the paragraph so we only get the text
        verse_num_tag.decompose()
        
        # Also remove inline footnote letters (like <a> tags)
        for sup in p.find_all('sup'):
            sup.decompose()
        for marker in p.find_all('span', class_='marker'):
            marker.decompose()
            
        # Get the clean text
        clean_text = p.get_text(separator=' ', strip=True)
        verses_dict[verse_num] = clean_text

    return verses_dict

def build_cebuano_csv(english_csv_path, output_csv_path):
    print("PHASE 1: Loading English Schema...")
    df = pd.read_csv(english_csv_path)
    triple_df = df[df['volume_id'].isin([3, 4, 5])].copy()
    
    # --- PANDAS CATEGORICAL FIX ---
    # Convert all text columns to strings so we can freely overwrite them
    text_cols = [
        'volume_title', 'volume_long_title', 'volume_subtitle', 'volume_short_title', 
        'book_title', 'book_long_title', 'book_subtitle', 'book_short_title', 
        'verse_title', 'verse_short_title', 'scripture_text'
    ]
    for col in text_cols:
        if col in triple_df.columns:
            triple_df[col] = triple_df[col].astype(str)
    
    # Empty column to hold our scraped text
    triple_df['scripture_text'] = ""

    print("PHASE 2: Translating Metadata & Scraping Cebuano Text...")
    
    # Get unique chapters to scrape (Group by Volume URL, Book URL, and Chapter Number)
    # This prevents us from downloading the same webpage multiple times
    unique_chapters = triple_df[['volume_lds_url', 'book_lds_url', 'chapter_number']].drop_duplicates()
    
    total_chapters = len(unique_chapters)
    print(f"Found {total_chapters} chapters to scrape. Starting network requests...")

    for i, (_, chap_row) in enumerate(unique_chapters.iterrows(), 1):
        vol_url = chap_row['volume_lds_url']
        book_url = chap_row['book_lds_url']
        chap_num = chap_row['chapter_number']
        
        print(f"  Scraping {book_url} Chapter {chap_num} ({i}/{total_chapters})...")
        
        # Scrape the chapter
        scraped_verses = fetch_chapter_verses(vol_url, book_url, chap_num)
        
        # Map the scraped verses back to the dataframe
        # Find all rows in our dataframe that belong to this specific chapter
        mask = (triple_df['volume_lds_url'] == vol_url) & \
               (triple_df['book_lds_url'] == book_url) & \
               (triple_df['chapter_number'] == chap_num)
               
        for index, row in triple_df[mask].iterrows():
            verse_num = int(row['verse_number'])
            eng_book = row['book_title']
            eng_vol = row['volume_title']
            
            # Translate Volume Metadata (only to long/short title columns)
            if eng_vol in CEBUANO_VOLUMES:
                triple_df.at[index, 'volume_long_title'] = CEBUANO_VOLUMES[eng_vol]['long']
                triple_df.at[index, 'volume_short_title'] = CEBUANO_VOLUMES[eng_vol]['short']
                triple_df.at[index, 'volume_subtitle'] = CEBUANO_VOLUMES[eng_vol]['subtitle']
                
            # Translate Book Metadata (only to long/short title columns)
            if eng_book in CEBUANO_BOOKS:
                ceb_book = CEBUANO_BOOKS[eng_book]
                triple_df.at[index, 'book_long_title'] = ceb_book['long']
                triple_df.at[index, 'book_short_title'] = ceb_book['short']
                triple_df.at[index, 'verse_title'] = f"{ceb_book['title']} {chap_num}:{verse_num}"
                triple_df.at[index, 'verse_short_title'] = f"{ceb_book['short']} {chap_num}:{verse_num}"

            # Insert Scraped Text
            if verse_num in scraped_verses:
                triple_df.at[index, 'scripture_text'] = scraped_verses[verse_num]
            else:
                triple_df.at[index, 'scripture_text'] = f"[NOT FOUND ON WEB: Verse {verse_num}]"

        # Rate limiting: Pause for half a second to avoid overloading the server
        # time.sleep(0.5)

    triple_df.to_csv(output_csv_path, index=False, encoding='utf-8')
    print(f"\n✅ Success! Scraped and exported clean CSV to {output_csv_path}")

if __name__ == "__main__":
    ENG_CSV = "lds-scriptures.csv"
    OUT_CSV = "cebuano_triple_combination_mapped.csv"
    build_cebuano_csv(ENG_CSV, OUT_CSV)