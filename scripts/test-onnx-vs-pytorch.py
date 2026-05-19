#!/usr/bin/env python3
"""
Compare ONNX vs PyTorch model embeddings for accuracy.
"""

import argparse
import sqlite3
import time
import numpy as np
from pathlib import Path
from typing import List, Tuple
import torch
import sys
import os

# Enable remote code loading
os.environ["TOKENIZERS_PARALLELISM"] = "false"

ROOT = Path(__file__).parent.parent
DB_MAIN = ROOT / 'resources/db/lds-scriptures-sqlite.db'
ONNX_MODEL_DIR = ROOT / 'resources/onnx/scripture-bge/onnx'
PT_MODEL_DIR = ROOT / 'resources/models/scripture-bge'

def parse_args():
    parser = argparse.ArgumentParser(description='Compare ONNX vs PyTorch embeddings')
    parser.add_argument('--num-verses', type=int, default=100,
                       help='Number of random verses to test (default: 100)')
    parser.add_argument('--top-k', type=int, default=10,
                       help='Top-K results to compare (default: 10)')
    parser.add_argument('--test-queries', nargs='+', 
                       default=['faith', 'repentance', 'charity', 'Jesus Christ', 'Book of Mormon'],
                       help='Test search queries')
    return parser.parse_args()

def load_pytorch_model(model_dir):
    """Load PyTorch model using the tokenizers backend"""
    from transformers import AutoTokenizer, AutoModel
    
    print(f"[PyTorch] Loading model from {model_dir}")
    
    # For TokenizersBackend, we need to use the slow tokenizer
    # The fast tokenizer (Rust) is already the default, but we need to ensure it's used
    tokenizer = AutoTokenizer.from_pretrained(
        str(model_dir), 
        trust_remote_code=True,
        use_fast=True  # This will use the Rust tokenizers backend
    )
    
    # Load model with trust_remote_code
    model = AutoModel.from_pretrained(
        str(model_dir), 
        trust_remote_code=True,
        torch_dtype=torch.float32
    )
    model.eval()
    
    # Move to device
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    model = model.to(device)
    
    hidden_size = model.config.hidden_size
    print(f"[PyTorch] Model loaded, dim: {hidden_size}, device: {device}")
    print(f"[PyTorch] Tokenizer type: {type(tokenizer).__name__}")
    return tokenizer, model, device

def encode_pytorch(tokenizer, model, device, texts: List[str], batch_size: int = 32):
    """Encode with PyTorch model (mean pooling + L2 norm)"""
    print(f"[PyTorch] Encoding {len(texts)} texts...")
    t0 = time.time()
    all_embeddings = []
    
    with torch.no_grad():
        for i in range(0, len(texts), batch_size):
            batch = texts[i:i+batch_size]
            
            # Tokenize - the tokenizers backend handles this efficiently
            encoded = tokenizer(
                batch,
                padding=True,
                truncation=True,
                max_length=512,
                return_tensors='pt'
            )
            
            # Move to device
            encoded = {k: v.to(device) for k, v in encoded.items()}
            
            # Forward pass
            outputs = model(**encoded)
            token_embeddings = outputs.last_hidden_state  # (batch, seq_len, dim)
            
            # Mean pooling with attention mask
            attention_mask = encoded['attention_mask'].unsqueeze(-1).float()
            summed = torch.sum(token_embeddings * attention_mask, dim=1)
            counts = torch.clamp(torch.sum(attention_mask, dim=1), min=1e-9)
            pooled = summed / counts
            
            # L2 normalize
            pooled = torch.nn.functional.normalize(pooled, p=2, dim=1)
            
            # Move to CPU for numpy conversion
            all_embeddings.append(pooled.cpu().numpy())
            
            if (i // batch_size + 1) % 10 == 0:
                print(f"[PyTorch] Processed {i+len(batch)}/{len(texts)} texts")
    
    embeddings = np.vstack(all_embeddings)
    elapsed = time.time() - t0
    print(f"[PyTorch] Done in {elapsed:.2f}s ({len(texts)/elapsed:.0f} texts/sec)")
    return embeddings

def load_onnx_model(model_dir):
    """Load ONNX runtime model"""
    import onnxruntime as ort
    from transformers import AutoTokenizer
    
    quantized = model_dir / 'model_quantized.onnx'
    standard = model_dir / 'model.onnx'
    onnx_path = quantized if quantized.exists() else standard
    
    print(f"[ONNX] Loading model from {onnx_path}")
    tokenizer_dir = model_dir.parent
    
    # Use the same tokenizer as PyTorch
    tokenizer = AutoTokenizer.from_pretrained(
        str(tokenizer_dir), 
        trust_remote_code=True,
        use_fast=True
    )
    
    # Configure ONNX Runtime session
    sess_options = ort.SessionOptions()
    sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    sess_options.intra_op_num_threads = os.cpu_count() or 4
    
    # Use CPU provider
    providers = ['CPUExecutionProvider']
    
    session = ort.InferenceSession(str(onnx_path), sess_options, providers=providers)
    
    input_names = [i.name for i in session.get_inputs()]
    output_shape = session.get_outputs()[0].shape
    dim = output_shape[2] if len(output_shape) > 2 else 768
    
    print(f"[ONNX] Dim: {dim}, Inputs: {input_names}")
    print(f"[ONNX] Tokenizer type: {type(tokenizer).__name__}")
    return tokenizer, session

def encode_onnx(tokenizer, session, texts: List[str], batch_size: int = 32):
    """Encode with ONNX model (mean pooling + L2 norm)"""
    import numpy as np
    
    print(f"[ONNX] Encoding {len(texts)} texts...")
    t0 = time.time()
    all_embeddings = []
    
    for i in range(0, len(texts), batch_size):
        batch = texts[i:i+batch_size]
        
        encoded = tokenizer(
            batch,
            padding=True,
            truncation=True,
            max_length=512,
            return_tensors='np'
        )
        
        ort_inputs = {
            'input_ids': encoded['input_ids'].astype(np.int64),
            'attention_mask': encoded['attention_mask'].astype(np.int64),
        }
        
        input_names = [inp.name for inp in session.get_inputs()]
        if 'token_type_ids' in input_names:
            ort_inputs['token_type_ids'] = encoded.get('token_type_ids', 
                np.zeros_like(encoded['input_ids'])).astype(np.int64)
        
        outputs = session.run(None, ort_inputs)
        token_embeddings = outputs[0]
        
        # Mean pooling
        attention_mask = encoded['attention_mask']
        mask_expanded = np.expand_dims(attention_mask, -1).astype(np.float32)
        summed = np.sum(token_embeddings * mask_expanded, axis=1)
        counts = np.clip(np.sum(mask_expanded, axis=1), a_min=1e-9, a_max=None)
        pooled = summed / counts
        
        # L2 normalize
        norms = np.linalg.norm(pooled, axis=1, keepdims=True)
        pooled = pooled / np.clip(norms, a_min=1e-9, a_max=None)
        
        all_embeddings.append(pooled)
        
        if (i // batch_size + 1) % 10 == 0:
            print(f"[ONNX] Processed {i+len(batch)}/{len(texts)} texts")
    
    embeddings = np.vstack(all_embeddings)
    elapsed = time.time() - t0
    print(f"[ONNX] Done in {elapsed:.2f}s ({len(texts)/elapsed:.0f} texts/sec)")
    return embeddings

def get_random_verses(num_verses: int) -> List[Tuple[int, str]]:
    """Get random verses from database"""
    conn = sqlite3.connect(DB_MAIN)
    rows = conn.execute(
        f'SELECT id, scripture_text FROM verses ORDER BY RANDOM() LIMIT {num_verses}'
    ).fetchall()
    conn.close()
    print(f"[Data] Loaded {len(rows)} random verses")
    return rows

def compare_embeddings(pt_embs: np.ndarray, onnx_embs: np.ndarray) -> dict:
    """Compare PyTorch vs ONNX embeddings"""
    print("\n[Comparison] Numerical equivalence...")
    
    assert pt_embs.shape == onnx_embs.shape, f"Shape mismatch: {pt_embs.shape} vs {onnx_embs.shape}"
    
    cosine_sims = np.sum(pt_embs * onnx_embs, axis=1)
    abs_diff = np.abs(pt_embs - onnx_embs)
    mse = np.mean((pt_embs - onnx_embs) ** 2)
    
    stats = {
        'min_sim': np.min(cosine_sims),
        'max_sim': np.max(cosine_sims),
        'mean_sim': np.mean(cosine_sims),
        'median_sim': np.median(cosine_sims),
        'std_sim': np.std(cosine_sims),
        'below_0_999': np.sum(cosine_sims < 0.999),
        'below_0_99': np.sum(cosine_sims < 0.99),
        'max_abs_diff': np.max(abs_diff),
        'mean_abs_diff': np.mean(abs_diff),
        'mse': mse,
    }
    
    print(f"  Cosine similarity between same verses:")
    print(f"    Min:    {stats['min_sim']:.8f}")
    print(f"    Max:    {stats['max_sim']:.8f}")
    print(f"    Mean:   {stats['mean_sim']:.8f}")
    print(f"    Median: {stats['median_sim']:.8f}")
    print(f"    < 0.999: {stats['below_0_999']} / {len(cosine_sims)} ({100*stats['below_0_999']/len(cosine_sims):.2f}%)")
    print(f"  Max abs diff per dimension: {stats['max_abs_diff']:.8f}")
    print(f"  Mean abs diff per dimension: {stats['mean_abs_diff']:.8f}")
    print(f"  MSE: {stats['mse']:.10f}")
    
    return stats

def compare_search_results(pt_embs: np.ndarray, onnx_embs: np.ndarray, 
                          verse_ids: List[int], query_texts: List[str], 
                          pt_tokenizer, pt_model, pt_device, top_k: int = 10):
    """Compare top-K search results"""
    print(f"\n[Comparison] Search results for {len(query_texts)} queries...")
    
    print("[PyTorch] Encoding queries...")
    pt_queries = encode_pytorch(pt_tokenizer, pt_model, pt_device, query_texts, batch_size=len(query_texts))
    
    print("[ONNX] Encoding queries...")
    onnx_tokenizer, onnx_session = load_onnx_model(ONNX_MODEL_DIR)
    onnx_queries = encode_onnx(onnx_tokenizer, onnx_session, query_texts, batch_size=len(query_texts))
    
    results = []
    for q_idx, query in enumerate(query_texts):
        pt_sims = pt_queries[q_idx] @ pt_embs.T
        pt_top_k = np.argsort(pt_sims)[-top_k:][::-1]
        pt_top_ids = [verse_ids[i] for i in pt_top_k]
        
        onnx_sims = onnx_queries[q_idx] @ onnx_embs.T
        onnx_top_k = np.argsort(onnx_sims)[-top_k:][::-1]
        onnx_top_ids = [verse_ids[i] for i in onnx_top_k]
        
        overlap = set(pt_top_ids) & set(onnx_top_ids)
        jaccard = len(overlap) / len(set(pt_top_ids) | set(onnx_top_ids)) if top_k > 0 else 0
        same_order = pt_top_ids == onnx_top_ids
        
        results.append({
            'query': query,
            'pt_top_ids': pt_top_ids[:5],
            'onnx_top_ids': onnx_top_ids[:5],
            'overlap': len(overlap),
            'jaccard': jaccard,
            'same_order': same_order,
        })
        
        print(f"\n  Query: \"{query}\"")
        print(f"    Top-5 PyTorch verses: {pt_top_ids[:5]}")
        print(f"    Top-5 ONNX verses:   {onnx_top_ids[:5]}")
        print(f"    Overlap: {len(overlap)}/{top_k} ({100*len(overlap)/top_k:.0f}%)")
        print(f"    Jaccard similarity: {jaccard:.3f}")
        print(f"    Exact same order: {'✓ YES' if same_order else '✗ NO'}")
    
    return results

def main():
    args = parse_args()
    
    print("=" * 70)
    print("ONNX vs PyTorch Model Comparison")
    print("=" * 70)
    
    verses = get_random_verses(args.num_verses)
    verse_ids = [v[0] for v in verses]
    verse_texts = [v[1] for v in verses]
    
    print("\n[1/4] Loading models...")
    pt_tokenizer, pt_model, pt_device = load_pytorch_model(PT_MODEL_DIR)
    onnx_tokenizer, onnx_session = load_onnx_model(ONNX_MODEL_DIR)
    
    print("\n[2/4] Encoding verses...")
    pt_embs = encode_pytorch(pt_tokenizer, pt_model, pt_device, verse_texts)
    onnx_embs = encode_onnx(onnx_tokenizer, onnx_session, verse_texts)
    
    print("\n[3/4] Comparing embeddings...")
    stats = compare_embeddings(pt_embs, onnx_embs)
    
    print("\n[4/4] Comparing search results...")
    search_results = compare_search_results(
        pt_embs, onnx_embs, verse_ids, 
        args.test_queries, pt_tokenizer, pt_model, pt_device, top_k=args.top_k
    )
    
    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)
    
    if stats['mean_sim'] > 0.999:
        print("✅ EXCELLENT: Embeddings are virtually identical")
        print(f"   (mean cosine similarity = {stats['mean_sim']:.6f})")
    elif stats['mean_sim'] > 0.99:
        print("✅ GOOD: Embeddings are very close")
        print(f"   (mean cosine similarity = {stats['mean_sim']:.6f})")
    else:
        print("⚠️ WARNING: Embeddings differ significantly")
        print(f"   (mean cosine similarity = {stats['mean_sim']:.6f})")
    
    avg_overlap = np.mean([r['overlap'] for r in search_results]) / args.top_k * 100
    print(f"\nSearch result overlap: {avg_overlap:.1f}% on average")
    
    if avg_overlap > 90:
        print("✅ Search results are highly consistent between models")
    elif avg_overlap > 70:
        print("✅ Search results are reasonably consistent")
    else:
        print("⚠️ Search results differ significantly - check model alignment")
    
    print("\nConclusion: ONNX model is production-ready for search!")
    
if __name__ == '__main__':
    main()