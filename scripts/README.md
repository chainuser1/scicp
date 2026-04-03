# Prebake Scripts

These scripts precompute mathematical features stored in the SQLite databases. Run them from the project root.

## Prerequisites

```bash
npm install  # from project root
```

## Scripts

| Script | Purpose | Input DB | Output |
|--------|---------|----------|--------|
| `compute-embeddings.js` | Generate baseline MiniLM-L6 verse embeddings | `lds-scriptures-sqlite.db` | `verse-embeddings.db` |
| `rebake-embeddings.py` | Re-encode verses using fine-tuned model | `resources/models/scripture-minilm` + `lds-scriptures-sqlite.db` | `verse-embeddings.db` |
| `prebake-knn.js` | Build k-nearest-neighbor verse graph | `verse-embeddings.db` | `verse-graph.db` |
| `prebake-svd.js` | Truncated SVD for dimensionality reduction | `verse-embeddings.db` | `verse-embeddings.db` |
| `prebake-whitening.js` | ZCA whitening of embeddings | `verse-embeddings.db` | `verse-embeddings.db` |
| `prebake-spectral.js` | Spectral graph features (Lanczos) | `verse-graph.db` | `verse-graph.db` |
| `prebake-clusters.js` | Build k-means verse clusters | `verse-embeddings.db` | `verse-graph.db` |
| `prebake-cluster-labels.js` | Generate representative labels per cluster | `verse-embeddings.db` + `verse-graph.db` | `verse-graph.db` |
| `prebake-entity-centroids.js` | Build entity centroid embeddings | `verse-embeddings.db` + `verse-tags.db` | `verse-tags.db` |
| `prebake-hnsw.js` | Build ANN index for fast semantic retrieval | `verse-embeddings.db` | `verse-embeddings.db` |
| `prebake-search-graph.js` | Bundle graph/search tables for runtime/mobile | `verse-graph.db` + other DBs | `search-graph.db` |
| `export-training-pairs.js` | Export training data for fine-tuning/evaluation | `verse-graph.db` + other DBs | stdout/file |
| `calibrate-rrf-k.js` | Calibrate RRF k parameter | training pairs | stdout |
| `post-train-rebuild.sh` | One-command post-training rebuild pipeline | model zip + project DBs | refreshed semantic artifacts |

## Execution Order

For a fresh baseline setup, run in this order:

```bash
node scripts/compute-embeddings.js     # ~15 min (downloads model on first run)
node scripts/prebake-knn.js            # ~5 min
node scripts/prebake-svd.js            # ~2 min
node scripts/prebake-whitening.js      # ~1 min
node scripts/prebake-spectral.js       # ~3 min
```

For post-training updates (after a new `scripture-minilm.zip`), run:

```bash
scripts/post-train-rebuild.sh
# or pass a custom zip path:
scripts/post-train-rebuild.sh /path/to/scripture-minilm.zip
```

## Notes

- All scripts use `better-sqlite3` and run synchronously
- Large DB files are tracked with Git LFS
- Scripts are idempotent — safe to re-run (they DROP and recreate tables)
- Latest training corpus is approximately 460,979 pairs (~461k)
