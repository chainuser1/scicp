FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json

RUN npm ci --include=dev

COPY . .

RUN npm run build --workspace=frontend \
  && NODE_ENV=production npm prune --omit=dev \
  && npm rebuild better-sqlite3

EXPOSE 8080

ENV NODE_ENV=production
ENV PORT=8080
ENV REBUILD_FTS_ON_START=false

CMD ["npm", "start", "--workspace=backend"]
