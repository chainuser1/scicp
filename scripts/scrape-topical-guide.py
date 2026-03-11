#!/usr/bin/env python3
"""
scrape-topical-guide.py  (async edition)

Scrapes the LDS Topical Guide using aiohttp with 10 concurrent workers.
~10x faster than the sequential version.

Usage:
  python3 scripts/scrape-topical-guide.py [--force] [--workers N]
"""

import sys, re, json, base64, time, sqlite3, argparse, asyncio
from pathlib import Path
import aiohttp

ROOT    = Path(__file__).resolve().parent.parent
TG_DB   = ROOT / "resources" / "db" / "topical-guide.db"
SCPT_DB = ROOT / "resources" / "db" / "lds-scriptures-sqlite.db"
BASE    = "https://www.churchofjesuschrist.org"
UA      = "Mozilla/5.0 (compatible; scicp-tg-scraper/3.0)"

BOOK_SLUG_MAP = {
    "gen":"Genesis","exod":"Exodus","lev":"Leviticus","num":"Numbers",
    "deut":"Deuteronomy","josh":"Joshua","judg":"Judges","ruth":"Ruth",
    "1-sam":"1 Samuel","2-sam":"2 Samuel","1-kgs":"1 Kings","2-kgs":"2 Kings",
    "1-chr":"1 Chronicles","2-chr":"2 Chronicles","ezra":"Ezra","neh":"Nehemiah",
    "esth":"Esther","job":"Job","ps":"Psalms","prov":"Proverbs",
    "eccl":"Ecclesiastes","song":"Song of Solomon","isa":"Isaiah",
    "jer":"Jeremiah","lam":"Lamentations","ezek":"Ezekiel","dan":"Daniel",
    "hosea":"Hosea","joel":"Joel","amos":"Amos","obad":"Obadiah",
    "jonah":"Jonah","micah":"Micah","nahum":"Nahum","hab":"Habakkuk",
    "zeph":"Zephaniah","hag":"Haggai","zech":"Zechariah","mal":"Malachi",
    "matt":"Matthew","mark":"Mark","luke":"Luke","john":"John","acts":"Acts",
    "rom":"Romans","1-cor":"1 Corinthians","2-cor":"2 Corinthians",
    "gal":"Galatians","eph":"Ephesians","philip":"Philippians",
    "col":"Colossians","1-thes":"1 Thessalonians","2-thes":"2 Thessalonians",
    "1-tim":"1 Timothy","2-tim":"2 Timothy","titus":"Titus",
    "philem":"Philemon","heb":"Hebrews","james":"James","1-pet":"1 Peter",
    "2-pet":"2 Peter","1-jn":"1 John","2-jn":"2 John","3-jn":"3 John",
    "jude":"Jude","rev":"Revelation",
    "1-ne":"1 Nephi","2-ne":"2 Nephi","jacob":"Jacob","enos":"Enos",
    "jarom":"Jarom","omni":"Omni","w-of-m":"Words of Mormon","mosiah":"Mosiah",
    "alma":"Alma","hel":"Helaman","3-ne":"3 Nephi","4-ne":"4 Nephi",
    "morm":"Mormon","ether":"Ether","moro":"Moroni",
    "dc":"Doctrine and Covenants","moses":"Moses","abr":"Abraham",
    "js-m":"Joseph Smith--Matthew","js-h":"Joseph Smith--History",
    "a-of-f":"Articles of Faith",
}

REF_RE = re.compile(
    r'/study/scriptures/(?!tg|bd|jst)[\w-]+/([\w-]+)/(\d+)[^"]*id=p(\d+)'
)

def parse_state(html: str) -> dict:
    m = re.search(r'window\.__INITIAL_STATE__="([^"]+)"', html)
    if not m:
        raise ValueError("No __INITIAL_STATE__")
    return json.loads(base64.b64decode(m.group(1)).decode())

def extract_refs(body: str):
    seen, out = set(), []
    for m in REF_RE.finditer(body):
        slug, ch, vs = m.group(1), int(m.group(2)), int(m.group(3))
        book = BOOK_SLUG_MAP.get(slug)
        if not book or (slug,ch,vs) in seen: continue
        seen.add((slug,ch,vs))
        out.append((f"{book} {ch}:{vs}", book, ch, vs))
    return out

# ── DB helpers (sync, called from main thread only) ───────────────────────────
def open_dbs():
    tg = sqlite3.connect(str(TG_DB))
    tg.execute("PRAGMA journal_mode=WAL")
    tg.executescript("""
        CREATE TABLE IF NOT EXISTS topics (
            id   INTEGER PRIMARY KEY AUTOINCREMENT,
            slug TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS topical_guide (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            topic_id    INTEGER NOT NULL REFERENCES topics(id),
            verse_title TEXT    NOT NULL,
            verse_id    INTEGER
        );
        CREATE INDEX IF NOT EXISTS tg_topic_id ON topical_guide(topic_id);
        CREATE INDEX IF NOT EXISTS tg_verse_id  ON topical_guide(verse_id);
    """)
    tg.commit()
    sc = sqlite3.connect(f"file:{SCPT_DB}?mode=ro", uri=True)
    sc.row_factory = sqlite3.Row
    return tg, sc

def find_verse_id(sc, book, ch, vs):
    r = sc.execute(
        "SELECT verse_id FROM scriptures WHERE book_title=? AND chapter_number=? AND verse_number=? LIMIT 1",
        (book, ch, vs)
    ).fetchone()
    return r["verse_id"] if r else None

# ── async worker ──────────────────────────────────────────────────────────────
async def scrape_topic(session, sem, slug, retries=4):
    url = f"{BASE}/study/scriptures/tg/{slug}?lang=eng"
    delay = 1.0
    async with sem:
        for attempt in range(retries):
            try:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=20)) as r:
                    r.raise_for_status()
                    html = await r.text()
                state = parse_state(html)
                key   = f"/eng/scriptures/tg/{slug}"
                body  = state.get("reader",{}).get("contentStore",{}).get(key,{}).get("content",{}).get("body","")
                return extract_refs(body)
            except Exception as e:
                if attempt == retries - 1:
                    raise
                await asyncio.sleep(delay)
                delay = min(delay * 2, 10)

# ── main ──────────────────────────────────────────────────────────────────────
async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--force",   action="store_true")
    parser.add_argument("--workers", type=int, default=10)
    args = parser.parse_args()

    tg_con, sc_con = open_dbs()

    if args.force:
        print("--force: wiping...", flush=True)
        tg_con.execute("DELETE FROM topical_guide")
        tg_con.execute("DELETE FROM topics")
        tg_con.commit()

    # Fetch topic list
    print("Fetching topic index...", flush=True)
    async with aiohttp.ClientSession(headers={"User-Agent": UA}) as http:
        async with http.get(f"{BASE}/study/scriptures/tg?lang=eng",
                            timeout=aiohttp.ClientTimeout(total=20)) as r:
            index_html = await r.text()
    state = parse_state(index_html)
    body  = state["reader"]["contentStore"]["/eng/scriptures/tg"]["content"]["body"]
    all_topics = re.findall(
        r'href="/study/scriptures/tg/([\w-]+)\?lang=eng"[^>]*>[^<]*<p class="title">([^<]+)</p>', body
    )
    all_topics = [(s, n) for s, n in all_topics if s != "introduction"]
    total = len(all_topics)
    print(f"Found {total} topics. Workers: {args.workers}\n", flush=True)

    # Upsert all topic rows upfront
    for slug, name in all_topics:
        tg_con.execute("INSERT OR IGNORE INTO topics (slug,name) VALUES (?,?)", (slug, name))
    tg_con.commit()

    # Build skip set (topics with any row already)
    done_ids = {row[0] for row in tg_con.execute(
        "SELECT topic_id FROM topical_guide GROUP BY topic_id"
    ).fetchall()}
    slug_to_id = {row[0]: row[1] for row in tg_con.execute("SELECT slug, id FROM topics").fetchall()}

    pending = [(slug, name) for slug, name in all_topics if slug_to_id.get(slug) not in done_ids]
    skipped = total - len(pending)
    print(f"Skipping {skipped} already done. Scraping {len(pending)} topics...\n", flush=True)

    sem = asyncio.Semaphore(args.workers)
    done_count = skipped
    failed = 0
    total_verses = 0
    lock = asyncio.Lock()

    connector = aiohttp.TCPConnector(limit=args.workers + 2)
    async with aiohttp.ClientSession(headers={"User-Agent": UA}, connector=connector) as http_session:

        async def process(slug, name):
            nonlocal done_count, failed, total_verses
            topic_id = slug_to_id[slug]
            try:
                refs = await scrape_topic(http_session, sem, slug)
                rows = [(topic_id, vt, find_verse_id(sc_con, bt, ch, vs)) for vt, bt, ch, vs in refs]
                async with lock:
                    tg_con.execute("DELETE FROM topical_guide WHERE topic_id=?", (topic_id,))
                    if rows:
                        tg_con.executemany(
                            "INSERT INTO topical_guide (topic_id,verse_title,verse_id) VALUES (?,?,?)", rows
                        )
                    else:
                        tg_con.execute(
                            "INSERT INTO topical_guide (topic_id,verse_title,verse_id) VALUES (?,?,?)",
                            (topic_id, "__no_verses__", -1)
                        )
                    tg_con.commit()
                    done_count  += 1
                    total_verses += len(rows)
                    if done_count % 50 == 0:
                        pct = done_count / total * 100
                        print(f"  {done_count}/{total} ({pct:.1f}%)  failed={failed}  verses={total_verses}", flush=True)
            except Exception as e:
                async with lock:
                    failed += 1
                    done_count += 1
                    print(f"\n  FAILED: {slug} — {e}", flush=True)

        await asyncio.gather(*[process(s, n) for s, n in pending])

    entry_count  = tg_con.execute("SELECT COUNT(*) FROM topical_guide WHERE verse_title!='__no_verses__'").fetchone()[0]
    mapped_count = tg_con.execute("SELECT COUNT(*) FROM topical_guide WHERE verse_id IS NOT NULL AND verse_id!=-1").fetchone()[0]
    print(f"\n✅ Done! Topics: {total}  Entries: {entry_count}  Mapped: {mapped_count} ({mapped_count/max(entry_count,1)*100:.1f}%)", flush=True)

    tg_con.close()
    sc_con.close()

if __name__ == "__main__":
    asyncio.run(main())
