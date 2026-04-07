#!/usr/bin/env python3
"""
embed-concepts.py — Step 2 of build-concept-index pipeline.

Reads concept-phrases.json written by build-concept-index.js,
encodes all phrases using the fine-tuned scripture-bge model,
and writes the results into concept-embeddings.db.

Called automatically by build-concept-index.js — do not run directly
unless you want to re-encode without re-collecting phrases.

Usage (manual):
  python3 scripts/embed-concepts.py
  python3 scripts/embed-concepts.py --model-dir resources/models/scripture-bge-vNext
"""

import os, sqlite3, json, pathlib, sys, time
import numpy as np
from sentence_transformers import SentenceTransformer

ROOT        = pathlib.Path(__file__).parent.parent
DB_DIR      = ROOT / 'resources' / 'db'
DEFAULT_MODEL_DIR = ROOT / 'resources' / 'models' / 'scripture-bge'
PHRASES_TMP = ROOT / 'resources' / 'concept-phrases.json'
OUT_DB      = DB_DIR / 'concept-embeddings.db'
BATCH_SIZE  = 256

def resolve_model_dir(argv):
    model_dir = os.environ.get('SCRIPTURE_MODEL_DIR')
    for idx, arg in enumerate(argv):
        if arg == '--model-dir' and idx + 1 < len(argv):
            model_dir = argv[idx + 1]
        elif arg in ('-h', '--help'):
            print('Usage: python3 scripts/embed-concepts.py [--model-dir PATH]')
            raise SystemExit(0)

    if model_dir:
        candidate = pathlib.Path(model_dir)
        return candidate if candidate.is_absolute() else ROOT / candidate
    return DEFAULT_MODEL_DIR

def main():
    model_dir = resolve_model_dir(sys.argv[1:])

    # ── Load model ──────────────────────────────────────────────────────────
    if not model_dir.exists():
        raise SystemExit(f'[embed-concepts] Fine-tuned model not found at {model_dir}\n'
                         f'Run post-train-rebuild.sh first to install the model.')

    print(f'[embed-concepts] Loading model from {model_dir}')
    model = SentenceTransformer(str(model_dir))
    dim   = model.get_sentence_embedding_dimension()
    print(f'[embed-concepts] Model ready  dim={dim}')

    # ── Load phrases ─────────────────────────────────────────────────────────
    if not PHRASES_TMP.exists():
        raise SystemExit(f'[embed-concepts] Phrases file not found: {PHRASES_TMP}\n'
                         f'Run build-concept-index.js first.')

    with open(PHRASES_TMP) as f:
        entries = json.load(f)
    print(f'[embed-concepts] {len(entries):,} phrases to encode')

    texts   = [e['phrase'] for e in entries]
    sources = [e['source'] for e in entries]

    # ── Encode ───────────────────────────────────────────────────────────────
    print(f'[embed-concepts] Encoding in batches of {BATCH_SIZE}...')
    t0 = time.time()
    embeddings = model.encode(
        texts,
        batch_size=BATCH_SIZE,
        normalize_embeddings=True,
        show_progress_bar=True,
        convert_to_numpy=True,
    )
    print(f'[embed-concepts] Done in {time.time() - t0:.1f}s  shape={embeddings.shape}')

    # ── Write to SQLite ───────────────────────────────────────────────────────
    conn = sqlite3.connect(OUT_DB)
    conn.execute('''
        CREATE TABLE IF NOT EXISTS concepts (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            phrase    TEXT NOT NULL,
            source    TEXT NOT NULL,
            embedding BLOB NOT NULL,
            UNIQUE(phrase, source)
        )
    ''')
    conn.execute('DELETE FROM concepts')

    print(f'[embed-concepts] Writing {len(entries):,} concept embeddings to {OUT_DB}...')
    t1 = time.time()
    data = [
        (texts[i], sources[i], embeddings[i].astype(np.float32).tobytes())
        for i in range(len(entries))
    ]
    conn.executemany(
        'INSERT OR IGNORE INTO concepts (phrase, source, embedding) VALUES (?, ?, ?)',
        data
    )
    conn.commit()
    conn.close()
    print(f'[embed-concepts] Written in {time.time() - t1:.1f}s')
    print(f'[embed-concepts] ✅ concept-embeddings.db ready  dim={dim}')

if __name__ == '__main__':
    main()
