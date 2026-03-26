#!/usr/bin/env node
/**
 * sync-electron-deps.js
 *
 * Copies all transitive runtime dependencies of backend/index.js from root
 * node_modules into electron/backend-deps/ so electron-builder can bundle
 * them at the correct path (node_modules/) inside the ASAR.
 *
 * Run automatically as part of electron:build via package.json scripts.
 *
 * Packages intentionally skipped (handled separately in electron-builder.yml):
 *   - better-sqlite3        → electron/node_modules (Electron ABI rebuild)
 *   - @xenova/transformers  → from: "node_modules/@xenova"
 *   - onnxruntime-node      → from: "node_modules/onnxruntime-node"
 */

const fs   = require('fs');
const path = require('path');

const ROOT      = path.join(__dirname, '..');
const SRC       = path.join(ROOT, 'node_modules');
const DST       = path.join(ROOT, 'electron', 'backend-deps');

// Packages handled separately — do not copy
const SKIP = new Set([
  'better-sqlite3',
  '@xenova',
  'onnxruntime-node',
]);

const visited = new Set();

function readPkg(name) {
  try {
    const p = path.join(SRC, name, 'package.json');
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { return null; }
}

function copyPkg(name) {
  // Skip scoped package top-level check
  const topScope = name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0];
  if (SKIP.has(topScope) || SKIP.has(name)) return;
  if (visited.has(name)) return;
  visited.add(name);

  const srcDir = path.join(SRC, name);
  const dstDir = path.join(DST, name);

  if (!fs.existsSync(srcDir)) {
    console.warn(`  ⚠  ${name} not found in root node_modules — skipping`);
    return;
  }

  if (!fs.existsSync(dstDir)) {
    fs.cpSync(srcDir, dstDir, { recursive: true });
    process.stdout.write('.');
  }

  const pkg = readPkg(name);
  if (pkg) {
    Object.keys(pkg.dependencies || {}).forEach(dep => copyPkg(dep));
  }
}

// Read backend direct deps
const backendPkg = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'backend', 'package.json'), 'utf8')
);

console.log('Syncing backend runtime deps to electron/backend-deps/...');
fs.mkdirSync(DST, { recursive: true });

Object.keys(backendPkg.dependencies || {}).forEach(dep => copyPkg(dep));

console.log(`\n✓ Synced ${visited.size} packages to electron/backend-deps/`);
