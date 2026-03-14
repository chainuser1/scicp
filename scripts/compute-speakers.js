#!/usr/bin/env node
/**
 * compute-speakers.js
 * Assigns a speaker and re-classifies POV for every verse in lds-scriptures.
 *
 * Strategy:
 *   1. Chapter-level default speaker  (curated static map — scholarly consensus)
 *   2. Verse-level dialogue override  (regex attribution tracking mid-chapter)
 *   3. POV re-classification          (deterministic rules, not zero-shot ML)
 *
 * Adds a `speaker` column to verse_doctrine_tags and updates `pov`.
 *
 * Run: node scripts/compute-speakers.js [--reset]
 */
'use strict';

const path = require('path');
const Database = require('better-sqlite3');

const DB_DIR  = path.resolve(__dirname, '../resources/db');
const db      = new Database(path.join(DB_DIR, 'lds-scriptures-sqlite.db'), { readonly: true });
const db_tags = new Database(path.join(DB_DIR, 'verse-tags.db'));

// ── Schema migration ──────────────────────────────────────────────────────────
try { db_tags.exec(`ALTER TABLE verse_doctrine_tags ADD COLUMN speaker TEXT DEFAULT NULL;`); } catch {}
console.log('Schema ready.');

// ── Chapter-level default speaker map ────────────────────────────────────────
// Format: chapter_id (or range) → speaker string
// chapter_id is the PK in the `chapters` table of lds-scriptures-sqlite.db

// We'll build this map dynamically from book ranges
// book_id → { first_chapter_id, last_chapter_id, chapter_number → speaker }
// For books with a single narrator throughout, we just use defaultSpeaker.
// For books with chapter-specific speakers (sermons, epistles), we use chapterSpeakers.

const BOOK_SPEAKERS = {
  // ── OLD TESTAMENT ──────────────────────────────────────────────────────────
  1:  { default: 'Moses (narrator)' },        // Genesis
  2:  { default: 'Moses (narrator)' },        // Exodus
  3:  { default: 'Moses (narrator)' },        // Leviticus
  4:  { default: 'Moses (narrator)' },        // Numbers
  5:  { default: 'Moses (narrator)' },        // Deuteronomy — Moses's farewell sermon
  6:  { default: 'Joshua (narrator)' },       // Joshua
  7:  { default: 'Unknown (narrator)' },      // Judges
  8:  { default: 'Unknown (narrator)' },      // Ruth
  9:  { default: 'Samuel (narrator)' },       // 1 Samuel
  10: { default: 'Unknown (narrator)' },      // 2 Samuel
  11: { default: 'Unknown (narrator)' },      // 1 Kings
  12: { default: 'Unknown (narrator)' },      // 2 Kings
  13: { default: 'Ezra (narrator)' },         // 1 Chronicles
  14: { default: 'Ezra (narrator)' },         // 2 Chronicles
  15: { default: 'Ezra (narrator)' },         // Ezra
  16: { default: 'Nehemiah (narrator)' },     // Nehemiah
  17: { default: 'Unknown (narrator)' },      // Esther
  18: { default: 'Job (narrator)' },          // Job
  19: { default: 'Various Psalmists' },       // Psalms — override per chapter below
  20: { default: 'Solomon (narrator)' },      // Proverbs
  21: { default: 'Ecclesiastes (Qoheleth)' }, // Ecclesiastes
  22: { default: 'Solomon' },                 // Song of Solomon
  23: { default: 'Isaiah' },                  // Isaiah
  24: { default: 'Jeremiah' },                // Jeremiah
  25: { default: 'Jeremiah' },                // Lamentations
  26: { default: 'Ezekiel' },                 // Ezekiel
  27: { default: 'Daniel' },                  // Daniel
  28: { default: 'Hosea' },                   // Hosea
  29: { default: 'Joel' },                    // Joel
  30: { default: 'Amos' },                    // Amos
  31: { default: 'Obadiah' },                 // Obadiah
  32: { default: 'Jonah (narrator)' },        // Jonah
  33: { default: 'Micah' },                   // Micah
  34: { default: 'Nahum' },                   // Nahum
  35: { default: 'Habakkuk' },                // Habakkuk
  36: { default: 'Zephaniah' },               // Zephaniah
  37: { default: 'Haggai' },                  // Haggai
  38: { default: 'Zechariah' },               // Zechariah
  39: { default: 'Malachi' },                 // Malachi

  // ── NEW TESTAMENT ──────────────────────────────────────────────────────────
  40: { default: 'Matthew (narrator)' },      // Matthew
  41: { default: 'Mark (narrator)' },         // Mark
  42: { default: 'Luke (narrator)' },         // Luke
  43: { default: 'John (narrator)' },         // John
  44: { default: 'Luke (narrator)' },         // Acts
  45: { default: 'Paul' },                    // Romans
  46: { default: 'Paul' },                    // 1 Corinthians
  47: { default: 'Paul' },                    // 2 Corinthians
  48: { default: 'Paul' },                    // Galatians
  49: { default: 'Paul' },                    // Ephesians
  50: { default: 'Paul' },                    // Philippians
  51: { default: 'Paul' },                    // Colossians
  52: { default: 'Paul' },                    // 1 Thessalonians
  53: { default: 'Paul' },                    // 2 Thessalonians
  54: { default: 'Paul' },                    // 1 Timothy
  55: { default: 'Paul' },                    // 2 Timothy
  56: { default: 'Paul' },                    // Titus
  57: { default: 'Paul' },                    // Philemon
  58: { default: 'Paul' },                    // Hebrews
  59: { default: 'James' },                   // James
  60: { default: 'Peter' },                   // 1 Peter
  61: { default: 'Peter' },                   // 2 Peter
  62: { default: 'John' },                    // 1 John
  63: { default: 'John' },                    // 2 John
  64: { default: 'John' },                    // 3 John
  65: { default: 'Jude' },                    // Jude
  66: { default: 'John (narrator)' },         // Revelation

  // ── BOOK OF MORMON ─────────────────────────────────────────────────────────
  67: { default: 'Nephi' },                   // 1 Nephi
  68: {                                        // 2 Nephi
    default: 'Nephi',
    // 2 Nephi chapter_number → speaker
    // ch 1: Lehi's blessing/farewell; ch 2-4: Lehi; ch 4: Nephi's Psalm
    // ch 6-8: Jacob quoting Isaiah; ch 11-24: Nephi quoting Isaiah
    // ch 25-30: Nephi prophecy; ch 31-33: Nephi
    byChapter: { 1:'Lehi', 2:'Lehi', 3:'Lehi', 4:'Nephi' }
  },
  69: {                                        // Jacob
    default: 'Jacob',
    byChapter: { 5:'Jacob (quoting Zenos)' }
  },
  70: { default: 'Enos' },                    // Enos
  71: { default: 'Jarom' },                   // Jarom
  72: {                                        // Omni
    default: 'Various Nephite narrators',
    byChapter: { 1:'Omni/Amaron/Chemish/Abinadom/Amaleki' }
  },
  73: { default: 'Mormon (narrator)' },       // Words of Mormon
  74: {                                        // Mosiah
    default: 'Mormon (narrator)',
    byChapter: {
      2: 'King Benjamin', 3: 'King Benjamin', 4: 'King Benjamin', 5: 'King Benjamin',
      12: 'Abinadi', 13: 'Abinadi', 14: 'Abinadi',
    }
  },
  75: {                                        // Alma
    default: 'Mormon (narrator)',
    byChapter: {
      5: 'Alma the Younger',     // Alma's sermon in Zarahemla
      7: 'Alma the Younger',     // Alma's sermon in Gideon
      17: 'Ammon (narrator)',    // Ammon in king Lamoni's court
      32: 'Alma the Younger',    // sermon on faith (Zoramite poor)
      33: 'Alma the Younger',
      34: 'Amulek',
      36: 'Alma the Younger',    // Alma to Helaman
      37: 'Alma the Younger',
      38: 'Alma the Younger',    // Alma to Shiblon
      39: 'Alma the Younger',    // Alma to Corianton
      40: 'Alma the Younger',
      41: 'Alma the Younger',
      42: 'Alma the Younger',
    }
  },
  76: { default: 'Mormon (narrator)' },       // Helaman
  77: {                                        // 3 Nephi
    default: 'Mormon (narrator)',
    byChapter: {
      11: 'Jesus Christ', 12: 'Jesus Christ', 13: 'Jesus Christ', 14: 'Jesus Christ',
      15: 'Jesus Christ', 16: 'Jesus Christ', 17: 'Jesus Christ', 18: 'Jesus Christ',
      19: 'Mormon (narrator)', 20: 'Jesus Christ', 21: 'Jesus Christ',
      22: 'Jesus Christ', 23: 'Jesus Christ', 24: 'Jesus Christ', 25: 'Jesus Christ',
      27: 'Jesus Christ', 28: 'Jesus Christ',
    }
  },
  78: { default: 'Mormon (narrator)' },       // 4 Nephi
  79: { default: 'Mormon (narrator)' },       // Mormon
  80: { default: 'Moroni (narrator)' },       // Ether
  81: {                                        // Moroni
    default: 'Moroni',
    byChapter: {
      7: 'Mormon', // Mormon's sermon on faith, hope, charity (Moroni 7)
    }
  },

  // ── DOCTRINE AND COVENANTS ─────────────────────────────────────────────────
  // Most sections are revelations given to/through Joseph Smith
  82: {
    default: 'Joseph Smith / The Lord',
    // A few sections have different receivers or speakers
    byChapter: {
      // section 76 = Vision of the Three Degrees (Joseph Smith & Sidney Rigdon)
      76: 'Joseph Smith & Sidney Rigdon',
      // section 77 = Q&A on Revelation (Joseph Smith)
      77: 'Joseph Smith',
      // section 88 = Olive Leaf revelation
      88: 'Joseph Smith / The Lord',
      // section 121-123 = Joseph's Liberty Jail letters
      121: 'Joseph Smith', 122: 'Joseph Smith', 123: 'Joseph Smith',
      // section 135 = martyrdom notice (John Taylor)
      135: 'John Taylor',
      // Official Declarations
      138: 'Joseph F. Smith',
    }
  },

  // ── PEARL OF GREAT PRICE ────────────────────────────────────────────────────
  83: { default: 'Moses (narrator)' },         // Moses
  84: { default: 'Abraham (narrator)' },       // Abraham
  85: { default: 'Joseph Smith (narrator)' },  // JS-Matthew
  86: { default: 'Joseph Smith (narrator)' },  // JS-History
  87: { default: 'Joseph Smith' },             // Articles of Faith
};

// Special Psalms speaker map (psalm number → author)
// David wrote most; others are noted
const PSALM_AUTHORS = {
  // Asaph: 50, 73-83
  50:true, 73:true, 74:true, 75:true, 76:true, 77:true, 78:true, 79:true, 80:true, 81:true, 82:true, 83:true,
  // Sons of Korah: 42-49, 84-85, 87-88
  42:true, 43:true, 44:true, 45:true, 46:true, 47:true, 48:true, 49:true, 84:true, 85:true, 87:true, 88:true,
  // Solomon: 72, 127
  72:'Solomon', 127:'Solomon',
  // Moses: 90
  90:'Moses',
  // Ethan the Ezrahite: 89
  89:'Ethan the Ezrahite',
  // Anonymous/David (default for rest)
};

// ── Load chapters ─────────────────────────────────────────────────────────────
const chapters = db.prepare(`
  SELECT c.id, c.chapter_number, b.id AS book_id, b.book_title
  FROM chapters c JOIN books b ON b.id = c.book_id
  ORDER BY c.id
`).all();

// Build chapter_id → speaker map
const chapterSpeakerMap = new Map();
for (const ch of chapters) {
  const spec = BOOK_SPEAKERS[ch.book_id];
  if (!spec) {
    chapterSpeakerMap.set(ch.id, 'Unknown');
    continue;
  }
  let speaker = spec.default || 'Unknown';
  if (spec.byChapter && spec.byChapter[ch.chapter_number]) {
    speaker = spec.byChapter[ch.chapter_number];
  }
  // Special Psalms handling
  if (ch.book_id === 19) {
    const pn = ch.chapter_number;
    const auth = PSALM_AUTHORS[pn];
    if (auth === true) {
      // Asaph or Sons of Korah — determine by range
      if ([50,73,74,75,76,77,78,79,80,81,82,83].includes(pn)) speaker = 'Asaph';
      else speaker = 'Sons of Korah';
    } else if (typeof auth === 'string') {
      speaker = auth;
    } else {
      speaker = 'David'; // default psalm author
    }
  }
  chapterSpeakerMap.set(ch.id, speaker);
}

// ── Verse-level dialogue attribution patterns ─────────────────────────────────
// These patterns, when found in a verse, shift the "current speaker" for
// subsequent verses until another attribution is found.

const ATTRIBUTION_PATTERNS = [
  // God / the Lord speaking
  { re: /\b(thus saith the lord|saith the lord|the lord said|god said|the lord spake|the lord commanded|i the lord|i am the lord|saith the lord of hosts|i am jesus christ|i am alpha|i am he|mine only begotten)\b/i, speaker: 'The Lord (Jehovah)', pov: 'spoken by God' },
  // Jesus Christ specifically
  { re: /\bjesus (said|answered|spake|taught|commanded|told|replied)\b/i, speaker: 'Jesus Christ', pov: 'spoken by God' },
  // Prayer / praise
  { re: /\b(o lord, i thank|o lord my god|i pray unto thee|father, i thank|o god, hear|o lord, wilt thou|my soul doth magnify|hallowed be thy name|our father which art)\b/i, speaker: null, pov: 'prayer or praise' },
  // Psalm-style praise
  { re: /^(praise (ye |the lord|god)|blessed (is|are) the (lord|god|man)|o (lord|god), thou)\b/i, speaker: null, pov: 'prayer or praise' },
  // Named prophet sermons / addresses
  { re: /\b(nephi (said|spake|wrote)|i nephi|thus (saith|spake) nephi)\b/i, speaker: 'Nephi', pov: 'spoken by a prophet' },
  { re: /\b(jacob (said|spake)|thus (saith|spake) jacob)\b/i, speaker: 'Jacob', pov: 'spoken by a prophet' },
  { re: /\b(alma (said|spake|cried)|thus (saith|spake) alma)\b/i, speaker: 'Alma the Younger', pov: 'spoken by a prophet' },
  { re: /\b(king benjamin (said|spake)|thus (saith|spake) benjamin)\b/i, speaker: 'King Benjamin', pov: 'spoken by a prophet' },
  { re: /\b(moses (said|spake)|thus (saith|spake) moses|the lord said unto moses)\b/i, speaker: 'Moses', pov: 'spoken by a prophet' },
  { re: /\b(paul (said|wrote|spake)|thus (saith|spake) paul)\b/i, speaker: 'Paul', pov: 'spoken by a prophet' },
  { re: /\b(moroni (said|spake|wrote)|thus (saith|spake) moroni)\b/i, speaker: 'Moroni', pov: 'spoken by a prophet' },
  { re: /\b(mormon (said|spake|wrote)|thus (saith|spake) mormon)\b/i, speaker: 'Mormon', pov: 'spoken by a prophet' },
  { re: /\b(joseph smith (said|wrote|spake)|i joseph smith)\b/i, speaker: 'Joseph Smith', pov: 'spoken by a prophet' },
  { re: /\b(isaiah (said|spake|wrote)|thus (saith|spake) isaiah)\b/i, speaker: 'Isaiah', pov: 'spoken by a prophet' },
  { re: /\b(jeremiah (said|spake|wrote)|thus (saith|spake) jeremiah)\b/i, speaker: 'Jeremiah', pov: 'spoken by a prophet' },
  { re: /\b(ezekiel (said|spake)|thus (saith|spake) ezekiel)\b/i, speaker: 'Ezekiel', pov: 'spoken by a prophet' },
  // Hymn / poetry patterns
  { re: /^(bless(ed|ings)|sing (unto the lord|praises)|make a joyful noise|the lord is my shepherd|i will (praise|exalt|bless) (thee|the lord))\b/i, speaker: null, pov: 'prayer or praise' },
];

// ── POV classification rules ──────────────────────────────────────────────────
// Applied after speaker is determined; returns pov string.
function classifyPov(text, speaker, chapterDefaultSpeaker) {
  const t = text.toLowerCase();

  // 1. Direct divine speech markers (highest priority)
  if (/\b(thus saith the lord|saith the lord|i the lord|the lord said|i am the lord|i am jesus christ|i am alpha and omega)\b/.test(t)) {
    return 'spoken by God';
  }
  // D&C-style divine first-person markers
  if (/\b(my church|saith the voice of him who dwells on high|the voice of the lord is unto|mine anger is kindled|i have sworn|i will reveal|i the lord your god|i will forgive|i have commanded you)\b/.test(t)) {
    return 'spoken by God';
  }
  // 2. Speaker is God/Lord/Christ (from attribution map or chapter default)
  if (speaker && /^(the lord|jesus christ|god|jehovah|elohim)/i.test(speaker)) {
    return 'spoken by God';
  }
  // D&C: chapter default speaker contains "The Lord" — treat first-person as divine
  if (chapterDefaultSpeaker && /the lord/i.test(chapterDefaultSpeaker) &&
      /\b(i will|i have|mine|my people|my church|i say|behold i)\b/.test(t)) {
    return 'spoken by God';
  }
  // 3. Prayer / praise markers
  if (/\b(o lord|i pray|i thank thee|hallowed be|our father which art|hear my prayer|bless the lord|praise (ye|the lord|god))\b/.test(t)) {
    return 'prayer or praise';
  }
  // 4. First-person testimony / doctrinal teaching by a prophet
  if (/\b(i say unto you|i testify|i bear witness|my brethren|i would that ye|behold i say|thus we see that|hearken unto me)\b/.test(t)) {
    return 'spoken by a prophet';
  }
  // 5. Epistolary / letter pattern
  if (/\b(grace (be|unto) you|peace from god|i beseech you|i write unto you|i paul|i peter|i john)\b/.test(t)) {
    return 'spoken by a prophet';
  }
  // 6. Prophecy / vision pattern
  if (/\b(thus saith|the word of the lord came|i saw in a vision|it came to pass that i saw|and i looked and beheld)\b/.test(t)) {
    return 'spoken by a prophet';
  }
  // 7. Psalm / poetry speaker is David/Asaph/Moses — almost always addressed to God
  if (speaker && /^(david|asaph|moses|sons of korah|ethan|solomon)/i.test(speaker) &&
      /\b(lord|god|thee|thy|thou)\b/.test(t)) {
    return 'prayer or praise';
  }
  // 8. If speaker is a named prophet/apostle and verse is clearly first-person teaching
  if (speaker && !/narrator/i.test(speaker) && !/unknown/i.test(speaker) &&
      /\b(i|my|we|our)\b/.test(t) && !/^(the lord|jesus christ|god|unknown|various)/i.test(speaker)) {
    // Named individual speaker + first-person = spoken by a prophet
    if (/\b(i (say|know|have|bear|write|speak|teach|exhort|charge|beseech|declare))\b/.test(t)) {
      return 'spoken by a prophet';
    }
  }
  // 9. Narrative fallback
  return 'historical narrative';
}

// ── Load all verses ───────────────────────────────────────────────────────────
const verses = db.prepare(`
  SELECT v.id, v.chapter_id, v.verse_number, v.scripture_text,
         c.chapter_number, b.id book_id
  FROM verses v
  JOIN chapters c ON c.id = v.chapter_id
  JOIN books b ON b.id = c.book_id
  ORDER BY v.id
`).all();

console.log(`Processing ${verses.length} verses…`);

// Group by chapter for dialogue tracking
const versesByChapter = new Map();
for (const v of verses) {
  if (!versesByChapter.has(v.chapter_id)) versesByChapter.set(v.chapter_id, []);
  versesByChapter.get(v.chapter_id).push(v);
}

// ── Process ───────────────────────────────────────────────────────────────────
const updates = [];

for (const [chapterId, chVerses] of versesByChapter) {
  const chDefaultSpeaker = chapterSpeakerMap.get(chapterId) || 'Unknown';
  let currentSpeaker = chDefaultSpeaker;
  let dialogueSpeaker = null; // override from verse-level attribution

  for (const v of chVerses) {
    const text = v.scripture_text || '';
    // Scan attribution patterns
    for (const pat of ATTRIBUTION_PATTERNS) {
      if (pat.re.test(text)) {
        if (pat.speaker) dialogueSpeaker = pat.speaker;
        break;
      }
    }
    const speaker = dialogueSpeaker || currentSpeaker;
    const pov = classifyPov(text, speaker, chDefaultSpeaker);
    updates.push({ verse_id: v.id, speaker, pov });
  }
}

// ── Write to DB ───────────────────────────────────────────────────────────────
const upd = db_tags.prepare(`
  UPDATE verse_doctrine_tags SET speaker = ?, pov = ? WHERE verse_id = ?
`);
const batchUpdate = db_tags.transaction(items => {
  for (const item of items) upd.run(item.speaker, item.pov, item.verse_id);
});

const BATCH = 2000;
for (let i = 0; i < updates.length; i += BATCH) {
  batchUpdate(updates.slice(i, i + BATCH));
  process.stdout.write(`\r${Math.min(i + BATCH, updates.length)}/${updates.length}`);
}
console.log('\nDone.');

// ── Stats ─────────────────────────────────────────────────────────────────────
const povStats = db_tags.prepare(`
  SELECT pov, COUNT(*) as c FROM verse_doctrine_tags GROUP BY pov ORDER BY c DESC
`).all();
console.log('\nPOV distribution:');
for (const r of povStats) console.log(`  ${r.pov}: ${r.c}`);

const speakerStats = db_tags.prepare(`
  SELECT speaker, COUNT(*) as c FROM verse_doctrine_tags 
  WHERE speaker IS NOT NULL GROUP BY speaker ORDER BY c DESC LIMIT 20
`).all();
console.log('\nTop 20 speakers:');
for (const r of speakerStats) console.log(`  ${r.speaker}: ${r.c}`);

db.close();
db_tags.close();
