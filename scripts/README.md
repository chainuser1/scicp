# Prebake Scripts

These scripts precompute mathematical features stored in the SQLite databases. Run them from the project root.

## Prerequisites

```bash
npm install  # from project root
```

## Scripts

| Script | Purpose | Input DB | Output |
|--------|---------|----------|--------|
| `compute-embeddings.js` | Generate baseline MiniLM-L6 verse embeddings | `lds-scriptures-sqlite.db` | `verse-embeddings.db` | ✅ Active |
| `rebake-embeddings.py` | Re-encode verses using fine-tuned model | `resources/models/scripture-minilm` + `lds-scriptures-sqlite.db` | `verse-embeddings.db` | ✅ Active |
| `prebake-knn.js` | Build k-nearest-neighbor verse graph | `verse-embeddings.db` | `verse-graph.db` | ✅ Active |
| `prebake-svd.js` | Truncated SVD for dimensionality reduction | `verse-embeddings.db` | `verse-embeddings.db` | ✅ Active |
| `prebake-whitening.js` | **DEPRECATED** (ZCA whitening disabled v2.0) | — | — | ❌ Disabled |
| `prebake-spectral.js` | Spectral graph features (Lanczos) | `verse-graph.db` | `verse-graph.db` | ✅ Active |
| `prebake-clusters.js` | Build k-means verse clusters | `verse-embeddings.db` | `verse-graph.db` | ✅ Active |
| `prebake-cluster-labels.js` | Generate representative labels per cluster | `verse-embeddings.db` + `verse-graph.db` | `verse-graph.db` | ✅ Active |
| `prebake-entity-centroids.js` | Build entity centroid embeddings | `verse-embeddings.db` + `verse-tags.db` | `verse-tags.db` | ✅ Active |
| `prebake-hnsw.js` | Build ANN index from raw embeddings (v2.0+) | `verse-embeddings.db` | `verse-embeddings.db` | ✅ Active |
| `prebake-search-graph.js` | Bundle graph/search tables for runtime packaging | `verse-graph.db` + other DBs | `search-graph.db` | ✅ Active |
| `export-training-pairs.js` | Export training data for fine-tuning/evaluation, including modern-English translation pairs (YLT + NRSVUE) | `verse-graph.db` + other DBs | stdout/file | ✅ Active |
| `calibrate-rrf-k.js` | Calibrate RRF k parameter | training pairs | stdout | ✅ Active |
| `post-train-rebuild.sh` | One-command post-training rebuild pipeline | model zip + project DBs | refreshed semantic artifacts | ✅ Active |

## Execution Order

For a fresh baseline setup, run in this order (note: whitening disabled v2.0):

```bash
node scripts/compute-embeddings.js     # ~15 min (downloads model on first run)
node scripts/prebake-knn.js            # ~5 min
node scripts/prebake-svd.js            # ~2 min
# prebake-whitening.js is DISABLED — ZCA whitening was inverting similarity rankings
node scripts/prebake-spectral.js       # ~3 min

For post-training updates (after a new `scripture-minilm.zip`), run:

```bash
scripts/post-train-rebuild.sh
# or pass a custom zip path:
scripts/post-train-rebuild.sh /path/to/scripture-minilm.zip

This wrapper currently refreshes the fine-tuned model, concept index, verse embeddings,
SVD, kNN graph, spectral features, clusters, cluster labels, entity centroids, HNSW, and
the packaged search graph bundle. Whitening is intentionally skipped because it remains
disabled in search v2.0.
```

## Notes

- All scripts use `better-sqlite3` and run synchronously
- Large DB files are tracked with Git LFS
- Scripts are idempotent — safe to re-run (they DROP and recreate tables)
- Latest training corpus includes restored modern-English pairs from YLT and NRSVUE
