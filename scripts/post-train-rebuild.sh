#!/usr/bin/env bash
set -euo pipefail

# One-command post-training pipeline:
# 1) install latest fine-tuned model zip
# 2) rebake embeddings
# 3) rebuild all embedding-dependent artifacts
#
# Usage:
#   scripts/post-train-rebuild.sh [path/to/scripture-bge.zip]
#   scripts/post-train-rebuild.sh --zip /path/to/scripture-bge.zip --install-dir resources/models/scripture-bge-vNext
#   scripts/post-train-rebuild.sh --model-dir resources/models/scripture-bge-vNext --skip-install
#
# Default zip path:
#   ~/Downloads/scripture-bge.zip

ZIP_PATH="$HOME/Downloads/scripture-bge.zip"
INSTALL_DIR="resources/models/scripture-bge"
MODEL_DIR=""
SKIP_INSTALL=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --zip)
      ZIP_PATH="$2"
      shift 2
      ;;
    --install-dir)
      INSTALL_DIR="$2"
      shift 2
      ;;
    --model-dir)
      MODEL_DIR="$2"
      shift 2
      ;;
    --skip-install)
      SKIP_INSTALL=1
      shift
      ;;
    -h|--help)
      cat <<'EOF'
Usage:
  scripts/post-train-rebuild.sh [path/to/scripture-bge.zip]
  scripts/post-train-rebuild.sh --zip /path/to/scripture-bge.zip --install-dir resources/models/scripture-bge-vNext
  scripts/post-train-rebuild.sh --model-dir resources/models/scripture-bge-vNext --skip-install

Options:
  --zip PATH          Zip artifact to install. Defaults to ~/Downloads/scripture-bge.zip.
  --install-dir PATH  Model install destination inside or outside the repo.
  --model-dir PATH    Model directory to use for rebake/rebuild. Defaults to install dir.
  --skip-install      Reuse an already unpacked model directory.
EOF
      exit 0
      ;;
    *)
      if [[ "$1" == -* ]]; then
        echo "[error] unknown option: $1" >&2
        exit 1
      fi
      ZIP_PATH="$1"
      shift
      ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

resolve_path() {
  local raw="$1"
  if [[ "$raw" = /* ]]; then
    printf '%s\n' "$raw"
  else
    printf '%s\n' "$REPO_ROOT/$raw"
  fi
}

INSTALL_DIR_ABS="$(resolve_path "$INSTALL_DIR")"
MODEL_DIR_ABS="${MODEL_DIR:+$(resolve_path "$MODEL_DIR")}" 
if [[ -z "$MODEL_DIR_ABS" ]]; then
  MODEL_DIR_ABS="$INSTALL_DIR_ABS"
fi

echo "[info] repo: $REPO_ROOT"
echo "[info] model zip: $ZIP_PATH"
echo "[info] install dir: $INSTALL_DIR_ABS"
echo "[info] rebuild model dir: $MODEL_DIR_ABS"

if [[ "$SKIP_INSTALL" -eq 0 ]]; then
  if [[ ! -f "$ZIP_PATH" ]]; then
    echo "[error] model zip not found: $ZIP_PATH" >&2
    echo "[hint] pass an explicit path: scripts/post-train-rebuild.sh /path/to/scripture-bge.zip" >&2
    exit 1
  fi
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

if [[ "$SKIP_INSTALL" -eq 0 ]]; then
  echo "[step] installing fine-tuned model"
  rm -rf "$INSTALL_DIR_ABS"
  mkdir -p "$INSTALL_DIR_ABS"
  unzip -o "$ZIP_PATH" -d "$INSTALL_DIR_ABS" >/dev/null
else
  echo "[step] skipping install; reusing existing model directory"
fi

if [[ ! -d "$MODEL_DIR_ABS" ]]; then
  echo "[error] rebuild model directory not found: $MODEL_DIR_ABS" >&2
  exit 1
fi

echo "[step] rebaking embeddings"
SCRIPTURE_MODEL_DIR="$MODEL_DIR_ABS" python3 scripts/rebake-embeddings.py

echo "[step] rebuilding concept index"
SCRIPTURE_MODEL_DIR="$MODEL_DIR_ABS" node scripts/build-concept-index.js

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
echo "[note] active rebuild model: $MODEL_DIR_ABS"
echo "[note] current default active path remains: $REPO_ROOT/resources/models/scripture-bge"
echo ""
echo "[push] Run the following to push rebuilt DBs (squashes into one LFS commit):"
echo "       scripts/push-data.sh \"fine-tuned scripture-bge\""
