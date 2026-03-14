#!/usr/bin/env python3
"""
scrape-chapter-summaries.py
Fetches LDS chapter summaries using DuckDuckGo search (free, unlimited).
Produces clean 2-3 paragraph summaries from top LDS/scholarly snippets.
Replaces summary_text in chapter_summaries table.

Usage:
  python3 scripts/scrape-chapter-summaries.py [--limit N] [--start-id N] [--dry-run] [--reset]
"""

import sys, time, argparse, sqlite3, re, textwrap
from pathlib import Path

try:
    from ddgs import DDGS
except ImportError:
    from duckduckgo_search import DDGS

TAGS_DB  = Path(__file__).parent.parent / 'resources/db/verse-tags.db'
SCRIP_DB = Path(__file__).parent.parent / 'resources/db/lds-scriptures-sqlite.db'
DELAY    = 2.0   # seconds between requests — polite rate

LDS_DOMAINS = [
    'churchofjesuschrist.org', 'lds.org', 'byustudies.byu.edu',
    'gospeldoctrine.com', 'fairlatterdaysaints.org', 'mi.byu.edu',
    'thechurchnews.com', 'ldsliving.com', 'byu.edu',
    'scriptures.byu.edu', 'rsc.byu.edu', 'knowhy.bookofmormoncentral.org',
]

def is_lds(url: str) -> bool:
    return any(d in url for d in LDS_DOMAINS)

def clean_snippet(text: str) -> str:
    """Remove excessive whitespace and truncation markers."""
    text = re.sub(r'\s+', ' ', text).strip()
    text = re.sub(r'\s*…$', '…', text)
    return text

def build_summary(results: list) -> str | None:
    """
    Combine top LDS snippets into 2-3 clean paragraphs.
    Prioritise LDS sources, deduplicate by first 50 chars.
    """
    lds_hits  = [r for r in results if is_lds(r.get('href', '')) and len(r.get('body', '')) > 60]
    other_hits = [r for r in results if not is_lds(r.get('href', '')) and len(r.get('body', '')) > 80]

    seen, paragraphs = set(), []
    for r in [*lds_hits[:4], *other_hits[:2]]:
        snippet = clean_snippet(r.get('body', ''))
        key = snippet[:50].lower()
        if key in seen:
            continue
        seen.add(key)
        paragraphs.append(snippet)
        if len(paragraphs) >= 3:
            break

    return '\n\n'.join(paragraphs) if paragraphs else None

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--limit',    type=int, default=None)
    parser.add_argument('--start-id', type=int, default=0)
    parser.add_argument('--dry-run',  action='store_true')
    parser.add_argument('--reset',    action='store_true', help='Re-scrape serper-ok rows too')
    args = parser.parse_args()

    src  = sqlite3.connect(SCRIP_DB)
    tags = sqlite3.connect(TAGS_DB)

    # Load all chapters with book title
    query = """
        SELECT c.id, c.chapter_number, b.book_title
        FROM chapters c JOIN books b ON c.book_id = b.id
    """
    if args.start_id > 0:
        query += f' WHERE c.id >= {args.start_id}'
    query += ' ORDER BY c.id'
    if args.limit:
        query += f' LIMIT {args.limit}'

    chapters = src.execute(query).fetchall()
    src.close()

    # Skip already-done unless --reset
    if not args.reset:
        done_ids = {
            row[0] for row in tags.execute(
                "SELECT chapter_id FROM chapter_summaries WHERE summary_method = 'ddgs-ok'"
            )
        }
        chapters = [c for c in chapters if c[0] not in done_ids]

    total = len(chapters)
    print(f'Chapters to process: {total}')
    if args.dry_run:
        print('DRY RUN — no DB writes.\n')
    if total == 0:
        tags.close()
        return

    done = failed = 0

    with DDGS() as ddgs:
        for i, (chapter_id, chapter_num, book_title) in enumerate(chapters):
            label = f'{book_title} {chapter_num}'
            query = f'what does {book_title} {chapter_num} teach LDS meaning church leaders'

            try:
                results = list(ddgs.text(query, region='us-en', max_results=8))
                summary = build_summary(results)

                if summary and len(summary) > 80:
                    if not args.dry_run:
                        tags.execute(
                            "UPDATE chapter_summaries SET summary_text=?, summary_method='ddgs-ok' WHERE chapter_id=?",
                            (summary, chapter_id)
                        )
                        tags.commit()
                    done += 1
                    if args.dry_run and done <= 3:
                        print(f'--- {label} ---')
                        print(summary)
                        print()
                    elif done % 25 == 0:
                        print(f'\n[{done}/{total}] {label} ✓', flush=True)
                    else:
                        print('.', end='', flush=True)
                else:
                    if not args.dry_run:
                        tags.execute(
                            "UPDATE chapter_summaries SET summary_method='ddgs-error' WHERE chapter_id=?",
                            (chapter_id,)
                        )
                        tags.commit()
                    failed += 1
                    print(f'\n  NO CONTENT: {label}', flush=True)

            except Exception as e:
                if not args.dry_run:
                    tags.execute(
                        "UPDATE chapter_summaries SET summary_method='ddgs-error' WHERE chapter_id=?",
                        (chapter_id,)
                    )
                    tags.commit()
                failed += 1
                print(f'\n  ERROR: {label}: {e}', flush=True)
                time.sleep(5)  # back off on error

            time.sleep(DELAY)

    tags.close()
    print(f'\n\nDone. Written: {done}, Failed/empty: {failed}')

if __name__ == '__main__':
    main()
