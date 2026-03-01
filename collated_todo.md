# Scripture Projector Project

## Project Purpose

This project aims to create a high-performance, web-based scripture projection engine. It allows a "presenter" to control what scripture verse and theme is displayed on a "client" screen in near real-time. This is ideal for use in churches, study groups, or any event where scriptures need to be displayed to an audience.

## What I Have Done So Far

*   **Backend (Node.js / Fastify / Socket.io):**
    *   Set up a backend server.
    *   Connected to a SQLite database containing the scriptures.
    *   Implemented a `search` feature to find scriptures, including basic parsing of references like "John 3:16" or "1 Nephi 3" so backend queries by book/chapter/verse when appropriate.
    *   Implemented an `update-verse` feature to send a scripture to the client.
    *   Implemented an `update-theme` feature to change the client's visual theme.
    *   Added presenter‑side staging with a Go‑Live event so verses can be queued before broadcasting.
    *   Presenter can now choose a custom background image via URL.
    *   Navigation buttons let the presenter step to the previous/next verse in the same chapter without retyping.
    *   Client view now performs a smooth fade when the verse or theme changes and dynamically adjusts font size so content never overflows the viewport.
    *   Created a `/themes` CRUD API and frontend controls allowing custom themes to be saved, listed and applied.
*   **Frontend (React / Vite):**
    *   Set up a frontend application with routing for Presenter and Client views.
    *   **Presenter View:** A control panel where the user can search for scriptures, select a verse to display, and change the theme. It correctly sends `update-verse` and `update-theme` events.
    *   **Client View:** A display panel that shows the scripture and reference. It correctly receives `update-verse` and `update-theme` events to update its content and appearance.

## Our Plan (Next Steps)

The remaining work is broken down into smaller, implementable tasks so we can chip away at the ideal finished product.

### Search & Data

1. Improve query parsing and matching:
   * ✅ **DONE:** Fully support various book name abbreviations (e.g. "Jn" → "John", "1 Ne" → "1 Nephi"). [60+ abbreviations mapped]
   * Implement auto‑completion suggestions based on book/chapter/verse.
   * ✅ **DONE:** Full‑text search for phrase searches in scripture_text [phraseSearch() function implemented]
   * ✅ **DONE:** Load more behaviour - now returns 50 results instead of 10

2. ✅ **DONE:** Add backend tests for parsing and searching. [13/13 tests passing, including abbreviation tests]

### Presenter UI/UX

1. Build a staging area and **Go Live** button for queued verses. *(implemented – presenter now stages a verse and emits a `go-live` event)*
2. Allow background selection by URL (or later file upload). *(implemented)*
3. Add previous/next verse buttons so the presenter can move through a chapter without typing. *(implemented)*
4. Add loading/empty states and input validation to the search box.
5. Design a more polished layout (cards, grids, responsive). Use a CSS framework or custom styles.
6. Provide an interface to manage/switch themes (view list, preview, rename, delete). *(initial theme persistence UI added; more polish can come later)*

### Client UI/UX

1. Animate verse/theme transitions (fade, slide). *(simple fade implemented on updates)*
2. Automatically adjust font size based on verse length so that no scrolling is required. *(implemented)*
3. Improve responsive layout for projection screens (landscape, big text).
4. Cache the last displayed verse and theme locally for offline display.

### Theming & Media

1. Expand theme model to include:
   * Font families, font sizes, text color, background color/gradient.
   * Logo or watermark overlay.
   * Alignments/positioning (centered, lower third, full screen).
2. Persist themes on the backend (new `themes` table) with CRUD endpoints. *(done)*
3. UI for uploading/selecting background images (store on server or cloud).
4. Option to save the current theme as a named, reusable preset. *(basic save functionality added)*

### Offline & Resilience

1. Add a Service Worker (Workbox) to cache static assets and socket JS.
2. Implement reconnection logic for Socket.IO with exponential backoff.
3. Provide a fallback where the client shows the last verse if disconnected.

### Security & Sessions

1. Introduce session tokens / room IDs so only the presenter can control the client(s).
2. Optionally add a simple access PIN or OAuth login for presenters.
3. Rate‑limit the search endpoint to prevent abuse.

### Testing & Deployment

1. Add unit tests for backend logic (search parsing, socket handlers) using Jest or similar.
2. Add E2E tests for critical flows (search + display) with Cypress / Playwright.
3. Set up CI pipeline (GitHub Actions) to lint, test, and build both front and back.
4. Create Dockerfiles and/or deployment scripts for easy hosting.

### Documentation

1. Update `README.md` with setup, development, and deployment instructions.
2. Add a short user guide describing the presenter/client workflow.
3. Maintain an architecture/overview document for developers.

> Completing these items will bring the project to a polished, production‑ready state capable of being used by non‑technical users.

## The Ideal Finished Product

The ideal finished product is a polished and reliable scripture projection system that feels "instant" to the presenter and the audience. It will be easy to use, visually flexible, and resilient to network issues. A user with no technical expertise should be able to open the Presenter view on their laptop or tablet and instantly control the scripture displayed on a projector connected to the Client view.
