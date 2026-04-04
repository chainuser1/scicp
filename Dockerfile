FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package*.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json

RUN npm ci --include=dev

COPY . .

# Sanity check: ensure DBs are real SQLite files, not LFS pointers.
# (Deploy workflow extracts analysis DBs from previous GHCR image or falls back to LFS.)
RUN for db in lds-scriptures-sqlite.db ylt-scriptures-sqlite.db \
              tagalog-scriptures-sqlite.db cebuano-scriptures-sqlite.db \
              concept-embeddings.db; do \
      head -c 6 "resources/db/$db" | grep -q 'SQLite' \
        || (echo "ERROR: $db is an LFS pointer — deploy workflow did not resolve it." && exit 1); \
    done

# Pre-bake the HNSW approximate-nearest-neighbor index into verse-embeddings.db.
# Eliminates ~3-8 s cold-build at every server start; index loads in ~50 ms instead.
# Non-fatal: if verse-embeddings.db or its embeddings table is absent, image still builds.
RUN node scripts/prebake-hnsw.js \
  && echo "✓ HNSW index pre-baked" \
  || echo "WARN: prebake-hnsw.js skipped (verse-embeddings.db missing or incomplete)"

RUN npm run build --workspace=frontend

# --- Production stage ---
FROM node:22-bookworm-slim

WORKDIR /app

COPY --from=build /app/package*.json ./
COPY --from=build /app/backend ./backend
COPY --from=build /app/frontend/dist ./frontend/dist
COPY --from=build /app/frontend/package.json ./frontend/package.json
COPY --from=build /app/shared ./shared
COPY --from=build /app/resources ./resources

RUN npm ci --omit=dev --workspace=backend \
  && npm rebuild better-sqlite3

# Verify the fine-tuned Scripture-MiniLM ONNX model is present
RUN test -f resources/onnx/scripture-minilm/onnx/model_quantized.onnx \
  && echo "Scripture-MiniLM ONNX model found ($(du -h resources/onnx/scripture-minilm/onnx/model_quantized.onnx | cut -f1))" \
  || echo "WARNING: ONNX model not found — will fall back to generic MiniLM from HuggingFace"

EXPOSE 8080

ENV NODE_ENV=production
ENV PORT=8080
ENV REBUILD_FTS_ON_START=false

CMD ["npm", "start", "--workspace=backend"]
