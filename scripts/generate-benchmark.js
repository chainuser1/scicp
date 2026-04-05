'use strict';
/**
 * scripts/generate-benchmark.js
 *
 * Generates silver-label benchmark queries from three human-curated sources:
 *   Tier 1 — Topical Guide (TG): theological topic → verse mappings
 *   Tier 2 — Verse cross-references: semantically linked verse pairs
 *   Tier 3 — Verse summaries: AI paraphrase of verse meaning
 *
 * Silver labels are NOT derived from the 768D model — they come from
 * human-curated TG, human-curated cross-refs, and AI summaries written
 * against the scripture text directly. No circularity.
 *
 * Usage:
 *   node scripts/generate-benchmark.js [--dry-run] [--merge]
 *
 *   (no flags)   Write candidates to resources/search-benchmark-candidates.json
 *   --dry-run    Print counts only, write nothing
 *   --merge      Merge candidates directly into resources/search-benchmark.json
 */

const path = require('path');
const fs   = require('fs');
const DB   = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');

// ── Open DBs ─────────────────────────────────────────────────────────────────
const mainDb = new DB(path.join(ROOT, 'resources/db/lds-scriptures-sqlite.db'), { readonly: true });
const tgDb   = new DB(path.join(ROOT, 'resources/db/topical-guide.db'),          { readonly: true });
const xrefDb = new DB(path.join(ROOT, 'resources/db/verse-cross-refs.db'),       { readonly: true });
const summDb = new DB(path.join(ROOT, 'resources/db/verse-summaries.db'),        { readonly: true });

// ── Load existing benchmark (for dedup) ──────────────────────────────────────
const benchPath   = path.join(ROOT, 'resources/search-benchmark.json');
const existing    = JSON.parse(fs.readFileSync(benchPath, 'utf8'));
const existingIds = new Set(existing.queries.map(q => q.id));

const candidates = [];

// ── Helpers ───────────────────────────────────────────────────────────────────
function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const _verseTitleStmt = mainDb.prepare('SELECT verse_title FROM scriptures WHERE verse_id = ? LIMIT 1');
const _titleCache = new Map();
function verseIdToTitle(id) {
  if (!_titleCache.has(id)) _titleCache.set(id, _verseTitleStmt.get(id)?.verse_title ?? null);
  return _titleCache.get(id);
}

const getVerseByTitle = mainDb.prepare(
  'SELECT verse_id, scripture_text FROM scriptures WHERE verse_title = ? LIMIT 1'
);

function add(candidate) {
  if (!existingIds.has(candidate.id)) {
    candidates.push(candidate);
    existingIds.add(candidate.id); // prevent self-duplicates within same run
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TIER 1: Topical Guide → topical queries
//
// Strategy: for each focused theological topic (3–20 verses), generate:
//   - a keyword query   (topic name lowercased)
//   - a question query  (multi-word topics only)
// Expected: any of the topic's top-5 verses appear in top-10.
// ─────────────────────────────────────────────────────────────────────────────

// Only keep theologically meaningful topics — skip generic action words
const THEOLOGICAL_KEYWORDS = [
  'atonement', 'baptis', 'prayer', 'resurrect', 'repent', 'covenant',
  'salvation', 'savior', 'grace', 'mercy', 'faith', 'forgiv', 'charity',
  'obedien', 'sacrifice', 'priesthood', 'eternal', 'truth', 'holy ghost',
  'jesus christ', 'commandm', 'righteous', 'humil', 'temple', 'ordinan',
  'redeem', 'judgment', 'love of god', 'light of christ', 'resurrection',
  'prophet', 'scripture', 'revelation', 'witness', 'testimony', 'zion',
  'peace', 'hope', 'pure in heart', 'virtue', 'conversion', 'mission',
  'agency', 'creation', 'spirit world', 'eternal life', 'holy spirit',
  'family, eternal', 'baptism for the dead', 'poor in spirit',
  'priesthood, oath', 'salvation of little',
];

const tgTopics = tgDb.prepare(`
  SELECT t.name, t.slug, count(tv.verse_id) AS cnt
  FROM topics t
  JOIN topic_verse_index tv ON t.slug = tv.topic_slug
  GROUP BY t.slug
  HAVING cnt BETWEEN 3 AND 20
  ORDER BY t.name
`).all();

const getTopicVerses = tgDb.prepare(`
  SELECT tv.verse_id FROM topic_verse_index tv WHERE tv.topic_slug = ? LIMIT 8
`);

for (const topic of tgTopics) {
  const nameLower = topic.name.toLowerCase();
  const isTheological = THEOLOGICAL_KEYWORDS.some(kw => nameLower.includes(kw));
  if (!isTheological) continue;

  const verseIds    = getTopicVerses.all(topic.slug).map(r => r.verse_id);
  const verseTitles = verseIds.map(verseIdToTitle).filter(Boolean);
  if (verseTitles.length < 2) continue;

  // Form 1: keyword query
  add({
    id: `tg-${slugify(topic.name)}`,
    label: `TG: ${topic.name}`,
    category: 'topical',
    query: nameLower,
    expectedVerseTitles: verseTitles.slice(0, 5),
    targetRankThreshold: 10,
    notes: `Silver label from Topical Guide (${topic.cnt} mapped verses)`,
  });

  // Form 2: question form (multi-word topics only)
  if (topic.name.includes(' ')) {
    add({
      id: `tg-q-${slugify(topic.name)}`,
      label: `TG question: ${topic.name}`,
      category: 'topical',
      query: `what does scripture say about ${nameLower}`,
      expectedVerseTitles: verseTitles.slice(0, 5),
      targetRankThreshold: 10,
      notes: `Silver label from Topical Guide (question form)`,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TIER 2: Cross-references → semantic verse-pair queries
//
// Strategy: for each seed verse, query = the verse's own text.
// Expected: the verse itself at rank 1, AND at least one of its cross-refs
// in top-5. This tests whether semantically linked verses cluster correctly.
// ─────────────────────────────────────────────────────────────────────────────

// Curated list of well-known doctrinal verses with meaningful cross-refs
const XREF_SEED_VERSES = [
  // New Testament
  'John 3:16', 'John 1:1', 'John 11:25', 'John 14:6', 'John 15:12',
  'Matthew 5:3', 'Matthew 5:44', 'Matthew 6:9', 'Matthew 22:37', 'Matthew 22:39',
  'Romans 5:8', 'Romans 8:28', 'Ephesians 2:8', 'Philippians 4:7', 'Philippians 4:13',
  '1 Corinthians 13:4', '1 Corinthians 13:13', 'James 1:5', 'James 2:17',
  'Hebrews 11:1', '1 John 4:8',
  // Old Testament
  'Proverbs 3:5', 'Proverbs 3:6', 'Psalms 23:1', 'Isaiah 53:5', 'Isaiah 40:31',
  'Isaiah 1:18', 'Jeremiah 29:11', 'Joshua 24:15', 'Micah 6:8',
  // Book of Mormon
  '2 Nephi 2:25', '2 Nephi 2:27', '2 Nephi 31:20', '1 Nephi 3:7',
  'Alma 32:21', 'Alma 34:9', 'Alma 42:15', 'Mosiah 3:19', 'Mosiah 4:9',
  'Moroni 7:45', 'Moroni 10:4', 'Moroni 10:5',
  '3 Nephi 11:10', '3 Nephi 27:27',
  // D&C / PGP
  'Doctrine and Covenants 4:2', 'Doctrine and Covenants 76:22',
  'Doctrine and Covenants 121:7', 'Doctrine and Covenants 121:8',
  'Doctrine and Covenants 130:22', 'Moses 1:39', 'Abraham 3:22',
];

// Note: xrefDb cross-references are alphabetically sorted, not semantically ranked.
// We use it only for verifying verse existence; semantic pairs are manually curated below.

for (const title of XREF_SEED_VERSES) {
  const row = getVerseByTitle.get(title);
  if (!row) continue;

  // Cross-refs in this DB are alphabetically sorted, not semantically ranked.
  // Use the verse's own text as the query and only require the verse itself at
  // rank 1 — a full-sentence retrieval sanity check (harder than phrase-fragment
  // because full sentences can match many verses; the right one must still top).
  add({
    id: `xref-${slugify(title)}`,
    label: `Full-sentence retrieval: ${title}`,
    category: 'cross-reference',
    query: row.scripture_text.slice(0, 200),
    expectedVerseTitles: [title],
    targetRankThreshold: 1,
    notes: `Querying a verse's own text must return it at rank 1 (baseline sanity).`,
  });
}

// Tier 2b: Manually-curated semantic pairs — verse A text → verse B expected.
// These come from doctrinal equivalence, NOT from the alphabetically-sorted DB.
const SEMANTIC_PAIRS = [
  // Faith definitions
  { queryTitle: 'Hebrews 11:1',          expectedTitle: 'Alma 32:21',              label: 'Faith definition pair (Hebrews ↔ Alma)' },
  // "I am the resurrection" ↔ resurrection prophecy in Isaiah
  { queryTitle: 'John 11:25',            expectedTitle: 'Isaiah 26:19',            label: 'Resurrection promise pair' },
  // "Love one another" commandment cluster
  { queryTitle: 'John 15:12',            expectedTitle: 'Moroni 7:45',             label: 'Love commandment pair (John ↔ Moroni)' },
  // Work and glory ↔ immortality and eternal life
  { queryTitle: 'Moses 1:39',            expectedTitle: '2 Nephi 10:23',           label: 'Eternal life purpose pair' },
  // Wisdom asks — James ↔ D&C
  { queryTitle: 'James 1:5',             expectedTitle: 'Doctrine and Covenants 42:68', label: 'Ask in faith pair (James ↔ D&C)' },
  // All things work for good — Romans ↔ D&C
  { queryTitle: 'Romans 8:28',           expectedTitle: 'Doctrine and Covenants 90:24', label: 'All things work for good pair' },
  // Men are that they might have joy ↔ gospel purpose
  { queryTitle: '2 Nephi 2:25',          expectedTitle: 'Alma 34:9',              label: 'Atonement purpose pair (2 Ne ↔ Alma)' },
  // Natural man pair
  { queryTitle: 'Mosiah 3:19',           expectedTitle: '1 Corinthians 2:14',     label: 'Natural man pair (Mosiah ↔ 1 Cor)' },
];

for (const pair of SEMANTIC_PAIRS) {
  const row = getVerseByTitle.get(pair.queryTitle);
  if (!row) continue;
  // Confirm expected verse exists
  const expectedRow = getVerseByTitle.get(pair.expectedTitle);
  if (!expectedRow) continue;

  add({
    id: `sempair-${slugify(pair.queryTitle)}-${slugify(pair.expectedTitle)}`,
    label: `Semantic pair: ${pair.label}`,
    category: 'cross-reference',
    query: row.scripture_text.slice(0, 200),
    expectedVerseTitles: [pair.queryTitle, pair.expectedTitle],
    targetRankThreshold: 5,
    notes: `Manually curated semantic pair — no circularity with embeddings.`,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// TIER 3: Verse summaries → paraphrase queries
//
// Strategy: extract the most paraphrase-like sentence from the summary
// (not the first sentence which tends to be generic); use it as a query.
// Expected: the verse itself in top-5.
// ─────────────────────────────────────────────────────────────────────────────

const SUMMARY_SEED_VERSES = [
  // PGP / D&C
  'Moses 1:39', 'Abraham 3:22', 'Doctrine and Covenants 76:22',
  'Doctrine and Covenants 121:7', 'Doctrine and Covenants 4:2',
  'Doctrine and Covenants 130:22',
  // Book of Mormon
  '2 Nephi 2:25', '2 Nephi 31:20', '1 Nephi 3:7',
  'Alma 32:21', 'Mosiah 3:19', 'Moroni 10:4', 'Moroni 10:5',
  '3 Nephi 11:10',
  // New Testament
  'John 3:16', 'John 14:6', 'John 11:25', 'Matthew 5:3', 'Matthew 5:44',
  'Matthew 6:9', 'Matthew 22:37', 'James 1:5', '1 Corinthians 13:4',
  'Romans 8:28', 'Hebrews 11:1', 'Philippians 4:13', '1 John 4:8',
  // Old Testament
  'Isaiah 53:5', 'Isaiah 40:31', 'Proverbs 3:5', 'Psalms 23:1', 'Joshua 24:15',
];

const getSummary = summDb.prepare(
  'SELECT summary FROM verse_summaries WHERE verse_id = ?'
);

for (const title of SUMMARY_SEED_VERSES) {
  const row = getVerseByTitle.get(title);
  if (!row) continue;

  const summRow = getSummary.get(row.verse_id);
  if (!summRow?.summary) continue;

  // Split into sentences; find the best paraphrase candidate:
  // - skip first sentence (often "The verse states that...")
  // - prefer 50–180 chars
  const sentences = summRow.summary
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim());

  const candidate = sentences
    .slice(1) // skip opener
    .find(s => s.length >= 50 && s.length <= 180 && !/^(The verse|This verse|Based on|Within the)/i.test(s));

  if (!candidate) continue;

  // Normalise: lowercase, strip trailing period, trim leading "It "
  const query = candidate
    .replace(/^(It |He |She )/, '')
    .toLowerCase()
    .replace(/\.$/, '')
    .trim();

  if (query.length < 40) continue;

  add({
    id: `summ-${slugify(title)}`,
    label: `Summary paraphrase: ${title}`,
    category: 'semantic-paraphrase',
    query,
    expectedVerseTitles: [title],
    targetRankThreshold: 5,
    notes: 'Silver label derived from verse summary (not from embedding output).',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Output
// ─────────────────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const dryRun  = args.includes('--dry-run');
const doMerge = args.includes('--merge');

const tier1 = candidates.filter(c => c.id.startsWith('tg-')).length;
const tier2 = candidates.filter(c => c.id.startsWith('xref-')).length;
const tier3 = candidates.filter(c => c.id.startsWith('summ-')).length;

console.log(`\nGenerated ${candidates.length} new benchmark candidates`);
console.log(`  Tier 1 (topical guide):    ${tier1}`);
console.log(`  Tier 2 (cross-references): ${tier2}`);
console.log(`  Tier 3 (verse summaries):  ${tier3}`);
console.log(`  Existing queries kept:     ${existing.queries.length}`);

if (dryRun) {
  console.log('\n--dry-run: no files written.');
  process.exit(0);
}

// Strip internal-only fields before writing
function clean(c) {
  const { ...rest } = c;
  return rest;
}

if (doMerge) {
  existing.queries.push(...candidates.map(clean));
  fs.writeFileSync(benchPath, JSON.stringify(existing, null, 2));
  console.log(`\nMerged → ${benchPath}  (total queries: ${existing.queries.length})`);
} else {
  const outPath = path.join(ROOT, 'resources/search-benchmark-candidates.json');
  fs.writeFileSync(outPath, JSON.stringify({
    description: 'Auto-generated silver-label candidates — review then run --merge',
    generated: new Date().toISOString(),
    totalCandidates: candidates.length,
    tier1_topical: tier1,
    tier2_crossref: tier2,
    tier3_summary: tier3,
    queries: candidates.map(clean),
  }, null, 2));
  console.log(`\nCandidates written → resources/search-benchmark-candidates.json`);
  console.log('Review, then run: node scripts/generate-benchmark.js --merge');
}

// Sample preview
console.log('\nSample:');
for (const c of candidates.slice(0, 8)) {
  console.log(`  [${c.category.padEnd(18)}] "${c.query.slice(0, 65)}" → ${c.expectedVerseTitles[0]}`);
}
