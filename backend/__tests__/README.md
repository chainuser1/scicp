# Backend Tests

This directory contains comprehensive tests for the backend API located in `../index.js`.

## Test Coverage

The tests cover the following functionality:

### Core Functions
- `parseScriptureReference`: Tests for parsing scripture references in various formats
- `searchScripture`: Tests for searching scripture text by reference or phrase
- `segmentVerseText`: Tests for splitting verses into readable segments
- `registerSocketHandlers`: Tests for socket connection handlers

### API Endpoints
- GET `/`: Health check endpoint
- GET `/themes`: Retrieve all themes
- POST `/themes`: Create a new theme
- PUT `/themes/:id`: Update an existing theme
- DELETE `/themes/:id`: Delete a theme

### Testing Approach

The tests use Jest as the test runner and include both unit tests for individual functions and integration tests for API endpoints. For API testing, we create a Fastify test server that replicates the routing and database logic from the main application.

## Running Tests

To run the tests, use the npm script:

```bash
npm test
```

Or specifically for the backend:

```bash
npm test --workspace=backend
```

## Test Structure

Each major function or feature has its own test suite with multiple test cases covering:
- Normal operation scenarios
- Edge cases and error conditions
- Invalid inputs and error handling
- Database operations