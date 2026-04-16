#!/usr/bin/env python3
"""Export a fine-tuned Scripture model to ONNX for backend runtime.

Uses Hugging Face `transformers.onnx` to export the fine-tuned model to
ONNX. The intermediate export is written to a temp directory on the system
partition so it never competes for space with the project drive.

Usage:
    python3 scripts/export-onnx.py
    python3 scripts/export-onnx.py --model-dir resources/models/scripture-bge-vNext \
        --output-dir resources/onnx/scripture-bge --force

Requirements (install once):
    pip install --upgrade transformers onnxruntime
"""

import argparse
import atexit
import os
import shutil
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_MODEL_DIR = ROOT / 'resources' / 'models' / 'scripture-bge'
DEFAULT_OUTPUT_DIR = ROOT / 'resources' / 'onnx' / 'scripture-bge'

# Files to copy from the model dir so the ONNX runtime dir is self-contained.
TOKENIZER_FILES = [
    'config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'vocab.txt',
    'merges.txt',
    'special_tokens_map.json',
    'added_tokens.json',
]


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description='Export a SentenceTransformer model to ONNX via transformers.onnx.'
    )
    parser.add_argument(
        '--model-dir', type=Path, default=DEFAULT_MODEL_DIR,
        help='Path to the fine-tuned SentenceTransformer model directory.',
    )
    parser.add_argument(
        '--output-dir', type=Path, default=DEFAULT_OUTPUT_DIR,
        help='Destination directory for the ONNX runtime artefacts.',
    )
    parser.add_argument(
        '--task', type=str, default='feature-extraction',
        help='ONNX export task / feature alias (default: feature-extraction, translated to default for transformers).',
    )
    parser.add_argument(
        '--opset', type=int, default=17,
        help='ONNX opset version (default: 17; BGE/XLM-RoBERTa requires >=17).',
    )
    parser.add_argument(
        '--tmp-dir', type=Path, default=None,
        help='Parent directory for the intermediate export scratch space. '
             'Defaults to the system temp dir (usually on the largest partition).',
    )
    parser.add_argument(
        '--direct-output', action='store_true',
        help='Write export artifacts directly into the output directory instead of using a temporary scratch space.',
    )
    parser.add_argument(
        '--quantize', action='store_true',
        help='Quantize the exported ONNX model and write onnx/model_quantized.onnx.',
    )
    parser.add_argument(
        '--force', action='store_true',
        help='Overwrite existing ONNX output directory.',
    )
    return parser.parse_args()


# ---------------------------------------------------------------------------
# Dependency check
# ---------------------------------------------------------------------------

def ensure_transformers() -> None:
    """Abort early with an actionable message if transformers is not installed."""
    try:
        from transformers.onnx import export  # noqa: F401
    except ImportError as exc:
        raise SystemExit(
            '[error] transformers is not installed or is missing the ONNX export support.\n'
            '        Fix it with:\n'
            '    pip install --upgrade transformers onnxruntime'
        ) from exc


# ---------------------------------------------------------------------------
# Tokenizer helpers
# ---------------------------------------------------------------------------

def copy_tokenizer_files(model_dir: Path, output_dir: Path) -> None:
    """Copy tokenizer/config files so the runtime dir is self-contained."""
    output_dir.mkdir(parents=True, exist_ok=True)
    copied = []
    for fname in TOKENIZER_FILES:
        src = model_dir / fname
        if src.exists():
            dst = output_dir / fname
            if not dst.exists():
                shutil.copy2(src, dst)
                copied.append(fname)
    if copied:
        print(f'[export] copied tokenizer files: {", ".join(copied)}')
    else:
        print('[export] tokenizer files already present, skipping copy.')


# ---------------------------------------------------------------------------
# Scratch space management
# ---------------------------------------------------------------------------

def make_tmp_dir(parent: Path | None) -> Path:
    """
    Create a fresh scratch directory on the system temp partition (or an
    explicit --tmp-dir) so the intermediate weights are never written to a
    partition that might be constrained for space.

    The directory is registered with atexit so it is always removed — including
    on unhandled exceptions and Ctrl+C.
    """
    parent_str = str(parent) if parent else None
    tmp = Path(tempfile.mkdtemp(prefix='scicp_onnx_export_', dir=parent_str))
    print(f'[export] scratch dir: {tmp}')

    def _cleanup() -> None:
        if tmp.exists():
            shutil.rmtree(tmp, ignore_errors=True)
            print(f'[export] cleaned up scratch dir: {tmp}')

    atexit.register(_cleanup)
    return tmp


def purge_stale_tmp_dirs(fresh: Path) -> None:
    """Remove leftover scicp_onnx_export_* dirs from previous crashed runs."""
    for stale in fresh.parent.glob('scicp_onnx_export_*'):
        if stale != fresh and stale.is_dir():
            print(f'[export] removing stale scratch dir: {stale}')
            shutil.rmtree(stale, ignore_errors=True)


# ---------------------------------------------------------------------------
# Core export
# ---------------------------------------------------------------------------

def run_transformers_export(
    model_dir: Path,
    output_path: Path,
    task: str,
    opset: int,
) -> None:
    """
    Call transformers' ONNX export API directly.

    This path uses local model files only and exports a monolithic onnx model
    suitable for the existing backend loader.
    """
    from transformers import AutoModel, AutoTokenizer
    from transformers.onnx import FeaturesManager, export

    print(f'[export] running transformers.onnx export — task={task}, opset={opset}')
    tokenizer = AutoTokenizer.from_pretrained(str(model_dir), local_files_only=True)
    model = AutoModel.from_pretrained(str(model_dir), local_files_only=True)

    feature = task
    if feature == 'feature-extraction':
        feature = 'default'

    config_factory = FeaturesManager.get_config(model.config.model_type, feature)
    onnx_config = config_factory(model.config)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    export(
        preprocessor=tokenizer,
        model=model,
        config=onnx_config,
        opset=opset,
        output=output_path,
        device='cpu',
    )
    print(f'[export] transformers.onnx export finished to {output_path}')


# ---------------------------------------------------------------------------
# Install artefacts into the final output layout
# ---------------------------------------------------------------------------

def install_onnx_artefacts(tmp_dir: Path, output_dir: Path) -> None:
    """
    Move ONNX files from tmp_dir into output_dir with this layout:

        output_dir/
            onnx/
                model.onnx          <- canonical path consumed by the backend
                model.onnx.data     <- external weights (present if model > 2 GB)
            model.onnx              <- hard-link alias for legacy loaders
            model.onnx.data         <- hard-link alias
            config.json             ]
            tokenizer.json          ] already written by copy_tokenizer_files()
            …                       ]
    """
    onnx_dir = output_dir / 'onnx'
    if onnx_dir.exists():
        shutil.rmtree(onnx_dir)
    onnx_dir.mkdir(parents=True, exist_ok=True)

    moved_onnx = False

    def _is_onnx(name: str) -> bool:
        return name.endswith('.onnx') or name.endswith('.onnx.data')

    def _move_if_onnx(src: Path) -> bool:
        if _is_onnx(src.name):
            shutil.move(str(src), str(onnx_dir / src.name))
            return True
        return False

    for item in tmp_dir.iterdir():
        if _move_if_onnx(item):
            moved_onnx = True
        elif item.is_dir() and item.name == 'onnx':
            # transformers may also nest files in an `onnx/` sub-directory
            for sub in item.iterdir():
                if _move_if_onnx(sub):
                    moved_onnx = True
                elif sub.is_file():
                    dst = output_dir / sub.name
                    if not dst.exists():
                        shutil.move(str(sub), str(dst))
        elif item.is_file() and item.name in TOKENIZER_FILES:
            dst = output_dir / item.name
            if not dst.exists():
                shutil.move(str(item), str(dst))

    if not moved_onnx:
        raise SystemExit(
            '[error] no .onnx file found in transformers export output.\n'
            f'        Check {tmp_dir} for clues (it will be cleaned up on exit).'
        )

    # Create aliases at the root level for loaders that don't look
    # inside the `onnx/` sub-directory. For the external-data file
    # (model.onnx.data) we must avoid creating extra hard links because
    # ONNX will reject files with multiple hard links (potential
    # hardlink attack). Copy the external-data file instead.
    for fname in ('model.onnx', 'model.onnx.data'):
        src = onnx_dir / fname
        dst = output_dir / fname
        if src.exists() and not dst.exists():
            # Never create additional hard links for external data files.
            if fname.endswith('.data'):
                shutil.copy2(str(src), str(dst))
            else:
                try:
                    os.link(src, dst)
                except OSError:
                    # Falls back to a copy if hard-linking fails (cross-device, etc.)
                    shutil.copy2(str(src), str(dst))

    print(f'[export] ONNX artefacts installed to {onnx_dir}')


def quantize_onnx_model(input_path: Path, output_path: Path) -> None:
    try:
        from onnxruntime.quantization import quantize_dynamic, QuantType
    except ImportError as exc:
        raise SystemExit(
            '[error] onnxruntime quantization is not installed.\n'
            '        Fix it with:\n'
            '    pip install --upgrade onnxruntime\n'
        ) from exc

    if not input_path.exists():
        raise SystemExit(f'[error] input ONNX model not found: {input_path}')

    if output_path.exists():
        output_path.unlink()

    print(f'[export] quantizing {input_path.name} -> {output_path.name}')
    quantize_dynamic(
        model_input=str(input_path),
        model_output=str(output_path),
        weight_type=QuantType.QInt8,
    )
    print(f'[export] quantized model written to {output_path}')


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def normalize_direct_output(output_dir: Path) -> None:
    onnx_dir = output_dir / 'onnx'
    root_model = output_dir / 'model.onnx'
    root_data = output_dir / 'model.onnx.data'

    # Find the canonical model file produced by the export tool.
    candidate_model = None
    if root_model.exists():
        candidate_model = root_model
    elif (onnx_dir / 'model.onnx').exists():
        candidate_model = onnx_dir / 'model.onnx'
    else:
        for path in output_dir.glob('*.onnx'):
            candidate_model = path
            break
        if candidate_model is None and onnx_dir.exists():
            for path in onnx_dir.glob('*.onnx'):
                candidate_model = path
                break

    if candidate_model is None:
        raise SystemExit(
            '[error] no .onnx file found in output directory after direct export.'
        )

    if not onnx_dir.exists():
        onnx_dir.mkdir(parents=True, exist_ok=True)

    if candidate_model.parent != onnx_dir:
        dst = onnx_dir / candidate_model.name
        if dst.exists():
            dst.unlink()
        shutil.move(str(candidate_model), str(dst))
        candidate_model = dst

    if root_model.exists() and root_model != candidate_model:
        root_model.unlink()

    if not root_model.exists():
        try:
            os.link(str(candidate_model), str(root_model))
        except OSError:
            shutil.copy2(str(candidate_model), str(root_model))

    if (onnx_dir / 'model.onnx.data').exists() and not root_data.exists():
        # Avoid hard-linking external data files; always copy to prevent
        # onnx runtime validation errors about multiple hard links.
        shutil.copy2(str(onnx_dir / 'model.onnx.data'), str(root_data))

    print(f'[export] direct output normalized in {output_dir}')


def main() -> None:
    args = parse_args()
    model_dir: Path = args.model_dir.resolve()
    output_dir: Path = args.output_dir.resolve()

    # ── Validate inputs ──────────────────────────────────────────────────────
    if not model_dir.exists() or not model_dir.is_dir():
        raise SystemExit(f'[error] model directory not found: {model_dir}')

    if args.direct_output and args.tmp_dir:
        raise SystemExit(
            '[error] --tmp-dir cannot be used with --direct-output.'
        )

    if output_dir.exists() and not args.force:
        onnx_candidate = output_dir / 'onnx' / 'model.onnx'
        if onnx_candidate.exists():
            raise SystemExit(
                f'[error] output already exists: {output_dir}\n'
                '        Pass --force to overwrite.'
            )

    if output_dir.exists() and args.force:
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # ── Dependencies ─────────────────────────────────────────────────────────
    ensure_transformers()

    # ── Tokenizer files ──────────────────────────────────────────────────────
    copy_tokenizer_files(model_dir, output_dir)

    if args.direct_output:
        export_path = output_dir / 'onnx' / 'model.onnx'
        try:
            run_transformers_export(model_dir, export_path, args.task, args.opset)
            normalize_direct_output(output_dir)
        except Exception:
            raise
    else:
        tmp_parent = args.tmp_dir.resolve() if args.tmp_dir else None
        tmp_dir = make_tmp_dir(tmp_parent)
        purge_stale_tmp_dirs(tmp_dir)

        try:
            run_transformers_export(model_dir, tmp_dir / 'model.onnx', args.task, args.opset)
            install_onnx_artefacts(tmp_dir, output_dir)
        except Exception:
            raise  # atexit still cleans tmp_dir

    if args.quantize:
        model_path = output_dir / 'onnx' / 'model.onnx'
        quantized_path = output_dir / 'onnx' / 'model_quantized.onnx'
        quantize_onnx_model(model_path, quantized_path)

    print('[done] ONNX export complete.')


if __name__ == '__main__':
    main()