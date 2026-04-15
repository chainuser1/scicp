#!/usr/bin/env python3
"""Export a fine-tuned Scripture model to ONNX for backend runtime.

This script is intended to be run after a fine-tuned model is installed under
resources/models/scripture-bge* and before the backend restarts.

Usage:
    python3 scripts/export-onnx.py --model-dir resources/models/scripture-bge-vNext \
        --output-dir resources/onnx/scripture-bge
"""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_MODEL_DIR = ROOT / 'resources' / 'models' / 'scripture-bge'
DEFAULT_OUTPUT_DIR = ROOT / 'resources' / 'onnx' / 'scripture-bge'

TOKENIZER_FILES = [
    'config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'vocab.txt',
    'merges.txt',
    'special_tokens_map.json',
    'added_tokens.json',
]


def parse_args():
    parser = argparse.ArgumentParser(description='Export a sentence-transformers model to ONNX for backend runtime.')
    parser.add_argument('--model-dir', type=Path, default=DEFAULT_MODEL_DIR,
                        help='Path to the fine-tuned SentenceTransformer model directory.')
    parser.add_argument('--output-dir', type=Path, default=DEFAULT_OUTPUT_DIR,
                        help='Path to write the ONNX runtime model directory.')
    parser.add_argument('--feature', type=str, default='feature-extraction',
                        help='Transformers ONNX feature type. Default: feature-extraction')
    parser.add_argument('--force', action='store_true', help='Overwrite existing ONNX export output.')
    return parser.parse_args()


def ensure_transformers():
    try:
        import transformers  # noqa: F401
    except Exception as exc:
        raise SystemExit(
            'transformers is required to export ONNX. Install it with:\n'
            '    python3 -m pip install transformers tqdm'
        ) from exc


def copy_tokenizer_files(model_dir: Path, output_dir: Path):
    output_dir.mkdir(parents=True, exist_ok=True)
    for fname in TOKENIZER_FILES:
        src = model_dir / fname
        if src.exists():
            dst = output_dir / fname
            if dst.exists():
                continue
            shutil.copy2(src, dst)


def run_transformers_onnx(model_dir: Path, output_dir: Path, feature: str):
    tmp_dir = output_dir / '_onnx_export_tmp'
    if tmp_dir.exists():
        shutil.rmtree(tmp_dir)
    cmd = [
        sys.executable,
        '-m',
        'transformers.onnx',
        '--model',
        str(model_dir),
        '--feature',
        feature,
        str(tmp_dir),
    ]
    print('[export] running:', ' '.join(cmd))
    subprocess.run(cmd, check=True)
    return tmp_dir


def move_exported_onnx(tmp_dir: Path, output_dir: Path):
    onnx_dir = output_dir / 'onnx'
    if onnx_dir.exists():
        shutil.rmtree(onnx_dir)
    onnx_dir.mkdir(parents=True, exist_ok=True)

    moved = False
    for item in tmp_dir.iterdir():
        if item.name in ('model.onnx', 'model_quantized.onnx'):
            shutil.move(str(item), str(onnx_dir / item.name))
            moved = True
        elif item.is_dir() and item.name == 'onnx':
            for sub in item.iterdir():
                shutil.move(str(sub), str(onnx_dir / sub.name))
                moved = True
        else:
            # Preserve any tokenizer/config files produced by the export
            if item.is_file():
                shutil.move(str(item), str(output_dir / item.name))
    if not moved:
        raise SystemExit('[export] no ONNX model file found in export output')

    shutil.rmtree(tmp_dir)
    print(f'[export] ONNX model written to {onnx_dir}')


def main():
    args = parse_args()
    model_dir = args.model_dir.resolve()
    output_dir = args.output_dir.resolve()

    if not model_dir.exists() or not model_dir.is_dir():
        raise SystemExit(f'[error] model dir not found: {model_dir}')

    if output_dir.exists() and not args.force:
        print(f'[export] output dir exists: {output_dir}')
    copy_tokenizer_files(model_dir, output_dir)
    ensure_transformers()
    tmp_dir = run_transformers_onnx(model_dir, output_dir, args.feature)
    move_exported_onnx(tmp_dir, output_dir)
    print('[done] ONNX export complete.')


if __name__ == '__main__':
    main()
