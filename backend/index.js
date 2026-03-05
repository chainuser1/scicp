const fastify = require('fastify')({ logger: true });
const { Server } = require("socket.io");
// english scriptures database (LDS standard works)
const db = require('better-sqlite3')('../resources/db/lds-scriptures-sqlite.db', { fileMustExist: true });
// additional language databases (optional)
const db_tagalog = require('better-sqlite3')('../resources/db/tagalog-scriptures-sqlite.db', { fileMustExist: true });
const db_cebuano = require('better-sqlite3')('../resources/db/cebuano-scriptures-sqlite.db', { fileMustExist: true });

fastify.register(require('@fastify/cors'), {
  origin: "*",
});

fastify.get('/', async (request, reply) => {
  return { hello: 'world' }
});

// theme management endpoints
fastify.get('/themes', async (request, reply) => {
  const rows = db.prepare('SELECT id, name, data FROM themes').all();
  return rows.map(r => ({ id: r.id, name: r.name, data: JSON.parse(r.data) }));
});

fastify.post('/themes', async (request, reply) => {
  const { name, data } = request.body;
  if (!name || !data) {
    reply.code(400);
    return { error: 'name and data are required' };
  }
  try {
    const stmt = db.prepare('INSERT INTO themes (name, data) VALUES (?, ?)');
    const info = stmt.run(name, JSON.stringify(data));
    return { id: info.lastInsertRowid, name, data };
  } catch (err) {
    fastify.log.error(err);
    reply.code(500);
    return { error: 'could not create theme' };
  }
});

fastify.put('/themes/:id', async (request, reply) => {
  const { id } = request.params;
  const { name, data } = request.body;
  if (!name || !data) {
    reply.code(400);
    return { error: 'name and data are required' };
  }
  try {
    const stmt = db.prepare('UPDATE themes SET name = ?, data = ? WHERE id = ?');
    stmt.run(name, JSON.stringify(data), id);
    return { id: Number(id), name, data };
  } catch (err) {
    fastify.log.error(err);
    reply.code(500);
    return { error: 'could not update theme' };
  }
});

fastify.delete('/themes/:id', async (request, reply) => {
  const { id } = request.params;
  try {
    const stmt = db.prepare('DELETE FROM themes WHERE id = ?');
    stmt.run(id);
    return { success: true };
  } catch (err) {
    fastify.log.error(err);
    reply.code(500);
    return { error: 'could not delete theme' };
  }
});


const io = new Server(fastify.server, {
  cors: {
    origin: "*",
  }
});

// ensure themes table exists
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS themes (
      id INTEGER PRIMARY KEY,
      name TEXT UNIQUE,
      data TEXT NOT NULL
    );
  `);
} catch (err) {
  fastify.log.error('failed to ensure themes table', err);
}

// ─── FTS5 Setup: Drop & Rebuild with advanced features ───────────────────────
//
//  Upgrades over the previous table:
//  1. tokenize = "porter ascii"
//     Porter stemmer reduces words to their root so that:
//       "redemption" matches "redeem", "atoning" matches "atone",
//       "baptisms" matches "baptism", "believing" matches "believe"
//     Without this, prefix wildcards (*) only help suffix variation, not
//     root-level morphological variation.
//
//  2. Weighted columns via bm25()
//     BM25 (Best Match 25) is the industry-standard relevance ranking algorithm.
//     We give scripture_text the highest weight (10), verse_title medium (5),
//     book_title low (1) so a match in the verse body ranks above a title match.
//     Column weights in bm25() are negative by convention (higher = more negative).
//
//  3. Results ordered by rank (bm25 score) instead of verse_id
//     Previously results came back in canonical order regardless of relevance.
//     Now the most relevant verse surfaces first — critical for doctrinal queries
//     where a keyword appears in hundreds of verses.
//
//  4. LIMIT 50 applied at the FTS level
//     Prevents returning thousands of rows for common words like "faith".
// ─────────────────────────────────────────────────────────────────────────────
try {
  // Drop old table unconditionally so we always get the upgraded schema.
  // This is safe because scriptures_fts is a pure index — all source data
  // lives in the canonical `verses`, `chapters`, and `books` tables.
  db.exec(`DROP TABLE IF EXISTS scriptures_fts`);
  fastify.log.info('Dropped old scriptures_fts table');

  // Rebuild with porter stemmer + column structure preserved
  db.exec(`
    CREATE VIRTUAL TABLE scriptures_fts USING fts5(
      verse_id   UNINDEXED,
      scripture_text,
      verse_title,
      book_title,
      chapter_number UNINDEXED,
      verse_number   UNINDEXED,
      tokenize = "porter ascii"
    )
  `);
  fastify.log.info('Rebuilt scriptures_fts with porter stemmer');

  // Populate from canonical tables (same join as before)
  fastify.log.info('Populating FTS5 table from verses...');
  const insertStmt = db.prepare(`
    INSERT INTO scriptures_fts(verse_id, scripture_text, verse_title, book_title, chapter_number, verse_number)
    SELECT
      verses.id,
      verses.scripture_text,
      (books.book_title || ' ' || chapters.chapter_number || ':' || verses.verse_number),
      books.book_title,
      chapters.chapter_number,
      verses.verse_number
    FROM verses
    JOIN chapters ON chapters.id = verses.chapter_id
    JOIN books    ON books.id    = chapters.book_id
  `);
  const result = insertStmt.run();
  fastify.log.info(`FTS5 table populated with ${result.changes} verses`);

  // Run OPTIMIZE so the index is fully merged into a single segment —
  // this cuts query time on large result sets (e.g. "faith") significantly.
  db.exec(`INSERT INTO scriptures_fts(scriptures_fts) VALUES('optimize')`);
  fastify.log.info('FTS5 index optimized');

} catch (err) {
  fastify.log.error('FTS5 setup failed:', err && err.message ? err.message : err);
}


// Map of book abbreviations to full names (LDS scriptures)
const BOOK_ABBREVIATIONS = {
  // Old Testament
  'gen': 'Genesis',
  'ex': 'Exodus',
  'lev': 'Leviticus',
  'num': 'Numbers',
  'deut': 'Deuteronomy',
  'josh': 'Joshua',
  'judg': 'Judges',
  'ruth': 'Ruth',
  '1 sam': '1 Samuel',
  '1sam': '1 Samuel',
  '2 sam': '2 Samuel',
  '2sam': '2 Samuel',
  '1 kg': '1 Kings',
  '1kg': '1 Kings',
  '1 kgs': '1 Kings',
  '2 kg': '2 Kings',
  '2kg': '2 Kings',
  '2 kgs': '2 Kings',
  '1 chr': '1 Chronicles',
  '1chr': '1 Chronicles',
  '2 chr': '2 Chronicles',
  '2chr': '2 Chronicles',
  'ezra': 'Ezra',
  'neh': 'Nehemiah',
  'esth': 'Esther',
  'job': 'Job',
  'ps': 'Psalms',
  'psa': 'Psalms',
  'prov': 'Proverbs',
  'eccl': 'Ecclesiastes',
  'isa': 'Isaiah',
  'jer': 'Jeremiah',
  'lam': 'Lamentations',
  'ezek': 'Ezekiel',
  'dan': 'Daniel',
  'hos': 'Hosea',
  'joel': 'Joel',
  'amos': 'Amos',
  'obad': 'Obadiah',
  'jonah': 'Jonah',
  'micah': 'Micah',
  'nahum': 'Nahum',
  'hab': 'Habakkuk',
  'zeph': 'Zephaniah',
  'hag': 'Haggai',
  'zech': 'Zechariah',
  'mal': 'Malachi',
  
  // New Testament
  'matt': 'Matthew',
  'mark': 'Mark',
  'luke': 'Luke',
  'john': 'John',
  'acts': 'Acts',
  'rom': 'Romans',
  '1 cor': '1 Corinthians',
  '1cor': '1 Corinthians',
  '2 cor': '2 Corinthians',
  '2cor': '2 Corinthians',
  'gal': 'Galatians',
  'eph': 'Ephesians',
  'phil': 'Philippians',
  'col': 'Colossians',
  '1 thes': '1 Thessalonians',
  '1thes': '1 Thessalonians',
  '2 thes': '2 Thessalonians',
  '2thes': '2 Thessalonians',
  '1 tim': '1 Timothy',
  '1tim': '1 Timothy',
  '2 tim': '2 Timothy',
  '2tim': '2 Timothy',
  'titus': 'Titus',
  'philem': 'Philemon',
  'heb': 'Hebrews',
  'james': 'James',
  '1 pet': '1 Peter',
  '1pet': '1 Peter',
  '2 pet': '2 Peter',
  '2pet': '2 Peter',
  '1 jn': '1 John',
  '1jn': '1 John',
  '2 jn': '2 John',
  '2jn': '2 John',
  '3 jn': '3 John',
  '3jn': '3 John',
  'jude': 'Jude',
  'rev': 'Revelation',
  
  // Book of Mormon
  '1 ne': '1 Nephi',
  '1ne': '1 Nephi',
  '2 ne': '2 Nephi',
  '2ne': '2 Nephi',
  'jacob': 'Jacob',
  'enos': 'Enos',
  'jarom': 'Jarom',
  'omni': 'Omni',
  'w of m': 'Words of Mormon',
  'wom': 'Words of Mormon',
  'mosiah': 'Mosiah',
  'alma': 'Alma',
  'hel': 'Helaman',
  '3 ne': '3 Nephi',
  '3ne': '3 Nephi',
  '4 ne': '4 Nephi',
  '4ne': '4 Nephi',
  'moro': 'Moroni',
  
  // Doctrine and Covenants
  'd&c': 'Doctrine and Covenants',
  'dc': 'Doctrine and Covenants',
  'doc': 'Doctrine and Covenants',
  'doc&cov': 'Doctrine and Covenants',
  'oa': 'Olive Garden Account' 
};

// Function to expand abbreviated book name
function expandBookName(bookRef) {
  if (!bookRef) return null;
  const lowerRef = bookRef.toLowerCase().trim();
  return BOOK_ABBREVIATIONS[lowerRef] || bookRef;
}

// Function to segment verse text into readable chunks (max 100 words per segment)
function segmentVerseText(text, wordsPerSegment = 100) {
  if (!text) return [];
  
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const segments = [];
  
  for (let i = 0; i < words.length; i += wordsPerSegment) {
    segments.push(words.slice(i, i + wordsPerSegment).join(' '));
  }
  
  return segments.length > 0 ? segments : [text];
}



function parseScriptureReference(str) {
    if (!str || typeof str !== 'string') return null;
    const trimmed = str.trim();
    // look for a book name followed by numeric chapter and optional verse
    const match = trimmed.match(/^(.+?)\s+(\d+)(?::(\d+))?$/);
    if (!match) return null;
    let book = match[1].trim();
    const chapter = parseInt(match[2], 10);
    const verse = match[3] ? parseInt(match[3], 10) : null;
    
    // Try to expand abbreviated book name
    book = expandBookName(book);
    
    return { book, chapter, verse };
}

// Build a safe FTS5 MATCH query from user input.
// - quoted phrase ("...") is searched as an exact phrase
// - otherwise split into tokens and require all tokens (AND)
// Build a safe FTS5 MATCH query from user input.
// ─── Doctrine Alias Map ───────────────────────────────────────────────────────
//  Maps plain-language doctrinal queries → keyword expansions that FTS5 can
//  match against scripture text. Evaluated before FTS5 runs, costs 0ms.
//  Extend this map whenever a real-world presenter query stumps the system.
// ─────────────────────────────────────────────────────────────────────────────
const DOCTRINE_ALIASES = {

  // ── Plan of Salvation ─────────────────────────────────────────────────────
  'plan of salvation': {
    phrases: ['plan of salvation', 'plan of redemption', 'plan of happiness', 'great plan of happiness', 'great plan of the Eternal God'],
    terms:   ['salvation', 'redemption', 'immortality', 'eternal life', 'atonement', 'resurrection', 'exaltation'],
  },
  'plan of redemption': {
    phrases: ['plan of redemption', 'plan of salvation', 'plan of happiness', 'prepared from the foundation of the world'],
    terms:   ['redemption', 'salvation', 'eternal life', 'atonement', 'prepared', 'foundation'],
  },
  'plan of happiness': {
    phrases: ['plan of happiness', 'plan of salvation', 'great plan of happiness'],
    terms:   ['happiness', 'salvation', 'eternal life', 'joy', 'redemption'],
  },
  'premortal life': {
    phrases: ['before the world was', 'foundation of the world', 'pre-earth life', 'council in heaven', 'chosen before', 'foreordained'],
    terms:   ['foreordained', 'chosen', 'foundation', 'spirits', 'council', 'heaven', 'premortal'],
  },
  'preexistence': {
    phrases: ['before the world was', 'foundation of the world', 'council in heaven'],
    terms:   ['foreordained', 'spirits', 'chosen', 'foundation', 'premortal'],
  },
  'war in heaven': {
    phrases: ['war in heaven', 'cast out', 'third part of the stars', 'rebellion in heaven'],
    terms:   ['war', 'heaven', 'cast', 'rebel', 'devil', 'dragon', 'third', 'stars'],
  },
  'spirit world': {
    phrases: ['spirit world', 'world of spirits', 'paradise of God', 'spirit prison', 'prison house'],
    terms:   ['spirit', 'dead', 'prison', 'paradise', 'resurrection', 'disembodied'],
  },
  'three kingdoms': {
    phrases: ['celestial kingdom', 'terrestrial kingdom', 'telestial kingdom', 'degrees of glory', 'many mansions'],
    terms:   ['celestial', 'terrestrial', 'telestial', 'glory', 'kingdom', 'mansion'],
  },

  // ── Atonement ─────────────────────────────────────────────────────────────
  'atonement': {
    phrases: ['atonement of Christ', 'atonement of Jesus Christ', 'infinite atonement', 'atoning sacrifice', 'atoning blood', 'blood of Christ'],
    terms:   ['atone', 'redeem', 'suffer', 'reconcile', 'ransom', 'sacrifice', 'expiate'],
  },
  'infinite atonement': {
    phrases: ['infinite atonement', 'infinite and eternal', 'atonement of Christ', 'eternal sacrifice'],
    terms:   ['infinite', 'eternal', 'atone', 'suffer', 'sins', 'all mankind'],
  },
  'gethsemane': {
    phrases: ['garden of Gethsemane', 'suffer in Gethsemane', 'blood from every pore', 'sweat as it were great drops'],
    terms:   ['gethsemane', 'suffer', 'cup', 'bleed', 'pore', 'agony', 'garden'],
  },
  'grace': {
    phrases: ['saved by grace', 'grace of God', 'grace of Christ', 'after all we can do'],
    terms:   ['grace', 'mercy', 'favour', 'unmerited', 'enable', 'divine help'],
  },
  'grace vs works': {
    phrases: ['saved by grace', 'after all we can do', 'faith without works', 'works of righteousness'],
    terms:   ['grace', 'works', 'faith', 'justified', 'saved', 'merit'],
  },
  'redemption': {
    phrases: ['redemption of Christ', 'redemption through Christ', 'plan of redemption', 'redeemed from the fall'],
    terms:   ['redeem', 'ransom', 'bought', 'price', 'redemption', 'deliver'],
  },

  // ── Christology ───────────────────────────────────────────────────────────
  'jesus christ': {
    phrases: ['Jesus Christ', 'Son of God', 'Son of Man', 'Lamb of God', 'Messiah', 'Holy One of Israel', 'Redeemer of Israel', 'Lord and Savior'],
    terms:   ['Jesus', 'Christ', 'Savior', 'Redeemer', 'Messiah', 'Lord'],
  },
  'second coming': {
    phrases: ['second coming', 'coming of the Son of Man', 'day of the Lord', 'great and dreadful day', 'coming in glory', 'at his coming'],
    terms:   ['second', 'coming', 'return', 'clouds', 'glory', 'parousia', 'millennium'],
  },
  'millennium': {
    phrases: ['thousand years', 'reign of Christ', 'millennial reign', 'new heaven and new earth'],
    terms:   ['millennium', 'thousand', 'reign', 'peace', 'Satan bound', 'rest'],
  },
  'resurrection': {
    phrases: ['resurrection of the dead', 'resurrection of Christ', 'brought to pass the resurrection', 'rise from the dead', 'first resurrection', 'resurrection of the just'],
    terms:   ['resurrect', 'rise', 'dead', 'immortal', 'body', 'alive', 'quicken'],
  },

  // ── Godhead ───────────────────────────────────────────────────────────────
  'godhead': {
    phrases: ['the Father and the Son', 'God the Father', 'Holy Ghost', 'three separate', 'Godhead', 'three personages'],
    terms:   ['father', 'son', 'holy ghost', 'godhead', 'personage', 'one'],
  },
  'nature of god': {
    phrases: ['God is a God of truth', 'body of flesh and bones', 'eternal God', 'immortal God', 'perfections of God'],
    terms:   ['god', 'eternal', 'immortal', 'omniscient', 'omnipotent', 'flesh', 'bones', 'perfection'],
  },
  'holy ghost': {
    phrases: ['Holy Ghost', 'Holy Spirit', 'gift of the Holy Ghost', 'Comforter', 'Spirit of God', 'Spirit of the Lord'],
    terms:   ['holy ghost', 'comforter', 'spirit', 'confirm', 'receive', 'witness', 'gift'],
  },
  'first vision': {
    phrases: ['pillar of light', 'two personages', 'Father and the Son appeared', 'grove of trees'],
    terms:   ['vision', 'light', 'pillar', 'personage', 'grove', 'appeared', 'Joseph'],
  },

  // ── Faith & Repentance ────────────────────────────────────────────────────
  'faith': {
    phrases: ['faith in Christ', 'faith in Jesus Christ', 'faith in the Lord', 'faith unto repentance', 'faith and works'],
    terms:   ['faith', 'believe', 'trust', 'hope', 'assurance', 'confidence'],
  },
  'repentance': {
    phrases: ['repent and be baptized', 'repentance of sins', 'broken heart and contrite spirit', 'godly sorrow', 'forsake your sins'],
    terms:   ['repent', 'forsake', 'confess', 'sorrow', 'contrite', 'broken heart', 'change'],
  },
  'forgiveness': {
    phrases: ['forgiveness of sins', 'sins are forgiven', 'I the Lord will forgive', 'remember no more', 'blot out transgressions'],
    terms:   ['forgive', 'pardon', 'remit', 'cleanse', 'blot', 'remember no more', 'merciful'],
  },
  'born again': {
    phrases: ['born again', 'born of God', 'born of the Spirit', 'new creature in Christ', 'spiritual rebirth', 'mighty change of heart'],
    terms:   ['born', 'spirit', 'new', 'creature', 'change', 'heart', 'rebirth'],
  },
  'doubt': {
    phrases: ['doubt not', 'fear not', 'O ye of little faith', 'wavering in faith'],
    terms:   ['doubt', 'fear', 'unbelief', 'waver', 'unstable', 'weak'],
  },

  // ── Ordinances & Priesthood ───────────────────────────────────────────────
  'baptism': {
    phrases: ['baptized in the name', 'baptism by immersion', 'born of water', 'enter by the gate', 'remission of sins by baptism'],
    terms:   ['baptize', 'immerse', 'water', 'spirit', 'gate', 'covenant', 'remission'],
  },
  'baptism for the dead': {
    phrases: ['baptized for the dead', 'baptism for the dead', 'proxy ordinance', 'work for the dead', 'salvation for the dead'],
    terms:   ['baptized', 'dead', 'proxy', 'vicarious', 'salvation', 'temple'],
  },
  'gift of holy ghost': {
    phrases: ['gift of the Holy Ghost', 'receive the Holy Ghost', 'confirmed a member', 'laying on of hands for the gift'],
    terms:   ['holy ghost', 'gift', 'confirm', 'receive', 'laying', 'hands'],
  },
  'sacrament': {
    phrases: ['bread and wine', 'bless and break bread', 'in remembrance of me', 'body and blood', 'sacrament of the Lord'],
    terms:   ['sacrament', 'bread', 'wine', 'cup', 'remember', 'body', 'blood', 'covenant'],
  },
  'priesthood': {
    phrases: ['Melchizedek Priesthood', 'Aaronic Priesthood', 'holy priesthood', 'keys of the kingdom', 'authority of God', 'ordained to the priesthood'],
    terms:   ['priesthood', 'authority', 'ordain', 'keys', 'melchizedek', 'aaronic', 'hold'],
  },
  'melchizedek priesthood': {
    phrases: ['Melchizedek Priesthood', 'higher priesthood', 'holy order of God', 'after the order of the Son of God'],
    terms:   ['melchizedek', 'higher', 'priesthood', 'order', 'authority', 'high priest'],
  },
  'aaronic priesthood': {
    phrases: ['Aaronic Priesthood', 'lesser priesthood', 'Levitical priesthood', 'preparatory priesthood'],
    terms:   ['aaronic', 'lesser', 'levitical', 'deacon', 'teacher', 'priest', 'preparatory'],
  },
  'laying on of hands': {
    phrases: ['laid their hands upon', 'laying on of hands', 'by the laying on', 'hands were laid'],
    terms:   ['hands', 'laid', 'ordained', 'blessed', 'healed', 'consecrated'],
  },
  'endowment': {
    phrases: ['endowed with power', 'endowment from on high', 'clothed with power', 'receive your endowment'],
    terms:   ['endow', 'power', 'high', 'holy', 'clothe', 'temple', 'ordinance'],
  },
  'sealing': {
    phrases: ['sealed for time and all eternity', 'sealed by the Holy Spirit of Promise', 'bind on earth', 'bind in heaven', 'sealing power', 'keys of sealing'],
    terms:   ['seal', 'bind', 'loose', 'keys', 'heaven', 'earth', 'eternity', 'family'],
  },
  'temple': {
    phrases: ['house of the Lord', 'holy temple', 'temple of God', 'enter into the temple', 'holy of holies'],
    terms:   ['temple', 'holy', 'house', 'Lord', 'sacred', 'ordinance', 'endowment', 'sealing'],
  },

  // ── Eternal Life & Exaltation ─────────────────────────────────────────────
  'eternal life': {
    phrases: ['eternal life', 'life eternal', 'immortality and eternal life', 'inherit eternal life', 'the greatest of all the gifts of God'],
    terms:   ['eternal', 'life', 'immortality', 'exaltation', 'inherit', 'gift', 'God'],
  },
  'exaltation': {
    phrases: ['exalted in the celestial kingdom', 'joint heirs with Christ', 'heirs of God', 'thrones and dominions', 'eternal increase'],
    terms:   ['exalt', 'celestial', 'inherit', 'throne', 'dominion', 'heir', 'eternal', 'increase'],
  },
  'eternal family': {
    phrases: ['families are forever', 'sealed for eternity', 'eternal family', 'together forever', 'time and all eternity'],
    terms:   ['family', 'sealed', 'eternal', 'together', 'forever', 'eternity', 'children'],
  },
  'life after death': {
    phrases: ['resurrection of the dead', 'spirit world', 'life after death', 'immortality', 'we shall live again'],
    terms:   ['resurrect', 'spirit', 'world', 'eternal', 'death', 'live', 'immortal'],
  },
  'judgement': {
    phrases: ['stand before God', 'bar of God', 'judgment bar', 'judged according to works', 'books were opened', 'day of judgment'],
    terms:   ['judgment', 'bar', 'God', 'stand', 'account', 'works', 'books', 'judged'],
  },
  'degrees of glory': {
    phrases: ['celestial kingdom', 'terrestrial kingdom', 'telestial kingdom', 'degrees of glory', 'glory of the sun', 'glory of the moon', 'glory of the stars'],
    terms:   ['celestial', 'terrestrial', 'telestial', 'glory', 'kingdom', 'sun', 'moon', 'stars'],
  },
  'outer darkness': {
    phrases: ['outer darkness', 'sons of perdition', 'weeping and wailing', 'gnashing of teeth', 'perdition', 'second death'],
    terms:   ['outer', 'darkness', 'perdition', 'weeping', 'gnashing', 'sons', 'second death'],
  },

  // ── Families & Covenant ───────────────────────────────────────────────────
  'covenant': {
    phrases: ['covenant with God', 'everlasting covenant', 'new covenant', 'covenant people', 'keep my covenant', 'enter into a covenant'],
    terms:   ['covenant', 'promise', 'oath', 'swear', 'bind', 'agree', 'testament', 'keep'],
  },
  'abrahamic covenant': {
    phrases: ['covenant of Abraham', 'seed of Abraham', 'covenant with Abraham', 'blessings of Abraham', 'as the stars of heaven'],
    terms:   ['abraham', 'covenant', 'seed', 'blessing', 'nations', 'stars', 'sand', 'posterity'],
  },
  'gathering of israel': {
    phrases: ['gather Israel', 'remnant of Israel', 'house of Israel', 'return to the promised land', 'scattered Israel', 'ten tribes'],
    terms:   ['gather', 'israel', 'remnant', 'return', 'promised', 'land', 'scattered', 'tribes'],
  },
  'zion': {
    phrases: ['City of Zion', 'pure in heart', 'city of Enoch', 'New Jerusalem', 'Zion shall flourish', 'establish Zion'],
    terms:   ['zion', 'pure', 'heart', 'city', 'enoch', 'jerusalem', 'establish', 'flourish'],
  },

  // ── Revelation & Spiritual Gifts ──────────────────────────────────────────
  'revelation': {
    phrases: ['revelation from God', 'word of the Lord', 'thus saith the Lord', 'voice of the Lord', 'spirit of revelation', 'open vision'],
    terms:   ['revelation', 'prophet', 'vision', 'manifest', 'spirit', 'saith', 'Lord'],
  },
  'still small voice': {
    phrases: ['still small voice', 'voice of the Spirit', 'Spirit whispered', 'spirit of the Lord came upon'],
    terms:   ['still', 'small', 'voice', 'spirit', 'whisper', 'quiet', 'gentle'],
  },
  'spiritual gifts': {
    phrases: ['gifts of the Spirit', 'gift of prophecy', 'gift of tongues', 'gift of healing', 'speaking in tongues', 'discerning of spirits'],
    terms:   ['gift', 'spirit', 'prophecy', 'tongues', 'heal', 'discern', 'miracle'],
  },
  'prophecy': {
    phrases: ['thus saith the Lord', 'the word of the Lord came', 'prophesy in my name', 'spirit of prophecy'],
    terms:   ['prophecy', 'prophet', 'saith', 'Lord', 'foretell', 'vision', 'declare'],
  },
  'angels': {
    phrases: ['angel of the Lord', 'ministering angels', 'angel appeared', 'angels of God', 'holy angels'],
    terms:   ['angel', 'ministering', 'appeared', 'messenger', 'holy', 'heaven', 'sent'],
  },

  // ── Prayer & Worship ──────────────────────────────────────────────────────
  'prayer': {
    phrases: ['pray always', 'pray without ceasing', 'ask and ye shall receive', 'ask of God', 'bow in prayer'],
    terms:   ['pray', 'ask', 'father', 'name', 'faith', 'petition', 'kneel'],
  },
  'fasting': {
    phrases: ['fast and pray', 'fasting and prayer', 'humbled himself with fasting'],
    terms:   ['fast', 'fasting', 'abstain', 'prayer', 'humble', 'soul'],
  },
  'sabbath': {
    phrases: ['keep the sabbath', 'sabbath day', 'day of rest', 'holy day', 'remember the sabbath'],
    terms:   ['sabbath', 'day', 'rest', 'holy', 'Lord', 'keep', 'remember'],
  },
  'tithing': {
    phrases: ['pay tithing', 'bring all the tithes', 'tenth part', 'storehouse', 'windows of heaven', 'tithing and offerings'],
    terms:   ['tithe', 'tenth', 'storehouse', 'offering', 'windows', 'heaven', 'pour out'],
  },
  'gratitude': {
    phrases: ['give thanks', 'thankful in all things', 'praise the Lord', 'grateful heart', 'acknowledge the hand of God'],
    terms:   ['thank', 'grateful', 'praise', 'acknowledge', 'bless', 'glorify', 'hand of God'],
  },

  // ── Agency & Mortal Experience ────────────────────────────────────────────
  'agency': {
    phrases: ['free to choose', 'agency of man', 'choose liberty', 'choose eternal life', 'enticed by the one or the other', 'moral agency'],
    terms:   ['agency', 'choose', 'free', 'will', 'liberty', 'choose', 'entice', 'act'],
  },
  'opposition': {
    phrases: ['opposition in all things', 'bitter and the sweet', 'good and evil', 'compound in one'],
    terms:   ['opposition', 'contrary', 'bitter', 'sweet', 'good', 'evil', 'compound'],
  },
  'natural man': {
    phrases: ['natural man is an enemy to God', 'carnal mind', 'fallen man', 'put off the natural man', 'yield to the enticings'],
    terms:   ['natural', 'man', 'enemy', 'carnal', 'fallen', 'yield', 'enticings', 'saint'],
  },
  'temptation': {
    phrases: ['led into temptation', 'tempted of the devil', 'overcome temptation', 'resist the devil', 'fiery darts'],
    terms:   ['tempt', 'devil', 'adversary', 'overcome', 'resist', 'fiery', 'darts', 'snare'],
  },
  'trials': {
    phrases: ['endure to the end', 'in the midst of affliction', 'all these things shall give thee experience', 'refiner fire'],
    terms:   ['trial', 'tribulation', 'affliction', 'suffer', 'adversity', 'trouble', 'refine', 'endure'],
  },
  'comfort in trials': {
    phrases: ['I will not leave you comfortless', 'peace I leave with you', 'I am with thee', 'be still and know', 'bear up your burdens'],
    terms:   ['comfort', 'peace', 'affliction', 'bear', 'burden', 'strengthen', 'consolation', 'still'],
  },

  // ── Service & Discipleship ────────────────────────────────────────────────
  'service': {
    phrases: ['serve one another', 'in the service of your God', 'minister to the poor', 'succor the weak', 'pure religion'],
    terms:   ['serve', 'minister', 'lift', 'poor', 'needy', 'hands', 'succor', 'strengthen'],
  },
  'consecration': {
    phrases: ['consecrate thy performance', 'law of consecration', 'all things in common', 'have all things equal'],
    terms:   ['consecrate', 'all', 'steward', 'poor', 'needy', 'equal', 'common'],
  },
  'charity': {
    phrases: ['charity never faileth', 'pure love of Christ', 'charity is the pure love', 'clothe yourself with charity'],
    terms:   ['charity', 'love', 'pure', 'Christ', 'faileth', 'greatest', 'bond'],
  },
  'humility': {
    phrases: ['humble yourself before God', 'broken heart and contrite spirit', 'meek and lowly in heart', 'humble yourselves'],
    terms:   ['humble', 'meek', 'lowly', 'submissive', 'contrite', 'broken', 'heart'],
  },
  'obedience': {
    phrases: ['obedience to the commandments', 'keep my commandments', 'hearken unto my voice', 'do all things whatsoever the Lord commands'],
    terms:   ['obey', 'keep', 'commandment', 'observe', 'hearken', 'follow', 'law'],
  },

  // ── Scripture & Restoration ───────────────────────────────────────────────
  'restoration': {
    phrases: ['restoration of all things', 'restored church', 'dispensation of the fullness of times', 'restitution of all things'],
    terms:   ['restoration', 'restore', 'dispensation', 'fullness', 'times', 'church', 'restitution'],
  },
  'book of mormon': {
    phrases: ['another testament of Jesus Christ', 'record of the Nephites', 'fulness of the gospel', 'stick of Joseph', 'gold plates'],
    terms:   ['nephite', 'lamanite', 'record', 'plates', 'gospel', 'fullness', 'testament'],
  },
  'word of god': {
    phrases: ['word of God', 'word of the Lord', 'living word', 'iron rod', 'hold fast to the rod'],
    terms:   ['word', 'god', 'scripture', 'commandment', 'truth', 'rod', 'iron'],
  },
  'iron rod': {
    phrases: ['rod of iron', 'hold fast to the rod', 'word of God', 'strait and narrow path'],
    terms:   ['rod', 'iron', 'hold', 'fast', 'word', 'god', 'strait', 'narrow'],
  },
  'liahona': {
    phrases: ['Liahona', 'ball of curious workmanship', 'director', 'faith and diligence'],
    terms:   ['liahona', 'director', 'faith', 'diligence', 'compass', 'spindle', 'work'],
  },
  'apostasy': {
    phrases: ['great apostasy', 'falling away', 'darkness covered the earth', 'plain and precious truths removed'],
    terms:   ['apostasy', 'apostate', 'fall', 'away', 'darkness', 'plain', 'precious', 'removed'],
  },
  'prophet': {
    phrases: ['called of God', 'living prophet', 'voice of the prophet', 'follow the prophet', 'word of the prophet'],
    terms:   ['prophet', 'seer', 'revelator', 'called', 'God', 'voice', 'follow', 'living'],
  },

  // ── Specific LDS Doctrinal Phrases ────────────────────────────────────────
  'by their fruits': {
    phrases: ['by their fruits ye shall know them', 'good tree bringeth forth', 'corrupt tree'],
    terms:   ['fruits', 'know', 'tree', 'good', 'corrupt', 'bring', 'forth'],
  },
  'iron rod': {
    phrases: ['rod of iron', 'hold fast', 'word of God', 'strait and narrow'],
    terms:   ['rod', 'iron', 'hold', 'word', 'god', 'narrow', 'path'],
  },
  'light of christ': {
    phrases: ['light of Christ', 'spirit of Christ', 'given to every man', 'true light', 'light and life'],
    terms:   ['light', 'Christ', 'spirit', 'every', 'man', 'conscience', 'truth'],
  },
  'love of god': {
    phrases: ['love of God', 'God so loved the world', 'charity is the love of God', 'he first loved us'],
    terms:   ['love', 'God', 'world', 'gave', 'son', 'charity', 'first'],
  },
  'armor of god': {
    phrases: ['whole armor of God', 'breastplate of righteousness', 'shield of faith', 'sword of the Spirit', 'helmet of salvation'],
    terms:   ['armor', 'breastplate', 'shield', 'faith', 'sword', 'spirit', 'helmet', 'salvation'],
  },
  'new jerusalem': {
    phrases: ['New Jerusalem', 'city of Zion', 'holy city', 'come down from heaven', 'bride of the Lamb'],
    terms:   ['new', 'jerusalem', 'zion', 'city', 'holy', 'heaven', 'bride'],
  },
  'abide in me': {
    phrases: ['abide in me', 'I am the vine', 'branch cannot bear fruit', 'abide in my love'],
    terms:   ['abide', 'vine', 'branch', 'fruit', 'love', 'remain', 'dwell'],
  },
  'suffering of christ': {
    phrases: ['suffered for our sins', 'he was wounded for our transgressions', 'he bore our griefs', 'by his stripes we are healed'],
    terms:   ['suffer', 'wound', 'transgression', 'grief', 'stripe', 'heal', 'bore', 'carried'],
  },
  'prayer of faith': {
    phrases: ['prayer of faith', 'pray with faith', 'ask in faith', 'nothing wavering'],
    terms:   ['prayer', 'faith', 'ask', 'waver', 'believe', 'receive', 'heal'],
  },
  'power of god': {
    phrases: ['power of God', 'arm of the Lord', 'by the power of God', 'omnipotent God'],
    terms:   ['power', 'God', 'arm', 'Lord', 'omnipotent', 'mighty', 'strength'],
  },
  'endure to the end': {
    phrases: ['endure to the end', 'hold out faithful', 'patient in tribulation', 'run with endurance'],
    terms:   ['endure', 'end', 'faithful', 'patient', 'tribulation', 'run', 'persevere'],
  },
  'consecrate': {
    phrases: ['consecrate thy performance', 'dedicate to the Lord', 'law of consecration'],
    terms:   ['consecrate', 'dedicate', 'steward', 'all', 'law', 'performance'],
  },
  'mighty change': {
    phrases: ['mighty change of heart', 'changed from their carnal', 'no more disposition to do evil'],
    terms:   ['mighty', 'change', 'heart', 'carnal', 'disposition', 'evil', 'good'],
  },
  'steadfast': {
    phrases: ['steadfast and immovable', 'firm and steadfast in the faith', 'hold fast'],
    terms:   ['steadfast', 'immovable', 'firm', 'faith', 'hold', 'fast', 'constant'],
  },
};
function applyDoctrineAliases(input) {
  const lower = input.toLowerCase().trim();
  if (DOCTRINE_ALIASES[lower]) return DOCTRINE_ALIASES[lower];
  for (const [key, entry] of Object.entries(DOCTRINE_ALIASES)) {
    if (lower.includes(key)) return entry;
  }
  return null;
}

const buildFTSPhraseQuery = (phrase) => {
  return `"${phrase.replace(/"/g, '""')}"`;
};

const buildFTSTermQuery = (terms, mode = 'and') => {
  if (!terms || !terms.length) return '';
  const cleaned = terms
    .map(t => t.replace(/["']/g, '').replace(/[^a-zA-Z0-9\-\s]/g, '').trim())
    .filter(t => t.length > 1);
  if (!cleaned.length) return '';
  const wildcarded = cleaned.map(t => `${t.split(/\s+/)[0]}*`);
  return mode === 'or'
    ? wildcarded.join(' OR ')
    : wildcarded.join(' AND ');
};

const buildFTSMatchQuery = (input, { orFallback = false } = {}) => {
  if (!input) return '';
  const trimmed = input.trim();
  if (!trimmed) return '';

  const quoted = trimmed.match(/^"(.+)"$/);
  if (quoted) return `"${quoted[1].replace(/"/g, '""')}"`;

  const terms = trimmed
    .split(/\s+/)
    .map(t => t.replace(/["']/g, '').replace(/[^a-zA-Z0-9\-]/g, ''))
    .filter(t => t.length > 1);

  if (terms.length === 0) return '';
  const wildcarded = terms.map(t => `${t}*`);
  return orFallback ? wildcarded.join(' OR ') : wildcarded.join(' AND ');
};


const runFTSQuery = (matchQuery, rawPhrase = null, limit = 50) => {
  const literalPattern = rawPhrase
    ? `%${rawPhrase.trim().toLowerCase()}%`
    : null;

  const stmt = db.prepare(`
    SELECT
      s.volume_id, s.book_id, s.chapter_id, s.verse_id,
      s.volume_title, s.book_title, s.volume_long_title, s.book_long_title,
      s.volume_subtitle, s.book_subtitle, s.volume_short_title, s.book_short_title,
      s.volume_lds_url, s.book_lds_url, s.chapter_number, s.verse_number,
      s.scripture_text, s.verse_title, s.verse_short_title
    FROM scriptures s
    JOIN (
      SELECT verse_id, bm25(scriptures_fts, 0, 10, 5, 1, 0, 0) AS rank
      FROM scriptures_fts
      WHERE scriptures_fts MATCH ?
      LIMIT ${limit}
    ) fts ON fts.verse_id = s.verse_id
    ORDER BY
      CASE WHEN ${literalPattern ? 'LOWER(s.scripture_text) LIKE ?' : '0'} THEN 0 ELSE 1 END,
      fts.rank,
      s.verse_id
  `);

  const args = literalPattern
    ? [matchQuery, literalPattern]
    : [matchQuery];

  return stmt.all(...args);
};

const phraseSearch = (phrase) => {
  if (!phrase || !phrase.trim()) return [];

  const raw = phrase.trim();
  const alias = applyDoctrineAliases(raw);

  try {
    const ftsExists = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='scriptures_fts'`
    ).get();

    if (ftsExists) {

      if (alias) {
        const seen = new Set();
        const merged = [];

        // Pass 0 — exact FTS5 phrase match on each alias phrase, in order
        // These are the most precise possible matches — literal scripture phrases.
        for (const phrase of (alias.phrases || [])) {
          const q = buildFTSPhraseQuery(phrase);
          const rows = runFTSQuery(q, raw);
          for (const row of rows) {
            if (!seen.has(row.verse_id)) {
              seen.add(row.verse_id);
              merged.push(row);
            }
          }
        }
        if (merged.length > 0) return merged.slice(0, 50);

        // Pass 1 — AND on alias terms — all key terms must appear in verse
        const andQ = buildFTSTermQuery(alias.terms || [], 'and');
        if (andQ) {
          const r1 = runFTSQuery(andQ, raw);
          if (r1.length > 0) return r1;
        }

        // Pass 2 — OR on alias terms — any key term qualifies, BM25 ranks relevance
        const orQ = buildFTSTermQuery(alias.terms || [], 'or');
        if (orQ) {
          const r2 = runFTSQuery(orQ, raw, 50);
          if (r2.length > 0) return r2;
        }

      } else {

        // No alias — raw input path
        // Pass 0 — exact phrase on raw input (multi-word only)
        if (raw.split(/\s+/).length > 1) {
          const exactQ = buildFTSPhraseQuery(raw);
          const r0 = runFTSQuery(exactQ, raw);
          if (r0.length > 0) return r0;
        }

        // Pass 1 — AND on raw terms
        const andQ = buildFTSMatchQuery(raw);
        if (andQ) {
          const r1 = runFTSQuery(andQ, raw);
          if (r1.length > 0) return r1;
        }

        // Pass 2 — OR on raw terms
        const orQ = buildFTSMatchQuery(raw, { orFallback: true });
        if (orQ) {
          const r2 = runFTSQuery(orQ, raw, 50);
          if (r2.length > 0) return r2;
        }

        // Pass 3 — prefix wildcard for single-word input
        if (raw.split(/\s+/).length === 1) {
          const r3 = runFTSQuery(`${raw}*`, raw);
          if (r3.length > 0) return r3;
        }
      }
    }
  } catch (err) {
    fastify.log.warn('FTS pipeline failed, falling back to LIKE:', err && err.message);
  }

  // Last resort — LIKE token scan
  const fallbackTerms = (alias ? (alias.terms || [raw]) : [raw])
    .join(' ').trim().split(/\s+/).filter(Boolean);
  const clauses = fallbackTerms.map(() => '(scripture_text LIKE ? OR verse_title LIKE ?)');
  const params = [];
  fallbackTerms.forEach(t => params.push(`%${t}%`, `%${t}%`));
  return db.prepare(`
    SELECT book_id, book_title, chapter_number, verse_number,
           scripture_text, verse_title, verse_id
    FROM scriptures
    WHERE ${clauses.join(' AND ')}
    ORDER BY verse_id
    LIMIT 50
  `).all(...params);
};


const searchScripture = (input) => {
    // first, attempt to parse a structured reference
    const ref = parseScriptureReference(input);
    if (ref) {
        let sql = `
    SELECT
        book_title,
        chapter_number,
        verse_number,
        scripture_text,
        verse_title,
        verse_short_title,
        verse_id
    FROM
        scriptures
    WHERE
        book_title LIKE ?`;
        const params = [`%${ref.book}%`];
        
        sql += '\n        AND chapter_number = ?';
        params.push(ref.chapter);
        
        if (ref.verse !== null) {
            sql += ' AND verse_number = ?';
            params.push(ref.verse);
        }
        sql += '\n    ORDER BY verse_number ASC\n    LIMIT 50';
        const stmt = db.prepare(sql);
        const result = stmt.all(...params);
        return result.length > 0 ? result : phraseSearch(input);
    }

    // fallback: phrase search in scripture text and titles
    return phraseSearch(input);
};

// direction should be 'next' or 'prev'
function getAdjacentVerse({ verse_id, direction }, db) {
    const op = direction === 'next' ? '+' : '-';
    const stmt = db.prepare(`
      SELECT
        book_title,
        chapter_number,
        verse_number,
        scripture_text,
        verse_title, 
        verse_short_title,
        chapter_number,
        verse_number,
        verse_id
      FROM scriptures
      WHERE verse_id = ? ${op} 1
      LIMIT 1
    `);
    try {
        return stmt.get(verse_id);
    } catch (err) {
        fastify.log.error('adjacent query failed', err);
        return null;
    }
}

// add HTTP route for adjacent verse
fastify.get('/verse/adjacent', async (request, reply) => {
    const { verse_id, direction, language } = request.query;
    if (!verse_id || !direction) {
        reply.code(400);
        return { error: 'missing parameters' };
    }

    let targetDb = db;
    if (language && ['ceb', 'tl'].includes(language)) {
        targetDb = language === 'ceb' ? db_cebuano : db_tagalog;
    }

    const result = getAdjacentVerse({
        verse_id: Number(verse_id),
        direction,
    }, targetDb);

    if (!result) {
        reply.code(404);
        return { error: 'not found' };
    }
    return result;
});

io.on('connection', (socket) => {
  console.log('a user connected');

  socket.on('search', (query) => {
      console.log('searching for:', query);
      const results = searchScripture(query);
      socket.emit('search-results', results);
  });

  socket.on('update-verse', (verse) => {
    console.log('updating verse:', verse);
    io.emit('update-verse', verse);
  });

  socket.on('update-theme', (theme) => {
    console.log('updating theme:', theme);
    io.emit('update-theme', theme);
  });

  socket.on('highlight-text', (text) => {
    console.log('highlighting text:', text);
    io.emit('highlight-text', text);
  });

  socket.on('go-live', ({verse, theme, language}) => {
    console.log('go-live triggered', verse, theme, language);
    
    let scriptureText = verse.scripture_text;
    let verseTitle = verse.book_title + ' ' + verse.chapter_number + ':' + verse.verse_number; 
    let bookTitle = verse.book_title;
    
    // Normalize language input
    const normalizedLanguage = language ? language.toLowerCase().trim() : null;
    
    // Determine target database with streamlined mapping
    const targetDbMap = {
      'en': db,
      'ceb': db_cebuano,
      'tl': db_tagalog
    };
    
    const targetDb = targetDbMap[normalizedLanguage];
    const isTranslation = normalizedLanguage && ['ceb', 'tl'].includes(normalizedLanguage);

    if (targetDb) {
      const verseId = Number(verse.verse_id);
      const query = `SELECT scripture_text, verse_title, book_title FROM scriptures WHERE verse_id = ?`;
      
      try {
        const stmt = targetDb.prepare(query);
        const result = stmt.get(verseId);
        
        if (result) {
          // Apply field validation only for translations per specification
          if (isTranslation) {
            if (result.scripture_text) scriptureText = result.scripture_text;
            if (result.verse_title) verseTitle = result.verse_title;
            if (result.book_title) bookTitle = result.book_title;
          } else {
            scriptureText = result.scripture_text;
            verseTitle = result.verse_title;
            bookTitle = result.book_title;
          }
        }
      } catch (err) {
        fastify.log.error(
          isTranslation 
            ? `Failed to fetch ${normalizedLanguage} translation` 
            : 'Failed to fetch English text',
          err
        );
      }
    }
    
    // Segment the verse for readability
    const segments = segmentVerseText(scriptureText);
    const verseWithSegments = {
      ...verse,
      scripture_text: scriptureText,
      verse_title: verseTitle,
      book_title: bookTitle,
      segments,
      totalSegments: segments.length,
      currentSegment: 0
    };
    
    // Send to all clients
    io.emit('update-verse', verseWithSegments);
    io.emit('update-theme', theme);
  });

  socket.on('disconnect', () => {
    console.log('user disconnected');
  });
});

const start = async () => {
  try {
    const port = process.env.PORT || 3000 // default to 3095 if PORT is not set;
    await fastify.listen({ port, host: '0.0.0.0' })
    console.log(`Server running on ${port}`)
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}


// only start the server if the file is run directly; this makes the module importable for tests
if (require.main === module) {
  start();
}

module.exports = { parseScriptureReference, searchScripture, segmentVerseText, fastify };