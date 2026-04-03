/**
 * Entity Disambiguation Pipeline
 *
 * Mines verse summaries + uses AI to build disambiguated entity profiles
 * and map every entity mention to the correct identity.
 *
 * Usage:
 *   node scripts/build-entity-disambiguation.js --phase profiles    # Step 1: mine + AI validate profiles
 *   node scripts/build-entity-disambiguation.js --phase assign      # Step 2: score + AI disambiguate
 *   node scripts/build-entity-disambiguation.js --phase validate    # Step 3: random sample validation
 *   node scripts/build-entity-disambiguation.js --phase all         # All steps
 *   node scripts/build-entity-disambiguation.js --stats             # Show progress
 *   node scripts/build-entity-disambiguation.js --workers 5         # AI workers (default 3)
 */

const https = require('https');
const Database = require('better-sqlite3');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;

const MODEL = 'meta/llama-3.3-70b-instruct';
const FALLBACK_MODELS = [
  'nvidia/llama-3.3-nemotron-super-49b-v1',
  'meta/llama-3.1-405b-instruct',
  'deepseek-ai/deepseek-v3.2',
];
let fallbackIdx = 0;

const DB_TAGS   = path.resolve(__dirname, '../resources/db/verse-tags.db');
const DB_YLT = path.resolve(__dirname, '../resources/db/ylt-scriptures-sqlite.db');

const args = process.argv.slice(2);
const PHASE   = (() => { const i = args.indexOf('--phase'); return i !== -1 ? args[i + 1] : 'all'; })();
const WORKERS = (() => { const i = args.indexOf('--workers'); return i !== -1 ? parseInt(args[i + 1]) : 3; })();
const STATS   = args.includes('--stats');
const DELAY_MS = 400;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── NIM API ──────────────────────────────────────────────────────────────────

function nimRequest(model, prompt, maxTokens = 1500) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.1,
    });
    const req = https.request({
      hostname: 'integrate.api.nvidia.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${NVIDIA_API_KEY}`,
      },
    }, (res) => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`${res.statusCode}: ${data.slice(0, 200)}`));
        try {
          const j = JSON.parse(data);
          resolve(j.choices?.[0]?.message?.content?.trim() || '');
        } catch { reject(new Error('JSON parse failed')); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function aiCall(prompt, maxTokens = 1500) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const m = attempt === 0 ? MODEL : FALLBACK_MODELS[fallbackIdx % FALLBACK_MODELS.length];
      if (attempt > 0) fallbackIdx++;
      return await nimRequest(m, prompt, maxTokens);
    } catch (e) {
      const isRate = String(e).includes('429') || String(e).includes('rate');
      await sleep(isRate ? 15000 : 3000);
    }
  }
  throw new Error('All AI attempts failed');
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const db = new Database(DB_TAGS);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 10000');
  const ndb = new Database(DB_YLT, { readonly: true });

  // Ensure tables exist
  db.prepare(`
    CREATE TABLE IF NOT EXISTS entity_profiles (
      entity_id    TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      type         TEXT NOT NULL,
      qualifier    TEXT,
      book_start   TEXT,
      book_end     TEXT,
      description  TEXT,
      status       TEXT DEFAULT 'pending',
      verse_count  INTEGER DEFAULT 0
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS entity_verse_map (
      entity_id  TEXT NOT NULL,
      verse_id   INTEGER NOT NULL,
      confidence REAL DEFAULT 1.0,
      PRIMARY KEY (entity_id, verse_id)
    )
  `).run();
  try { db.prepare('CREATE INDEX idx_evm_entity ON entity_verse_map(entity_id)').run(); } catch {}
  try { db.prepare('CREATE INDEX idx_evm_verse ON entity_verse_map(verse_id)').run(); } catch {}

  // Verse → book mapping
  const verseBookMap = new Map();
  const allVerses = ndb.prepare(`
    SELECT v.id, b.book_title, vol.volume_title, b.id as book_id
    FROM verses v JOIN chapters c ON v.chapter_id=c.id JOIN books b ON c.book_id=b.id JOIN volumes vol ON b.volume_id=vol.id
  `).all();
  for (const v of allVerses) verseBookMap.set(v.id, { book: v.book_title, volume: v.volume_title, book_id: v.book_id });

  // ── Stats ────────────────────────────────────────────────────────────────
  if (STATS) {
    const profiles = db.prepare('SELECT status, COUNT(*) as c FROM entity_profiles GROUP BY status').all();
    const mapped = db.prepare('SELECT COUNT(*) as c FROM entity_verse_map').get().c;
    const totalProfiles = db.prepare('SELECT COUNT(*) as c FROM entity_profiles').get().c;
    console.log('\n📊 Entity Disambiguation Stats:');
    console.log('─'.repeat(40));
    for (const s of profiles) console.log(`  Profiles ${s.status.padEnd(12)} ${String(s.c).padStart(6)}`);
    console.log(`  Total profiles:       ${String(totalProfiles).padStart(6)}`);
    console.log(`  Verse mappings:       ${String(mapped).padStart(6)}`);
    db.close(); ndb.close();
    return;
  }

  // ── Phase 1: Build Profiles ──────────────────────────────────────────────
  if (PHASE === 'profiles' || PHASE === 'all') {
    console.log('\n═══ Phase 1: Building Entity Profiles ═══\n');

    // Gather all distinct names + their verse distribution
    const personNames = db.prepare('SELECT DISTINCT name_normalized FROM entity_person_index').all().map(r => r.name_normalized);
    const placeNames  = db.prepare('SELECT DISTINCT name_normalized FROM entity_place_index').all().map(r => r.name_normalized);

    // Identify which names need disambiguation (multi-book-cluster)
    function analyzeNameSpread(name, type) {
      const table = type === 'person' ? 'entity_person_index' : 'entity_place_index';
      const verseIds = db.prepare(`SELECT verse_id FROM ${table} WHERE name_normalized=?`).all(name).map(r => r.verse_id);
      if (verseIds.length < 3) return { ambiguous: false, verseIds, books: new Map() };

      const bookCounts = new Map();
      const volumeCounts = new Map();
      for (const vid of verseIds) {
        const info = verseBookMap.get(vid);
        if (!info) continue;
        bookCounts.set(info.book, (bookCounts.get(info.book) || 0) + 1);
        volumeCounts.set(info.volume, (volumeCounts.get(info.volume) || 0) + 1);
      }

      // Ambiguous if: spans 2+ volumes, or 5+ books, or has >100 verses (worth profiling)
      const ambiguous = volumeCounts.size >= 2 || bookCounts.size >= 5 || verseIds.length > 100;
      return { ambiguous, verseIds, books: bookCounts, volumes: volumeCounts };
    }

    // Mine summaries for qualifier patterns
    function mineQualifiers(name) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rows = db.prepare(`
        SELECT verse_title, summary FROM verse_summaries 
        WHERE summary LIKE ? AND status IN ('ai-ok','ai-verified')
        LIMIT 100
      `).all(`%${name}%`);

      const qualifiers = new Map(); // qualifier → count
      const patterns = [
        new RegExp(`${escaped},?\\s+(?:the\\s+)?son\\s+of\\s+([A-Z][a-z]+)`, 'gi'),
        new RegExp(`${escaped},?\\s+(?:the\\s+)?daughter\\s+of\\s+([A-Z][a-z]+)`, 'gi'),
        new RegExp(`${escaped}\\s+the\\s+(Elder|Younger|prophet|priest|king|captain|judge)`, 'gi'),
        new RegExp(`(?:Captain|King|Prophet|Judge|Chief)\\s+${escaped}`, 'gi'),
        new RegExp(`${escaped},?\\s+(?:who|which)\\s+(?:was|is|were)\\s+(.{5,40?})[\\.\\,]`, 'gi'),
        new RegExp(`the\\s+(?:city|land|place|valley|hill|waters?)\\s+of\\s+${escaped}`, 'gi'),
        new RegExp(`${escaped}(?:,?\\s+a\\s+city|\\s+in\\s+the\\s+land)`, 'gi'),
      ];

      for (const row of rows) {
        if (!row.summary) continue;
        for (const pat of patterns) {
          pat.lastIndex = 0;
          let m;
          while ((m = pat.exec(row.summary)) !== null) {
            const qual = (m[1] || m[0]).trim().slice(0, 60);
            qualifiers.set(qual, (qualifiers.get(qual) || 0) + 1);
          }
        }
      }
      return [...qualifiers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    }

    // Process all names
    const allNames = [
      ...personNames.map(n => ({ name: n, type: 'person' })),
      ...placeNames.map(n => ({ name: n, type: 'place' })),
    ];

    // Deduplicate (some names appear in both person and place)
    const seen = new Set();
    const uniqueNames = allNames.filter(n => {
      const key = `${n.type}:${n.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    console.log(`📋 ${uniqueNames.length} distinct entity names to analyze`);

    // Skip already-profiled names
    const existingProfiles = new Set(
      db.prepare('SELECT DISTINCT name FROM entity_profiles').all().map(r => r.name.toLowerCase())
    );

    const needsAI = [];     // ambiguous names → send to AI
    const autoProfile = [];  // unambiguous names → auto-create profile

    let analyzed = 0;
    for (const { name, type } of uniqueNames) {
      if (existingProfiles.has(name)) continue;
      const spread = analyzeNameSpread(name, type);

      if (spread.ambiguous) {
        const quals = mineQualifiers(name);
        needsAI.push({ name, type, spread, quals, verseCount: spread.verseIds.length });
      } else {
        autoProfile.push({ name, type, verseCount: spread.verseIds.length });
      }
      analyzed++;
      if (analyzed % 500 === 0) process.stdout.write(`  analyzed ${analyzed}/${uniqueNames.length}\r`);
    }

    console.log(`\n✅ Analysis: ${autoProfile.length} unambiguous, ${needsAI.length} need AI disambiguation`);

    // Auto-create single profiles for unambiguous names
    const insertProfile = db.prepare(`
      INSERT OR IGNORE INTO entity_profiles (entity_id, name, type, qualifier, book_start, book_end, description, status, verse_count)
      VALUES (?, ?, ?, NULL, NULL, NULL, NULL, 'auto', ?)
    `);

    let autoCount = 0;
    const autoTxn = db.transaction(() => {
      for (const { name, type, verseCount } of autoProfile) {
        const eid = `${type}:${name.replace(/\s+/g, '_')}`;
        insertProfile.run(eid, name, type, verseCount);
        autoCount++;
      }
    });
    autoTxn();
    console.log(`  ✓ Created ${autoCount} auto-profiles (unambiguous entities)`);

    // AI disambiguation for ambiguous names
    needsAI.sort((a, b) => b.verseCount - a.verseCount); // highest-impact first
    console.log(`\n🤖 AI profiling ${needsAI.length} ambiguous entities (${WORKERS} workers)...`);

    let aiDone = 0;
    let aiFailed = 0;
    const queue = [...needsAI];
    let queueIdx = 0;

    const insertProfileFull = db.prepare(`
      INSERT OR REPLACE INTO entity_profiles (entity_id, name, type, qualifier, book_start, book_end, description, status, verse_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'ai-verified', ?)
    `);

    async function aiWorker(wid) {
      while (queueIdx < queue.length) {
        const item = queue[queueIdx++];
        if (!item) break;
        const { name, type, spread, quals } = item;

        // Build context: book distribution + mined qualifiers + sample summaries
        const bookDist = [...spread.books.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 15)
          .map(([b, c]) => `${b}: ${c} verses`)
          .join(', ');

        const qualStr = quals.length > 0
          ? `Mined qualifiers: ${quals.map(([q, c]) => `"${q}" (${c}x)`).join(', ')}`
          : 'No qualifier patterns found in summaries.';

        // Get sample summaries mentioning this name
        const samples = db.prepare(`
          SELECT verse_title, summary FROM verse_summaries
          WHERE summary LIKE ? AND status IN ('ai-ok','ai-verified')
          ORDER BY RANDOM() LIMIT 8
        `).all(`%${name}%`);

        const sampleStr = samples
          .map(s => `[${s.verse_title}] ${(s.summary || '').slice(0, 150)}`)
          .join('\n');

        const prompt = `You are a scripture scholar. The name "${name}" appears as a ${type} in scripture across multiple books.

Book distribution: ${bookDist}
${qualStr}

Sample verse summaries mentioning "${name}":
${sampleStr}

Based on your knowledge of the Bible, Book of Mormon, Doctrine & Covenants, and Pearl of Great Price:

1. How many DISTINCT ${type === 'person' ? 'individuals' : 'locations'} share this name?
2. For each, provide a JSON array of objects with these fields:
   - "id": a short unique slug (e.g., "nephi_son_of_lehi")
   - "qualifier": a brief distinguishing label (e.g., "son of Lehi", "Lamanite city")
   - "book_start": first book they appear in
   - "book_end": last book they appear in  
   - "description": one sentence description

RESPOND WITH ONLY THE JSON ARRAY, no other text. Example:
[{"id":"nephi_son_of_lehi","qualifier":"son of Lehi","book_start":"1 Nephi","book_end":"2 Nephi","description":"First Nephite prophet and record keeper"}]

If this is actually ONE ${type === 'person' ? 'person' : 'place'} (not ambiguous), return a single-element array.`;

        try {
          const raw = await aiCall(prompt);
          // Extract JSON from response
          const jsonMatch = raw.match(/\[[\s\S]*\]/);
          if (!jsonMatch) throw new Error('No JSON array found');

          const profiles = JSON.parse(jsonMatch[0]);
          if (!Array.isArray(profiles) || profiles.length === 0) throw new Error('Empty profiles');

          const txn = db.transaction(() => {
            for (const p of profiles) {
              const eid = `${type}:${(p.id || name.replace(/\s+/g, '_')).toLowerCase()}`;
              insertProfileFull.run(
                eid, name, type,
                p.qualifier || null,
                p.book_start || null,
                p.book_end || null,
                p.description || null,
                item.verseCount
              );
            }
          });
          txn();
          aiDone++;
          console.log(`  [W${wid}] ✓ ${name} → ${profiles.length} profile(s)`);
        } catch (e) {
          aiFailed++;
          // Fallback: create single unambiguous profile
          const eid = `${type}:${name.replace(/\s+/g, '_')}`;
          insertProfile.run(eid, name, type, item.verseCount);
          console.error(`  [W${wid}] ✗ ${name}: ${(e?.message || String(e)).slice(0, 80)} — auto-profiled`);
        }
        await sleep(DELAY_MS);
      }
    }

    await Promise.all(Array.from({ length: WORKERS }, (_, i) => aiWorker(i + 1)));
    console.log(`\n✅ Phase 1 done: ${aiDone} AI-profiled, ${aiFailed} auto-fallback, ${autoCount} auto-profiled`);
  }

  // ── Phase 2: Assign Verses to Profiles ───────────────────────────────────
  if (PHASE === 'assign' || PHASE === 'all') {
    console.log('\n═══ Phase 2: Assigning Verses to Profiles ═══\n');

    const profiles = db.prepare('SELECT * FROM entity_profiles').all();
    console.log(`📋 ${profiles.length} profiles loaded`);

    // Group profiles by name
    const profilesByName = new Map();
    for (const p of profiles) {
      const key = `${p.type}:${p.name}`;
      if (!profilesByName.has(key)) profilesByName.set(key, []);
      profilesByName.get(key).push(p);
    }

    // Book name → ordering for range matching
    const bookOrder = new Map();
    const books = ndb.prepare('SELECT id, book_title FROM books ORDER BY id').all();
    for (const b of books) bookOrder.set(b.book_title, b.id);

    function bookInRange(verseBookTitle, profileStart, profileEnd) {
      if (!profileStart || !profileEnd) return 0.5; // unknown range → neutral
      const vid = bookOrder.get(verseBookTitle) || 0;
      const sid = bookOrder.get(profileStart) || 0;
      const eid = bookOrder.get(profileEnd) || 999;
      return (vid >= sid && vid <= eid) ? 1.0 : 0.0;
    }

    const insertMap = db.prepare('INSERT OR REPLACE INTO entity_verse_map (entity_id, verse_id, confidence) VALUES (?, ?, ?)');
    const getSummary = db.prepare('SELECT summary FROM verse_summaries WHERE verse_id = ?');

    let mapped = 0;
    let ambiguousQueue = []; // low-confidence assignments → AI later

    // Process each entity type
    for (const type of ['person', 'place']) {
      const table = type === 'person' ? 'entity_person_index' : 'entity_place_index';
      const names = db.prepare(`SELECT DISTINCT name_normalized FROM ${table}`).all().map(r => r.name_normalized);

      for (const name of names) {
        const key = `${type}:${name}`;
        const candidates = profilesByName.get(key);
        if (!candidates || candidates.length === 0) continue;

        const verseIds = db.prepare(`SELECT verse_id FROM ${table} WHERE name_normalized=?`).all(name).map(r => r.verse_id);

        if (candidates.length === 1) {
          // Single profile → assign all verses directly
          const txn = db.transaction(() => {
            for (const vid of verseIds) {
              insertMap.run(candidates[0].entity_id, vid, 1.0);
            }
          });
          txn();
          mapped += verseIds.length;
        } else {
          // Multiple profiles → score each verse
          const txn = db.transaction(() => {
            for (const vid of verseIds) {
              const vInfo = verseBookMap.get(vid);
              if (!vInfo) continue;

              let bestProfile = null;
              let bestScore = -1;
              let secondScore = -1;

              for (const p of candidates) {
                // Score 1: Book range match (weight: 0.6)
                const rangeScore = bookInRange(vInfo.book, p.book_start, p.book_end) * 0.6;

                // Score 2: Summary keyword match (weight: 0.4)
                let keywordScore = 0;
                if (p.qualifier) {
                  const summary = getSummary.get(vid)?.summary || '';
                  const qualWords = p.qualifier.toLowerCase().split(/\s+/).filter(w => w.length > 2);
                  const matchCount = qualWords.filter(w => summary.toLowerCase().includes(w)).length;
                  keywordScore = (qualWords.length > 0 ? matchCount / qualWords.length : 0) * 0.4;
                }

                const total = rangeScore + keywordScore;
                if (total > bestScore) {
                  secondScore = bestScore;
                  bestScore = total;
                  bestProfile = p;
                } else if (total > secondScore) {
                  secondScore = total;
                }
              }

              if (bestProfile) {
                const confidence = bestScore > 0 ? Math.min(1.0, bestScore) : 0.5;
                const margin = bestScore - secondScore;
                insertMap.run(bestProfile.entity_id, vid, confidence);

                // If margin is tiny → ambiguous, queue for AI
                if (margin < 0.15 && ambiguousQueue.length < 5000) {
                  ambiguousQueue.push({ vid, name, type, candidates, vInfo });
                }
              }
              mapped++;
            }
          });
          txn();
        }

        if (mapped % 10000 === 0) process.stdout.write(`  mapped ${mapped} verse links\r`);
      }
    }

    console.log(`\n✅ Mapped ${mapped} verse-entity links`);
    console.log(`  ${ambiguousQueue.length} low-confidence assignments queued for AI`);

    // AI disambiguation for ambiguous assignments
    if (ambiguousQueue.length > 0 && (PHASE === 'all' || PHASE === 'assign')) {
      console.log(`\n🤖 AI disambiguating ${ambiguousQueue.length} ambiguous links (${WORKERS} workers)...`);

      let aiFixed = 0;
      let aiIdx = 0;

      async function disambigWorker(wid) {
        while (aiIdx < ambiguousQueue.length) {
          // Batch 5 verses at a time for efficiency
          const batch = [];
          while (batch.length < 5 && aiIdx < ambiguousQueue.length) {
            batch.push(ambiguousQueue[aiIdx++]);
          }
          if (batch.length === 0) break;

          // Group by name for efficient prompting
          const byName = new Map();
          for (const item of batch) {
            if (!byName.has(item.name)) byName.set(item.name, []);
            byName.get(item.name).push(item);
          }

          for (const [name, items] of byName) {
            const profiles = items[0].candidates.map(p =>
              `- ${p.entity_id}: "${p.qualifier || 'unknown'}" (${p.book_start || '?'}–${p.book_end || '?'}): ${p.description || 'no description'}`
            ).join('\n');

            const verses = items.map(item => {
              const summary = getSummary.get(item.vid)?.summary || '';
              return `Verse ${item.vid} (${item.vInfo.book}): ${summary.slice(0, 150)}`;
            }).join('\n');

            const prompt = `Given these profiles for "${name}":
${profiles}

For each verse below, respond with ONLY the entity_id that matches. Format: one line per verse as "verse_id:entity_id"

${verses}`;

            try {
              const raw = await aiCall(prompt, 500);
              const lines = raw.split('\n').filter(l => l.includes(':'));
              for (const line of lines) {
                const [vidStr, eid] = line.split(':').map(s => s.trim());
                const vid = parseInt(vidStr);
                if (vid && eid && items[0].candidates.some(p => p.entity_id === eid)) {
                  insertMap.run(eid, vid, 0.9); // AI-assigned confidence
                  aiFixed++;
                }
              }
            } catch {
              // Keep existing assignment
            }
            await sleep(DELAY_MS);
          }
        }
      }

      await Promise.all(Array.from({ length: WORKERS }, (_, i) => disambigWorker(i + 1)));
      console.log(`  ✅ AI fixed ${aiFixed} ambiguous assignments`);
    }

    // Update verse counts on profiles
    db.prepare(`
      UPDATE entity_profiles SET verse_count = (
        SELECT COUNT(*) FROM entity_verse_map WHERE entity_verse_map.entity_id = entity_profiles.entity_id
      )
    `).run();

    console.log('✅ Phase 2 done');
  }

  // ── Phase 3: Validate ────────────────────────────────────────────────────
  if (PHASE === 'validate' || PHASE === 'all') {
    console.log('\n═══ Phase 3: Validation Sampling ═══\n');

    // Sample 200 random assignments from multi-profile entities
    const multiNames = db.prepare(`
      SELECT name FROM entity_profiles GROUP BY name HAVING COUNT(*) > 1
    `).all().map(r => r.name);

    if (multiNames.length === 0) {
      console.log('⚠️  No multi-profile entities found — skipping validation');
    } else {
      const sampleSize = Math.min(200, multiNames.length * 10);
      const samples = db.prepare(`
        SELECT evm.entity_id, evm.verse_id, evm.confidence, ep.name, ep.qualifier, ep.description
        FROM entity_verse_map evm
        JOIN entity_profiles ep ON evm.entity_id = ep.entity_id
        WHERE ep.name IN (${multiNames.map(() => '?').join(',')})
        ORDER BY RANDOM()
        LIMIT ?
      `).all(...multiNames, sampleSize);

      console.log(`📋 Validating ${samples.length} random assignments...`);

      let correct = 0;
      let incorrect = 0;
      let uncertain = 0;
      let valIdx = 0;

      async function validateWorker(wid) {
        while (valIdx < samples.length) {
          const batch = [];
          while (batch.length < 10 && valIdx < samples.length) {
            batch.push(samples[valIdx++]);
          }
          if (batch.length === 0) break;

          const items = batch.map(s => {
            const vInfo = verseBookMap.get(s.verse_id);
            const summary = db.prepare('SELECT summary FROM verse_summaries WHERE verse_id=?').get(s.verse_id)?.summary || '';
            return `- Verse ${s.verse_id} (${vInfo?.book || '?'}): assigned to "${s.name} — ${s.qualifier || 'unspecified'}". Summary: ${summary.slice(0, 120)}`;
          }).join('\n');

          const allProfiles = db.prepare('SELECT entity_id, qualifier, description FROM entity_profiles WHERE name = ?');

          const profileContext = [...new Set(batch.map(b => b.name))].map(name => {
            const profs = allProfiles.all(name).map(p => `  ${p.entity_id}: "${p.qualifier}" — ${p.description || ''}`).join('\n');
            return `"${name}" profiles:\n${profs}`;
          }).join('\n\n');

          const prompt = `You are a scripture validation expert. Check if these entity assignments are CORRECT.

${profileContext}

Assignments to check:
${items}

For each verse, respond with ONLY: "verse_id:CORRECT" or "verse_id:INCORRECT:correct_entity_id"
Respond with nothing else.`;

          try {
            const raw = await aiCall(prompt, 800);
            for (const line of raw.split('\n').filter(l => l.trim())) {
              if (line.includes('CORRECT') && !line.includes('INCORRECT')) {
                correct++;
              } else if (line.includes('INCORRECT')) {
                incorrect++;
                // Fix the assignment
                const parts = line.split(':');
                const vid = parseInt(parts[0]);
                const correctEid = parts[2]?.trim();
                if (vid && correctEid) {
                  db.prepare('UPDATE entity_verse_map SET entity_id=?, confidence=0.95 WHERE verse_id=?').run(correctEid, vid);
                }
              } else {
                uncertain++;
              }
            }
          } catch {
            uncertain += batch.length;
          }
          await sleep(DELAY_MS);
        }
      }

      await Promise.all(Array.from({ length: WORKERS }, (_, i) => validateWorker(i + 1)));

      const accuracy = correct + incorrect > 0 ? (correct / (correct + incorrect) * 100).toFixed(1) : 'N/A';
      console.log(`\n✅ Validation: ${correct} correct, ${incorrect} incorrect, ${uncertain} uncertain`);
      console.log(`   Accuracy: ${accuracy}%`);
      if (incorrect > 0) console.log(`   Fixed ${incorrect} incorrect assignments`);
    }
  }

  db.close();
  ndb.close();
  console.log('\n🏁 Done');
}

main().catch(e => { console.error(e); process.exit(1); });
