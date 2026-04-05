# Backend Tests

This directory contains comprehensive tests for the backend API in `../index.js`.

## Test Coverage

**159 tests** covering:

### Core Functions
- `searchScripture` — full pipeline including FTS, semantic, graph, and fusion stages
- `registerSocketHandlers` — socket connection and event handlers

> `parseScriptureReference` and `segmentVerseText` have moved to `shared/scripture-engine.js` and are tested in `shared/__tests__/`.

### API Endpoints
- `GET /health` — health check
- `GET /themes` — retrieve all themes
- `POST /themes` — create a new theme
- `PUT /themes/:id` — update an existing theme
- `DELETE /themes/:id` — delete a theme
- `GET /search` — scripture search endpoint
- `GET /verse/of-the-day` — daily verse
- Translation and cross-reference endpoints

### Testing Approach

Jest 29 with both unit and integration tests. Integration tests use a Fastify test server with real SQLite databases. The backend uses `if (require.main === module)` to guard `start()` so Jest can `require('../index')` without binding a port.

## Running Tests

```bash
npm test --workspace=backend
```

## Test Structure

Each feature has its own `describe` block covering:
- Normal operation
- Edge cases and error conditions
- Invalid inputs
- Database operation correctness