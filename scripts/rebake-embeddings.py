#!/usr/bin/env python3
"""
Re-bake all verse embeddings using the fine-tuned scripture-bge model.

Reads all 41,995 verses from lds-scriptures-sqlite.db, encodes them with
the fine-tuned model, and writes Float32Array BLOBs back to verse-embeddings.db.

Run this after finetune-embeddings.py has completed successfully.

Usage:
    python3 scripts/rebake-embeddings.py
    python3 scripts/rebake-embeddings.py --model-dir resources/models/scripture-bge-vNext

The server will pick up the new embeddings on next restart (buildEmbeddingCache
reads all rows from verse-embeddings.db at startup).
"""

import os, sqlite3, pathlib, sys, time
import numpy as np

ROOT      = pathlib.Path(__file__).parent.parent
DB_MAIN   = ROOT / 'resources/db/lds-scriptures-sqlite.db'
DB_EMBED  = ROOT / 'resources/db/verse-embeddings.db'
DEFAULT_MODEL_DIR = ROOT / 'resources/models/scripture-bge'
BATCH_SIZE = 256

def resolve_model_dir(argv):
    model_dir = os.environ.get('SCRIPTURE_MODEL_DIR')
    for idx, arg in enumerate(argv):
        if arg == '--model-dir' and idx + 1 < len(argv):
            model_dir = argv[idx + 1]
        elif arg in ('-h', '--help'):
            print('Usage: python3 scripts/rebake-embeddings.py [--model-dir PATH]')
            raise SystemExit(0)

    if model_dir:
        candidate = pathlib.Path(model_dir)
        return candidate if candidate.is_absolute() else ROOT / candidate
    return DEFAULT_MODEL_DIR

def load_model(model_dir):
    from sentence_transformers import SentenceTransformer
    print(f'[model] Loading fine-tuned model from {model_dir}')
    model = SentenceTransformer(str(model_dir))
    print(f'[model] dim={model.get_sentence_embedding_dimension()}')
    return model

def load_verses():
    conn = sqlite3.connect(DB_MAIN)
    rows = conn.execute('SELECT id, scripture_text FROM verses ORDER BY id').fetchall()
    conn.close()
    print(f'[data] {len(rows):,} verses loaded')
    return rows

def encode_all(model, verses):
    ids   = [r[0] for r in verses]
    texts = [r[1] for r in verses]

    print(f'[encode] Encoding {len(texts):,} verses in batches of {BATCH_SIZE}…')
    t0 = time.time()
    embeddings = model.encode(
        texts,
        batch_size=BATCH_SIZE,
        normalize_embeddings=True,
        show_progress_bar=True,
        convert_to_numpy=True,
    )
    elapsed = time.time() - t0
    print(f'[encode] Done in {elapsed:.1f}s  shape={embeddings.shape}')
    return ids, embeddings

def write_embeddings(ids, embeddings):
    conn = sqlite3.connect(DB_EMBED)
    conn.execute('''
        CREATE TABLE IF NOT EXISTS verse_embeddings (
            verse_id INTEGER PRIMARY KEY,
            embedding BLOB NOT NULL
        )
    ''')
    conn.execute('DELETE FROM verse_embeddings')   # full replace

    print(f'[write] Writing {len(ids):,} embeddings to {DB_EMBED}…')
    t0 = time.time()
    data = [
        (int(vid), embeddings[i].astype(np.float32).tobytes())
        for i, vid in enumerate(ids)
    ]
    conn.executemany('INSERT INTO verse_embeddings (verse_id, embedding) VALUES (?,?)', data)
    conn.commit()
    conn.close()
    elapsed = time.time() - t0
    print(f'[write] Done in {elapsed:.1f}s')

def main():
    model_dir = resolve_model_dir(sys.argv[1:])

    if not model_dir.exists():
        print(f'[error] Fine-tuned model not found at {model_dir}')
        print('[error] Run: python3 scripts/finetune-embeddings.py first')
        raise SystemExit(1)

    model = load_model(model_dir)
    verses = load_verses()
    ids, embeddings = encode_all(model, verses)
    write_embeddings(ids, embeddings)

    print('\n[done] Embeddings rebaked.')
    print('[done] Restart the server to load the new embeddings (buildEmbeddingCache).')

if __name__ == '__main__':
    main()
