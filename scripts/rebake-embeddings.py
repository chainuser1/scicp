#!/usr/bin/env python3
"""
Re-bake all verse embeddings using the fine-tuned scripture-bge model.

Reads all 41,995 verses from lds-scriptures-sqlite.db, encodes them with
the fine-tuned model, and writes Float32Array BLOBs back to verse-embeddings.db.

Optimized version with:
- Incremental database writes (no memory accumulation)
- GPU support if available
- Progress tracking with rate
- Preserves table structure (only replaces data)
"""

import os, sqlite3, pathlib, sys, time
import numpy as np
import torch

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
    from transformers import AutoTokenizer, AutoModel
    print(f'[model] Loading fine-tuned Nomic BERT from {model_dir}')
    
    # Use GPU if available
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    print(f'[model] Using device: {device}')
    
    tokenizer = AutoTokenizer.from_pretrained(
        str(model_dir), 
        trust_remote_code=True  # Required for Nomic BERT
    )
    model = AutoModel.from_pretrained(
        str(model_dir), 
        trust_remote_code=True
    )
    model.to(device)
    model.eval()
    
    dim = model.config.hidden_size
    print(f'[model] dim={dim}')
    return tokenizer, model, device

def load_verses():
    conn = sqlite3.connect(DB_MAIN)
    rows = conn.execute('SELECT id, scripture_text FROM verses ORDER BY id').fetchall()
    conn.close()
    print(f'[data] {len(rows):,} verses loaded')
    return rows

def encode_and_write(tokenizer, model, device, verses):
    """Encode verses in batches and write directly to database."""
    ids = [r[0] for r in verses]
    texts = [r[1] for r in verses]
    
    # Connect to database for writing
    conn = sqlite3.connect(DB_EMBED)
    
    # Ensure table exists but don't drop it
    conn.execute('''
        CREATE TABLE IF NOT EXISTS verse_embeddings (
            verse_id INTEGER PRIMARY KEY,
            embedding BLOB NOT NULL
        )
    ''')
    
    # Clear existing data (much safer than DROP TABLE)
    conn.execute('DELETE FROM verse_embeddings')
    
    insert_stmt = 'INSERT INTO verse_embeddings (verse_id, embedding) VALUES (?, ?)'
    
    total_encoded = 0
    batch_count = 0
    t0 = time.time()
    
    print(f'[encode] Encoding {len(texts):,} verses in batches of {BATCH_SIZE}…')
    
    for i in range(0, len(texts), BATCH_SIZE):
        batch_texts = texts[i:i + BATCH_SIZE]
        batch_ids = ids[i:i + BATCH_SIZE]
        
        # Tokenize batch
        encoded = tokenizer(
            batch_texts,
            padding=True,
            truncation=True,
            max_length=512,
            return_tensors='pt',
        )
        
        # Move to GPU if available
        encoded = {k: v.to(device) for k, v in encoded.items()}
        
        # Run inference
        with torch.no_grad():
            output = model(**encoded)
        
        # Mean pooling with attention mask
        attention_mask = encoded['attention_mask']
        token_embeddings = output.last_hidden_state
        mask_expanded = attention_mask.unsqueeze(-1).expand(token_embeddings.size()).float()
        summed = torch.sum(token_embeddings * mask_expanded, dim=1)
        counts = torch.clamp(mask_expanded.sum(dim=1), min=1e-9)
        pooled = summed / counts
        
        # L2 normalize
        pooled = torch.nn.functional.normalize(pooled, p=2, dim=1)
        
        # Move to CPU and convert to numpy
        pooled_np = pooled.cpu().numpy().astype(np.float32)
        
        # Write batch to database immediately
        data = [
            (int(batch_ids[j]), pooled_np[j].tobytes())
            for j in range(len(batch_ids))
        ]
        conn.executemany(insert_stmt, data)
        conn.commit()
        
        total_encoded += len(batch_ids)
        batch_count += 1
        
        # Progress report every 10 batches or at the end
        if batch_count % 10 == 0 or i + BATCH_SIZE >= len(texts):
            elapsed = time.time() - t0
            rate = total_encoded / elapsed
            print(f'[encode] {total_encoded:,} / {len(texts):,}  '
                  f'({100*total_encoded/len(texts):.1f}%)  {rate:.0f} verses/sec')
    
    conn.close()
    elapsed = time.time() - t0
    print(f'[encode] Done in {elapsed:.1f}s')
    return total_encoded

def main():
    model_dir = resolve_model_dir(sys.argv[1:])

    if not model_dir.exists():
        print(f'[error] Fine-tuned model not found at {model_dir}')
        print('[error] Run: python3 scripts/finetune-embeddings.py first')
        raise SystemExit(1)

    # Load model and tokenizer
    tokenizer, model, device = load_model(model_dir)
    
    # Load verses
    verses = load_verses()
    
    # Encode and write incrementally (preserves table structure)
    encoded_count = encode_and_write(tokenizer, model, device, verses)
    
    print(f'\n[done] Successfully rebaked {encoded_count:,} verse embeddings.')
    print('[done] Restart the server to load the new embeddings (buildEmbeddingCache).')

if __name__ == '__main__':
    main()