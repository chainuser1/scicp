const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const Database = require('better-sqlite3');
const { fastify } = require('../backend');

const OUTPUT_DIR = path.join(__dirname, '..', 'artifacts', 'search-baselines');
const DB_PATH = path.join(__dirname, '..', 'resources', 'db', 'lds-scriptures-sqlite.db');
const DEFAULT_SEED = Number(process.env.SEARCH_BASELINE_SEED || 20260404);
const DEFAULT_SAMPLE_COUNT = Number(process.env.SEARCH_BASELINE_RANDOM_COUNT || 24);
const DEFAULT_PAGE_SIZE = Number(process.env.SEARCH_BASELINE_PAGE_SIZE || 10);

const CURATED_QUERIES = [
  { id: 'exact-john-316', label: 'Exact reference', query: 'John 3:16', expectedVerseTitle: 'John 3:16' },
  { id: 'exact-1-ne-37', label: 'Book of Mormon reference', query: '1 Ne 3:7', expectedVerseTitle: '1 Nephi 3:7' },
  { id: 'exact-dc-76', label: 'Doctrine and Covenants reference', query: 'D&C 76', expectedVerseTitle: 'Doctrine and Covenants 76:1' },
  { id: 'semantic-battle', label: 'Paraphrased battle narrative', query: 'their generals died with ten thousand each', expectedVerseTitle: 'Mormon 6:14' },
  { id: 'semantic-nephi', label: 'Nephi family wording', query: 'nephi said unto my father', expectedVerseTitle: '1 Nephi 3:7' },
  { id: 'semantic-work-glory', label: 'Moses 1:39 wording', query: 'for behold my work and glory', expectedVerseTitle: 'Moses 1:39' },
  { id: 'situational-grief', label: 'Situational grief', query: 'dealing with grief' },
  { id: 'situational-temptation', label: 'Situational temptation', query: 'overcoming temptation' },
  { id: 'conceptual-faith', label: 'Conceptual faith', query: 'faith' },
  { id: 'conceptual-mercy', label: 'Conceptual mercy', query: 'mercy' },
  { id: 'phrase-revelation', label: 'Revelation phrase', query: 'lamb slain before the foundation foundation', expectedVerseTitle: 'Revelation 13:8' },
  { id: 'phrase-exhort', label: 'Exhort wording', query: 'and moreover i would exhort you' },
];

const STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'with', 'from', 'unto', 'into', 'upon', 'have', 'were', 'they', 'them', 'their',
  'this', 'there', 'which', 'shall', 'would', 'could', 'should', 'about', 'your', 'while', 'where', 'when',
  'then', 'than', 'been', 'being', 'those', 'these', 'because', 'through', 'after', 'before', 'under', 'over',
  'again', 'also', 'therefore', 'behold', 'came', 'come', 'said', 'made', 'make', 'thou', 'thee', 'thy', 'ye',
  'you', 'your', 'ours', 'ourselves', 'herself', 'himself', 'itself', 'myself', 'it', 'its', 'him', 'her', 'his',
  'our', 'are', 'was', 'who', 'whom', 'what', 'why', 'how', 'not', 'all', 'any', 'but', 'can', 'did', 'does', 'had',
  'has', 'let', 'may', 'might', 'much', 'must', 'nor', 'now', 'off', 'once', 'only', 'other', 'same', 'some', 'such',
  'than', 'too', 'very'
]);

function mulberry32(seed) {
  let state = seed >>> 0;
  return function random() {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function slugTimestamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function safeGit(command, fallback) {
  try {
    return execSync(command, { cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return fallback;
  }
}

function normalizeWords(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
}

function buildRandomFragmentQuery(scriptureText, random) {
  const words = normalizeWords(scriptureText);
  const contentWords = words.filter((word) => word.length >= 4 && !STOPWORDS.has(word));
  const sourceWords = contentWords.length >= 4 ? contentWords : words.filter((word) => word.length >= 3);

  if (sourceWords.length === 0) {
    return null;
  }

  const windowSize = Math.max(3, Math.min(sourceWords.length, 4 + Math.floor(random() * 4)));
  const maxStart = Math.max(0, sourceWords.length - windowSize);
  const start = maxStart > 0 ? Math.floor(random() * (maxStart + 1)) : 0;
  return sourceWords.slice(start, start + windowSize).join(' ');
}

function buildRandomQueries(sampleCount, seed) {
  const db = new Database(DB_PATH, { readonly: true });
  const rows = db.prepare(`
    SELECT verse_id, verse_title, scripture_text
    FROM scriptures
    WHERE length(scripture_text) BETWEEN 50 AND 280
    ORDER BY verse_id
  `).all();
  db.close();

  const random = mulberry32(seed);
  const picked = new Set();
  const queries = [];

  while (queries.length < sampleCount && picked.size < rows.length) {
    const index = Math.floor(random() * rows.length);
    if (picked.has(index)) {
      continue;
    }
    picked.add(index);

    const row = rows[index];
    const query = buildRandomFragmentQuery(row.scripture_text, random);
    if (!query || query.length < 12) {
      continue;
    }

    queries.push({
      id: `random-${queries.length + 1}`,
      label: `Random verse fragment ${queries.length + 1}`,
      query,
      expectedVerseTitle: row.verse_title,
      sourceVerseId: row.verse_id,
    });
  }

  return queries;
}

function summarizeResult(result, rank) {
  return {
    rank,
    verse_id: result.verse_id,
    verse_title: result.verse_title,
    book_title: result.book_title,
    chapter_number: result.chapter_number,
    verse_number: result.verse_number,
    similarity_score: result.similarity_score ?? null,
    specificity_score: result._specificity_score ?? null,
    tier: result._tier ?? null,
    source: result._source ?? null,
    scripture_text: result.scripture_text,
  };
}

async function captureQuerySnapshot(queryDef, pageSize) {
  const url = `/search?q=${encodeURIComponent(queryDef.query)}&pageSize=${pageSize}`;
  const response = await fastify.inject({ method: 'GET', url });
  const body = JSON.parse(response.payload);
  const topResults = Array.isArray(body.results)
    ? body.results.map((result, index) => summarizeResult(result, index + 1))
    : [];

  const expectedRank = queryDef.expectedVerseTitle
    ? topResults.findIndex((result) => result.verse_title === queryDef.expectedVerseTitle) + 1 || null
    : null;

  return {
    id: queryDef.id,
    label: queryDef.label,
    query: queryDef.query,
    expectedVerseTitle: queryDef.expectedVerseTitle || null,
    sourceVerseId: queryDef.sourceVerseId || null,
    statusCode: response.statusCode,
    total: body.total ?? 0,
    pageSize: body.pageSize ?? pageSize,
    meta: body.meta || null,
    expectedRank,
    topResults,
  };
}

async function main() {
  const generatedAt = new Date();
  const randomQueries = buildRandomQueries(DEFAULT_SAMPLE_COUNT, DEFAULT_SEED);
  const queries = [...CURATED_QUERIES, ...randomQueries];

  await fastify.ready();

  const snapshots = [];
  for (const queryDef of queries) {
    snapshots.push(await captureQuerySnapshot(queryDef, DEFAULT_PAGE_SIZE));
  }

  await fastify.close();

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const payload = {
    generatedAt: generatedAt.toISOString(),
    seed: DEFAULT_SEED,
    randomSampleCount: randomQueries.length,
    pageSize: DEFAULT_PAGE_SIZE,
    git: {
      branch: safeGit('git rev-parse --abbrev-ref HEAD', 'unknown'),
      commit: safeGit('git rev-parse HEAD', 'unknown'),
      dirty: safeGit('git status --short', '') !== '',
    },
    queries: snapshots,
  };

  const latestPath = path.join(OUTPUT_DIR, 'latest-current-model.json');
  const archivePath = path.join(OUTPUT_DIR, `search-baseline-${slugTimestamp(generatedAt)}.json`);
  const text = `${JSON.stringify(payload, null, 2)}\n`;

  fs.writeFileSync(latestPath, text);
  fs.writeFileSync(archivePath, text);

  console.log(`Saved search baseline to ${latestPath}`);
  console.log(`Archived search baseline to ${archivePath}`);
  console.log(`Captured ${snapshots.length} queries (${randomQueries.length} seeded-random + ${CURATED_QUERIES.length} curated).`);
}

main().catch(async (error) => {
  try {
    await fastify.close();
  } catch {
    // ignore close errors on failure cleanup
  }
  console.error(error);
  process.exitCode = 1;
});