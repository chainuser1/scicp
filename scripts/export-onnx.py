#!/usr/bin/env python3
"""Export a fine-tuned Scripture model to ONNX for backend runtime.

Uses SentenceTransformer's internal tokenizer and model loading.

Usage:
    python3 scripts/export-onnx.py
    python3 scripts/export-onnx.py --model-dir resources/models/scripture-bge \
        --output-dir resources/onnx/scripture-bge --force
"""

import argparse
import shutil
import sys
import torch
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_MODEL_DIR = ROOT / 'resources' / 'models' / 'scripture-bge'
DEFAULT_OUTPUT_DIR = ROOT / 'resources' / 'onnx' / 'scripture-bge'

def parse_args():
    parser = argparse.ArgumentParser(description='Export Nomic BERT to ONNX')
    parser.add_argument('--model-dir', type=Path, default=DEFAULT_MODEL_DIR)
    parser.add_argument('--output-dir', type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument('--opset', type=int, default=17)
    parser.add_argument('--force', action='store_true')
    parser.add_argument('--quantize', action='store_true')
    return parser.parse_args()

def export_to_onnx(model_dir: Path, output_path: Path, opset: int):
    """Export model to ONNX using SentenceTransformer's internals"""
    from sentence_transformers import SentenceTransformer
    
    print(f'[export] Loading SentenceTransformer from {model_dir}')
    st_model = SentenceTransformer(str(model_dir))
    
    # Get the tokenizer (already properly configured)
    tokenizer = st_model.tokenizer
    print(f'[export] Tokenizer loaded: {type(tokenizer).__name__}')
    
    # Get the underlying transformer model (first module is usually the transformer)
    # Nomic BERT uses a custom architecture that SentenceTransformer wraps
    transformer_module = st_model._first_module()
    model = transformer_module.auto_model
    model.eval()
    
    # Dummy input for tracing
    dummy = tokenizer(
        "export trace input",
        return_tensors="pt",
        padding="max_length",
        max_length=16,
        truncation=True,
    )
    
    input_ids = dummy["input_ids"]
    attention_mask = dummy["attention_mask"]
    
    # Check if token_type_ids is needed
    if "token_type_ids" in dummy:
        inputs = (input_ids, attention_mask, dummy["token_type_ids"])
        input_names = ["input_ids", "attention_mask", "token_type_ids"]
    else:
        inputs = (input_ids, attention_mask)
        input_names = ["input_ids", "attention_mask"]
    
    dynamic_axes = {name: {0: "batch_size", 1: "sequence_length"} for name in input_names}
    dynamic_axes["last_hidden_state"] = {0: "batch_size", 1: "sequence_length"}
    
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    print(f'[export] Exporting to ONNX (opset {opset})...')
    with torch.no_grad():
        torch.onnx.export(
            model,
            inputs,
            str(output_path),
            opset_version=opset,
            input_names=input_names,
            output_names=["last_hidden_state"],
            dynamic_axes=dynamic_axes,  
        )   
    print(f'[export] Saved to {output_path}')
    
    # Clean up to free memory
    del st_model
    del model

def quantize_onnx(input_path: Path, output_path: Path):
    """Quantize ONNX model to int8"""
    try:
        from onnxruntime.quantization import quantize_dynamic, QuantType
        print(f'[export] Quantizing {input_path} -> {output_path}')
        quantize_dynamic(
            model_input=str(input_path),
            model_output=str(output_path),
            weight_type=QuantType.QInt8,
        )
        print(f'[export] Quantized model saved')
    except ImportError:
        print('[export] onnxruntime not installed, skipping quantization')

def main():
    args = parse_args()
    
    if not args.model_dir.exists():
        print(f'[error] Model not found: {args.model_dir}')
        sys.exit(1)
    
    # Prepare output directory
    if args.output_dir.exists() and args.force:
        shutil.rmtree(args.output_dir)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    
    # Create onnx subdirectory
    onnx_dir = args.output_dir / 'onnx'
    onnx_dir.mkdir(exist_ok=True)
    
    # Export to ONNX
    onnx_path = onnx_dir / 'model.onnx'
    try:
        export_to_onnx(args.model_dir, onnx_path, args.opset)
    except Exception as e:
        print(f'[error] Export failed: {e}')
        raise
    
    # Quantize if requested
    if args.quantize:
        quantized_path = onnx_dir / 'model_quantized.onnx'
        quantize_onnx(onnx_path, quantized_path)
    
    # Copy tokenizer files from original model
    print('[export] Copying tokenizer files...')
    for fname in ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json']:
        src = args.model_dir / fname
        if src.exists():
            dst = args.output_dir / fname
            shutil.copy2(src, dst)
    
    print(f'\n[done] ONNX model exported to {onnx_dir}')
    print('[done] Ready for rebake-embeddings-onnx.py')

if __name__ == '__main__':
    main()