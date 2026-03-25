# Prebake Scripts

These scripts precompute mathematical features stored in the SQLite databases. Run them from the project root.

## Prerequisites

```bash
npm install  # from project root
```

## Scripts

| Script | Purpose | Input DB | Output |
|--------|---------|----------|--------|
| `compute-embeddings.js` | Generate MiniLM-L6 verse embeddings | `lds-scriptures-sqlite.db` | `verse-embeddings.db` |
| `prebake-knn.js` | Build k-nearest-neighbor verse graph | `verse-embeddings.db` | `search-graph.db` |
| `prebake-svd.js` | Truncated SVD for dimensionality reduction | `verse-embeddings.db` | `verse-embeddings.db` |
| `prebake-whitening.js` | ZCA whitening of embeddings | `verse-embeddings.db` | `verse-embeddings.db` |
| `prebake-spectral.js` | Spectral graph features (Lanczos) | `search-graph.db` | `search-graph.db` |
| `export-training-pairs.js` | Export training data for evaluation | `search-graph.db` | stdout/file |
| `calibrate-rrf-k.js` | Calibrate RRF k parameter | training pairs | stdout |

## Execution Order

For a fresh setup, run in this order:

```bash
node scripts/compute-embeddings.js     # ~15 min (downloads model on first run)
node scripts/prebake-knn.js            # ~5 min
node scripts/prebake-svd.js            # ~2 min
node scripts/prebake-whitening.js      # ~1 min
node scripts/prebake-spectral.js       # ~3 min
```

## Notes

- All scripts use `better-sqlite3` and run synchronously
- Large DB files are tracked with Git LFS
- Scripts are idempotent — safe to re-run (they DROP and recreate tables)
