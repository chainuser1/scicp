#!/usr/bin/env node
// Pre-bake LLR (Log-Likelihood Ratio / Dunning's G-test) term weights
// Computes for both unigrams AND bigrams (phrases)
//
// LLR identifies terms/phrases that are statistically surprising given the corpus distribution.
// Bigram LLR identifies significant phrases like "plan salvation", "thou art", "second coming"
//
// G = 2 * Σ(O * ln(O/E)) for the 2x2 contingency table
//
// Output: term_llr table in lds-scriptures-sqlite.db
//   term TEXT, doc_freq INTEGER, llr REAL, idf REAL, burstiness REAL
//   Includes both unigrams and bigrams

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'resources', 'db', 'lds-scriptures-sqlite.db');
const MIN_BIGRAM_DF = 3;

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

console.log('Computing LLR term weights (unigrams + bigrams)...');

const TOTAL_DOCS = db.prepare('SELECT COUNT(*) AS n FROM verses').get().n;
const vocabRows = db.prepare('SELECT term, doc, cnt FROM scriptures_fts_vocab').all();
console.log(`  ${vocabRows.length} unigram vocabulary terms, ${TOTAL_DOCS} documents`);

const TOTAL_TOKENS = vocabRows.reduce((sum, r) => sum + r.cnt, 0);

// ── Extract bigrams from raw text ──
console.log('Extracting bigrams from scripture text...');
const STOP = new Set([
  'a','an','the','and','or','but','of','to','in','for','is','it','on',
  'at','by','from','with','as','be','was','were','are','been','being',
  'have','has','had','do','does','did','will','shall','would','should',
  'may','might','can','could','not','no','nor','so','if','than','that',
  'this','these','those','which','who','whom','what','where','when','how',
  'all','each','every','both','few','more','most','some','any','such',
  'into','upon','about','also','them','they','their','there','then',
  'him','his','her','she','he','we','our','you','your','me','us',
  'i','ye','thee','thy'
]);

const bigramStats = new Map(); // "word1 word2" → { df: Set<verse_id>, cf: number }
const allVerses = db.prepare('SELECT id AS verse_id, scripture_text FROM verses').all();

for (const { verse_id, scripture_text } of allVerses) {
  if (!scripture_text) continue;
  const words = scripture_text.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(w => w.length > 1);
  const seenInVerse = new Set();
  for (let i = 0; i < words.length - 1; i++) {
    const w1 = words[i], w2 = words[i + 1];
    if (STOP.has(w1) && STOP.has(w2)) continue;
    const bigram = w1 + ' ' + w2;
    if (!bigramStats.has(bigram)) bigramStats.set(bigram, { df: new Set(), cf: 0 });
    const entry = bigramStats.get(bigram);
    entry.df.add(verse_id);
    entry.cf++;
  }
}

// Filter bigrams
let bigramCount = 0;
for (const [bigram, stats] of bigramStats) {
  if (stats.df.size < MIN_BIGRAM_DF) {
    bigramStats.delete(bigram);
  } else {
    bigramCount++;
  }
}
console.log(`  ${bigramCount} bigrams after filtering (df >= ${MIN_BIGRAM_DF})`);

// Total bigram tokens for normalization
const TOTAL_BIGRAM_TOKENS = [...bigramStats.values()].reduce((sum, s) => sum + s.cf, 0);

function dunningG(observed, expected, total) {
  if (observed === 0 || observed === total) return 0;
  if (expected === 0 || expected >= total) return 0;
  let g = 0;
  const notObs = total - observed;
  const notExp = total - expected;
  if (observed > 0 && expected > 0) {
    g += observed * Math.log(observed / expected);
  }
  if (notObs > 0 && notExp > 0) {
    g += notObs * Math.log(notObs / notExp);
  }
  return 2 * g;
}

db.exec(`
  DROP TABLE IF EXISTS term_llr;
  CREATE TABLE term_llr (
    term TEXT PRIMARY KEY,
    doc_freq INTEGER NOT NULL,
    llr REAL NOT NULL,
    idf REAL NOT NULL,
    burstiness REAL NOT NULL
  );
`);

const insert = db.prepare(
  'INSERT INTO term_llr (term, doc_freq, llr, idf, burstiness) VALUES (?, ?, ?, ?, ?)'
);

let count = 0;
const tx = db.transaction(() => {
  // Unigrams
  for (const { term, doc, cnt } of vocabRows) {
    if (term.length < 2) continue;
    const df = doc;
    const cf = cnt;
    const expectedDf = TOTAL_DOCS * (cf / TOTAL_TOKENS);
    const llr = dunningG(df, expectedDf, TOTAL_DOCS);
    const idf = Math.log((TOTAL_DOCS + 1) / (df + 1)) + 1;
    const burstiness = df > 0 ? cf / df : 0;
    insert.run(term, df, +llr.toFixed(4), +idf.toFixed(6), +burstiness.toFixed(4));
    count++;
  }

  // Bigrams
  for (const [bigram, stats] of bigramStats) {
    const df = stats.df.size;
    const cf = stats.cf;
    const expectedDf = TOTAL_DOCS * (cf / TOTAL_BIGRAM_TOKENS);
    const llr = dunningG(df, expectedDf, TOTAL_DOCS);
    const idf = Math.log((TOTAL_DOCS + 1) / (df + 1)) + 1;
    const burstiness = df > 0 ? cf / df : 0;
    insert.run(bigram, df, +llr.toFixed(4), +idf.toFixed(6), +burstiness.toFixed(4));
    count++;
  }
});

tx();

db.exec('CREATE INDEX IF NOT EXISTS idx_term_llr_term ON term_llr(term)');

console.log('\nTop 15 unigrams by LLR:');
const topUni = db.prepare("SELECT term, doc_freq, llr, idf, burstiness FROM term_llr WHERE term NOT LIKE '% %' ORDER BY llr DESC LIMIT 15").all();
for (const r of topUni) {
  console.log(`  ${r.term.padEnd(20)} df=${String(r.doc_freq).padStart(5)} LLR=${String(r.llr).padStart(10)} IDF=${r.idf.toFixed(3)} burst=${r.burstiness.toFixed(2)}`);
}

console.log('\nTop 30 bigrams by LLR (significant phrases):');
const topBi = db.prepare("SELECT term, doc_freq, llr, idf, burstiness FROM term_llr WHERE term LIKE '% %' ORDER BY llr DESC LIMIT 30").all();
for (const r of topBi) {
  console.log(`  "${r.term}"`.padEnd(35) + ` df=${String(r.doc_freq).padStart(5)} LLR=${String(r.llr).padStart(10)} burst=${r.burstiness.toFixed(2)}`);
}

console.log(`\n✅ LLR table built: ${count} terms (unigrams + bigrams)`);
db.close();
