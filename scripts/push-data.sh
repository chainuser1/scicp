#!/usr/bin/env bash
# push-data.sh — stage rebuilt DB files, squash into one rolling "data:" commit, push.
#
# Usage:
#   scripts/push-data.sh                         # commit message auto-generated
#   scripts/push-data.sh "custom message suffix" # appended after timestamp
#
# What it does:
#   1. Stage every LFS-tracked DB that has changed.
#   2. If the previous commit is already a "data:" commit, amend it in-place
#      (so LFS only retains ONE version of each DB on the server — no history bloat).
#   3. Otherwise, create a fresh "data:" commit.
#   4. Push (force-with-lease for safety — won't overwrite an unrelated upstream change).
#
# LFS storage impact:
#   - Each push replaces the old LFS pointer; GitHub eventually GCs the old object.
#   - Without this script every rebuild adds a full new copy to GitHub LFS quota.
#
# SAFETY: use --no-amend to always create a fresh commit and skip the amend logic.

set -euo pipefail

REPO_ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
cd "$REPO_ROOT"

NO_AMEND=false
MSG_SUFFIX="${1:-}"
for arg in "$@"; do
  [[ "$arg" == "--no-amend" ]] && NO_AMEND=true
done

# ── 1. Detect changed LFS-tracked DBs ────────────────────────────────────────
LFS_PATTERNS=(
  "resources/db/verse-embeddings.db"
  "resources/db/verse-graph.db"
  "resources/db/verse-tags.db"
  "resources/db/search-graph.db"
  "resources/db/verse-summaries.db"
  "resources/db/verse-cross-refs.db"
  "resources/db/triple-index.db"
  "resources/db/topical-guide.db"
  "resources/db/chapter-summaries-fts.db"
  "resources/db/footnotes-lds-summaries.db"
)

CHANGED=()
for f in "${LFS_PATTERNS[@]}"; do
  if [[ -f "$f" ]] && ! git diff --quiet HEAD -- "$f" 2>/dev/null; then
    CHANGED+=("$f")
  elif [[ -f "$f" ]] && git status --short "$f" | grep -qE '^(\?\?|M| M)'; then
    CHANGED+=("$f")
  fi
done

if [[ ${#CHANGED[@]} -eq 0 ]]; then
  echo "No LFS DBs have changed — nothing to commit."
  exit 0
fi

echo "Staging ${#CHANGED[@]} changed LFS DB(s):"
for f in "${CHANGED[@]}"; do
  echo "  $f"
  git add "$f"
done

# ── 2. Build commit message ───────────────────────────────────────────────────
TIMESTAMP=$(date -u +"%Y-%m-%d %H:%M UTC")
DB_LIST=$(printf '%s\n' "${CHANGED[@]}" | xargs -I{} basename {} | paste -sd ', ' -)
if [[ -n "$MSG_SUFFIX" && "$MSG_SUFFIX" != "--no-amend" ]]; then
  COMMIT_MSG="data: rebuild ${DB_LIST} [${TIMESTAMP}] — ${MSG_SUFFIX}"
else
  COMMIT_MSG="data: rebuild ${DB_LIST} [${TIMESTAMP}]"
fi

# ── 3. Amend or create commit ─────────────────────────────────────────────────
PREV_MSG=$(git log -1 --format="%s" 2>/dev/null || true)

if [[ "$NO_AMEND" == false && "$PREV_MSG" == data:* ]]; then
  echo ""
  echo "Previous commit is a data: commit — amending in-place to keep LFS lean."
  echo "  Old: $PREV_MSG"
  echo "  New: $COMMIT_MSG"
  git commit --amend --no-edit -m "$COMMIT_MSG"
  FORCE_FLAG="--force-with-lease"
else
  echo ""
  git commit -m "$COMMIT_MSG"
  FORCE_FLAG=""
fi

# ── 4. Push ───────────────────────────────────────────────────────────────────
echo ""
echo "Pushing to origin/main (LFS upload may take a while for large DBs)..."
# shellcheck disable=SC2086
git push origin main $FORCE_FLAG

echo ""
echo "Done. LFS objects for this rebuild are now on GitHub."
echo "Run 'git lfs prune' to clean up unreferenced local LFS objects."
