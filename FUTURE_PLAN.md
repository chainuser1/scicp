# Future Search Enhancement Roadmap

This document outlines planned improvements to the Scriptures in View search pipeline. Items marked (✅ Implemented) already exist in the codebase.

## Current Status (v2.1-audit)

- **Test coverage**: 157 backend / 23 shared / 37 frontend tests passing
- **Search benchmark**: 100% exact-reference accuracy, 100% phrase-fragment top3
- **Search pipeline**: Bias-free retrieval with specificity-first ranking
- **Infrastructure ready**: Adam-optimized intent weights, search feedback collection, ONNX Runtime pipeline

---

## Implemented Features (Confirmed in `backend/index.js`)

### ✅ Presenter Selection Ready for LTR Signal

The `/search-feedback` endpoint exists and collects:
- `query`, `verse_id`, `rank_shown`, `source`, `intent` (lines 558-580)
- Adam optimizer updates `learnedWeights` and `intentWeights` (lines 1028-1034)
- **Missing**: `source='presenter'` marker for explicit relevance judgments

### ✅ Co-occurrence Penalty

Implemented in `getCooccurrenceWeight()` (lines 1605-1630):
- Pure statistical signal: observed term co-occurrence / total combinations
- Applied to `ftsRanked` (lines 2553-2566) and `phraseRanked` (lines 2603-2614)
- No assumptions about theological meaning

### ✅ Chamfer Distance / Sinkhorn WMD

Token-level phrase matching in `backend/index.js` (lines 1340-1390) and `backend/phrase-matcher.js`:
- Chamfer distance for set similarity without order
- Ordered Earth Mover's Distance for order-preserving alignment
- Called inside `runSearchPipeline` for embedding-based phrase matches (lines 2933-2947)

### ✅ Query-Personalized PPR

`queryPPR()` function (lines 2187-2279):
- Intent-specific alpha (0.72-0.84), hops (1-2), seed limits
- PPR table available via `pprStmt` (lines 1498-1518)
- Uses `topic_ppr` table for query-topic semantic expansion

### ✅ Weak Structure Prior

`computeWeakStructurePrior()` (lines 2058-2069):
- Max 0.07 for conceptual queries, 0.05 for situational
- Blends PageRank (0.45), graph consensus (0.2), topical (0.15), PPR (0.12), spectral (0.08)
- Activated only when `shouldUseWeakStructurePrior()` returns true (lines 2052-2056)

### ✅ MMR Diversity Reranking

`mmrRerank()` function (lines 2110-2164):
- Lambda derived from entropy of similarity scores
- Balances relevance vs. redundancy

### ✅ Specificity Scoring

Tier assignment (lines 3135-3156):
- T1 (reference): early return, no tier computed
- T2 (phrase: 4.0 max), T3 (keyword: 3.0 max), T4 (semantic: 2.0 max), T5 (graph: 1.0 max)
- Calibration via PAV curves (`calibrateScore()`, lines 1065-1079)

---

## Needed Improvements

### 1. Presenter Selection as Explicit LTR Signal

**Change:** Add `source: 'presenter'` to search_feedback when presenter selects a verse via socket.

**Location:** `socket.on('update-verse')` (line 3715) should emit feedback with source='presenter'.

### 2. Cross-Encoder Reranking

**Current limitation:** Bi-encoder scores query and verse independently via cosine similarity.

**Solution:** Retrieval-then-rerank pattern
- HNSW retrieves top-50 candidates (fast, ~10ms)
- Cross-encoder rescoring (50 pairs, ~50ms additional)
- Return top-10 reranked results

**Implementation location:** After MMR reranking (~line 3043)

```javascript
// Integration point after MMR
if (crossEncoderSession && results.length >= 10) {
  const topCandidates = results.slice(0, 50);
  const ceWeight = confidence < 0.7 ? 0.4 : 0.25;
  results = results.map(r => ({
    ...r,
    _specificity_score: blendScores(r._specificity_score, ceScore(r), ceWeight)
  })).sort((a, b) => b._specificity_score - a._specificity_score);
}
```

### 3. HyDE (Hypothetical Document Embeddings)

**Use case:** Short, ambiguous queries ("faith", "hope") lack semantic anchor.

**Solution:** Generate synthetic "ideal verse" then embed.

**Trigger conditions:**
- Intent class: situational or conceptual
- Query length ≤ 3 tokens
- HNSW top-1 confidence < SEM_THRESHOLD_BASE (0.28)

**Implementation:** Add HyDE branch before phrase search expansion.

### 4. BGE-M3 Multi-Vector Activation

**Opportunity:** Trained `scripture-m3-model-v1` on Kaggle already exists.

**Advantages:**
- ColBERT token-level late interaction scoring
- Captures "spirit and the flesh" relationship better than single-vector cosine
- Sparse + dense + token vectors

**Work required:**
- Prebake: generate token vectors for all 41,995 verses
- Storage: Extend `verse-embeddings.db` schema
- Index: ColBERT MaxSim or PLAID approximation
- Activate: A/B test against current Nomic-BERT 768D model

---

## Advanced Features (Months Out)

### 5. Sinkhorn → Full Optimal Transport Reranking

Current Sinkhorn WMD (lines 1340-1390) → full Earth Mover's Distance.

Benefits: Beyond commercial search - fine-grained token distribution matching.

### 6. Dynamic Concept Graph

Current: Static curated topical guide (3,512 topics) in `topical_guide` table.

Next-level: Update cluster memberships as Adam weights shift.

---

## Bias-Controlled LTR Design (Setup B)

### Features (pipeline-intrinsic):
- Tier confidence score
- RRF fusion score
- Phrase coverage ratio
- HNSW cosine similarity
- Specificity score
- Semantic gap distance

### Labels:
- **Primary:** Presenter selections → pairwise preferences (selected > shown but not selected)
- **Secondary:** Z-score normalized dwell time (minimum 5 observations per query)

### Debiasing:
- **Inverse propensity scoring** for popularity via `search_feedback` frequency data

### Model choice:
- LambdaMART or neural ranker after collecting 10K+ judgment pairs