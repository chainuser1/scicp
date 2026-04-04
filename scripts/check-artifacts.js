#!/usr/bin/env node
/**
 * check-artifacts.js — Post-prebake artifact sanity checker
 *
 * Validates that every prebaked SQLite artifact (embeddings, graph, tags, etc.)
 * meets its minimum row-count and embedding-dimension requirements. Run after
 * any prebake script to confirm the build is not corrupt or truncated.
 *
 * Usage:
 *   node scripts/check-artifacts.js
 *   node scripts/check-artifacts.js --strict   # exit 1 on any warning too
 */
'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, '..', 'resources', 'db');
const STRICT = process.argv.includes('--strict');

// ── Helpers ──────────────────────────────────────────────────────────────────

function open(filename) {
  const file = path.join(DB_DIR, filename);
  if (!fs.existsSync(file)) return null;
  try { return Database(file, { readonly: true, fileMustExist: true }); } catch { return null; }
}

function tableExists(db, tableName) {
  return db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name=?").get(tableName)?.n > 0;
}

function rowCount(db, tableName) {
  if (!tableExists(db, tableName)) return null;
  return db.prepare(`SELECT COUNT(*) AS n FROM ${tableName}`).get().n;
}

function blobDim(db, tableName, colName) {
  if (!tableExists(db, tableName)) return null;
  const row = db.prepare(`SELECT ${colName} FROM ${tableName} LIMIT 1`).get();
  if (!row || !row[colName]) return null;
  const buf = row[colName];
  return Buffer.isBuffer(buf) ? Math.round(buf.length / 4) : null;
}

// ── Result tracking ──────────────────────────────────────────────────────────

const results = [];

function check(label, condition, detail = '', level = 'error') {
  results.push({ label, passed: condition, detail, level });
}

function rowCheck(label, n, minRows, detail = '') {
  if (n === null) {
    check(label, false, `table missing${detail ? ' — ' + detail : ''}`, 'error');
  } else {
    check(label, n >= minRows, `${n.toLocaleString()} rows (min ${minRows.toLocaleString()})${detail ? ' — ' + detail : ''}`, n >= minRows ? 'ok' : 'error');
  }
}

function dimCheck(label, actual, expected, detail = '') {
  if (actual === null) {
    check(label, false, `blob column missing or empty${detail ? ' — ' + detail : ''}`, 'error');
  } else {
    check(label, actual === expected, `dim=${actual} (expected ${expected})${detail ? ' — ' + detail : ''}`, actual === expected ? 'ok' : 'error');
  }
}

function dbCheck(label, db, warnMissing = false) {
  if (!db) {
    check(`${label} open`, false, 'file missing or unreadable', warnMissing ? 'warn' : 'error');
    return false;
  }
  return true;
}

// ── Checks ───────────────────────────────────────────────────────────────────

// Verse count oracle — total English verses in the primary scripture DB.
const TOTAL_VERSES = 41995;
const TG_VERSES    = 21991; // LDS volumes only in topical guide

function checkVerseEmbeddings(db) {
  rowCheck('verse_embeddings rows', rowCount(db, 'verse_embeddings'), TOTAL_VERSES);
  dimCheck('verse_embeddings dim',  blobDim(db, 'verse_embeddings', 'embedding'), 768);
  rowCheck('verse_svd rows',        rowCount(db, 'verse_svd'),       TOTAL_VERSES, 'SVD-reduced embeddings');
  dimCheck('verse_svd dim',         blobDim(db, 'verse_svd', 'svd_vector'), 100, 'SVD-100D');
  const hnswN = rowCount(db, 'hnsw_index');
  check('hnsw_index present', hnswN !== null && hnswN >= 1, `${hnswN} row(s)  (needs ≥ 1 saved index)`);
}

function checkVerseGraph(db) {
  rowCheck('verse_knn rows',      rowCount(db, 'verse_knn'),      750000, 'kNN edges');
  rowCheck('verse_rwr rows',      rowCount(db, 'verse_rwr'),      350000, 'RWR propagation table');
  rowCheck('verse_spectral rows', rowCount(db, 'verse_spectral'), 35000,  'spectral embeddings (partial is OK)');
  dimCheck('verse_spectral dim',  blobDim(db, 'verse_spectral', 'embedding'), 50, 'spectral-50D');
  rowCheck('verse_clusters rows', rowCount(db, 'verse_clusters'), TOTAL_VERSES);
  rowCheck('cluster_labels rows', rowCount(db, 'cluster_labels'), 100, 'cluster centroid labels');
}

function checkVerseTags(db) {
  rowCheck('verse_doctrine_tags rows',  rowCount(db, 'verse_doctrine_tags'),  TOTAL_VERSES);
  rowCheck('ai_entity_verse_map rows',  rowCount(db, 'ai_entity_verse_map'),  50000, 'entity→verse links');
  rowCheck('ai_entity_index rows',      rowCount(db, 'ai_entity_index'),      15000, 'entity search index');
  rowCheck('ai_entity_profiles rows',   rowCount(db, 'ai_entity_profiles'),   3000,  'entity profile records');
  rowCheck('ai_entity_centroids rows',  rowCount(db, 'ai_entity_centroids'),  3000,  'entity centroid vectors');
  dimCheck('ai_entity_centroids dim',   blobDim(db, 'ai_entity_centroids', 'centroid'), 768);
}

function checkTopicalGuide(db) {
  rowCheck('topics rows',           rowCount(db, 'topics'),           2000,  'topical guide entries');
  rowCheck('topical_guide rows',    rowCount(db, 'topical_guide'),    50000, 'topic→verse links');
  rowCheck('topic_ppr rows',        rowCount(db, 'topic_ppr'),        300000,'topic PPR table');
  rowCheck('topic_verse_index rows',rowCount(db, 'topic_verse_index'),50000, 'pre-baked reverse index');
  rowCheck('verse_pagerank rows',   rowCount(db, 'verse_pagerank'),   TG_VERSES);
}

function checkConcepts(db) {
  rowCheck('concepts rows', rowCount(db, 'concepts'), 5000, 'concept phrase embeddings');
  dimCheck('concepts dim',  blobDim(db, 'concepts', 'embedding'), 768);
}

function checkVerseSummaries(db) {
  rowCheck('verse_summaries rows', rowCount(db, 'verse_summaries'), TOTAL_VERSES);
}

function checkCrossRefs(db) {
  rowCheck('verse_cross_references rows', rowCount(db, 'verse_cross_references'), 15000);
}

// ── Run all checks ────────────────────────────────────────────────────────────

const dbs = {
  embed:   open('verse-embeddings.db'),
  graph:   open('verse-graph.db'),
  tags:    open('verse-tags.db'),
  tg:      open('topical-guide.db'),
  concept: open('concept-embeddings.db'),
  summ:    open('verse-summaries.db'),
  xref:    open('verse-cross-refs.db'),
};

check('verse-embeddings.db accessible',  !!dbs.embed);
check('verse-graph.db accessible',       !!dbs.graph);
check('verse-tags.db accessible',        !!dbs.tags);
check('topical-guide.db accessible',     !!dbs.tg);
check('concept-embeddings.db accessible',!!dbs.concept);
check('verse-summaries.db accessible',   !!dbs.summ,  '', 'warn');
check('verse-cross-refs.db accessible',  !!dbs.xref,  '', 'warn');

if (dbs.embed)   checkVerseEmbeddings(dbs.embed);
if (dbs.graph)   checkVerseGraph(dbs.graph);
if (dbs.tags)    checkVerseTags(dbs.tags);
if (dbs.tg)      checkTopicalGuide(dbs.tg);
if (dbs.concept) checkConcepts(dbs.concept);
if (dbs.summ)    checkVerseSummaries(dbs.summ);
if (dbs.xref)    checkCrossRefs(dbs.xref);

for (const db of Object.values(dbs)) {
  try { db?.close(); } catch {}
}

// ── Report ────────────────────────────────────────────────────────────────────

const errors   = results.filter(r => !r.passed && r.level === 'error');
const warnings = results.filter(r => !r.passed && r.level === 'warn');
const passed   = results.filter(r => r.passed);

console.log(`\nArtifact sanity check — ${results.length} checks`);
console.log(`  PASS: ${passed.length}  WARN: ${warnings.length}  FAIL: ${errors.length}\n`);

for (const r of results) {
  const icon = r.passed ? '✓' : (r.level === 'warn' ? '⚠' : '✗');
  const detail = r.detail ? `  ${r.detail}` : '';
  console.log(`  ${icon}  ${r.label}${detail}`);
}

if (errors.length > 0) {
  console.error(`\n${errors.length} error(s) found — artifacts may be incomplete or corrupt.`);
  process.exit(1);
} else if (STRICT && warnings.length > 0) {
  console.error(`\n${warnings.length} warning(s) found (--strict mode).`);
  process.exit(1);
} else {
  console.log('\nAll critical artifact checks passed.');
  process.exit(0);
}
