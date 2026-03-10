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

const dbFiles = readdirSync(SRC).filter(f => f.endsWith('.db'));
for (const file of dbFiles) {
  copyFileSync(join(SRC, file), join(DEST, file));
  console.log(`  copied ${file}`);
}
console.log(`${dbFiles.length} DB files copied to public/assets/db/`);

// Copy sql-wasm.wasm for offline use (no CDN dependency at runtime)
const WASM_SRC = resolve(__dirname, '../node_modules/sql.js/dist/sql-wasm.wasm');
const WASM_DEST = resolve(__dirname, '../public/sql-wasm.wasm');
copyFileSync(WASM_SRC, WASM_DEST);
console.log('  copied sql-wasm.wasm');
