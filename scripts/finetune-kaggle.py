#!/usr/bin/env python3
"""Fine-tune scripture embeddings on Kaggle using official BGE models.

This script is a pure-Python version of the existing Kaggle notebook flow,
with the same model registry, profile settings, and /kaggle/input dataset
lookup behavior.

Usage example:
    python3 scripts/finetune-kaggle.py \
      --model bge-m3 \
      --profile fast \
      --output scripture-bge

If run inside Kaggle, it will automatically detect the first
`training-pairs.json` found under `/kaggle/input/`.
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import random
import shutil
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

MODEL_REGISTRY = {
    'minilm-l6':     {'hf_id': 'sentence-transformers/all-MiniLM-L6-v2',     'dims': 384,  'bge': False},
    'minilm-l12':    {'hf_id': 'sentence-transformers/all-MiniLM-L12-v2',    'dims': 384,  'bge': False},
    'mpnet':         {'hf_id': 'sentence-transformers/all-mpnet-base-v2',     'dims': 768,  'bge': False},
    'distilroberta': {'hf_id': 'sentence-transformers/all-distilroberta-v1',  'dims': 768,  'bge': False},
    'bge-base':      {'hf_id': 'BAAI/bge-base-en-v1.5',                       'dims': 768,  'bge': True},
    'bge-large':     {'hf_id': 'BAAI/bge-large-en-v1.5',                      'dims': 1024, 'bge': True},
    'bge-m3':        {'hf_id': 'BAAI/bge-m3',                               'dims': 768, 'bge': True},
}

PROFILES = {
    'fast': {
        'epochs': 1,
        'max_seq_length': 256,
        'max_train_pairs': 50000,
        'validation_fraction': 0.0,
        'run_validation': False,
        'micro_batch_size': 4,
        'gradient_accumulation': 32,
    },
    'full': {
        'epochs': 2,
        'max_seq_length': 512,
        'max_train_pairs': None,
        'validation_fraction': 0.05,
        'run_validation': True,
        'micro_batch_size': 2,
        'gradient_accumulation': 64,
    },
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description='Kaggle-ready fine-tuning script for BGE and sentence-transformers models.',
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument('--data', type=str, default=None,
                        help='Path to training-pairs.json or folder containing it. If omitted, searches /kaggle/input.')
    parser.add_argument('--model', type=str, default='bge-m3', choices=MODEL_REGISTRY.keys(),
                        help='Model key from the registry.')
    parser.add_argument('--profile', type=str, default='fast', choices=PROFILES.keys(),
                        help='Training profile to use.')
    parser.add_argument('--output', type=str, default='scripture-bge',
                        help='Output model directory and zip base name.')
    parser.add_argument('--max-train-pairs', type=int, default=None,
                        help='Override the profile max train pairs cap.')
    parser.add_argument('--validation-fraction', type=float, default=None,
                        help='Override the validation fraction from the profile.')
    parser.add_argument('--no-validation', action='store_true',
                        help='Disable evaluation even if the profile requests it.')
    parser.add_argument('--seed', type=int, default=42,
                        help='Random seed for shuffling.')
    parser.add_argument('--hf-token', type=str, default=None,
                        help='Optional Hugging Face token for gated model access.')
    parser.add_argument('--auto-tune', action='store_true', default=False,
                        help='Auto-tune micro-batch and grad accumulation based on GPU VRAM')
    parser.add_argument('--bf16', action='store_true', default=False,
                        help='Force use of bf16 mixed precision when available')
    return parser.parse_args()


def find_training_data(explicit_path: str | None) -> str:
    if explicit_path:
        path = Path(explicit_path)
        if path.is_file():
            return str(path)
        if path.is_dir():
            matches = list(path.rglob('training-pairs.json'))
            if matches:
                return str(matches[0])
            raise FileNotFoundError(f'training-pairs.json not found under {path}')

    candidates = glob.glob('/kaggle/input/**/training-pairs.json', recursive=True)
    if not candidates:
        raise FileNotFoundError(
            'training-pairs.json not found under /kaggle/input/. Add the data set to the Kaggle notebook.'
        )
    return candidates[0]


def setup_cuda() -> tuple[int, bool]:
    raw_vis = os.environ.get('CUDA_VISIBLE_DEVICES', '').strip()
    world_size = int(os.environ.get('WORLD_SIZE', '1'))
    is_distributed = world_size > 1

    if not is_distributed and raw_vis and ',' in raw_vis:
        os.environ['CUDA_VISIBLE_DEVICES'] = raw_vis.split(',')[0].strip()
        print(f'Visible GPUs masked to single device: CUDA_VISIBLE_DEVICES={os.environ["CUDA_VISIBLE_DEVICES"]}')

    try:
        import torch
    except ImportError as exc:
        raise ImportError('torch is required for training. Install it first.') from exc

    cuda_available = torch.cuda.is_available()
    visible = torch.cuda.device_count() if cuda_available else 0
    use_single_gpu = cuda_available and visible > 1 and not is_distributed

    print(f'CUDA available : {cuda_available}')
    print(f'Visible GPUs    : {visible}')
    print(f'Distributed     : {is_distributed}')
    if cuda_available:
        props = torch.cuda.get_device_properties(0)
        print(f'Primary GPU     : {torch.cuda.get_device_name(0)}')
        print(f'VRAM / GPU      : {round(props.total_memory / 1e9, 1)} GB')

    return visible, use_single_gpu


def auto_tune_profile(profile: dict, model_key: str, vram_gb: int) -> dict:
    """
    Adjust profile['micro_batch_size'] and profile['gradient_accumulation'] based
    on detected GPU VRAM (GB) and model. Returns modified profile.
    """
    # Table: thresholds (GB) -> (micro_batch, grad_accum)
    BATCH_TABLE = {
        'bge-m3': {80: (8, 16), 40: (4, 32), 22: (2, 32), 0: (1, 64)},
        'bge-large': {80: (8, 16), 40: (4, 32), 22: (1, 64), 0: (1, 32)},
        'bge-base': {80: (16, 8), 40: (8, 16), 22: (4, 32), 0: (2, 32)},
        'default': {80: (8, 16), 40: (4, 32), 22: (2, 32), 0: (1, 32)},
    }

    table = BATCH_TABLE.get(model_key, BATCH_TABLE['default'])
    chosen = None
    for thr in sorted(table.keys(), reverse=True):
        if vram_gb >= thr:
            chosen = table[thr]
            break

    if chosen:
        micro, grad = chosen
        profile['micro_batch_size'] = micro
        profile['gradient_accumulation'] = grad
    return profile


def load_pairs(path: str, profile: dict, seed: int) -> tuple[list[dict], list[dict], bool]:
    with open(path, 'r', encoding='utf-8') as f:
        pairs = json.load(f)

    random.seed(seed)
    random.shuffle(pairs)

    max_pairs = profile['max_train_pairs']
    if max_pairs is not None and len(pairs) > max_pairs:
        print(f'Capping dataset to {max_pairs:,} pairs for profile')
        pairs = pairs[:max_pairs]

    val_frac = profile['validation_fraction']
    split_idx = int(len(pairs) * (1.0 - val_frac))
    split_idx = max(1, min(split_idx, len(pairs) - 1))
    train_pairs = pairs[:split_idx]
    val_pairs = pairs[split_idx:] if val_frac > 0 else []

    has_hard_neg = bool(train_pairs) and 'hard_negative' in train_pairs[0]
    print(f'Loaded {len(pairs):,} pairs; train={len(train_pairs):,}  val={len(val_pairs):,}  hard_negatives={has_hard_neg}')
    return train_pairs, val_pairs, has_hard_neg


def maybe_apply_bge_prompt(train_pairs: list[dict], val_pairs: list[dict], model_key: str, cfg: dict) -> None:
    if cfg['bge'] and model_key != 'bge-m3':
        print('Applying BGE prompt prefix to training texts')
        def add_instruction(text: str) -> str:
            return f'Represent this sentence for retrieval: {text}'

        for item in train_pairs + val_pairs:
            item['anchor'] = add_instruction(item['anchor'])
            item['positive'] = add_instruction(item['positive'])
            if 'hard_negative' in item:
                item['hard_negative'] = add_instruction(item['hard_negative'])


def build_dataset(train_pairs: list[dict], val_pairs: list[dict], has_hard_neg: bool, run_validation: bool):
    from datasets import Dataset

    train_dict = {
        'anchor': [item['anchor'] for item in train_pairs],
        'positive': [item['positive'] for item in train_pairs],
    }
    if has_hard_neg:
        train_dict['negative'] = [item['hard_negative'] for item in train_pairs]
    train_ds = Dataset.from_dict(train_dict)

    val_ds = None
    if run_validation and val_pairs:
        val_dict = {
            'anchor': [item['anchor'] for item in val_pairs],
            'positive': [item['positive'] for item in val_pairs],
        }
        if has_hard_neg:
            val_dict['negative'] = [item['hard_negative'] for item in val_pairs]
        val_ds = Dataset.from_dict(val_dict)

    return train_ds, val_ds


def build_model(cfg: dict, max_seq_length: int, hf_token: str | None) -> object:
    from sentence_transformers import SentenceTransformer, models

    if cfg['bge']:
        print('BGE model detected — overriding CLS pooling to mean pooling')
        model_args = {'trust_remote_code': True}
        tokenizer_args = {'trust_remote_code': True}
        if hf_token:
            model_args['use_auth_token'] = hf_token
            tokenizer_args['use_auth_token'] = hf_token

        word_model = models.Transformer(
            cfg['hf_id'],
            model_args=model_args,
            tokenizer_args=tokenizer_args,
        )
        pooling = models.Pooling(
            word_model.get_word_embedding_dimension(),
            pooling_mode_mean_tokens=True,
            pooling_mode_cls_token=False,
        )
        model = SentenceTransformer(modules=[word_model, pooling])
    else:
        model = SentenceTransformer(cfg['hf_id'])

    model.max_seq_length = max_seq_length
    test_emb = model.encode('And it came to pass')
    actual_dim = test_emb.shape[0]
    print(f'Model loaded: {cfg["hf_id"]}')
    print(f'Embedding dimension: {actual_dim}')
    if actual_dim != cfg['dims']:
        raise AssertionError(
            f'Expected embedding dimension {cfg["dims"]}, got {actual_dim}. Check the model registry.'
        )
    return model


def build_trainer(model, train_ds, val_ds, cfg: dict, profile: dict, visible_gpus: int, use_single_gpu: bool, use_bf16: bool = False):
    import torch
    from sentence_transformers import losses
    from sentence_transformers.training_args import SentenceTransformerTrainingArguments
    from sentence_transformers.trainer import SentenceTransformerTrainer

    micro_batch = profile['micro_batch_size']
    grad_accum = profile['gradient_accumulation']
    effective_batch = micro_batch * grad_accum

    total_steps = (len(train_ds) // effective_batch) * profile['epochs']
    warmup_steps = max(1, total_steps // 20) if total_steps else 0

    import torch

    args = SentenceTransformerTrainingArguments(
        output_dir=f'/kaggle/working/{output_dir}',
        num_train_epochs=profile['epochs'],
        per_device_train_batch_size=micro_batch,
        per_device_eval_batch_size=max(1, micro_batch * 2),
        gradient_accumulation_steps=grad_accum,
        warmup_steps=warmup_steps,
        learning_rate=LEARNING_RATE,
        eval_strategy='epoch' if profile['run_validation'] else 'no',
        save_strategy='epoch' if profile['run_validation'] else 'no',
        save_total_limit=2 if profile['run_validation'] else 1,
        load_best_model_at_end=profile['run_validation'],
        logging_steps=50,
        fp16=(torch.cuda.is_available() and not use_bf16),
        bf16=use_bf16,
        gradient_checkpointing=cfg['hf_id'] in ['BAAI/bge-large-en-v1.5', 'BAAI/bge-m3'],
        dataloader_num_workers=2,
        dataloader_pin_memory=torch.cuda.is_available(),
        metric_for_best_model='eval_loss' if profile['run_validation'] else None,
        greater_is_better=False if profile['run_validation'] else None,
        report_to='none',
    )

    if torch.cuda.is_available() and use_single_gpu:
        args._n_gpu = 1
        print('Forcing single-GPU trainer path in Kaggle notebook environment')

    loss = losses.MultipleNegativesRankingLoss(model)
    trainer = SentenceTransformerTrainer(
        model=model,
        args=args,
        train_dataset=train_ds,
        eval_dataset=val_ds if profile['run_validation'] else None,
        loss=loss,
    )

    return trainer, total_steps, warmup_steps, effective_batch


def save_model_and_zip(output_dir: str):
    model_save_dir = Path(output_dir)
    model_save_dir.mkdir(parents=True, exist_ok=True)
    model.save(str(model_save_dir))
    archive_path = str(model_save_dir.parent / model_save_dir.name)
    shutil.make_archive(archive_path, 'zip', str(model_save_dir))
    print(f'Created: {archive_path}.zip')
    return f'{archive_path}.zip'


def main() -> None:
    global output_dir, LEARNING_RATE, model

    args = parse_args()
    cfg = MODEL_REGISTRY[args.model]
    profile = PROFILES[args.profile].copy()

    if args.no_validation:
        profile['run_validation'] = False
        profile['validation_fraction'] = 0.0

    if args.validation_fraction is not None:
        profile['validation_fraction'] = args.validation_fraction

    if args.max_train_pairs is not None:
        profile['max_train_pairs'] = args.max_train_pairs

    if args.model in ['bge-large', 'bge-m3'] and args.profile == 'full':
        print(f'Warning: {args.model} + full profile can be slow on Kaggle T4.')

    output_dir = f'/kaggle/working/{args.output}'
    LEARNING_RATE = 1e-5 if args.model in ['bge-large', 'bge-m3'] else 2e-5

    data_path = find_training_data(args.data)
    print(f'Data path: {data_path}')

    visible_gpus, use_single_gpu = setup_cuda()
    print(f'Output directory: {output_dir}')
    print(f'Model choice: {args.model} ({cfg["hf_id"]})')
    print(f'Profile: {args.profile}')
    print(f'Validation fraction: {profile["validation_fraction"]}')

    train_pairs, val_pairs, has_hard_neg = load_pairs(data_path, profile, args.seed)
    maybe_apply_bge_prompt(train_pairs, val_pairs, args.model, cfg)
    train_ds, val_ds = build_dataset(train_pairs, val_pairs, has_hard_neg, profile['run_validation'])

    # Auto-tune micro-batch and grad-accum based on GPU VRAM if requested
    use_bf16 = args.bf16
    vram_gb = 0
    if visible_gpus > 0:
        try:
            import torch
            props = torch.cuda.get_device_properties(0)
            vram_gb = int(round(props.total_memory / 1e9))
        except Exception:
            vram_gb = 0

    if args.auto_tune:
        if vram_gb <= 0:
            print('Auto-tune requested but no GPU detected or VRAM unknown — skipping auto-tune')
        else:
            profile = auto_tune_profile(profile, args.model, vram_gb)
            # Suggest bf16 on large VRAM (40GB+) when not explicitly disabled
            if not use_bf16 and vram_gb >= 40:
                use_bf16 = True
            print(f'Auto-tune applied: micro_batch={profile["micro_batch_size"]}, grad_accum={profile["gradient_accumulation"]}, bf16={use_bf16}')

    global model
    model = build_model(cfg, profile['max_seq_length'], args.hf_token)

    trainer, total_steps, warmup_steps, effective_batch = build_trainer(
        model, train_ds, val_ds, cfg, profile, visible_gpus, use_single_gpu, use_bf16
    )

    print(f'Training setup: epochs={profile["epochs"]}, micro_batch={profile["micro_batch_size"]}, grad_accum={profile["gradient_accumulation"]}')
    print(f'Effective batch size: {effective_batch}')
    print(f'Total steps: {total_steps}, warmup: {warmup_steps}')

    start = time.time()
    trainer.train()
    elapsed_m = (time.time() - start) / 60.0
    print(f'Training finished in {elapsed_m:.1f} minutes')

    save_model_and_zip(output_dir)
    print('Training complete. Download the zip from /kaggle/working in the Kaggle Output tab.')


if __name__ == '__main__':
    main()
