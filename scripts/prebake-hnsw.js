#!/usr/bin/env node
// Pre-bake the HNSW approximate-nearest-neighbor index into verse-embeddings.db
//
// One-time (or after embedding updates) script that:
//  1. Reads all verse vectors from verse-embeddings.db
//  2. Builds an HNSWIndex (384-dim, M=16, ef=200) — same params as runtime
//  3. Serialises the graph to a compact binary BLOB
//  4. Stores it in the `hnsw_index` table so the server can load it in ~50 ms instead of ~5 s
//
// Usage:
//   node scripts/prebake-hnsw.js
//   node scripts/prebake-hnsw.js --key hnsw_v2   # store under a custom key

'use strict';

const Database = require('better-sqlite3');
const path = require('path');

const EMB_PATH = path.join(__dirname, '..', 'resources', 'db', 'verse-embeddings.db');

const EMBED_DIM = 384;
const HNSW_M = 16;
const HNSW_EF = 200;
const DEFAULT_KEY = 'hnsw_v1';

// ---------------------------------------------------------------------------
// Parse CLI flags
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
let storeKey = DEFAULT_KEY;
let forceRaw = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--key' && args[i + 1]) storeKey = args[++i];
  if (args[i] === '--raw') forceRaw = true;
}

// ---------------------------------------------------------------------------
// Minimal HNSW implementation (must match backend/index.js exactly)
// ---------------------------------------------------------------------------

class HNSWIndex {
  constructor(dims, M = 16, ef = 200) {
    this.dims = dims;
    this.M = M;
    this.ef = ef;
    this.nodes = [];
    this.nodeMap = new Map(); // id → node index
    this.entryPoint = -1;
    this.maxLevel = -1;
  }

  _distance(a, b) {
    let d = 0;
    for (let i = 0; i < a.length; i++) d += (a[i] - b[i]) ** 2;
    return d;
  }

  _randomLevel() {
    const mL = 1 / Math.log(this.M);
    let level = 0;
    while (Math.random() < Math.exp(-level * mL)) level++;
    return Math.min(level, 16);
  }

  _searchLayer(query, entry, ef, level) {
    const visited = new Set([entry]);
    const candidates = [[this._distance(query, this.nodes[entry].vec), entry]];
    const results = [[...candidates[0]]];
    while (candidates.length > 0) {
      candidates.sort((a, b) => a[0] - b[0]);
      const [cDist, c] = candidates.shift();
      const worstResult = results[results.length - 1][0];
      if (cDist > worstResult && results.length >= ef) break;
      const neighbors = this.nodes[c].neighbors.get(level) || [];
      for (const n of neighbors) {
        if (!visited.has(n)) {
          visited.add(n);
          const d = this._distance(query, this.nodes[n].vec);
          if (results.length < ef || d < results[results.length - 1][0]) {
            candidates.push([d, n]);
            results.push([d, n]);
            results.sort((a, b) => a[0] - b[0]);
            if (results.length > ef) results.pop();
          }
        }
      }
    }
    return results;
  }

  insert(id, vec) {
    const level = this._randomLevel();
    const node = { id, vec: new Float32Array(vec), neighbors: new Map(), level };
    for (let l = 0; l <= level; l++) node.neighbors.set(l, []);
    const idx = this.nodes.length;
    this.nodes.push(node);
    this.nodeMap.set(id, idx);

    if (this.entryPoint === -1) {
      this.entryPoint = idx;
      this.maxLevel = level;
      return;
    }

    let ep = this.entryPoint;
    for (let l = this.maxLevel; l > level; l--) {
      const results = this._searchLayer(vec, ep, 1, l);
      ep = results[0][1];
    }
    for (let l = Math.min(level, this.maxLevel); l >= 0; l--) {
      const results = this._searchLayer(vec, ep, this.ef, l);
      const neighbors = results.slice(0, this.M).map(r => r[1]);
      node.neighbors.set(l, neighbors);
      for (const n of neighbors) {
        const nNeighbors = this.nodes[n].neighbors.get(l) || [];
        nNeighbors.push(idx);
        if (nNeighbors.length > this.M * 2) {
          nNeighbors.sort((a, b) =>
            this._distance(vec, this.nodes[a].vec) - this._distance(vec, this.nodes[b].vec)
          );
          nNeighbors.splice(this.M * 2);
        }
        this.nodes[n].neighbors.set(l, nNeighbors);
      }
      if (results.length > 0) ep = results[0][1];
    }
    if (level > this.maxLevel) {
      this.maxLevel = level;
      this.entryPoint = idx;
    }
  }

  // -------------------------------------------------------------------------
  // Binary serialisation
  // Header (24 bytes, little-endian Int32):
  //   version(4) | dims(4) | M(4) | entryPoint(4) | maxLevel(4) | nodeCount(4)
  // Per node:
  //   id(Int32) | levelCount(Uint8) |
  //   for each level: level(Uint8) | neighborCount(Uint8) | Int32[neighborCount]
  // Vecs section (after all nodes):
  //   Float32[dims] per node, in node order
  // -------------------------------------------------------------------------
  serialize() {
    const VERSION = 1;
    const N = this.nodes.length;

    // --- measure size ---
    let nodeBytes = 0;
    for (const node of this.nodes) {
      nodeBytes += 4 + 1; // id + levelCount
      for (const [, neighbors] of node.neighbors) {
        nodeBytes += 1 + 1 + neighbors.length * 4; // level + count + ids
      }
    }
    const vecBytes = N * this.dims * 4;
    const totalBytes = 24 + nodeBytes + vecBytes;

    const buf = Buffer.allocUnsafe(totalBytes);
    let offset = 0;

    // header
    buf.writeInt32LE(VERSION, offset); offset += 4;
    buf.writeInt32LE(this.dims, offset); offset += 4;
    buf.writeInt32LE(this.M, offset); offset += 4;
    buf.writeInt32LE(this.entryPoint, offset); offset += 4;
    buf.writeInt32LE(this.maxLevel, offset); offset += 4;
    buf.writeInt32LE(N, offset); offset += 4;

    // nodes
    for (const node of this.nodes) {
      buf.writeInt32LE(node.id, offset); offset += 4;
      const levels = [...node.neighbors.keys()];
      buf.writeUInt8(levels.length, offset); offset += 1;
      for (const lvl of levels) {
        const nbrs = node.neighbors.get(lvl);
        buf.writeUInt8(lvl, offset); offset += 1;
        buf.writeUInt8(nbrs.length, offset); offset += 1;
        for (const n of nbrs) {
          buf.writeInt32LE(n, offset); offset += 4;
        }
      }
    }

    // vecs
    for (const node of this.nodes) {
      for (let i = 0; i < this.dims; i++) {
        buf.writeFloatLE(node.vec[i], offset); offset += 4;
      }
    }

    return buf;
  }

  static deserialize(buf) {
    let offset = 0;
    /* const version = */ buf.readInt32LE(offset); offset += 4;
    const dims = buf.readInt32LE(offset); offset += 4;
    const M = buf.readInt32LE(offset); offset += 4;
    const entryPoint = buf.readInt32LE(offset); offset += 4;
    const maxLevel = buf.readInt32LE(offset); offset += 4;
    const N = buf.readInt32LE(offset); offset += 4;

    const idx = new HNSWIndex(dims, M, 200);
    idx.entryPoint = entryPoint;
    idx.maxLevel = maxLevel;

    for (let i = 0; i < N; i++) {
      const id = buf.readInt32LE(offset); offset += 4;
      const levelCount = buf.readUInt8(offset); offset += 1;
      const neighbors = new Map();
      for (let li = 0; li < levelCount; li++) {
        const lvl = buf.readUInt8(offset); offset += 1;
        const cnt = buf.readUInt8(offset); offset += 1;
        const nbrs = [];
        for (let ni = 0; ni < cnt; ni++) {
          nbrs.push(buf.readInt32LE(offset)); offset += 4;
        }
        neighbors.set(lvl, nbrs);
      }
      idx.nodes.push({ id, vec: null, neighbors, level: levelCount - 1 });
      idx.nodeMap.set(id, i);
    }

    // vecs
    for (let i = 0; i < N; i++) {
      const vec = new Float32Array(dims);
      for (let d = 0; d < dims; d++) {
        vec[d] = buf.readFloatLE(offset); offset += 4;
      }
      idx.nodes[i].vec = vec;
    }

    return idx;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  console.log('[prebake-hnsw] Opening:', EMB_PATH);
  const db = new Database(EMB_PATH);
  db.pragma('journal_mode = WAL');

  // Ensure table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS hnsw_index (
      key       TEXT PRIMARY KEY,
      data      BLOB NOT NULL,
      built_at  INTEGER NOT NULL
    )
  `);

  // Load all embeddings
  console.log('[prebake-hnsw] Loading embeddings…');
  const t0 = Date.now();

  // Try whitened embeddings first; fall back to raw
  // Use --raw flag to force raw embeddings (e.g., when whitening is disabled in backend)
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('verse_embeddings_white','verse_embeddings')"
  ).all().map(r => r.name);

  const sourceTable = (forceRaw || !tables.includes('verse_embeddings_white'))
    ? 'verse_embeddings'
    : 'verse_embeddings_white';
  console.log('[prebake-hnsw] Embedding source table:', sourceTable, forceRaw ? '(forced raw)' : '');

  const rows = db.prepare(`SELECT verse_id, embedding FROM ${sourceTable}`).all();
  console.log(`[prebake-hnsw] Loaded ${rows.length} embeddings in ${Date.now() - t0} ms`);

  // Build HNSW
  console.log(`[prebake-hnsw] Building HNSWIndex (dims=${EMBED_DIM}, M=${HNSW_M}, ef=${HNSW_EF})…`);
  const t1 = Date.now();
  const hnsw = new HNSWIndex(EMBED_DIM, HNSW_M, HNSW_EF);

  let i = 0;
  for (const row of rows) {
    const vec = new Float32Array(row.embedding.buffer,
      row.embedding.byteOffset, row.embedding.byteLength / 4);
    hnsw.insert(row.verse_id, vec);
    if (++i % 5000 === 0) {
      process.stdout.write(`\r  inserted ${i}/${rows.length}…`);
    }
  }
  process.stdout.write('\n');
  const buildMs = Date.now() - t1;
  console.log(`[prebake-hnsw] Built ${hnsw.nodes.length} nodes in ${buildMs} ms`);

  // Serialise
  console.log('[prebake-hnsw] Serialising…');
  const t2 = Date.now();
  const blob = hnsw.serialize();
  console.log(`[prebake-hnsw] Serialised to ${(blob.byteLength / 1024 / 1024).toFixed(2)} MB in ${Date.now() - t2} ms`);

  // Store
  db.prepare(
    'INSERT OR REPLACE INTO hnsw_index (key, data, built_at) VALUES (?, ?, ?)'
  ).run(storeKey, blob, Date.now());
  console.log(`[prebake-hnsw] Stored under key="${storeKey}"  total=${Date.now() - t0} ms`);

  db.close();
  console.log('[prebake-hnsw] Done.');
}

main();
