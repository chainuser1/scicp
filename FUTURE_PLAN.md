# Future Search Enhancement Roadmap

This document outlines planned improvements to the Scriptures in View search pipeline, ranked by effort and expected impact.

## Current Status (v2.1-audit)

- **Test coverage**: 157 backend / 23 shared / 37 frontend tests passing
- **Search benchmark**: 100% exact-reference accuracy, 100% phrase-fragment top3
- **Search pipeline**: Bias-free retrieval with specificity-first ranking
- **Infrastructure ready**: Adam-optimized intent weights, search feedback collection, ONNX Runtime pipeline

---

## Tier 1: Immediate Implementation (Days)

### 1. Presenter Selection as LTR Signal

**Change:** Use presenter verse selections as explicit relevance judgments instead of dwell time regression.

**Implementation:**
- Add `source: 'presenter'` to search_feedback when presenter selects a verse
- Convert to pairwise preference training: (selected > alternatives shown)
- Keep existing Adam infrastructure - no architectural changes needed

**Expected gain:** Measurable improvement on ambiguous/situational queries. Zero regression on exact-reference/phrase queries.

---

## Tier 2: Significant Upgrades (Weeks each)

### 2. Cross-Encoder Reranking

**Current limitation:** Bi-encoder scores query and verse independently via cosine similarity. Misses subtle interactions.

**Solution:** Retrieval-then-rerank pattern
- HNSW retrieves top-50 candidates (fast, ~10ms)
- Cross-encoder rescoring (50 pairs, ~50ms additional)
- Return top-10 reranked results

**Implementation location:** `backend/index.js` after MMR reranking (~line 3043)

```javascript
// Pseudo-code for integration point
if (crossEncoderSession && results.length >= 10) {
  const topCandidates = results.slice(0, 50);
  const ceWeight = confidence < 0.7 ? 0.4 : 0.25;
  // Score each pair jointly, blend with specificity score
  results = results.map(r => blendScores(r, ceScore, ceWeight))
    .sort((a, b) => (b._specificity_score || 0) - (a._specificity_score || 0));
}
```

**Model requirements:** BGE-M3 cross-encoder variant or dedicated cross-encoder ONNX model

### 3. HyDE (Hypothetical Document Embeddings)

**Use case:** Short, ambiguous queries ("faith", "hope", "comfort") lack semantic anchor in embedding space.

**Solution:** Generate synthetic "ideal verse" then embed.

**Trigger conditions:**
- Intent class: situational or conceptual
- Query length ≤ 3 tokens
- HNSW top-1 confidence < SEM_THRESHOLD_BASE (0.28)

**Implementation:**
- Leverage existing Claude API access via NexaraOS infrastructure
- Constrained prompt: "A verse about {query} with theological depth"
- Embed generated text → HNSW search

**Latency management:** Only run on low-confidence queries

### 4. BGE-M3 Multi-Vector Activation

**Opportunity:** Trained `scripture-m3-model-v1` on Kaggle already exists.

**Advantages:**
- ColBERT token-level late interaction scoring
- Captures "spirit and the flesh" relationship better than single-vector cosine
- Sparse + dense + token vectors

**Work required:**
- Prebake: generate token vectors for all 41,995 verses
- Storage: Extend verse-embeddings.db schema for token vectors
- Index: ColBERT MaxSim index (or PLAID approximation)
- Activate: A/B test against current Nomic-BERT 768D model

---

## Tier 3: Advanced Features (Months)

### 5. Sinkhorn → Full Optimal Transport Reranking

**Extension:** Current Sinkhorn WMD for phrase alignment → full Earth Mover's Distance.

**Benefits:** Beyond commercial search engines - fine-grained token distribution matching.

**Dependency:** BGE-M3 activation (Tier 4)

### 6. Emergent Theological Concept Graph

**Current:** Curated topical guide (3,512 topics)

**Next-level:** Dynamic concept graph from co-occurrence + embedding geometry.

**Implementation:**
- Cluster verses by learned similarity landscape
- Update cluster memberships as Adam weights shift
- Independent of curated theological assumptions

---

## Bias-Controlled LTR Design (Setup B)

### Features (pipeline-intrinsic only):
- Tier confidence score
- RRF fusion score  
- Phrase coverage ratio
- HNSW cosine similarity
- Specificity score
- Semantic gap distance

### Labels:
- **Primary:** Presenter selections → pairwise preferences (A > shown but not selected)
- **Secondary:** Z-score normalized dwell time (minimum 5 observations per query)

### Debiasing:
- **Inverse propensity scoring** for popularity:
  `weight(verse) = 1 / P(verse selected | position, popularity)`
- Preserve signal from popular verses while correcting for exposure bias

### Model choice:
- LambdaMART (50-100 trees) for small data volumes
- Neural ranker only after collecting 10K+ judgment pairs

---

## Decision Points

1. **Cross-encoder scope:** All queries vs. confidence-threshold triggered?
2. **Model architecture:** Use BGE-M3 cross-encoder mode or dedicated cross-encoder?
3. **Vector strategy:** Replace Nomic-BERT or run both in parallel (ensemble)?

Priority recommendation: Tier 1 (presenter signal) → Tier 2 #2 (cross-encoder) for maximum immediate quality impact.