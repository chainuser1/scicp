#!/usr/bin/env node
'use strict';

/**
 * build-strongs-pairs.js — Generate semantic expansion training pairs from
 * Strong's Hebrew and Greek lexicons.
 *
 * Source: openscriptures/strongs npm package (public domain data).
 *
 * Pair types created:
 *   A. (KJV gloss words → Strong's definition)  — concept grounding
 *   B. (KJV synonym pairs from same root)        — synonym expansion
 *      e.g. "love" ↔ "charity, affection"  (both translate G26 ἀγάπη)
 *           "faith" ↔ "belief, assurance"   (both translate G4102 πίστις)
 *
 * Output: resources/strongs-pairs.json
 *
 * Usage:
 *   node scripts/build-strongs-pairs.js
 *
 * Requires the 'strongs' npm package:
 *   npm install strongs --no-save   (from project root)
 */

const fs   = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'resources', 'strongs-pairs.json');

// ── Load Strong's data ────────────────────────────────────────────────────────

let stronsgs;
try {
  stronsgs = require('strongs');
} catch (_) {
  console.error('ERROR: strongs package not found.');
  console.error('Run: npm install strongs --no-save  (from project root)');
  process.exit(1);
}

// ── KJV def cleaner ───────────────────────────────────────────────────────────

/**
 * Parse KJV gloss field into an array of clean English word/phrases.
 * KJV def looks like:
 *   "hence, assurance, believe, bring up, establish, [phrase] fail, be faithful
 *    (of long continuance, stedfast, sure, surely, trusty, verified), nurse"
 */
function parseKjvWords(kjv_def) {
  return (kjv_def || '')
    .replace(/\[[^\]]*\]/g, '')          // strip [idiom], [phrase], [idiom] etc.
    .replace(/\([-–—][^)]*\)/g, '')      // strip (-ing father) form notes
    .replace(/\([^)]*\)/g, '')           // strip other parenthetical notes
    .replace(/H\d+|G\d+/g, '')          // strip Strong's cross-references
    .replace(/Compare[^,;]*/gi, '')      // strip "Compare names in..."
    .replace(/[;.!?]/g, ',')            // normalize delimiters to comma
    .split(/,\s*/)
    .map(w => w.trim().toLowerCase().replace(/^x\s+/, '').replace(/\s+/g, ' '))
    .filter(w => w.length > 2 && !/^\d+$/.test(w) && !/^(or|and|also|as|by|in|of|the|to|a|an)$/.test(w));
}

// ── Build pairs ───────────────────────────────────────────────────────────────

const pairs = [];
const MIN_LEN = 15;

for (const [number, entry] of Object.entries(stronsgs)) {
  const { strongs_def, kjv_def, xlit } = entry;
  if (!strongs_def || !kjv_def) continue;

  const words = parseKjvWords(kjv_def);
  if (words.length === 0) continue;

  const def = strongs_def.trim();
  if (def.length < MIN_LEN) continue;

  // Type A: KJV gloss phrase → Strong's definition
  // anchor = "word1, word2, word3 (H/G number)"
  const glossPhrase = words.slice(0, 5).join(', ') + ' (' + number + ')';
  if (glossPhrase.length >= MIN_LEN) {
    pairs.push({ anchor: glossPhrase, positive: def });
    // Bidirectional: definition → gloss (helps query expansion in both directions)
    if (def.length >= MIN_LEN && glossPhrase.length >= MIN_LEN) {
      pairs.push({ anchor: def, positive: glossPhrase });
    }
  }

  // Type B: KJV synonym pairs — pairs of different English words for the same root
  // Only when there are 2+ distinct words (these are the most valuable synonym pairs)
  if (words.length >= 2) {
    const w0 = words[0];
    const w1 = words[1];
    // Each synonym pair needs to be long enough to be meaningful
    // Combine words with definition context to ensure length
    const syn0 = w0.length < MIN_LEN ? `${w0} (${number}: ${xlit || ''})` : w0;
    const syn1 = w1.length < MIN_LEN ? `${w1} (${number}: ${xlit || ''})` : w1;
    if (syn0.length >= MIN_LEN && syn1.length >= MIN_LEN) {
      pairs.push({ anchor: syn0, positive: syn1 });
      pairs.push({ anchor: syn1, positive: syn0 });
    }

    // If 3+ words, also pair first word with rest joined
    if (words.length >= 3) {
      const restPhrase = words.slice(1, 4).join(', ');
      const w0ctx = w0.length < MIN_LEN ? `${w0} (${number})` : w0;
      if (w0ctx.length >= MIN_LEN && restPhrase.length >= MIN_LEN) {
        pairs.push({ anchor: w0ctx, positive: restPhrase });
      }
    }
  }
}

// ── Write output ──────────────────────────────────────────────────────────────

fs.writeFileSync(OUT, JSON.stringify(pairs, null, 0), 'utf8');

// Summary
const hebrew = Object.keys(stronsgs).filter(k => k.startsWith('H')).length;
const greek  = Object.keys(stronsgs).filter(k => k.startsWith('G')).length;
const typeA  = pairs.filter((p, i) => i % 5 < 2).length;  // rough count

console.log(`Strong's entries: ${Object.keys(stronsgs).length} (${hebrew} Hebrew, ${greek} Greek)`);
console.log(`Pairs generated : ${pairs.length}`);
console.log(`Output          : ${OUT}`);
const stat = fs.statSync(OUT);
console.log(`Size            : ${(stat.size / 1024).toFixed(0)} KB`);
