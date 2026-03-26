/**
 * copy-db.js — Copies all 9 scripture .db files from resources/db/ into
 * mobile/public/assets/db/ so Vite bundles them as static assets.
 */
import { readdirSync, copyFileSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SRC = resolve(__dirname, '../../resources/db');
const DEST = resolve(__dirname, '../public/assets/db');

mkdirSync(DEST, { recursive: true });

const EXCLUDE = new Set([
  'verse-graph.db',        // backend-only (raw source for search-graph.db prebake)
  'concept-embeddings.db', // backend-only (semantic concept expansion — not used by mobile)
  'scriptures-en.db',      // empty placeholder
  'scriptures.db',         // empty placeholder
  // Non-English scripture DBs — downloaded on demand from server
  'tagalog-scriptures-sqlite.db',
  'cebuano-scriptures-sqlite.db',
  'spanish-scriptures-sqlite.db',
  'greek-scriptures-sqlite.db',
  'ilocano-scriptures-sqlite.db',
  'japanese-scriptures-sqlite.db',
  'nrsvue-scriptures-sqlite.db',
  'waray-scriptures-sqlite.db',
  // Heavy intelligence DBs — too large for mobile WebView memory (>45MB each)
  // These are available on the backend server; mobile uses lite search instead.
  'verse-embeddings.db',     // 166MB — semantic embeddings
  'search-graph.db',         // 94MB  — graph-based ranking
  'verse-summaries.db',      // 89MB  — verse-level summaries
  'verse-tags.db',           // 73MB  — verse tagging
  'verse-cross-refs.db',     // 45MB  — cross references
  'footnotes-lds-summaries.db', // 17MB — footnotes
]);

const dbFiles = readdirSync(SRC).filter(f => f.endsWith('.db') && !EXCLUDE.has(f));
for (const file of dbFiles) {
  copyFileSync(join(SRC, file), join(DEST, file));
  console.log(`  copied ${file}`);
}
console.log(`${dbFiles.length} DB files copied to public/assets/db/`);

// Copy sql-wasm.wasm for offline use (FTS5-enabled build from fts5-sql-bundle)
const WASM_SRC = resolve(__dirname, '../node_modules/fts5-sql-bundle/dist/sql-wasm.wasm');
const WASM_DEST = resolve(__dirname, '../public/sql-wasm.wasm');
copyFileSync(WASM_SRC, WASM_DEST);
console.log('  copied sql-wasm.wasm (FTS5-enabled)');
