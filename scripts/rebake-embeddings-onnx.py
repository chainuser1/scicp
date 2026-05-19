#!/usr/bin/env python3
"""
Re-bake all verse embeddings using the ONNX-exported scripture model.

Reads all 41,995 verses from lds-scriptures-sqlite.db, encodes them with
the ONNX runtime, and writes Float32Array BLOBs back to verse-embeddings.db.

NOTE: Nomic BERT ONNX model only supports batch_size=1 due to custom attention.
"""

import os
import sqlite3
import pathlib
import sys
import time
import numpy as np

ROOT = pathlib.Path(__file__).parent.parent
DB_MAIN = ROOT / 'resources/db/lds-scriptures-sqlite.db'
DB_EMBED = ROOT / 'resources/db/verse-embeddings.db'
DEFAULT_MODEL_DIR = ROOT / 'resources/onnx/scripture-bge/onnx'
ORIGINAL_MODEL_DIR = ROOT / 'resources/models/scripture-bge'
BATCH_SIZE = 1  # Force batch size 1 for Nomic BERT ONNX

def resolve_model_dir(argv):
    model_dir = os.environ.get('SCRIPTURE_ONNX_DIR')
    for idx, arg in enumerate(argv):
        if arg == '--model-dir' and idx + 1 < len(argv):
            model_dir = argv[idx + 1]
        elif arg in ('-h', '--help'):
            print('Usage: python3 scripts/rebake-embeddings-onnx.py [--model-dir PATH]')
            raise SystemExit(0)

    if model_dir:
        candidate = pathlib.Path(model_dir)
        return candidate if candidate.is_absolute() else ROOT / candidate
    return DEFAULT_MODEL_DIR

def load_model(model_dir):
    import onnxruntime as ort
    from transformers import AutoTokenizer

    # Find the ONNX model file (prefer quantized if exists)
    quantized = model_dir / 'model_quantized.onnx'
    standard = model_dir / 'model.onnx'
    
    if quantized.exists():
        onnx_path = quantized
        print(f'[model] Using quantized ONNX model: {onnx_path}')
    elif standard.exists():
        onnx_path = standard
        print(f'[model] Using standard ONNX model: {onnx_path}')
    else:
        raise FileNotFoundError(f'No ONNX model found in {model_dir}')

    # Load tokenizer from ORIGINAL model dir
    print(f'[model] Loading tokenizer from original model: {ORIGINAL_MODEL_DIR}')
    tokenizer = AutoTokenizer.from_pretrained(
        str(ORIGINAL_MODEL_DIR),
        trust_remote_code=True
    )

    # Create ONNX runtime session
    sess_options = ort.SessionOptions()
    sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    sess_options.intra_op_num_threads = min(os.cpu_count() or 4, 2)  # Limit threads
    
    session = ort.InferenceSession(str(onnx_path), sess_options)
    
    # Get model dimension
    output_meta = session.get_outputs()[0]
    dim = 768  # Nomic BERT is 768-dim
    print(f'[model] dim={dim}, inputs={[i.name for i in session.get_inputs()]}')
    print(f'[model] NOTE: Running with batch_size={BATCH_SIZE} due to model constraints')
    
    return tokenizer, session

def load_verses():
    conn = sqlite3.connect(DB_MAIN)
    rows = conn.execute('SELECT id, scripture_text FROM verses ORDER BY id').fetchall()
    conn.close()
    print(f'[data] {len(rows):,} verses loaded')
    return rows

def encode_and_write(tokenizer, session, verses):
    """Encode verses one by one (batch_size=1) and write to database."""
    ids = [r[0] for r in verses]
    texts = [r[1] for r in verses]
    
    # Connect to database for writing
    conn = sqlite3.connect(DB_EMBED)
    
    # Ensure table exists
    conn.execute('''
        CREATE TABLE IF NOT EXISTS verse_embeddings (
            verse_id INTEGER PRIMARY KEY,
            embedding BLOB NOT NULL
        )
    ''')
    
    # Clear existing data
    conn.execute('DELETE FROM verse_embeddings')
    
    insert_stmt = 'INSERT INTO verse_embeddings (verse_id, embedding) VALUES (?, ?)'
    
    total_encoded = 0
    t0 = time.time()
    
    print(f'[encode] Encoding {len(texts):,} verses one by one (batch_size=1)…')
    print(f'[encode] This will take a while. Estimated time: ~{(len(texts) * 0.5)/60:.1f} minutes')
    
    for i, (verse_id, verse_text) in enumerate(zip(ids, texts)):
        try:
            # Tokenize single verse
            encoded = tokenizer(
                verse_text,
                padding=True,
                truncation=True,
                max_length=512,
                return_tensors='np',
            )
            
            # Prepare ONNX inputs
            ort_inputs = {
                'input_ids': encoded['input_ids'].astype(np.int64),
                'attention_mask': encoded['attention_mask'].astype(np.int64),
            }
            
            # Run ONNX inference
            outputs = session.run(None, ort_inputs)
            token_embeddings = outputs[0]  # shape: (1, seq_len, dim)
            
            # Mean pooling with attention mask
            attention_mask = encoded['attention_mask']
            mask_expanded = np.expand_dims(attention_mask, -1).astype(np.float32)
            summed = np.sum(token_embeddings * mask_expanded, axis=1)
            counts = np.clip(np.sum(mask_expanded, axis=1), a_min=1e-9, a_max=None)
            pooled = summed / counts
            
            # L2 normalize
            norms = np.linalg.norm(pooled, axis=1, keepdims=True)
            pooled = pooled / np.clip(norms, a_min=1e-9, a_max=None)
            
            # Write to database
            conn.execute(insert_stmt, (int(verse_id), pooled[0].astype(np.float32).tobytes()))
            conn.commit()
            
            total_encoded += 1
            
            # Progress report every 1000 verses
            if (i + 1) % 1000 == 0 or i + 1 == len(texts):
                elapsed = time.time() - t0
                rate = total_encoded / elapsed if elapsed > 0 else 0
                eta = (len(texts) - total_encoded) / rate if rate > 0 else 0
                print(f'[encode] {total_encoded:,} / {len(texts):,}  '
                      f'({100*total_encoded/len(texts):.1f}%)  '
                      f'{rate:.1f} verses/sec  ETA: {eta/60:.1f} min')
                
        except Exception as e:
            print(f'[error] Verse {verse_id} failed: {e}')
            # Continue with next verse
            continue
    
    conn.close()
    elapsed = time.time() - t0
    print(f'[encode] Done in {elapsed:.1f}s ({elapsed/60:.1f} minutes)')
    return total_encoded

def main():
    model_dir = resolve_model_dir(sys.argv[1:])

    if not model_dir.exists():
        print(f'[error] ONNX model directory not found: {model_dir}')
        print('[error] Run: python3 scripts/export-onnx.py first')
        raise SystemExit(1)

    # Verify original model directory exists for tokenizer
    if not ORIGINAL_MODEL_DIR.exists():
        print(f'[error] Original model directory not found: {ORIGINAL_MODEL_DIR}')
        raise SystemExit(1)

    # Setup database
    print('[setup] Preparing verse_embeddings table...')
    conn = sqlite3.connect(DB_EMBED)
    conn.execute('''
        CREATE TABLE IF NOT EXISTS verse_embeddings (
            verse_id INTEGER PRIMARY KEY,
            embedding BLOB NOT NULL
        )
    ''')
    conn.close()
    print('[setup] Table ready')

    # Load model and tokenizer
    tokenizer, session = load_model(model_dir)
    
    # Load verses
    verses = load_verses()
    
    # Encode and write one by one
    encoded_count = encode_and_write(tokenizer, session, verses)
    
    print(f'\n[done] Successfully rebaked {encoded_count:,} verse embeddings using ONNX.')
    print('[done] Restart the server to load the new embeddings.')

if __name__ == '__main__':
    main()