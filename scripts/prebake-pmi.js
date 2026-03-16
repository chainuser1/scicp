#!/usr/bin/env node
// Pre-bake PMI (Pointwise Mutual Information) query expansion table
// For every vocabulary term AND significant bigram, compute top-10 statistically associated terms
// PMI(x,y) = log2( P(x,y) / (P(x)*P(y)) )
// where P(x,y) = proportion of verses containing both x and y
//
// Output: term_pmi table in lds-scriptures-sqlite.db
//   term TEXT, assoc TEXT, pmi REAL, cooccur INTEGER
//   Includes both unigrams AND bigrams (e.g., "plan salvation", "thou art")

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'resources', 'db', 'lds-scriptures-sqlite.db');
const TOP_K = 10;            // top-K associations per term
const MIN_COOCCUR = 3;       // minimum co-occurrence count to consider
const MIN_DOC_FREQ = 5;      // skip extremely rare terms (noise)
const MAX_DOC_FREQ = 20000;  // skip extremely common terms (uninformative)
const MIN_BIGRAM_DF = 3;     // minimum doc freq for bigrams

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('cache_size = -512000');

// ── Step 1: Load unigram vocabulary ──
console.log('Loading vocabulary...');
const vocabRows = db.prepare('SELECT term, doc FROM scriptures_fts_vocab').all();
const vocab = new Map();
for (const { term, doc } of vocabRows) {
  if (doc >= MIN_DOC_FREQ && doc <= MAX_DOC_FREQ && term.length > 1) {
    vocab.set(term, doc);
  }
}
console.log(`  ${vocab.size} unigram terms after filtering`);

const TOTAL_DOCS = db.prepare('SELECT COUNT(*) AS n FROM verses').get().n;
console.log(`  ${TOTAL_DOCS} total documents`);

// ── Step 2: Build unigram inverted index via FTS ──
console.log('Building unigram inverted index from FTS...');
const termVerses = new Map(); // term → Set<verse_id>
const terms = [...vocab.keys()];
const ftsStmt = db.prepare(
  `SELECT verse_id FROM scriptures_fts WHERE scriptures_fts MATCH ? LIMIT 25000`
);

let loaded = 0;
for (const term of terms) {
  try {
    const escaped = '"' + term.replace(/"/g, '""') + '"';
    const rows = ftsStmt.all(escaped);
    const verseSet = new Set(rows.map(r => r.verse_id));
    if (verseSet.size >= MIN_COOCCUR) {
      termVerses.set(term, verseSet);
    }
  } catch {}
  loaded++;
  if (loaded % 1000 === 0) process.stdout.write(`  Indexed ${loaded}/${terms.length}\r`);
}
console.log(`  Indexed ${termVerses.size} unigram terms with verse sets`);

// ── Step 3: Extract bigrams from raw scripture text ──
console.log('Extracting bigrams from scripture text...');
// Stopwords to skip in bigrams (function words that don't form meaningful phrases)
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

const bigramVerses = new Map(); // "word1 word2" → Set<verse_id>
const allVerses = db.prepare('SELECT id AS verse_id, scripture_text FROM verses').all();

for (const { verse_id, scripture_text } of allVerses) {
  if (!scripture_text) continue;
  const words = scripture_text.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(w => w.length > 1);
  for (let i = 0; i < words.length - 1; i++) {
    const w1 = words[i], w2 = words[i + 1];
    // Skip if both are stopwords (e.g., "of the"), keep if at least one is content
    if (STOP.has(w1) && STOP.has(w2)) continue;
    const bigram = w1 + ' ' + w2;
    if (!bigramVerses.has(bigram)) bigramVerses.set(bigram, new Set());
    bigramVerses.get(bigram).add(verse_id);
  }
}

// Filter: keep bigrams with sufficient document frequency
// For PMI, we need a higher threshold to keep the O(n²) computation tractable
let bigramCount = 0;
for (const [bigram, verseSet] of bigramVerses) {
  if (verseSet.size < MIN_BIGRAM_DF || verseSet.size > MAX_DOC_FREQ) {
    bigramVerses.delete(bigram);
  } else {
    bigramCount++;
  }
}

// Only keep top bigrams by document frequency for PMI (O(n²) constraint)
// We want meaningful phrases, not noise — keep bigrams with df >= 10
const MAX_BIGRAMS_FOR_PMI = 5000;
const bigramsByDf = [...bigramVerses.entries()]
  .map(([bg, vs]) => [bg, vs, vs.size])
  .filter(([, , df]) => df >= 10)
  .sort((a, b) => b[2] - a[2])
  .slice(0, MAX_BIGRAMS_FOR_PMI);

bigramVerses.clear();
for (const [bg, vs] of bigramsByDf) {
  bigramVerses.set(bg, vs);
}
bigramCount = bigramVerses.size;
console.log(`  ${bigramCount} bigrams kept for PMI (top by df, min df=10)`);

// Merge bigrams into termVerses for unified PMI computation
for (const [bigram, verseSet] of bigramVerses) {
  termVerses.set(bigram, verseSet);
}

// ── Step 4: Compute PMI for all co-occurring term pairs ──
console.log('Computing PMI co-occurrences (unigrams + bigrams)...');

db.exec(`
  DROP TABLE IF EXISTS term_pmi;
  CREATE TABLE term_pmi (
    term TEXT NOT NULL,
    assoc TEXT NOT NULL,
    pmi REAL NOT NULL,
    cooccur INTEGER NOT NULL,
    PRIMARY KEY (term, assoc)
  );
`);

const insert = db.prepare('INSERT INTO term_pmi (term, assoc, pmi, cooccur) VALUES (?, ?, ?, ?)');
let totalPairs = 0;
let termsDone = 0;

const termList = [...termVerses.keys()];

const tx = db.transaction(() => {
  for (let i = 0; i < termList.length; i++) {
    const termA = termList[i];
    const setA = termVerses.get(termA);
    const pA = setA.size / TOTAL_DOCS;

    const scores = [];
    for (let j = 0; j < termList.length; j++) {
      if (i === j) continue;
      const termB = termList[j];
      // Skip bigram↔bigram pairs (too noisy, combinatorial explosion)
      if (termA.includes(' ') && termB.includes(' ')) continue;
      const setB = termVerses.get(termB);

      let cooccur = 0;
      const smaller = setA.size < setB.size ? setA : setB;
      const larger = setA.size < setB.size ? setB : setA;
      for (const v of smaller) {
        if (larger.has(v)) cooccur++;
      }
      if (cooccur < MIN_COOCCUR) continue;

      const pB = setB.size / TOTAL_DOCS;
      const pAB = cooccur / TOTAL_DOCS;
      const pmi = Math.log2(pAB / (pA * pB));
      const npmi = pmi / (-Math.log2(pAB));

      if (npmi > 0.05) {
        scores.push({ term: termB, npmi, cooccur });
      }
    }

    scores.sort((a, b) => b.npmi - a.npmi);
    for (let k = 0; k < Math.min(TOP_K, scores.length); k++) {
      const s = scores[k];
      insert.run(termA, s.term, +s.npmi.toFixed(6), s.cooccur);
      totalPairs++;
    }

    termsDone++;
    if (termsDone % 500 === 0) {
      process.stdout.write(`  PMI: ${termsDone}/${termList.length} terms, ${totalPairs} pairs\r`);
    }
  }
});

tx();

db.exec('CREATE INDEX IF NOT EXISTS idx_term_pmi_term ON term_pmi(term)');

// Show some bigram examples
const bigramExamples = db.prepare(
  "SELECT term, assoc, pmi, cooccur FROM term_pmi WHERE term LIKE '% %' ORDER BY pmi DESC LIMIT 15"
).all();
console.log(`\n\nTop 15 bigram PMI associations:`);
for (const r of bigramExamples) {
  console.log(`  "${r.term}" → ${r.assoc} (NPMI=${r.pmi.toFixed(3)}, co=${r.cooccur})`);
}

console.log(`\n✅ PMI table built: ${totalPairs} associations for ${termsDone} terms (including bigrams)`);
db.close();
