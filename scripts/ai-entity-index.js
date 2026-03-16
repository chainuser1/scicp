#!/usr/bin/env node
/**
 * AI Entity Index Builder
 * 
 * Processes every chapter through AI (NVIDIA NIM / Llama 3.3 70B) to extract
 * and disambiguate all proper nouns with verse-level precision.
 * 
 * Entity types: person, place, group, coin, object, title
 * 
 * Usage:
 *   node scripts/ai-entity-index.js [--workers 8] [--start 1] [--end 1582] [--pilot]
 *   --pilot   Process only 10 diverse chapters to validate quality
 *   --resume  Skip chapters already processed
 */

const Database = require('better-sqlite3');
const https = require('https');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'resources', 'db', 'lds-scriptures-sqlite.db');
const TAGS_PATH = path.join(__dirname, '..', 'resources', 'db', 'verse-tags.db');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const API_KEY = process.env.NVIDIA_API_KEY;
const API_HOST = 'integrate.api.nvidia.com';
const MODEL = 'meta/llama-3.3-70b-instruct';

// Parse args
const args = process.argv.slice(2);
const getArg = (name, def) => { const i = args.indexOf(name); return i >= 0 && args[i+1] ? args[i+1] : def; };
const hasFlag = name => args.includes(name);
const WORKERS = parseInt(getArg('--workers', '8'));
const START = parseInt(getArg('--start', '1'));
const END = parseInt(getArg('--end', '99999'));
const PILOT = hasFlag('--pilot');
const RESUME = hasFlag('--resume');

// Pilot chapters: diverse sample across volumes and entity types
const PILOT_CHAPTERS = [
  1,      // Genesis 1 (creation: God, Heaven, Earth)
  5,      // Genesis 5 (genealogy: Adam, Seth, Enoch, Noah)
  83,     // Exodus 3 (Moses, burning bush, Horeb, Midian)
  896,    // Matthew 1 (Jesus genealogy)
  931,    // Matthew 26 (Last Supper: Judas, Peter, Caiaphas)
  1085,   // 1 Nephi 1 (Lehi, Jerusalem, Nephi)
  1220,   // Mosiah 11 (King Noah, Zeniff, Abinadi)
  1293,   // Alma 11 (coins: senine, senum, limnah)
  1413,   // Ether 7 (Jaredite kings: Shule, Corihor, Noah)
  1480,   // D&C 84 (priesthood: Melchizedek, Aaron, Moses)
];

const dba = new Database(DB_PATH, { readonly: true });
const tags = new Database(TAGS_PATH);

// Create tables
tags.exec(`
  CREATE TABLE IF NOT EXISTS ai_entity_index (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chapter_id INTEGER NOT NULL,
    entity_name TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_uid TEXT NOT NULL,
    qualifier TEXT,
    verses TEXT NOT NULL,
    description TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_aei_chapter ON ai_entity_index(chapter_id);
  CREATE INDEX IF NOT EXISTS idx_aei_uid ON ai_entity_index(entity_uid);
  CREATE INDEX IF NOT EXISTS idx_aei_name_type ON ai_entity_index(entity_name, entity_type);

  CREATE TABLE IF NOT EXISTS ai_entity_progress (
    chapter_id INTEGER PRIMARY KEY,
    status TEXT NOT NULL,
    entities_found INTEGER DEFAULT 0,
    error TEXT,
    processed_at TEXT DEFAULT (datetime('now'))
  );
`);

// Get chapter data
function getChapter(chapterId) {
  const info = dba.prepare(`
    SELECT c.id, b.book_title, c.chapter_number, vo.volume_title
    FROM chapters c 
    JOIN books b ON c.book_id = b.id
    JOIN volumes vo ON b.volume_id = vo.id
    WHERE c.id = ?
  `).get(chapterId);
  if (!info) return null;

  const verses = dba.prepare(`
    SELECT v.id as verse_id, v.verse_number, v.scripture_text
    FROM verses v WHERE v.chapter_id = ? ORDER BY v.verse_number
  `).all(chapterId);

  return { ...info, verses };
}

// Build the extraction prompt
function buildPrompt(chapter) {
  const ref = `${chapter.book_title} ${chapter.chapter_number}`;
  const vol = chapter.volume_title;
  
  // Format verses
  const verseText = chapter.verses.map(v => 
    `v${v.verse_number}: ${v.scripture_text}`
  ).join('\n');

  return `You are a scripture scholar creating a comprehensive proper-noun index for ${ref} (${vol}).

CHAPTER TEXT:
${verseText}

TASK: Identify EVERY proper noun in this chapter. For each, provide:
1. name: The proper noun as it appears
2. type: One of: person, place, group, coin, object, title
3. uid: A unique disambiguation ID in format type:name_qualifier (lowercase, underscores)
4. qualifier: Brief phrase distinguishing this entity from others with the same name
5. verses: Array of verse numbers where this entity appears or is clearly referenced
6. description: One sentence describing who/what this is

ENTITY TYPE GUIDE:
- person: Named individuals (Moses, Nephi, Mary Magdalene). Disambiguate! Aaron brother of Moses ≠ Aaron son of Mosiah.
- place: Named locations (Jerusalem, River Sidon, Hill Cumorah, Land of Zarahemla)
- group: Named peoples, nations, tribes (Lamanites, Nephites, Pharisees, tribe of Judah)
- coin: Named monetary units (senine, senum, limnah, talent, shekel)
- object: Named sacred/significant objects (Liahona, Urim and Thummim, brass plates, ark of the covenant)
- title: Named offices or titles when used as proper nouns (High Priest, Chief Judge, Holy One of Israel)

DISAMBIGUATION RULES:
- If a name refers to different entities in scripture, give each a UNIQUE uid
- Use context clues: time period, book, relationships, actions
- Examples: person:nephi_son_of_lehi vs person:nephi_son_of_helaman
            place:jerusalem_israel vs place:jerusalem_lamanite_city
            person:noah_patriarch vs person:noah_nephite_king vs person:noah_jaredite
- For God/Jesus/Christ: use person:jesus_christ (the divine being), person:god_the_father, person:holy_ghost
- For generic references to "the Lord" meaning Jehovah/Christ: person:jesus_christ

IMPORTANT:
- Include EVERY proper noun, even if mentioned only once
- Be precise about which verses — only list verses where the entity actually appears
- Do NOT include common nouns (man, woman, city, land) unless they are proper names
- Groups like "Lamanites" or "Nephites" ARE proper nouns

Respond with ONLY a JSON array, no other text:
[{"name":"...","type":"...","uid":"...","qualifier":"...","verses":[...],"description":"..."},...]`;
}

// Call NVIDIA NIM API
function callAI(prompt) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 8192,
      temperature: 0.1,
      top_p: 0.9
    });

    const options = {
      hostname: API_HOST,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      }
    };

    const req = https.request(options, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        if (res.statusCode === 429) {
          // Rate limited — retry after delay
          const retryAfter = parseInt(res.headers['retry-after'] || '5');
          reject(new Error(`RATE_LIMITED:${retryAfter}`));
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`API ${res.statusCode}: ${body.substring(0, 200)}`));
          return;
        }
        try {
          const j = JSON.parse(body);
          resolve(j.choices[0].message.content);
        } catch (e) {
          reject(new Error(`Parse error: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(data);
    req.end();
  });
}

// Parse AI response (handles markdown code blocks, trailing commas, etc.)
function parseResponse(text) {
  // Strip markdown code blocks
  let clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  
  // Find the JSON array
  const start = clean.indexOf('[');
  const end = clean.lastIndexOf(']');
  if (start < 0 || end < 0) throw new Error('No JSON array found');
  clean = clean.substring(start, end + 1);
  
  // Fix common JSON issues
  clean = clean.replace(/,\s*]/g, ']').replace(/,\s*}/g, '}');
  // Fix unescaped quotes in strings (e.g., "description": "He said "hello"")
  clean = clean.replace(/"([^"]*?)"\s*(?=[,}\]])/g, (match) => {
    // Only fix if it looks like a broken string value
    return match;
  });
  
  // Try parsing, if fails try to recover truncated JSON
  try {
    return JSON.parse(clean);
  } catch (e) {
    // Truncated: find last complete object
    const lastComplete = clean.lastIndexOf('}');
    if (lastComplete > 0) {
      const truncated = clean.substring(0, lastComplete + 1) + ']';
      const fixed = truncated.replace(/,\s*]/g, ']').replace(/,\s*}/g, '}');
      return JSON.parse(fixed);
    }
    throw e;
  }
}

// Validate and normalize entities
function validateEntities(entities, chapter) {
  const validTypes = new Set(['person', 'place', 'group', 'coin', 'object', 'title']);
  const maxVerse = chapter.verses.length;
  const valid = [];

  for (const e of entities) {
    if (!e.name || !e.type || !e.uid || !e.verses) continue;
    if (!validTypes.has(e.type)) continue;
    
    // Normalize
    e.name = e.name.trim();
    e.uid = e.uid.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_:]/g, '');
    if (!e.uid.startsWith(e.type + ':')) e.uid = e.type + ':' + e.uid.replace(/^[^:]*:/, '');
    e.qualifier = (e.qualifier || '').trim();
    e.description = (e.description || '').trim();
    
    // Filter valid verse numbers
    e.verses = (Array.isArray(e.verses) ? e.verses : [e.verses])
      .map(v => parseInt(v))
      .filter(v => v >= 1 && v <= maxVerse);
    
    if (e.verses.length > 0) valid.push(e);
  }
  return valid;
}

// Process a single chapter
async function processChapter(chapterId) {
  const chapter = getChapter(chapterId);
  if (!chapter) return { error: 'Chapter not found' };

  const ref = `${chapter.book_title} ${chapter.chapter_number}`;
  const prompt = buildPrompt(chapter);

  let retries = 3;
  while (retries > 0) {
    try {
      const response = await callAI(prompt);
      const raw = parseResponse(response);
      const entities = validateEntities(raw, chapter);

      // Store results
      const insertEntity = tags.prepare(`
        INSERT INTO ai_entity_index (chapter_id, entity_name, entity_type, entity_uid, qualifier, verses, description)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const insertProgress = tags.prepare(`
        INSERT OR REPLACE INTO ai_entity_progress (chapter_id, status, entities_found)
        VALUES (?, 'done', ?)
      `);

      // Build verse_id map for this chapter
      const verseIdMap = {};
      for (const v of chapter.verses) verseIdMap[v.verse_number] = v.verse_id;

      tags.transaction(() => {
        // Clear old data for this chapter
        tags.prepare('DELETE FROM ai_entity_index WHERE chapter_id = ?').run(chapterId);
        
        for (const e of entities) {
          // Convert verse numbers to verse_ids
          const verseIds = e.verses.map(vn => verseIdMap[vn]).filter(Boolean);
          insertEntity.run(chapterId, e.name, e.type, e.uid, e.qualifier, JSON.stringify(verseIds), e.description);
        }
        insertProgress.run(chapterId, entities.length);
      })();

      return { ref, entities: entities.length, ok: true };
    } catch (err) {
      if (err.message.startsWith('RATE_LIMITED:')) {
        const delay = parseInt(err.message.split(':')[1]) * 1000 + 1000;
        await new Promise(r => setTimeout(r, delay));
        retries--;
        continue;
      }
      retries--;
      if (retries === 0) {
        tags.prepare(`
          INSERT OR REPLACE INTO ai_entity_progress (chapter_id, status, error)
          VALUES (?, 'error', ?)
        `).run(chapterId, err.message.substring(0, 500));
        return { ref: `chapter ${chapterId}`, error: err.message, ok: false };
      }
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

// Get all chapter IDs to process
function getChapterIds() {
  if (PILOT) return PILOT_CHAPTERS;
  
  let all = dba.prepare('SELECT id FROM chapters ORDER BY id').all().map(r => r.id);
  all = all.filter(id => id >= START && id <= END);
  
  if (RESUME) {
    const done = new Set(
      tags.prepare("SELECT chapter_id FROM ai_entity_progress WHERE status='done'").all().map(r => r.chapter_id)
    );
    all = all.filter(id => !done.has(id));
    console.log(`Resuming: ${done.size} already done, ${all.length} remaining`);
  }
  
  return all;
}

// Worker pool
async function runPool(chapterIds, workerCount) {
  let idx = 0;
  let completed = 0;
  let errors = 0;
  let totalEntities = 0;
  const total = chapterIds.length;
  const startTime = Date.now();

  async function worker(workerId) {
    while (idx < chapterIds.length) {
      const myIdx = idx++;
      const chId = chapterIds[myIdx];
      const result = await processChapter(chId);
      if (!result) { errors++; completed++; continue; }
      completed++;
      
      if (result.ok) {
        totalEntities += result.entities;
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = completed / elapsed;
        const eta = Math.round((total - completed) / rate);
        process.stdout.write(
          `\r[${completed}/${total}] ${result.ref} → ${result.entities} entities | ` +
          `${rate.toFixed(1)}/s | ETA ${Math.floor(eta/60)}m${eta%60}s    `
        );
      } else {
        errors++;
        console.log(`\n  ❌ ${result.ref}: ${result.error}`);
      }
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(workerCount, total); i++) {
    workers.push(worker(i));
  }
  await Promise.all(workers);

  console.log(`\n\n✅ Done: ${completed} chapters, ${totalEntities} entities, ${errors} errors`);
  console.log(`   Time: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
}

// Main
async function main() {
  const chapterIds = getChapterIds();
  console.log(`AI Entity Index Builder`);
  console.log(`  Model: ${MODEL}`);
  console.log(`  Workers: ${WORKERS}`);
  console.log(`  Chapters: ${chapterIds.length}${PILOT ? ' (pilot)' : ''}`);
  console.log(`  Resume: ${RESUME}\n`);

  if (chapterIds.length === 0) {
    console.log('Nothing to process.');
    return;
  }

  await runPool(chapterIds, WORKERS);

  // Print summary
  const stats = tags.prepare(`
    SELECT entity_type, COUNT(*) as cnt, COUNT(DISTINCT entity_uid) as unique_uids
    FROM ai_entity_index GROUP BY entity_type ORDER BY cnt DESC
  `).all();
  console.log('\nEntity breakdown:');
  for (const s of stats) {
    console.log(`  ${s.entity_type}: ${s.cnt} entries, ${s.unique_uids} unique IDs`);
  }

  const totalChapters = tags.prepare("SELECT COUNT(*) as cnt FROM ai_entity_progress WHERE status='done'").get();
  const totalErrors = tags.prepare("SELECT COUNT(*) as cnt FROM ai_entity_progress WHERE status='error'").get();
  console.log(`\nProgress: ${totalChapters.cnt} done, ${totalErrors.cnt} errors`);
}

main().catch(console.error);
