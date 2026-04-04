# Model Summary

This model is a fine-tuned English sentence embedding model for scripture retrieval in scicp (Sacred Scripture Projector). It encodes scripture verses, doctrinal concepts, and user queries into a shared vector space so that semantically related texts are close together even when they do not share the same surface wording.

The model is intended for retrieval tasks, not generation. Its main use cases are semantic verse search, doctrinal concept search, paraphrase retrieval, concept-to-verse matching, and retrieval reranking inside a larger search system.

Architecture:
- Base model: `BAAI/bge-base-en-v1.5`
- Model type: transformer encoder with mean pooling for sentence embeddings
- Embedding dimension: `768`
- Training objective: `MultipleNegativesRankingLoss`

Characteristics:
- English-only retrieval model
- Optimized for scripture-like language and doctrinal search
- Designed to work together with lexical search and graph-based retrieval
- Produces dense vector embeddings, not text completions

Training data:
- Fine-tuned on curated English scripture training pairs
- Training pairs include translation/paraphrase pairs, topical guide topic-to-verse pairs, triple-index topic-to-verse pairs, cross-reference pairs, adjacent verse pairs, same-topic verse pairs, and verse-summary/commentary grounding pairs

Evaluation:
- Internal smoke tests showed related theological pairs scoring higher than unrelated pairs
- The model has been evaluated primarily for retrieval usefulness inside the scicp search pipeline
- A full benchmark suite with ranking metrics is planned but was not complete at time of upload

## Usage

This model can be used anywhere sentence embeddings are needed for scripture retrieval or semantic similarity.

Typical inputs:
- `str`
- `list[str]`

Typical outputs:
- single input: vector of shape `(768,)`
- batch input: matrix of shape `(batch_size, 768)`

Example usage:

```python
from sentence_transformers import SentenceTransformer
from sentence_transformers.util import cos_sim

model = SentenceTransformer("path/to/this/model")

query = "for behold my work and my glory"
verse = "For behold, this is my work and my glory—to bring to pass the immortality and eternal life of man."

query_emb = model.encode(query, normalize_embeddings=True)
verse_emb = model.encode(verse, normalize_embeddings=True)

score = cos_sim(query_emb, verse_emb).item()
print("cosine similarity:", score)
```

Batch usage:

```python
from sentence_transformers import SentenceTransformer

model = SentenceTransformer("path/to/this/model")

texts = [
    "faith without works is dead",
    "true belief requires action",
    "the dimensions of Noah's ark",
]

embeddings = model.encode(
    texts,
    normalize_embeddings=True,
    convert_to_numpy=True,
)

print(embeddings.shape)  # (3, 768)
```

Known and preventable failures:
- It may over-associate broad devotional language if used without lexical grounding.
- It is not reliable as a standalone doctrinal interpreter.
- It can return semantically nearby but contextually wrong verses if retrieval is based only on embedding similarity.
- Best practice is to combine it with exact reference handling, lexical retrieval, graph signals, and calibrated reranking.

## System

This is not intended to be a standalone end-user answer model. It is part of a retrieval system.

System role:
- encodes queries into embedding vectors
- encodes verses, concepts, and entities into the same vector space
- supports ANN search, semantic candidate generation, reranking, and concept expansion

Input requirements:
- English text
- ideally normalized scripture queries, concepts, or verse text
- best results when inputs are sentence-like or short paragraph-like text spans

Downstream dependencies:
- vector search index or ANN index
- lexical retrieval layer for exact grounding
- optional graph propagation or reranking layers
- optional calibration layer for relevance probability

In scicp, the model is used together with:
- exact reference parsing
- FTS-based lexical retrieval
- semantic nearest-neighbor search
- graph-derived search features
- final calibrated ranking

## Implementation requirements

Training hardware and software:
- trained in Kaggle notebook environment
- framework: `sentence-transformers`
- backend: PyTorch
- accelerator: GPU-enabled Kaggle environment
- typical dependency stack: `sentence-transformers`, `datasets`, `accelerate`, `torch`

Training compute:
- single-GPU notebook training configuration
- exact runtime depends on GPU type, training profile, and dataset size
- measured wall-clock time was on the order of tens of minutes for smaller models and longer for larger variants

Inference compute:
- runs on CPU or GPU
- CPU inference is practical for single-query encoding and moderate batch sizes
- GPU is recommended for rebaking large corpora or high-throughput search services

Energy consumption:
- not measured

# Model Characteristics

## Model initialization

This model was fine-tuned from a pre-trained encoder, not trained from scratch.

Base initialization:
- `BAAI/bge-base-en-v1.5`

Fine-tuning method:
- sentence embedding fine-tuning using paired retrieval data
- mean pooling used for embedding extraction

## Model stats

Approximate stats:
- hidden embedding output: `768`
- transformer encoder family: BGE-base
- parameter count: approximately base-model scale for BGE-base
- output type: dense float embedding vector

Latency:
- depends on hardware, batch size, and sequence length
- suitable for offline corpus rebaking and online query encoding
- not intended for low-resource mobile on-device inference without additional optimization

## Other details

Pruning:
- not pruned

Quantization:
- not quantized in this release

Differential privacy:
- no differential privacy techniques were applied

# Data Overview

## Training data

The training set was built from English scripture-centered retrieval pairs designed to teach semantic closeness, doctrinal relatedness, and paraphrase invariance.

Sources included:
- verse-to-verse translation/paraphrase pairs
- topical guide topic-to-verse mappings
- triple-index topic-to-verse mappings
- cross-reference-linked verses
- adjacent verse continuity pairs
- same-topic verse pairs
- verse commentary / summary to verse grounding pairs

Collection and preprocessing:
- data was collected from project-local scripture databases and prebaked search resources
- text was normalized and filtered for use as training pairs
- non-English data was intentionally excluded from this model version
- the training objective expects paired positive examples rather than labels for text generation or classification

## Demographic groups

This is a domain-specific scripture retrieval model, not a demographic profiling model.

Relevant population or subgroup considerations:
- language domain: English
- textual domain: scripture and scripture-adjacent commentary
- theological domain: Christian and LDS scripture-related corpora used by the application

No personal demographic attributes were intentionally modeled.

## Evaluation data

Evaluation was primarily based on retrieval-oriented smoke tests and local search validation inside the application.

Split information:
- a train / validation split was used during fine-tuning
- a larger external benchmark with formal test-set reporting was not finalized at upload time

Differences between train and evaluation:
- training uses curated positive pairs
- evaluation focuses on semantic similarity sanity checks and downstream search behavior

# Evaluation Results

## Summary

Current evaluation is best described as retrieval-oriented internal validation rather than a full published benchmark.

Observed behavior:
- semantically related theological pairs scored above clearly unrelated pairs
- the model was strong enough to proceed into downstream prebake evaluation inside the scicp search stack
- final usefulness depends on the full retrieval system, not embedding quality alone

At time of release:
- no full public benchmark table with NDCG, MRR, or Recall@k is included
- no standalone classification or generation evaluation is applicable

## Subgroup evaluation results

No formal subgroup evaluation was completed.

Known practical subgroup boundaries:
- works best on English scripture-style language
- may underperform on modern colloquial phrasing if not semantically close to training patterns
- may underperform on non-English queries
- may confuse broad devotional language when lexical grounding is absent

Known and preventable failures:
- semantically broad but vague inputs can retrieve spiritually adjacent rather than contextually exact verses
- best mitigation is hybrid retrieval: lexical + semantic + graph + calibrated reranking

## Fairness

This model is for scripture retrieval, not demographic decision-making.

Fairness was considered mainly in terms of:
- avoiding misleading overclaiming
- avoiding use as a doctrinal authority engine
- avoiding unsupported interpretation or generation claims

No formal fairness benchmark across demographic groups was performed because the model is not intended for demographic classification or allocation tasks.

## Usage limitations

Sensitive use cases:
- doctrinal interpretation
- pastoral counseling
- religious advice
- authoritative teaching without source verification

Limitations:
- not a generative theology model
- not a fact-verification engine
- not a replacement for lexical retrieval on exact references
- not suitable as the only ranking signal in a production scripture search engine

Recommended conditions for use:
- combine with exact reference parsing
- combine with lexical full-text retrieval
- use semantic similarity as one signal among several
- validate results against downstream retrieval metrics before deployment changes

## Ethics

Ethical considerations included:
- limiting claims to retrieval and similarity
- not presenting the model as an authoritative interpreter of scripture
- keeping retrieval grounded in source text rather than only latent semantic similarity
- recognizing the possibility of semantically plausible but doctrinally incorrect retrievals

Identified risks:
- over-retrieval of famous or broadly devotional passages
- semantically plausible but contextually wrong verse matches
- misuse as a standalone theological judgment system

Mitigations:
- use inside a hybrid retrieval pipeline
- maintain lexical grounding
- use calibrated reranking and cutoffs
- continue benchmark-driven validation before production promotion