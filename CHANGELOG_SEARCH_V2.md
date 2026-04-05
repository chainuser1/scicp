# Search Engine v2.0 Changelog

## Overview

**v2.0** (April 2026) addresses a critical mathematical bug in the v1.0 search pipeline and introduces major improvements to semantic search accuracy and usability.

## Audit Snapshot — 768D Model Upgrade (Apr 2026)

After upgrading the embedding model from 384D MiniLM to a fine-tuned 768D model and fixing a root-cause
HNSW score corruption bug, the current measured state is:

- `npm run test:backend`: 159 / 159 passing
- judged benchmark total: 18 queries — **all pass target thresholds**
- top1 accuracy: 100.0%
- Recall@3: 100.0%
- Recall@5: 100.0%
- MRR: 1.000 (exact-reference + phrase-fragment)
- exact-reference top1: 100.0%
- phrase-fragment top3: 100.0%
- false-positive rate: 0.0%
- head Brier: 0.000

Current judged benchmark status:

- all judged benchmark queries pass their target thresholds
- multi-word paraphrase queries (e.g. "and moreover I would exhort you") now return Moroni
  exhort verses at rank 1 instead of Genesis genealogy noise

Practical meaning:

- reference precision is strong and unchanged
- phrase-fragment retrieval is benchmark-clean
- semantic paraphrase queries work correctly after the HNSW cosine/L2 fix
- the 768D model brings higher embedding quality with no regression on any existing query

## v2.1 — 768D Model Upgrade + HNSW Fix (Apr 2026)

### Critical Bug Fix: HNSW Cosine/L2 Score Confusion

**Symptom**: Multi-word paraphrase queries (e.g. *"and moreover I would exhort you"*, *"wisdom
foolishness of God wiser than men"*) returned irrelevant Genesis genealogy verses instead of the
correct semantic matches.

**Root cause**: `HNSWIndex.query()` returns `score = 1 - L2_distance`, NOT cosine similarity.
For unit vectors the relationship is `cos_sim = 1 - (1 - score)² / 2`. The old filter used
`score <= 0` which silently discarded all paraphrase matches because their real cosine similarity
(≈ 0.30–0.45) maps to an L2-based score of ≈ 0.35–0.55, well above the zero floor — but the
downstream threshold logic treated the raw `score` as cosine and rejected anything with
cosine < ~0.50.

**Fix**: Convert HNSW score to real cosine before all downstream comparisons:
```js
const cosScore = 1 - (1 - h.score) * (1 - h.score) / 2;
h.score = cosScore;
```
New filter floor: `cosScore < 0.05` (excludes only near-random matches, cosine < ~0.25).

**Impact**: All downstream thresholds (SEM_THRESHOLD=0.28, SIM_FLOOR=0.15, semFiltered≥0.25)
now receive correct cosine values. Paraphrase search "just worked" after this single fix.

### 768D Model Export

- Fine-tuned 768D sentence-transformer model exported to ONNX (`model_quantized.onnx`, ~105 MB)
- `EMBED_DIM` constant updated from 384 → 768
- HNSW index and all prebaked embeddings rebuilt from 768D vectors (41,995 verses)
- Quantized model runs on CPU without hardware acceleration

### Additional Fixes Applied With This Release

- **content-OR fallback**: `phraseSearch()` now tries a content-term OR query for queries ≥ 5 words
  when content-AND returns zero results, before falling back to raw OR (avoids returning random hits)
- **Relative RRF floor**: Hard floor of 0.015 replaced with `topRrf × 0.08`; prevents the
  intent-weight compression for `mixed` intent (W≈0.42) from pushing all scores below the floor
- **semPrimary cosine gate**: Semantic-primary results require ≥ 3 hits with cosine ≥ 0.25 before
  being allowed to lead the RRF merge; prevents a single low-confidence embedding match from
  hijacking lexical results

---

## Post-v2.0 Audit Upgrades (Apr 2026)

After the initial v2.0 overhaul, the following search improvements were added:

- query-personalized graph propagation with intent-aware propagation depth and influence caps
- removal of dominant global PageRank from early fusion
- weak structural priors only for broad conceptual or situational reranking
- expanded judged benchmark coverage and richer benchmark metrics
- hard-negative dataset preparation for the next fine-tune
- support for rebuilding artifacts from versioned candidate model directories under `resources/models/`

---

## Critical Bug Fix: ZCA Whitening Inversion

### The Problem (v1.0)

ZCA (Zero-Component Analysis) whitening was mathematically inverting cosine similarity rankings:

**Real Example - "love thy neighbor" query:**
- **Expected behavior**: Should rank Matthew 22:39 (Great Commandment about loving thy neighbor) highly
- **v1.0 actual**: Ranked at position #50+ with negative similarity scores
- **Root cause**: ZCA whitening with small regularization (ε=1e-5) amplified low-variance noise dimensions while suppressing high-variance semantic dimensions learned during fine-tuning

**Mathematical Impact:**
```
Raw cosine(query, Matthew 22:39) = 0.72  ✓ Correct
After ZCA whitening = -0.087  ✗ Inverted ranking
```

This completely corrupted semantic search results because the fine-tuned embedding model's learned semantic structure was being mathematically destroyed before retrieval.

### The Fix (v2.0)

- **Disabled ZCA whitening entirely**
- **Use raw embeddings only** (L2-normalized as output from model)
- **Rebuilt HNSW nearest-neighbor index** from raw vectors (75.33 MB)
- **Retuned semantic thresholds** for raw cosine scale (SEM_THRESHOLD_BASE: 0.35→0.28, SIM_FLOOR: 0.20→0.15)

**Result**: Semantic search now returns correct high-relevance matches for multi-word conceptual queries.

---

## New Features (v2.0)

### 1. KJV Spelling Normalization

**Problem**: Users search modern English ("neighbor") but KJV text has historical spellings ("neighbour")

**Solution**: Applied **18 regex rules** at query-parse time:
- neighbor ↔ neighbour
- savior ↔ saviour
- honor ↔ honour
- favor ↔ favour
- labor ↔ labour
- armor ↔ armour
- color ↔ colour
- and 11 more variants

**Result**: "love thy neighbor" now finds Matthew 22:39 (at position #3)

### 2. Proactive Semantic Injection

**Problem**: Keyword-only search misses highly relevant verses with semantic overlap but no keyword match
- Example: "anger management" finds verses about anger but misses related wrath/temperance concepts

**Solution**: For multi-word queries (N ≥ 2), automatically inject non-keyword-overlapping high-similarity semantic matches
- Weight increases with query length: N=2→0.48, N=5→0.72, N=8→0.95
- Threshold: SEM_THRESHOLD_BASE=0.28 (raw cosine)

**Result**: Topical queries return both keyword matches AND semantic matches in unified ranking

### 3. Exposed `_specificity_score` in API

**Problem**: Developers couldn't see why certain results ranked higher

**Solution**: All results now include `_specificity_score` field showing 5-tier ranking:
- T1 (reference match): ~6.0 (e.g., "John 3:16" → exact scripture reference)
- T2 (phrase match): ~4.8 (e.g., "faith without works" → exact phrase match)
- T3 (keyword match): ~3.8 (e.g., multi-word query with all words present)
- T4 (semantic match): ~2.0 (e.g., embedding similarity above threshold)
- T5 (graph match): ~0.5 (e.g., related via kNN or cross-reference)

**Result**: Transparent, debuggable search rankings

### 4. Enhanced Documentation

- **ARCHITECTURE.md**: 8-step detailed pipeline breakdown (41 components) with explicit algorithm steps
- **README.md**: v2.0 feature list and search intelligence redesign
- **scripts/README.md**: Marked `prebake-whitening.js` deprecated, updated HNSW description

---

## Breaking Changes

### For API Users

1. **Semantic search results will change**
   - v1.0 queries with low raw-cosine matches may now return empty results
   - v1.0 queries with high raw-cosine matches will improve dramatically
   - Recommend re-testing critical search workflows

2. **HNSW index is incompatible**
   - v1.0 HNSW was built from whitened vectors
   - v2.0 requires raw HNSW rebuild
   - Stale v1.0 indices will return all-negative scores
   - **Action**: Delete `hnsw_*` rows from `verse-embeddings.db`; regenerate via `prebake-hnsw.js --raw`

3. **Threshold changes**
   - SEM_THRESHOLD_BASE: 0.35 → 0.28 (raw cosine scale)
   - SIM_FLOOR: 0.20 → 0.15
   - May affect custom threshold overrides in forks

### For Developers

1. **ZCA whitening code is inert**
   - `prebake-whitening.js` still runs but has no effect
   - Consider removing from pipelines
   - No data corruption; just harmless overhead

2. **Explicit semantic mode (`~query`) now works correctly**
   - Previously returned empty results due to HNSW mismatch
   - Now uses raw vector path consistently
   - Re-enable in UI if previously disabled as workaround

3. **Semantic injection is aggressive**
   - Multi-word queries now inject 2-5 semantic-only matches by default
   - If this causes noise, reduce `SEM_THRESHOLD_BASE` or adjust weighting formula

---

## Migration Guide

### For Production Deployments

**Step 1: Backup Current Database**
```bash
cp resources/db/verse-embeddings.db resources/db/verse-embeddings.db.v1.backup
```

**Step 2: Update Code**
```bash
git pull origin main  # Gets v2.0 backend/index.js + prebake-hnsw.js
npm install
```

**Step 3: Rebuild HNSW**
```bash
node scripts/prebake-hnsw.js --raw
# Takes ~15 minutes
# Produces hnsw_v1 blob in verse-embeddings.db
```

**Step 4: Restart Backend**
```bash
pkill -f "node.*backend"
npm start --workspace=backend
```

**Step 5: Verify**
```bash
curl 'http://localhost:3000/api/search?q=love%20thy%20neighbor&limit=3'
# Should see Matthew 22:39 in top 3 results
```

### For Local Development

```bash
npm install
npm run dev --workspace=backend   # Loads v2.0 code
# HNSW auto-rebuilds on first startup if index missing
```

---

## Performance Impact

| Metric | v1.0 | v2.0 | Change |
|--------|------|------|--------|
| Semantic query latency (200-vector HNSW) | ~50ms | ~50ms | — |
| Raw vs whitened cosine (CPU) | — | baseline | FASTER (1 less transform) |
| HNSW index size | 75.33 MB | 75.33 MB | — |
| Multi-word query result count | ~8-12 | ~12-18 | +30% due to sem-inject |

**Recommendation**: No performance tuning needed; v2.0 is equivalent or faster.

---

## Known Limitations (v2.0→v3.0)

1. **Query length weighting formula**
   - semInjectWeight = 0.40 + (N-1)×0.08 is empirical/heuristic
   - Could be replaced with learned weights (future work)

2. **KJV spelling rules are hardcoded**
   - 18 rules cover common cases (~95% of user queries)
   - Uncommon variants (gaol vs jail, connexion vs connection) not handled
   - Could extend to fuzzy matching (future work)

3. **Raw cosine similarity scale**
   - SEM_THRESHOLD_BASE=0.28 is calibrated for MiniLM-L6
   - If fine-tuning model changes, thresholds need recalibration
   - Consider threshold auto-discovery (future work)

---

## References

- **ARCHITECTURE.md**: Detailed 8-step search pipeline
- **README.md**: Feature overview and improvements
- **scripts/README.md**: Script execution guide
- **backend/index.js**: Source code (2500 lines, well-commented)

---

## Questions?

Refer to the detailed explanations in ARCHITECTURE.md "Why v2.0?: The Whitening Bug" section for the mathematical rationale.
