FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package*.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json

RUN npm ci --include=dev

COPY . .

# Sanity check: ensure DBs are real SQLite files, not LFS pointers.
# (Deploy workflow extracts DBs from previous GHCR image or falls back to LFS.)
RUN if ! head -c 6 resources/db/lds-scriptures-sqlite.db | grep -q 'SQLite'; then \
      echo "ERROR: DB file is an LFS pointer — deploy workflow did not resolve it." && \
      exit 1; \
    fi

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
