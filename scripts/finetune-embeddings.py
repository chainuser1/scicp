#!/usr/bin/env python3
"""
Legacy training script for all-MiniLM-L6-v2 using topical guide pairs.

This file is retained for historical/reference use. The current recommended
training flow for production search models is the configurable Kaggle notebook
in scripts/finetune-kaggle.ipynb.

Training signal:
  Each row in topical_guide (topic_name, verse_text) is a positive pair.
  MultipleNegativesRankingLoss treats every other pair in the same batch
  as a negative — no manual negative mining required.

Output:
  resources/models/scripture-minilm/   ← fine-tuned sentence-transformers model

After running this, run rebake-embeddings.py to re-encode all 41k verses
and write them back to verse-embeddings.db.
"""

import os, sys, sqlite3, random, time, pathlib

ROOT = pathlib.Path(__file__).parent.parent
DB_MAIN  = ROOT / 'resources/db/lds-scriptures-sqlite.db'
DB_TG    = ROOT / 'resources/db/topical-guide.db'
OUT_DIR  = ROOT / 'resources/models/scripture-minilm'

BASE_MODEL = 'sentence-transformers/all-MiniLM-L6-v2'
BATCH_SIZE  = 64
EPOCHS      = 4
WARMUP_FRAC = 0.1   # 10% of steps for warmup
MAX_PAIRS   = 80_000  # cap to keep training time manageable on CPU

def load_pairs():
    print('[data] Loading training pairs from topical guide…')
    conn_main = sqlite3.connect(DB_MAIN)
    conn_tg   = sqlite3.connect(DB_TG)

    # verse_id → scripture_text
    verses = {}
    for row in conn_main.execute('SELECT id, scripture_text FROM verses'):
        verses[row[0]] = row[1]

    # topic_id → topic name
    topics = {}
    for row in conn_tg.execute('SELECT id, name FROM topics'):
        topics[row[0]] = row[1]

    # (topic_name, verse_text) pairs
    pairs = []
    for row in conn_tg.execute('SELECT topic_id, verse_id FROM topical_guide'):
        topic_name = topics.get(row[0])
        verse_text = verses.get(row[1])
        if topic_name and verse_text and len(verse_text) > 20:
            pairs.append((topic_name, verse_text))

    conn_main.close()
    conn_tg.close()

    random.shuffle(pairs)
    if len(pairs) > MAX_PAIRS:
        pairs = pairs[:MAX_PAIRS]

    print(f'[data] {len(pairs):,} training pairs loaded')
    return pairs


def main():
    from sentence_transformers import SentenceTransformer, losses
    from sentence_transformers.training_args import SentenceTransformerTrainingArguments
    from sentence_transformers.trainer import SentenceTransformerTrainer
    from datasets import Dataset
    import torch

    print(f'[model] Loading base model: {BASE_MODEL}')
    model = SentenceTransformer(BASE_MODEL)
    print(f'[model] Embedding dim: {model.get_sentence_embedding_dimension()}')

    pairs = load_pairs()

    # 90/10 split
    split = int(len(pairs) * 0.9)
    train_pairs = pairs[:split]
    val_pairs   = pairs[split:]

    train_ds = Dataset.from_dict({'anchor': [p[0] for p in train_pairs], 'positive': [p[1] for p in train_pairs]})
    val_ds   = Dataset.from_dict({'anchor': [p[0] for p in val_pairs],   'positive': [p[1] for p in val_pairs]})

    print(f'[data] train={len(train_ds):,}  val={len(val_ds):,}')

    loss = losses.MultipleNegativesRankingLoss(model)

    steps_per_epoch = len(train_ds) // BATCH_SIZE
    warmup_steps    = int(steps_per_epoch * EPOCHS * WARMUP_FRAC)

    args = SentenceTransformerTrainingArguments(
        output_dir=str(OUT_DIR),
        num_train_epochs=EPOCHS,
        per_device_train_batch_size=BATCH_SIZE,
        per_device_eval_batch_size=BATCH_SIZE,
        warmup_steps=warmup_steps,
        eval_strategy='epoch',
        save_strategy='best',
        load_best_model_at_end=True,
        logging_steps=100,
        fp16=False,
        bf16=False,
    )

    trainer = SentenceTransformerTrainer(
        model=model,
        args=args,
        train_dataset=train_ds,
        eval_dataset=val_ds,
        loss=loss,
    )

    print(f'[train] epochs={EPOCHS}  warmup_steps={warmup_steps}')
    print(f'[train] output → {OUT_DIR}')

    t0 = time.time()
    trainer.train()
    elapsed = time.time() - t0

    model.save(str(OUT_DIR))
    print(f'\n[done] Fine-tuning complete in {elapsed/60:.1f} min')
    print(f'[done] Model saved to: {OUT_DIR}')
    print('[next] Run: python3 scripts/rebake-embeddings.py')


if __name__ == '__main__':
    main()
