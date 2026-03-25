FROM node:20-bookworm-slim AS build

RUN apt-get update && apt-get install -y git-lfs && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json

RUN npm ci --include=dev

COPY . .

# Ensure LFS pointer files are replaced with actual content
RUN git lfs install --skip-repo \
  && if git lfs pointer --check resources/db/lds-scriptures-sqlite.db 2>/dev/null; then \
       echo "ERROR: LFS pointers detected — actual DB files required in build context" && exit 1; \
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

EXPOSE 8080

ENV NODE_ENV=production
ENV PORT=8080
ENV REBUILD_FTS_ON_START=false

CMD ["npm", "start", "--workspace=backend"]
