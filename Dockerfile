FROM node:20-bookworm-slim AS build

WORKDIR /app

COPY package*.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json

RUN npm ci --include=dev

COPY . .

# Sanity check: ensure DBs are real SQLite files, not LFS pointers.
RUN if ! head -c 6 resources/db/lds-scriptures-sqlite.db | grep -q 'SQLite'; then \
      echo "ERROR: DB files are Git LFS pointers. Build with 'lfs: true' in checkout." && \
      exit 1; \
    fi

RUN npm run build --workspace=frontend

# --- Production stage ---
FROM node:20-bookworm-slim

WORKDIR /app

COPY --from=build /app/package*.json ./
COPY --from=build /app/backend ./backend
COPY --from=build /app/frontend/dist ./frontend/dist
COPY --from=build /app/frontend/package.json ./frontend/package.json
COPY --from=build /app/shared ./shared
COPY --from=build /app/resources ./resources

RUN npm ci --omit=dev --workspace=backend \
  && npm rebuild better-sqlite3

# Prebake the Xenova/all-MiniLM-L6-v2 ONNX model so it's cached at build time
# and doesn't need to be downloaded on every container start.
RUN node -e "import('@xenova/transformers').then(m=>m.pipeline('feature-extraction','Xenova/all-MiniLM-L6-v2')).then(()=>console.log('Model cached')).catch(e=>console.warn('Model prebake skipped:',e.message))"

EXPOSE 8080

ENV NODE_ENV=production
ENV PORT=8080
ENV REBUILD_FTS_ON_START=false

CMD ["npm", "start", "--workspace=backend"]
