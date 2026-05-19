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
SKIP_EXPORT=0
SKIP_REBAKE=0
REBAKE_USING_ONNX=0
RESUME=0

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
    --skip-export)
      SKIP_EXPORT=1
      shift
      ;;
    --skip-rebake)
      SKIP_REBAKE=1
      shift
      ;;
    --rebake-using-onnx)
      REBAKE_USING_ONNX=1
      shift
      ;;
    --resume)
      RESUME=1
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
  --skip-export       Skip ONNX export even if the model is installed.
  --skip-rebake       Skip embedding rebake even if the ONNX export succeeded.
  --rebake-using-onnx Use the ONNX export as the source for rebaking embeddings, instead of the original model files.
  --resume            Resume from the last completed step when possible.
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

model_dir_is_valid() {
  local dir="$1"
  [[ -f "$dir/pytorch_model.bin" || -f "$dir/model.safetensors" || -f "$dir/tf_model.h5" ]]
}

onnx_export_is_complete() {
  local dir="$1"
  [[ -f "$dir/onnx/model_quantized.onnx" || -f "$dir/onnx/model.onnx" ]]
}

latest_model_mtime() {
  local dir="$1"
  find "$dir" -type f -printf '%T@\n' 2>/dev/null | sort -n | tail -1
}

artifact_is_up_to_date() {
  local artifact="$1"
  local model_mtime
  if [[ ! -f "$artifact" ]]; then
    return 1
  fi
  model_mtime=$(latest_model_mtime "$MODEL_DIR_ABS")
  if [[ -z "$model_mtime" ]]; then
    return 1
  fi
  local art_mtime
  art_mtime=$(stat -c %Y "$artifact")
  (( art_mtime >= model_mtime ))
}

embeddings_rebake_is_complete() {
  [[ -f "$REPO_ROOT/resources/db/verse-embeddings.db" ]]
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

if [[ "$RESUME" -eq 1 && "$SKIP_INSTALL" -eq 0 ]] && [[ -d "$INSTALL_DIR_ABS" ]] && model_dir_is_valid "$INSTALL_DIR_ABS"; then
  echo "[step] resume: existing fine-tuned model detected, skipping install"
  SKIP_INSTALL=1
fi

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

# Ensure Python dependencies used by rebake-embeddings.py and ONNX export are available
if ! python3 - <<'PY' >/dev/null 2>&1
import sentence_transformers  # noqa: F401
import numpy  # noqa: F401
import transformers  # noqa: F401
import onnxscript  # noqa: F401
import onnxruntime  # noqa: F401
PY
then
  echo "[error] Missing Python dependencies for rebake-embeddings.py or ONNX export" >&2
  echo "[hint] Install in the same Python env used by this script:" >&2
  echo "       python3 -m pip install -U sentence-transformers numpy transformers onnxscript onnxruntime" >&2
  exit 1
fi

if [[ "$SKIP_INSTALL" -eq 0 ]]; then
  echo "[step] installing fine-tuned model"
  rm -rf "$INSTALL_DIR_ABS"
  mkdir -p "$INSTALL_DIR_ABS"
  if ! command -v unzip >/dev/null 2>&1; then
    echo "[error] 'unzip' not found in PATH. Install 'unzip' or run with --skip-install" >&2
    exit 1
  fi

  unzip -o "$ZIP_PATH" -d "$INSTALL_DIR_ABS" >/dev/null
else
  echo "[step] skipping install; reusing existing model directory"
fi

# Detect whether the model files are nested one level down inside the install dir.
# Some zips package the model under a top-level folder (e.g. scripture-bge/*). In
# that case, defaulting to the install dir will not point at the actual model root.
detect_model_root() {
  local dir="$1"
  local candidates=(config.json tokenizer.json pytorch_model.bin model_index.json flax_model.msgpack)
  for f in "${candidates[@]}"; do
    if [[ -f "$dir/$f" ]]; then
      printf '%s\n' "$dir"
      return 0
    fi
  done

  # If there's exactly one child directory, check inside it for model artifacts.
  local children=("$dir"/*)
  if [[ ${#children[@]} -eq 1 && -d "${children[0]}" ]]; then
    local subdir="${children[0]}"
    for f in "${candidates[@]}"; do
      if [[ -f "$subdir/$f" ]]; then
        printf '%s\n' "$subdir"
        return 0
      fi
    done
  fi

  return 1
}

# If the model dir exists, try to detect the actual model root (may be nested).
if [[ -d "$MODEL_DIR_ABS" ]]; then
  detected_root="$(detect_model_root "$MODEL_DIR_ABS" || true)"
  if [[ -n "$detected_root" && "$detected_root" != "$MODEL_DIR_ABS" ]]; then
    MODEL_DIR_ABS="$detected_root"
    echo "[info] adjusted model root to nested folder: $MODEL_DIR_ABS"
  fi
fi

if [[ ! -d "$MODEL_DIR_ABS" ]]; then
  echo "[error] rebuild model directory not found: $MODEL_DIR_ABS" >&2
  exit 1
fi

if [[ "$RESUME" -eq 1 && "$SKIP_EXPORT" -eq 0 ]] && onnx_export_is_complete "$REPO_ROOT/resources/onnx/scripture-bge"; then
  if artifact_is_up_to_date "$REPO_ROOT/resources/onnx/scripture-bge/onnx/model_quantized.onnx" || artifact_is_up_to_date "$REPO_ROOT/resources/onnx/scripture-bge/onnx/model.onnx"; then
    echo "[step] resume: existing ONNX export is up to date, skipping export"
    SKIP_EXPORT=1
  else
    echo "[step] existing ONNX export appears stale relative to current model; re-exporting"
  fi
fi

if [[ "$SKIP_EXPORT" -eq 0 ]]; then
  echo "[step] exporting ONNX runtime model"
  python3 scripts/export-onnx.py --model-dir "$MODEL_DIR_ABS" --output-dir "$REPO_ROOT/resources/onnx/scripture-bge"
else
  echo "[step] skipping ONNX export"
fi

if [[ "$RESUME" -eq 1 && "$SKIP_REBAKE" -eq 0 ]] && embeddings_rebake_is_complete; then
  if [[ "$REBAKE_USING_ONNX" -eq 1 ]]; then
    # When using ONNX, check against the ONNX model timestamp
    if artifact_is_up_to_date "$REPO_ROOT/resources/onnx/scripture-bge/onnx/model_quantized.onnx" || \
       artifact_is_up_to_date "$REPO_ROOT/resources/onnx/scripture-bge/onnx/model.onnx"; then
      echo "[step] resume: existing embeddings DB is up to date, skipping rebake"
      SKIP_REBAKE=1
    else
      echo "[step] existing embeddings DB appears stale relative to ONNX model; rerunning rebake"
    fi
  else
    if artifact_is_up_to_date "$REPO_ROOT/resources/db/verse-embeddings.db"; then
      echo "[step] resume: existing embeddings DB is up to date, skipping rebake"
      SKIP_REBAKE=1
    else
      echo "[step] existing embeddings DB appears stale relative to current model; rerunning rebake"
    fi
  fi
fi

if [[ "$SKIP_REBAKE" -eq 0 ]]; then
  if [[ "$REBAKE_USING_ONNX" -eq 1 ]]; then
    echo "[step] rebaking embeddings using ONNX"
    SCRIPTURE_ONNX_DIR="$REPO_ROOT/resources/onnx/scripture-bge/onnx" python3 scripts/rebake-embeddings-onnx.py
  else
    echo "[step] rebaking embeddings"
    SCRIPTURE_MODEL_DIR="$MODEL_DIR_ABS" python3 scripts/rebake-embeddings.py
  fi
else
  echo "[step] skipping embedding rebake"
fi

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
