#!/usr/bin/env bash
set -euo pipefail

# One-command post-training pipeline:
# 1) install latest fine-tuned model zip
# 2) rebake embeddings
# 3) rebuild all embedding-dependent artifacts
#
# Usage:
#   scripts/post-train-rebuild.sh [path/to/scripture-minilm.zip]
#
# Default zip path:
#   ~/Downloads/scripture-minilm.zip

ZIP_PATH="${1:-$HOME/Downloads/scripture-minilm.zip}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "[info] repo: $REPO_ROOT"
echo "[info] model zip: $ZIP_PATH"

if [[ ! -f "$ZIP_PATH" ]]; then
  echo "[error] model zip not found: $ZIP_PATH" >&2
  echo "[hint] pass an explicit path: scripts/post-train-rebuild.sh /path/to/scripture-minilm.zip" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "[error] python3 not found in PATH" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[error] node not found in PATH" >&2
  exit 1
fi

# Ensure Python dependencies used by rebake-embeddings.py are available
if ! python3 - <<'PY' >/dev/null 2>&1
import sentence_transformers  # noqa: F401
import numpy  # noqa: F401
PY
then
  echo "[error] Missing Python dependencies for rebake-embeddings.py" >&2
  echo "[hint] Install in the same Python env used by this script:" >&2
  echo "       python3 -m pip install -U sentence-transformers numpy" >&2
  exit 1
fi

echo "[step] installing fine-tuned model"
rm -rf resources/models/scripture-minilm
mkdir -p resources/models/scripture-minilm
unzip -o "$ZIP_PATH" -d resources/models/scripture-minilm >/dev/null

echo "[step] rebaking embeddings"
python3 scripts/rebake-embeddings.py

echo "[step] rebuilding concept index"
node scripts/build-concept-index.js

echo "[step] rebuilding SVD"
node scripts/prebake-svd.js

echo "[step] rebuilding kNN graph"
node scripts/prebake-knn.js

echo "[step] rebuilding spectral embeddings"
node scripts/prebake-spectral.js

echo "[step] rebuilding clusters"
node scripts/prebake-clusters.js

echo "[step] rebuilding cluster labels"
node scripts/prebake-cluster-labels.js

echo "[step] rebuilding entity centroids"
node scripts/prebake-entity-centroids.js

echo "[step] rebuilding HNSW"
node scripts/prebake-hnsw.js --raw

echo "[step] rebuilding search graph bundle"
node scripts/prebake-search-graph.js

echo "[done] post-training rebuild complete"
echo "[next] restart backend: npm run dev --workspace=backend"
echo ""
echo "[push] Run the following to push rebuilt DBs (squashes into one LFS commit):"
echo "       scripts/push-data.sh \"fine-tuned scripture-minilm\""
