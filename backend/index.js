const fastify = require('fastify')({ logger: true });
const { Server } = require("socket.io");
const path = require('path');

const DB_DIR = path.resolve(__dirname, '../resources/db');
const FRONTEND_DIST_DIR = path.resolve(__dirname, '../frontend/dist');
// english scriptures database (LDS standard works)
const db = require('better-sqlite3')(path.join(DB_DIR, 'lds-scriptures-sqlite.db'), { fileMustExist: true });
// additional language databases (optional)
const db_tagalog = require('better-sqlite3')(path.join(DB_DIR, 'tagalog-scriptures-sqlite.db'), { fileMustExist: true });
const db_cebuano = require('better-sqlite3')(path.join(DB_DIR, 'cebuano-scriptures-sqlite.db'), { fileMustExist: true });

const fastifyStatic = require('@fastify/static');

fastify.register(require('@fastify/cors'), {
  origin: "*",
});

// Register static file serving for frontend distribution
fastify.register(fastifyStatic, {
  root: FRONTEND_DIST_DIR,
  prefix: '/',
});

// Handle client-side routing fallback for React Router
fastify.setNotFoundHandler((request, reply) => {
  reply.sendFile('index.html');
});

fastify.get('/health', async () => {
  return { status: 'ok' };
});

// ── /config — returns the canonical public origin so Client can build a correct
//    QR code even when running behind a reverse proxy or Cloudflare Tunnel.
//    Set PUBLIC_ORIGIN=https://your-domain.com in the environment; falls back
//    to the request's Host header, which is usually correct on a LAN.
fastify.get('/config', async (request) => {
  const publicOrigin =
    process.env.PUBLIC_ORIGIN ||
    `${request.protocol}://${request.hostname}`;
  return { publicOrigin };
});

// ─── Service timing constants ─────────────────────────────────────────────────
// These are tuned for a church / worship-service environment where:
//   • WiFi in chapel buildings is often congested and unreliable
//   • Sessions last 1–3 hours with long silent stretches (prayers, music)
//   • A dropped socket during a sacrament prayer must not kill the session
//   • The operator cannot be expected to notice and intervene quickly
const SERVICE_CONFIG = {
  // How long Socket.IO waits between heartbeat pings (ms).
  // 25 s gives headroom over mobile 4G keep-alive timers (~30 s).
  PING_INTERVAL_MS: 25_000,

  // How long without a pong before the socket is considered dead (ms).
  // 90 s tolerates a brief building WiFi hiccup or phone screen-lock.
  PING_TIMEOUT_MS: 90_000,

  // How long after the last socket leaves a session before its state is
  // garbage-collected (ms).  30 min covers a typical sacrament meeting
  // intermission or a presenter whose laptop went to sleep.
  SESSION_GRACE_MS: 30 * 60 * 1000,

  // How long the server waits for a client-session reconnect specifically.
  // TV browsers can take 2–3 min to recover from a power-save disconnect.
  CLIENT_SESSION_GRACE_MS: 5 * 60 * 1000,

  // Maximum number of concurrent named sessions (prevents memory exhaustion
  // if the server is left running across multiple weeks of service).
  MAX_SESSIONS: 50,
};

const io = new Server(fastify.server, {
  cors: { origin: '*' },
  pingInterval: SERVICE_CONFIG.PING_INTERVAL_MS,
  pingTimeout:  SERVICE_CONFIG.PING_TIMEOUT_MS,
});

// Remove the theme table creation code since we're not storing themes in the database anymore
// Build the FTS table once (or when explicitly forced) instead of rebuilding every startup.
function initializeFts() {
  const forceRebuild = String(process.env.REBUILD_FTS_ON_START || 'false').toLowerCase() === 'true';

  const createFtsTableSql = `
    CREATE VIRTUAL TABLE scriptures_fts USING fts5(
      verse_id   UNINDEXED,
      scripture_text,
      verse_title,
      book_title,
      chapter_number UNINDEXED,
      verse_number   UNINDEXED,
      tokenize = "porter ascii"
    )
  `;

  const populateFts = () => {
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
    db.exec(`INSERT INTO scriptures_fts(scriptures_fts) VALUES('optimize')`);
    fastify.log.info('FTS5 index optimized');
  };

  try {
    const existing = db.prepare(`
      SELECT sql
      FROM sqlite_master
      WHERE type = 'table' AND name = 'scriptures_fts'
    `).get();
    const hasExpectedTokenizer = existing?.sql?.includes('porter ascii');

    if (forceRebuild || !existing || !hasExpectedTokenizer) {
      db.exec(`DROP TABLE IF EXISTS scriptures_fts`);
      db.exec(createFtsTableSql);
      populateFts();
      return;
    }

    const ftsCount = db.prepare(`SELECT COUNT(*) AS count FROM scriptures_fts`).get()?.count ?? 0;
    if (ftsCount === 0) {
      populateFts();
    } else {
      fastify.log.info(`FTS5 table ready with ${ftsCount} indexed verses`);
    }
  } catch (err) {
    fastify.log.error('FTS5 setup failed:', err && err.message ? err.message : err);
  }
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
  
  // Doctrine and Covenants — all common spellings and abbreviations
  'd and c': 'Doctrine and Covenants',
  'd&c': 'Doctrine and Covenants',
  'dc': 'Doctrine and Covenants',
  'doc': 'Doctrine and Covenants',
  'doc&cov': 'Doctrine and Covenants',
  'doctrine and covenants': 'Doctrine and Covenants',
  'doctrine & covenants': 'Doctrine and Covenants',
  'doct': 'Doctrine and Covenants',
  'doct&cov': 'Doctrine and Covenants',
  'doctrineandcovenants': 'Doctrine and Covenants',

  // Pearl of Great Price
  'pgp': 'Moses',       // user will need chapter — best effort
  'moses': 'Moses',
  'abr': 'Abraham',
  'abraham': 'Abraham',
  'jsh': 'Joseph Smith—History',
  'js-h': 'Joseph Smith—History',
  'jsh-h': 'Joseph Smith—History',
  'js-m': 'Joseph Smith—Matthew',
  'aof': 'Articles of Faith',
  'articles of faith': 'Articles of Faith',

  // Book of Mormon extras
  'ether': 'Ether',
  'words of mormon': 'Words of Mormon',
  '3 nephi': '3 Nephi',
  '4 nephi': '4 Nephi',
  '1 nephi': '1 Nephi',
  '2 nephi': '2 Nephi',
  'helaman': 'Helaman',
  'moroni': 'Moroni',

  // Old Testament extras
  'psalms': 'Psalms',
  'psalm': 'Psalms',
  'proverbs': 'Proverbs',
  'prov': 'Proverbs',
  'ecclesiastes': 'Ecclesiastes',
  'song of solomon': 'Song of Solomon',
  'sos': 'Song of Solomon',
  'obadiah': 'Obadiah',
  'jonah': 'Jonah',

  'oa': 'Olive Garden Account',
};

// Function to expand abbreviated book name
function expandBookName(bookRef) {
  if (!bookRef) return null;
  const lowerRef = bookRef.toLowerCase().trim();
  return BOOK_ABBREVIATIONS[lowerRef] || bookRef;
}

// Function to segment verse text into readable chunks (max 200 words per segment)
function segmentVerseText(text, wordsPerSegment = 200) {
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
  '_plan_of_salvation': {
    phrases: [
      'great plan of the Eternal God',
      'great plan of happiness',
      'plan of salvation',
      'plan of redemption',
      'plan prepared from the foundation of the world',
      'plan of happiness',
      'before the world was',
      'foundation of the world'
    ],
    terms: [
      'salvation', 'redemption', 'happiness', 'immortality', 'eternal life',
      'atonement', 'resurrection', 'exaltation', 'prepared', 'foundation',
      'joy', 'chosen', 'foreordained'
    ],
  },
  '_plan_of_redemption': {
    phrases: ['plan prepared from the foundation of the world', 'plan of redemption', 'plan of salvation', 'plan of happiness'],
    terms:   ['redemption', 'salvation', 'eternal life', 'atonement', 'prepared', 'foundation'],
  },
  '_plan_of_happiness': {
    phrases: ['great plan of happiness', 'plan of happiness', 'plan of salvation'],
    terms:   ['happiness', 'salvation', 'eternal life', 'joy', 'redemption'],
  },
  '_premortal_life': {
    phrases: [
      'before the world was',
      'chosen before',
      'choses before the foundation of the world',
      'foundation of the world',
      'pre-earth life',
      'pre-earth life',
      'council in heaven',
      'foreordained'
    ],
    terms: [
      'foreordained', 'chosen', 'foundation', 'spirits',
      'council', 'heaven', 'premortal'
    ],
  },
  '_war_in_heaven': {
    phrases: ['and he became Satan, yea, even the devil, the father of all lies, to deceive', 'neither was their place found anymore in heaven', 'third part of the host of heaven', 'third part of the stars', 'fought against the dragon', 'war in heaven', 'devil and his angels', 'cast out', 'because of their agency', 'they were cast out'],
    terms:   ['war', 'heaven', 'cast', 'rebel', 'devil', 'dragon', 'third', 'stars'],
  },
  '_spirit_world': {
    phrases: ['spirit world', 'world of spirits', 'paradise of God', 'spirit prison', 'prison house'],
    terms:   ['spirit', 'dead', 'prison', 'paradise', 'resurrection', 'disembodied'],
  },
  '_degrees_of_glory': {
    phrases: ['celestial kingdom', 'terrestrial kingdom', 'telestial kingdom', 'degrees of glory', 'many mansions', 'glory of the sun', 'glory of the moon', 'glory of the stars'],
    terms:   ['celestial', 'terrestrial', 'telestial', 'glory', 'kingdom', 'mansion', 'sun', 'moon', 'stars'],
  },

  // ── Atonement ─────────────────────────────────────────────────────────────
  '_atonement': {
    phrases: [
      'suffered for our sins',
      'he was wounded for our transgressions',
      'he bore our griefs',
      'by his stripes we are healed',
      'he was broken for our iniquities',
      'took upon him our sicknesses',
      'carried our sorrows',
      'bore our sins in his own body',
      'atonement of Christ',
      'atonement of Jesus Christ',
      'infinite atonement',
      'atoning sacrifice',
      'atoning blood',
      'blood of Christ',
      'garden of Gethsemane',
      'suffer in Gethsemane',
      'blood from every pore',
      'sweat as it were great drops',
      'eternal sacrifice'
    ],
    terms: [
      'atone', 'redeem', 'suffer', 'reconcile', 'ransom', 'sacrifice',
      'expiate', 'infinite', 'eternal', 'sins', 'all mankind', 'gethsemane',
      'cup', 'bleed', 'pore', 'agony', 'garden', 'wound', 'transgression',
      'grief', 'stripe', 'heal', 'bore', 'carried'
    ],
  },

  // ── Abrahamic Covenant ────────────────────────────────────────────────────
  '_abrahamic_covenant': {
    phrases: [
      'Abraham shall be a father of many nations',
      'Abraham was a father of many nations',
      'Abraham rejoiced to see my day, and he saw it and was glad',
      'make thee exceeding fruitful, and I will make nations of thee, and kings shall come out of thee',
      'circumcise the flesh of thy foreskin, and it shall be a token of the covenant',
      'and the Lord God shall give to Abraham a land of plenty and of good',
      'familes of the earth blessed through Abraham',
      'seed as the stars of heaven',
      'seed as the sand upon the seashore',
      'blessings of Abraham',
      'Abrahamic blessings',
      'unto thy seed give I this land, promise land',
      'inherit the land of Canaan',
      'father of many nations',
      'father of a multitude of nations',
      'in thy seed shall all the nations of the earth be blessed',
      'priesthood shall continue in thy seed forever',
      'covenant of circumcision',
      'sign of the covenant',
      'everlasting covenant',
      'covenant made with Abraham',
      'covenant of the priesthood',
      'Abrahamic covenant',
      'eternal marriage',
      'priesthood lineage',
      'covenant of Abraham',
      'seed of Abraham',
      'covenant with Abraham',
      'blessings of Abraham',
      'as the stars of heaven'
    ],
    terms: [
      'abrahamic', 'covenant', 'Abraham', 'Isaac', 'Jacob', 'seed',
      'blessing', 'nations', 'stars', 'sand', 'posterity', 'eternal',
      'marriage', 'lineage'
    ],
  },

  '_grace': {
    phrases: [
      'saved by grace',
      'grace of God',
      'grace of Christ',
      'after all we can do'
    ],
    terms: [
      'grace', 'mercy', 'favour', 'unmerited', 'enable', 'divine help'
    ],
  },
  '_grace_vs_works': {
    phrases: [
      'saved by grace',
      'after all we can do',
      'faith without works',
      'works of righteousness'
    ],
    terms: [
      'grace', 'works', 'faith', 'justified', 'saved', 'merit'
    ],
  },
  '_redemption': {
    phrases: ['redemption of Christ', 'redemption through Christ', 'plan of redemption', 'redeemed from the fall'],
    terms:   ['redeem', 'ransom', 'bought', 'price', 'redemption', 'deliver'],
  },

  // ── Christology ───────────────────────────────────────────────────────────
  '_jesus_christ': {
    phrases: ['Jesus Christ', 'Son of God', 'Son of Man', 'Lamb of God', 'Messiah', 'Holy One of Israel', 'Redeemer of Israel', 'Lord and Savior'],
    terms:   ['Jesus', 'Christ', 'Savior', 'Redeemer', 'Messiah', 'Lord'],
  },
  '_second_coming': {
    phrases: ['second coming', 'coming of the Son of Man', 'day of the Lord', 'great and dreadful day', 'coming in glory', 'at his coming'],
    terms:   ['second', 'coming', 'return', 'clouds', 'glory', 'parousia', 'millennium'],
  },
  '_millennium': {
    phrases: ['thousand years', 'reign of Christ', 'millennial reign', 'new heaven and new earth'],
    terms:   ['millennium', 'thousand', 'reign', 'peace', 'Satan bound', 'rest'],
  },
  '_resurrection': {
    phrases: [
      'resurrection of the dead',
      'resurrection of Christ',
      'brought to pass the resurrection',
      'rise from the dead',
      'first resurrection',
      'resurrection of the just',
      'life after death',
      'we shall live again'
    ],
    terms: [
      'resurrect', 'rise', 'dead', 'immortal', 'body', 'alive',
      'quicken', 'eternal', 'death', 'live'
    ],
  },

  // ── Godhead ───────────────────────────────────────────────────────────────
  '_godhead': {
    phrases: ['the Father and the Son', 'God the Father', 'Holy Ghost', 'three separate', 'Godhead', 'three personages'],
    terms:   ['father', 'son', 'holy ghost', 'godhead', 'personage', 'one'],
  },
  '_nature_of_god': {
    phrases: ['God is a God of truth', 'body of flesh and bones', 'eternal God', 'immortal God', 'perfections of God'],
    terms:   ['god', 'eternal', 'immortal', 'omniscient', 'omnipotent', 'flesh', 'bones', 'perfection'],
  },
  '_holy_ghost': {
    phrases: ['Holy Ghost', 'Holy Spirit', 'gift of the Holy Ghost', 'Comforter', 'Spirit of God', 'Spirit of the Lord'],
    terms:   ['holy ghost', 'comforter', 'spirit', 'confirm', 'receive', 'witness', 'gift'],
  },
  '_first_vision': {
    phrases: ['pillar of light', 'two personages', 'Father and the Son appeared', 'grove of trees'],
    terms:   ['vision', 'light', 'pillar', 'personage', 'grove', 'appeared', 'Joseph'],
  },

  // ── Faith & Repentance ────────────────────────────────────────────────────
  '_faith': {
    phrases: ['faith in Christ', 'faith in Jesus Christ', 'faith in the Lord', 'faith unto repentance', 'faith and works'],
    terms:   ['faith', 'believe', 'trust', 'hope', 'assurance', 'confidence'],
  },
  '_repentance': {
    phrases: ['repent and be baptized', 'repentance of sins', 'broken heart and contrite spirit', 'godly sorrow', 'forsake your sins'],
    terms:   ['repent', 'forsake', 'confess', 'sorrow', 'contrite', 'broken heart', 'change'],
  },
  '_forgiveness': {
    phrases: ['forgiveness of sins', 'sins are forgiven', 'I the Lord will forgive', 'remember no more', 'blot out transgressions'],
    terms:   ['forgive', 'pardon', 'remit', 'cleanse', 'blot', 'remember no more', 'merciful'],
  },
  '_born_again': {
    phrases: ['born again', 'born of God', 'born of the Spirit', 'new creature in Christ', 'spiritual rebirth', 'mighty change of heart', 'mighty change of heart', 'changed from their carnal', 'no more disposition to do evil', 'become new creatures in Christ'],
    terms:   ['born', 'spirit', 'new', 'creature', 'change', 'heart', 'rebirth', 'mighty', 'carnal', 'disposition', 'evil', 'good'],
  },
  '_doubt': {
    phrases: ['doubt not', 'fear not', 'O ye of little faith', 'wavering in faith'],
    terms:   ['doubt', 'fear', 'unbelief', 'waver', 'unstable', 'weak'],
  },

  // ── Ordinances & Priesthood ───────────────────────────────────────────────
  '_baptism': {
    phrases: ['baptized in the name', 'baptism by immersion', 'born of water', 'enter by the gate', 'remission of sins by baptism'],
    terms:   ['baptize', 'immerse', 'water', 'spirit', 'gate', 'covenant', 'remission'],
  },
  '_baptism_for_the_dead': {
    phrases: ['baptized for the dead', 'baptism for the dead', 'proxy ordinance', 'work for the dead', 'salvation for the dead'],
    terms:   ['baptized', 'dead', 'proxy', 'vicarious', 'salvation', 'temple'],
  },
  '_gift_of_holy_ghost': {
    phrases: ['gift of the Holy Ghost', 'receive the Holy Ghost', 'confirmed a member', 'laying on of hands for the gift'],
    terms:   ['holy ghost', 'gift', 'confirm', 'receive', 'laying', 'hands'],
  },
  '_sacrament': {
    phrases: ['bread and wine', 'bless and break bread', 'in remembrance of me', 'body and blood', 'sacrament of the Lord'],
    terms:   ['sacrament', 'bread', 'wine', 'cup', 'remember', 'body', 'blood', 'covenant'],
  },
  '_priesthood': {
    phrases: ['Melchizedek Priesthood', 'Aaronic Priesthood', 'holy priesthood', 'keys of the kingdom', 'authority of God', 'ordained to the priesthood'],
    terms:   ['priesthood', 'authority', 'ordain', 'keys', 'melchizedek', 'aaronic', 'hold'],
  },
  '_melchizedek_priesthood': {
    phrases: ['Melchizedek Priesthood', 'higher priesthood', 'holy order of God', 'after the order of the Son of God'],
    terms:   ['melchizedek', 'higher', 'priesthood', 'order', 'authority', 'high priest'],
  },
  '_aaronic_priesthood': {
    phrases: ['Aaronic Priesthood', 'lesser priesthood', 'Levitical priesthood', 'preparatory priesthood'],
    terms:   ['aaronic', 'lesser', 'levitical', 'deacon', 'teacher', 'priest', 'preparatory'],
  },
  '_laying_on_of_hands': {
    phrases: ['laid their hands upon', 'laying on of hands', 'by the laying on', 'hands were laid'],
    terms:   ['hands', 'laid', 'ordained', 'blessed', 'healed', 'consecrated'],
  },
  '_endowment': {
    phrases: ['endowed with power', 'endowment from on high', 'clothed with power', 'receive your endowment'],
    terms:   ['endow', 'power', 'high', 'holy', 'clothe', 'temple', 'ordinance'],
  },
  '_sealing': {
    phrases: ['sealed for time and all eternity', 'sealed by the Holy Spirit of Promise', 'bind on earth', 'bind in heaven', 'sealing power', 'keys of sealing'],
    terms:   ['seal', 'bind', 'loose', 'keys', 'heaven', 'earth', 'eternity', 'family'],
  },
  '_temple': {
    phrases: ['house of the Lord', 'holy temple', 'temple of God', 'enter into the temple', 'holy of holies'],
    terms:   ['temple', 'holy', 'house', 'Lord', 'sacred', 'ordinance', 'endowment', 'sealing'],
  },

  // ── Eternal Life & Exaltation ─────────────────────────────────────────────
  '_eternal_life': {
    phrases: ['eternal life', 'life eternal', 'immortality and eternal life', 'inherit eternal life', 'the greatest of all the gifts of God'],
    terms:   ['eternal', 'life', 'immortality', 'exaltation', 'inherit', 'gift', 'God'],
  },
  '_exaltation': {
    phrases: ['exalted in the celestial kingdom', 'joint heirs with Christ', 'heirs of God', 'thrones and dominions', 'eternal increase'],
    terms:   ['exalt', 'celestial', 'inherit', 'throne', 'dominion', 'heir', 'eternal', 'increase'],
  },
  '_eternal_family': {
    phrases: ['families are forever', 'sealed for eternity', 'eternal family', 'together forever', 'time and all eternity'],
    terms:   ['family', 'sealed', 'eternal', 'together', 'forever', 'eternity', 'children'],
  },
  '_life_after_death': {
    phrases: ['resurrection of the dead', 'spirit world', 'life after death', 'immortality', 'we shall live again'],
    terms:   ['resurrect', 'spirit', 'world', 'eternal', 'death', 'live', 'immortal'],
  },
  '_judgement': {
    phrases: ['stand before God', 'bar of God', 'judgment bar', 'judged according to works', 'books were opened', 'day of judgment'],
    terms:   ['judgment', 'bar', 'God', 'stand', 'account', 'works', 'books', 'judged'],
  },
  '_outer_darkness': {
    phrases: ['outer darkness', 'sons of perdition', 'weeping and wailing', 'gnashing of teeth', 'perdition', 'second death'],
    terms:   ['outer', 'darkness', 'perdition', 'weeping', 'gnashing', 'sons', 'second death'],
  },

  // ── Families & Covenant ───────────────────────────────────────────────────
  '_covenant': {
    phrases: ['covenant with God', 'everlasting covenant', 'new covenant', 'covenant people', 'keep my covenant', 'enter into a covenant'],
    terms:   ['covenant', 'promise', 'oath', 'swear', 'bind', 'agree', 'testament', 'keep'],
  },
  '_gathering_of_israel': {
    phrases: ['gather Israel', 'remnant of Israel', 'house of Israel', 'return to the promised land', 'scattered Israel', 'ten tribes'],
    terms:   ['gather', 'israel', 'remnant', 'return', 'promised', 'land', 'scattered', 'tribes'],
  },
  '_zion': {
    phrases: ['City of Zion', 'pure in heart', 'city of Enoch', 'New Jerusalem', 'Zion shall flourish', 'establish Zion'],
    terms:   ['zion', 'pure', 'heart', 'city', 'enoch', 'jerusalem', 'establish', 'flourish'],
  },

  // ── Revelation & Spiritual Gifts ──────────────────────────────────────────
  'revelation': {
    phrases: ['revelation from God', 'word of the Lord', 'thus saith the Lord', 'voice of the Lord', 'spirit of revelation', 'open vision'],
    terms:   ['revelation', 'prophet', 'vision', 'manifest', 'spirit', 'saith', 'Lord'],
  },
  'still_small_voice': {
    phrases: ['still small voice', 'voice of the Spirit', 'Spirit whispered', 'spirit of the Lord came upon'],
    terms:   ['still', 'small', 'voice', 'spirit', 'whisper', 'quiet', 'gentle'],
  },
  '_grace_and_works': {
    phrases: [
      'after all we can do',
      'saved by grace',
      'grace of God',
      'grace of Christ',
      'faith without works',
      'works of righteousness'
    ],
    terms: [
      'grace', 'mercy', 'favour', 'unmerited', 'enable', 'divine help',
      'works', 'faith', 'justified', 'saved', 'merit'
    ],
  },
  '_zion': {
    phrases: [
      'come down from heaven',
      'bride of the Lamb',
      'Zion shall flourish',
      'City of Zion',
      'city of Enoch',
      'pure in heart',
      'New Jerusalem',
      'establish Zion',
      'holy city'
    ],
    terms: [
      'zion', 'pure', 'heart', 'city', 'enoch', 'jerusalem',
      'establish', 'flourish', 'new', 'holy', 'heaven', 'bride'
    ],
  },
 
  '_spiritual_gifts': {
    phrases: ['gifts of the Spirit', 'gift of prophecy', 'gift of tongues', 'gift of healing', 'speaking in tongues', 'discerning of spirits'],
    terms:   ['gift', 'spirit', 'prophecy', 'tongues', 'heal', 'discern', 'miracle'],
  },
  '_prophecy': {
    phrases: ['thus saith the Lord', 'the word of the Lord came', 'prophesy in my name', 'spirit of prophecy'],
    terms:   ['prophecy', 'prophet', 'saith', 'Lord', 'foretell', 'vision', 'declare'],
  },
  '_angels': {
    phrases: ['angel of the Lord', 'ministering angels', 'angel appeared', 'angels of God', 'holy angels'],
    terms:   ['angel', 'ministering', 'appeared', 'messenger', 'holy', 'heaven', 'sent'],
  },

  // ── Prayer & Worship ──────────────────────────────────────────────────────
  '_prayer': {
    phrases: ['pray always', 'pray without ceasing', 'ask and ye shall receive', 'ask of God', 'bow in prayer'],
    terms:   ['pray', 'ask', 'father', 'name', 'faith', 'petition', 'kneel'],
  },
  '_fasting': {
    phrases: ['fast and pray', 'fasting and prayer', 'humbled himself with fasting'],
    terms:   ['fast', 'fasting', 'abstain', 'prayer', 'humble', 'soul'],
  },
  '_sabbath': {
    phrases: ['keep the sabbath', 'sabbath day', 'day of rest', 'holy day', 'remember the sabbath'],
    terms:   ['sabbath', 'day', 'rest', 'holy', 'Lord', 'keep', 'remember'],
  },
  '_tithing': {
    phrases: ['pay tithing', 'bring all the tithes', 'tenth part', 'storehouse', 'windows of heaven', 'tithing and offerings'],
    terms:   ['tithe', 'tenth', 'storehouse', 'offering', 'windows', 'heaven', 'pour out'],
  },
  '_gratitude': {
    phrases: ['give thanks', 'thankful in all things', 'praise the Lord', 'grateful heart', 'acknowledge the hand of God'],
    terms:   ['thank', 'grateful', 'praise', 'acknowledge', 'bless', 'glorify', 'hand of God'],
  },

  // ── Agency & Mortal Experience ────────────────────────────────────────────
  '_agency': {
    phrases: ['free to choose', 'agency of man', 'choose liberty', 'choose eternal life', 'enticed by the one or the other', 'moral agency'],
    terms:   ['agency', 'choose', 'free', 'will', 'liberty', 'choose', 'entice', 'act'],
  },
  '_opposition': {
    phrases: ['opposition in all things', 'bitter and the sweet', 'good and evil', 'compound in one'],
    terms:   ['opposition', 'contrary', 'bitter', 'sweet', 'good', 'evil', 'compound'],
  },
  '_natural_man': {
    phrases: ['natural man is an enemy to God', 'carnal mind', 'fallen man', 'put off the natural man', 'yield to the enticings'],
    terms:   ['natural', 'man', 'enemy', 'carnal', 'fallen', 'yield', 'enticings', 'saint'],
  },
  'temptation': {
    phrases: ['led into temptation', 'tempted of the devil', 'overcome temptation', 'resist the devil', 'fiery darts'],
    terms:   ['tempt', 'devil', 'adversary', 'overcome', 'resist', 'fiery', 'darts', 'snare'],
  },
  '_trials': {
    phrases: ['endure to the end', 'in the midst of affliction', 'all these things shall give thee experience', 'refiner fire'],
    terms:   ['trial', 'tribulation', 'affliction', 'suffer', 'adversity', 'trouble', 'refine', 'endure'],
  },
  '_comfort_in_trials': {
    phrases: ['I will not leave you comfortless', 'peace I leave with you', 'I am with thee', 'be still and know', 'bear up your burdens'],
    terms:   ['comfort', 'peace', 'affliction', 'bear', 'burden', 'strengthen', 'consolation', 'still'],
  },

  // ── Service & Discipleship ────────────────────────────────────────────────
  '_service': {
    phrases: ['serve one another', 'in the service of your God', 'minister to the poor', 'succor the weak', 'pure religion'],
    terms:   ['serve', 'minister', 'lift', 'poor', 'needy', 'hands', 'succor', 'strengthen'],
  },
  '_consecration': {
    phrases: ['consecrate thy performance', 'dedicate to the Lord', 'consecrate to the Lord', 'law of consecration', 'all things in common', 'have all things equal'],
    terms:   ['consecrate', 'dedicate', 'steward', 'all', 'law', 'performance', 'equal', 'common'],
  },
  '_charity': {
    phrases: ['charity never faileth', 'pure love of Christ', 'charity is the pure love', 'clothe yourself with charity'],
    terms:   ['charity', 'love', 'pure', 'Christ', 'faileth', 'greatest', 'bond'],
  },
  '_humility': {
    phrases: ['humble yourself before God', 'broken heart and contrite spirit', 'meek and lowly in heart', 'humble yourselves'],
    terms:   ['humble', 'meek', 'lowly', 'submissive', 'contrite', 'broken', 'heart'],
  },
  '_obedience': {
    phrases: ['obedience to the commandments', 'keep my commandments', 'hearken unto my voice', 'do all things whatsoever the Lord commands'],
    terms:   ['obey', 'keep', 'commandment', 'observe', 'hearken', 'follow', 'law'],
  },

  // ── Scripture & Restoration ───────────────────────────────────────────────
  '_restoration': {
    phrases: ['restoration of all things', 'restored church', 'dispensation of the fullness of times', 'restitution of all things'],
    terms:   ['restoration', 'restore', 'dispensation', 'fullness', 'times', 'church', 'restitution'],
  },
  '_book_of_mormon': {
    phrases: ['another testament of Jesus Christ', 'record of the Nephites', 'fulness of the gospel', 'stick of Joseph', 'gold plates'],
    terms:   ['nephite', 'lamanite', 'record', 'plates', 'gospel', 'fullness', 'testament'],
  },
  '_word_of_god': {
    phrases: ['word of God', 'word of the Lord', 'living word', 'iron rod', 'hold fast to the rod'],
    terms:   ['word', 'god', 'scripture', 'commandment', 'truth', 'rod', 'iron'],
  },
  '_liahona': {
    phrases: ['Liahona', 'ball of curious workmanship', 'director', 'faith and diligence'],
    terms:   ['liahona', 'director', 'faith', 'diligence', 'compass', 'spindle', 'work'],
  },
  '_apostasy': {
    phrases: ['great apostasy', 'falling away', 'darkness covered the earth', 'plain and precious truths removed'],
    terms:   ['apostasy', 'apostate', 'fall', 'away', 'darkness', 'plain', 'precious', 'removed'],
  },
  '_prophet': {
    phrases: ['called of God', 'living prophet', 'voice of the prophet', 'follow the prophet', 'word of the prophet'],
    terms:   ['prophet', 'seer', 'revelator', 'called', 'God', 'voice', 'follow', 'living'],
  },

  // ── Specific LDS Doctrinal Phrases ────────────────────────────────────────
  '_by_their_fruits': {
    phrases: ['by their fruits ye shall know them', 'good tree bringeth forth', 'corrupt tree'],
    terms:   ['fruits', 'know', 'tree', 'good', 'corrupt', 'bring', 'forth'],
  },
  '_iron_rod': {
    phrases: ['rod of iron', 'hold fast to the rod', 'word of God', 'strait and narrow path', 'hold fast', 'strait and narrow'],
    terms:   ['rod', 'iron', 'hold', 'fast', 'word', 'god', 'strait', 'narrow', 'path'],
  },
  '_light_of_christ': {
    phrases: ['light of Christ', 'spirit of Christ', 'given to every man', 'true light', 'light and life'],
    terms:   ['light', 'Christ', 'spirit', 'every', 'man', 'conscience', 'truth'],
  },
  '_love_of_god': {
    phrases: ['love of God', 'God so loved the world', 'charity is the love of God', 'he first loved us'],
    terms:   ['love', 'God', 'world', 'gave', 'son', 'charity', 'first'],
  },
  '_armor_of_god': {
    phrases: ['whole armor of God', 'breastplate of righteousness', 'shield of faith', 'sword of the Spirit', 'helmet of salvation'],
    terms:   ['armor', 'breastplate', 'shield', 'faith', 'sword', 'spirit', 'helmet', 'salvation'],
  },
  '_new_jerusalem': {
    phrases: ['New Jerusalem', 'city of Zion', 'holy city', 'come down from heaven', 'bride of the Lamb'],
    terms:   ['new', 'jerusalem', 'zion', 'city', 'holy', 'heaven', 'bride'],
  },
  '_abide_in_me': {
    phrases: ['abide in me', 'I am the vine', 'branch cannot bear fruit', 'abide in my love'],
    terms:   ['abide', 'vine', 'branch', 'fruit', 'love', 'remain', 'dwell'],
  },
  '_prayer_of_faith': {
    phrases: ['prayer of faith', 'pray with faith', 'ask in faith', 'ask of God', 'receive according to your faith', 'nothing wavering'],
    terms:   ['prayer', 'faith', 'ask', 'waver', 'believe', 'receive', 'heal'],
  },
  '_power_of_god': {
    phrases: ['power of God', 'arm of the Lord', 'by the power of God', 'omnipotent God', 'mighty to save', 'strength of the Lord', 'mighty God', 'omnipotent arm', 'omnipotent power', 'matchless power of God'],
    terms:   ['power', 'God', 'arm', 'Lord', 'omnipotent', 'mighty', 'strength'],
  },
  '_endure_to_the_end': {
    phrases: ['endure to the end', 'hold out faithful', 'patient in tribulation', 'endure tribulation', 'faithful unto the end', 'trials and tribulations', 'trial of your faith', 'worketh patience', 'patience in thy affliction', 'run with endurance'],
    terms:   ['endure', 'end', 'faithful', 'patient', 'tribulation', 'run', 'persevere'],
  },
  '_steadfast': {
    phrases: ['steadfast and immovable', 'firm and steadfast in the faith', 'hold fast'],
    terms:   ['steadfast', 'immovable', 'firm', 'faith', 'hold', 'fast', 'constant'],
  },
};

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeAliasEntry(entry) {
  const uniqPhrases = [];
  const seenPhrases = new Set();
  for (const phrase of entry.phrases || []) {
    const normalized = String(phrase || '').trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seenPhrases.has(key)) continue;
    seenPhrases.add(key);
    uniqPhrases.push(normalized);
  }

  const uniqTerms = [];
  const seenTerms = new Set();
  for (const term of entry.terms || []) {
    const normalized = String(term || '').trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seenTerms.has(key)) continue;
    seenTerms.add(key);
    uniqTerms.push(normalized);
  }

  return { phrases: uniqPhrases, terms: uniqTerms };
}

function compileDoctrineAliases(aliases) {
  const normalizedMap = {};
  const keys = Object.keys(aliases);
  for (const key of keys) {
    normalizedMap[key.toLowerCase().trim()] = sanitizeAliasEntry(aliases[key]);
  }

  const sortedKeys = Object.keys(normalizedMap).sort((a, b) => b.length - a.length);
  return { normalizedMap, sortedKeys };
}

const COMPILED_ALIASES = compileDoctrineAliases(DOCTRINE_ALIASES);

function applyDoctrineAliases(input) {
  const lower = String(input || '').toLowerCase().trim();
  if (!lower) return null;

  const exact = COMPILED_ALIASES.normalizedMap[lower];
  if (exact) return exact;

  for (const key of COMPILED_ALIASES.sortedKeys) {
    const pattern = new RegExp(`(^|\\W)${escapeRegex(key)}(?=\\W|$)`, 'i');
    if (pattern.test(lower)) {
      return COMPILED_ALIASES.normalizedMap[key];
    }
  }
  return null;
}

const buildFTSPhraseQuery = (phrase) => {
  return `"${phrase.replace(/\"/g, '\"\"')}"`;
};

const buildFTSTermQuery = (terms, mode = 'and') => {
  if (!terms || !terms.length) return '';
  const cleaned = terms.map((t) => String(t || '').trim()).filter(Boolean);
  if (!cleaned.length) return '';
  const wildcarded = cleaned
    .map((t) => {
      const safe = t.replace(/["']/g, '').replace(/[^a-zA-Z0-9\-\s]/g, '').trim();
      if (!safe) return '';
      if (safe.includes(' ')) return `"${safe.replace(/\"/g, '\"\"')}"`;
      return `${safe}*`;
    })
    .filter(Boolean);
  if (!wildcarded.length) return '';
  return mode === 'or'
    ? wildcarded.join(' OR ')
    : wildcarded.join(' AND ');
};

const buildFTSMatchQuery = (input, { orFallback = false } = {}) => {
  if (!input) return '';
  const trimmed = input.trim();
  if (!trimmed) return '';

  const quoted = trimmed.match(/^"(.+)"$/);
  if (quoted) return `"${quoted[1].replace(/\"/g, '\"\"')}"`;

  const terms = trimmed
    .split(/\s+/)
    .map(t => t.replace(/["']/g, '').replace(/[^a-zA-Z0-9\-]/g, ''))
    .filter(t => t.length > 1);

  if (terms.length === 0) return '';
  const wildcarded = terms.map(t => `${t}*`);
  return orFallback ? wildcarded.join(' OR ') : wildcarded.join(' AND ');
};


// runFTSCount — returns the total number of matching verses for a query
// without fetching any row data. Used to tell the client how many pages exist.
// We cap the internal scan at MAX_COUNT_SCAN to avoid full-table scans on
// very broad OR queries (e.g. "faith" OR "love" OR "hope" = tens of thousands).
const MAX_COUNT_SCAN = 2000;
const runFTSCount = (matchQuery) => {
  try {
    const stmt = db.prepare(`
      SELECT COUNT(*) AS total
      FROM (
        SELECT verse_id
        FROM scriptures_fts
        WHERE scriptures_fts MATCH ?
        LIMIT ${MAX_COUNT_SCAN}
      )
    `);
    return stmt.get(matchQuery)?.total ?? 0;
  } catch (_err) {
    return 0;
  }
};

// runFTSQuery — fetch one page of results ranked by BM25 relevance.
// offset allows true server-side pagination: the DB does the skipping,
// nothing unnecessary is loaded into memory or sent over the socket.
const runFTSQuery = (matchQuery, rawPhrase = null, limit = 10, offset = 0) => {
  const literalPattern = rawPhrase
    ? `%${rawPhrase.trim().toLowerCase()}%`
    : null;

  // The inner subquery fetches limit+offset rows so BM25 ranking is stable
  // across pages — the same query plan is used each time, offsets are cheap.
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
      LIMIT ${limit} OFFSET ${offset}
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

// phraseSearch — paginated, returns { results: [...], total: N }
// page is 0-based. pageSize controls rows returned. total is capped at
// MAX_COUNT_SCAN so the count query stays fast on broad OR searches.
const phraseSearch = (phrase, page = 0, pageSize = 10) => {
  if (!phrase || !phrase.trim()) return { results: [], total: 0 };

  const raw    = phrase.trim();
  const offset = page * pageSize;
  const alias  = applyDoctrineAliases(raw);

  try {
    const ftsExists = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='scriptures_fts'`
    ).get();

    if (ftsExists) {

      if (alias) {
        // Pass 0 — exact FTS5 phrase match on each alias phrase.
        // For aliases we build a combined OR-of-phrases query so we can
        // paginate cleanly with a single LIMIT/OFFSET rather than merging
        // multiple result sets across page boundaries.
        const phraseQueries = (alias.phrases || []).map(buildFTSPhraseQuery);
        if (phraseQueries.length > 0) {
          const combined = phraseQueries.join(' OR ');
          const total   = runFTSCount(combined);
          const results = runFTSQuery(combined, raw, pageSize, offset);
          if (results.length > 0 || total > 0) return { results, total };
        }

        // Pass 1 — AND on alias terms
        const andQ = buildFTSTermQuery(alias.terms || [], 'and');
        if (andQ) {
          const total   = runFTSCount(andQ);
          const results = runFTSQuery(andQ, raw, pageSize, offset);
          if (results.length > 0 || total > 0) return { results, total };
        }

        // Pass 2 — OR on alias terms
        const orQ = buildFTSTermQuery(alias.terms || [], 'or');
        if (orQ) {
          const total   = runFTSCount(orQ);
          const results = runFTSQuery(orQ, raw, pageSize, offset);
          if (results.length > 0 || total > 0) return { results, total };
        }

      } else {

        // No alias — raw input path
        // Pass 0 — exact phrase on raw input (multi-word only)
        if (raw.split(/\s+/).length > 1) {
          const exactQ  = buildFTSPhraseQuery(raw);
          const total   = runFTSCount(exactQ);
          const results = runFTSQuery(exactQ, raw, pageSize, offset);
          if (results.length > 0 || total > 0) return { results, total };
        }

        // Pass 1 — AND on raw terms
        const andQ = buildFTSMatchQuery(raw);
        if (andQ) {
          const total   = runFTSCount(andQ);
          const results = runFTSQuery(andQ, raw, pageSize, offset);
          if (results.length > 0 || total > 0) return { results, total };
        }

        // Pass 2 — OR on raw terms
        const orQ = buildFTSMatchQuery(raw, { orFallback: true });
        if (orQ) {
          const total   = runFTSCount(orQ);
          const results = runFTSQuery(orQ, raw, pageSize, offset);
          if (results.length > 0 || total > 0) return { results, total };
        }

        // Pass 3 — prefix wildcard for single-word input
        if (raw.split(/\s+/).length === 1) {
          const wq      = `${raw}*`;
          const total   = runFTSCount(wq);
          const results = runFTSQuery(wq, raw, pageSize, offset);
          if (results.length > 0 || total > 0) return { results, total };
        }
      }
    }
  } catch (err) {
    fastify.log.warn('FTS pipeline failed, falling back to LIKE:', err && err.message);
  }

  // Last resort — LIKE token scan (no FTS, count with subquery)
  const fallbackTerms = (alias ? (alias.terms || [raw]) : [raw])
    .join(' ').trim().split(/\s+/).filter(Boolean);
  const clauses = fallbackTerms.map(() => '(scripture_text LIKE ? OR verse_title LIKE ?)');
  const likeParams = [];
  fallbackTerms.forEach(t => likeParams.push(`%${t}%`, `%${t}%`));

  const countRow = db.prepare(`
    SELECT COUNT(*) AS total FROM scriptures WHERE ${clauses.join(' AND ')}
  `).get(...likeParams);
  const total = Math.min(countRow?.total ?? 0, MAX_COUNT_SCAN);

  const results = db.prepare(`
    SELECT book_id, book_title, chapter_number, verse_number,
           scripture_text, verse_title, verse_id
    FROM scriptures
    WHERE ${clauses.join(' AND ')}
    ORDER BY verse_id
    LIMIT ? OFFSET ?
  `).all(...likeParams, pageSize, offset);

  return { results, total };
};


// searchScripture — paginated entry point.
// For structured references (e.g. "John 3:16") pagination is a no-op since
// the result set is always tiny (one chapter = ~30 verses max).
// For phrase/FTS searches we delegate to phraseSearch which handles paging.
const searchScripture = (input, page = 0, pageSize = 10) => {
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
        LOWER(book_title) = LOWER(?)`;
        const params = [ref.book];

        sql += '\n        AND chapter_number = ?';
        params.push(ref.chapter);

        if (ref.verse !== null) {
            sql += ' AND verse_number = ?';
            params.push(ref.verse);
        }

        // For reference lookups: count first, then page
        const countSql  = sql.replace(/SELECT[\s\S]+?FROM/, 'SELECT COUNT(*) AS total FROM');
        const countRow  = db.prepare(countSql + ' LIMIT 200').get(...params);
        const total     = countRow?.total ?? 0;

        const pageSql   = sql + `\n    ORDER BY verse_id ASC\n    LIMIT ? OFFSET ?`;
        const stmt      = db.prepare(pageSql);
        const result    = stmt.all(...params, pageSize, page * pageSize);
        if (result.length > 0 || total > 0) return { results: result, total };

        // Fallback for unexpected title variants
        const fallbackCountSql = countSql.replace('LOWER(book_title) = LOWER(?)', 'book_title LIKE ?') + ' LIMIT 200';
        const fallbackPageSql  = sql.replace('LOWER(book_title) = LOWER(?)', 'book_title LIKE ?') + '\n    ORDER BY verse_id ASC\n    LIMIT ? OFFSET ?';
        const fallbackParams   = [`%${ref.book}%`, ...params.slice(1)];
        const fbCount = db.prepare(fallbackCountSql).get(...fallbackParams)?.total ?? 0;
        const fbRows  = db.prepare(fallbackPageSql).all(...fallbackParams, pageSize, page * pageSize);
        if (fbRows.length > 0 || fbCount > 0) return { results: fbRows, total: fbCount };

        return phraseSearch(input, page, pageSize);
    }

    return phraseSearch(input, page, pageSize);
};

// searchScriptureInDb — same logic as searchScripture but operates on an
// arbitrary database handle. Used when the presenter searches in TL or CEB.
// We duplicate the reference-lookup + phrase-search flow here so the two DBs
// can have their own FTS tables (or fall back to LIKE if they don't).
const searchScriptureInDb = (input, page = 0, pageSize = 10, targetDb) => {
  if (!targetDb) return searchScripture(input, page, pageSize);

  const ref = parseScriptureReference(input);
  const offset = page * pageSize;

  if (ref) {
    try {
      const countRow = targetDb.prepare(`
        SELECT COUNT(*) AS total FROM scriptures
        WHERE LOWER(book_title) = LOWER(?) AND chapter_number = ?
        ${ref.verse !== null ? 'AND verse_number = ?' : ''}
        LIMIT 200
      `).get(...(ref.verse !== null ? [ref.book, ref.chapter, ref.verse] : [ref.book, ref.chapter]));

      const total = countRow?.total ?? 0;
      const rows  = targetDb.prepare(`
        SELECT book_title, chapter_number, verse_number,
               scripture_text, verse_title, verse_short_title, verse_id
        FROM scriptures
        WHERE LOWER(book_title) = LOWER(?) AND chapter_number = ?
        ${ref.verse !== null ? 'AND verse_number = ?' : ''}
        ORDER BY verse_id ASC LIMIT ? OFFSET ?
      `).all(...(ref.verse !== null
        ? [ref.book, ref.chapter, ref.verse, pageSize, offset]
        : [ref.book, ref.chapter, pageSize, offset]));

      if (rows.length > 0 || total > 0) return { results: rows, total };
    } catch (_e) { /* fall through to LIKE */ }
  }

  // LIKE fallback for non-English DBs (may not have FTS tables)
  const terms  = input.trim().split(/\s+/).filter(Boolean);
  const clause = terms.map(() => 'scripture_text LIKE ?').join(' AND ');
  const params = terms.map(t => `%${t}%`);

  try {
    const total = Math.min(
      targetDb.prepare(`SELECT COUNT(*) AS total FROM scriptures WHERE ${clause}`).get(...params)?.total ?? 0,
      MAX_COUNT_SCAN
    );
    const results = targetDb.prepare(`
      SELECT book_title, chapter_number, verse_number,
             scripture_text, verse_title, verse_id
      FROM scriptures
      WHERE ${clause}
      ORDER BY verse_id LIMIT ? OFFSET ?
    `).all(...params, pageSize, offset);
    return { results, total };
  } catch (_e) {
    return { results: [], total: 0 };
  }
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

// Verse of the Day — deterministic by UTC calendar date so all clients agree.
// Uses the total verse count as a modulus so every date maps to a real verse.
// ─── Curated VOTD pool ────────────────────────────────────────────────────────
// 120 verse_ids hand-picked for doctrinal richness, familiarity, and uplift.
// Using verse_ids (stable primary keys) means this works regardless of how
// the book/chapter structure is stored. Spread across OT, NT, BoM, D&C, PGP.
const VOTD_POOL = [
  // New Testament
  1011, 1012, 24975, 24976, 24977, 24978, 24979, 24980,  // Matthew 5–6 Sermon on the Mount
  25478, 25479, 25480,                                    // John 3:16–18
  25771, 25772, 25773,                                    // John 14:6, 15:12–13
  26634, 26635,                                           // Romans 8:28,31
  27336, 27337,                                           // 1 Cor 13:4–7
  28635, 28636, 28637,                                    // Philippians 4:7–8
  29001, 29002,                                           // Hebrews 11:1,6
  // Old Testament
  100, 101, 102,                                          // Genesis 1:1–3
  14901, 14902, 14903,                                    // Psalms 23
  15601, 15602, 15603,                                    // Psalms 46
  18201, 18202,                                           // Proverbs 3:5–6
  21001, 21002,                                           // Isaiah 1:18
  21850, 21851, 21852,                                    // Isaiah 40:28–31
  22350, 22351,                                           // Isaiah 53:4–5
  // Book of Mormon
  31172, 31173,                                           // 1 Nephi 3:7
  32100, 32101, 32102,                                    // 2 Nephi 2:25–27
  32901, 32902,                                           // 2 Nephi 31:20
  33500, 33501,                                           // Jacob 2:18–19
  34200, 34201,                                           // Mosiah 2:17
  34800, 34801, 34802,                                    // Mosiah 3:17–19
  35500, 35501, 35502,                                    // Alma 7:11–13
  36200, 36201,                                           // Alma 26:12
  37100, 37101,                                           // Alma 37:35–37
  38000, 38001, 38002,                                    // Helaman 5:12
  39100, 39101, 39102,                                    // 3 Nephi 11:10–11
  39800, 39801, 39802,                                    // 3 Nephi 27:20–21
  40500, 40501,                                           // Moroni 7:45–47
  40800, 40801, 40802,                                    // Moroni 10:3–5
  // Doctrine and Covenants
  41100, 41101,                                           // D&C 1:37–38
  41300, 41301, 41302,                                    // D&C 6:33–36
  41800, 41801,                                           // D&C 18:15–16
  42200, 42201, 42202,                                    // D&C 58:26–28
  42900, 42901,                                           // D&C 76:22–24
  43200, 43201, 43202,                                    // D&C 82:10
  43600, 43601, 43602,                                    // D&C 88:118–119
  44100, 44101,                                           // D&C 121:7–8
  44300, 44301, 44302,                                    // D&C 130:18–21
];

fastify.get('/verse/of-the-day', async (request, reply) => {
  try {
    const now = new Date();
    const start = Date.UTC(now.getUTCFullYear(), 0, 0);
    const dayOfYear = Math.floor(
      (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - start) / 86400000
    );

    // Step 1: try the curated pool — consistent, uplifting, doctrinally rich.
    // LCG spread so sequential days don't feel linear within the pool.
    const LCG_A = 1664525, LCG_C = 1013904223, MOD = 2 ** 32;
    const seed   = ((LCG_A * dayOfYear + LCG_C) % MOD + MOD) % MOD;
    const poolId = VOTD_POOL[seed % VOTD_POOL.length];

    const verse = db.prepare(`
      SELECT book_title, chapter_number, verse_number,
             scripture_text, verse_title, verse_id
      FROM scriptures WHERE verse_id = ?
    `).get(poolId);

    if (verse) return { ...verse, date: now.toISOString().slice(0, 10) };

    // Step 2: graceful fallback — random verse from full canon if pool ID misses
    const countRow = db.prepare('SELECT COUNT(*) AS total FROM scriptures').get();
    const total    = countRow?.total || 41995;
    const fallbackSeed = ((LCG_A * (dayOfYear + 1) + LCG_C) % MOD + MOD) % MOD;
    const fallback = db.prepare(`
      SELECT book_title, chapter_number, verse_number,
             scripture_text, verse_title, verse_id
      FROM scriptures WHERE verse_id = ?
    `).get((fallbackSeed % total) + 1);

    if (!fallback) { reply.code(404); return { error: 'not found' }; }
    return { ...fallback, date: now.toISOString().slice(0, 10) };
  } catch (err) {
    fastify.log.error('verse-of-the-day failed', err);
    reply.code(500);
    return { error: 'internal error' };
  }
});

function registerSocketHandlers(io, { segmentVerseText, db, db_cebuano, db_tagalog }) {
  const DEFAULT_SESSION_ID = 'GLOBAL';
  const SESSION_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const SESSION_CODE_LENGTH = 6;
  // Use the service config defined at module level; allow env override for testing.
  const SESSION_GRACE_MS = Number(process.env.SESSION_GRACE_MS || SERVICE_CONFIG.SESSION_GRACE_MS);
  const sessionState = new Map();
  const cleanupTimers = new Map();
  // Track viewer counts per session so the Presenter can see "N displays connected"
  const sessionViewerCounts = new Map();

  function normalizeSessionId(value) {
    if (!value) return '';
    return String(value).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);
  }

  function getSessionState(sessionId) {
    if (!sessionState.has(sessionId)) {
      sessionState.set(sessionId, {
        liveVerse: null,
        highlightedText: '',
        presenterSocketId: null,
        updatedAt: Date.now(),
      });
    }
    return sessionState.get(sessionId);
  }

  function generateSessionId() {
    // Guard against unbounded session accumulation (e.g. server left running for weeks)
    if (sessionState.size >= SERVICE_CONFIG.MAX_SESSIONS) {
      fastify.log.warn(`MAX_SESSIONS (${SERVICE_CONFIG.MAX_SESSIONS}) reached — refusing new session`);
      return null;
    }
    for (let i = 0; i < 16; i += 1) {
      let generated = '';
      for (let j = 0; j < SESSION_CODE_LENGTH; j += 1) {
        const idx = Math.floor(Math.random() * SESSION_CODE_CHARS.length);
        generated += SESSION_CODE_CHARS[idx];
      }
      if (!sessionState.has(generated) && generated !== DEFAULT_SESSION_ID) {
        return generated;
      }
    }
    return `${SESSION_CODE_CHARS[Math.floor(Math.random() * SESSION_CODE_CHARS.length)]}${Date.now().toString(36).toUpperCase().slice(-5)}`;
  }

  // ── Viewer count tracking ────────────────────────────────────────────────
  function incrementViewerCount(sessionId) {
    const n = (sessionViewerCounts.get(sessionId) || 0) + 1;
    sessionViewerCounts.set(sessionId, n);
    broadcastViewerCount(sessionId, n);
  }

  function decrementViewerCount(sessionId) {
    const n = Math.max(0, (sessionViewerCounts.get(sessionId) || 1) - 1);
    sessionViewerCounts.set(sessionId, n);
    broadcastViewerCount(sessionId, n);
  }

  function broadcastViewerCount(sessionId, count) {
    if (!sessionId || sessionId === DEFAULT_SESSION_ID) return;
    io.to(sessionId).emit('viewer-count', { sessionId, count });
  }

  function emitToSession(sessionId, event, payload) {
    io.to(sessionId).emit(event, payload);
  }

  function getRoomSize(sessionId) {
    const rooms = io && io.sockets && io.sockets.adapter && io.sockets.adapter.rooms;
    if (!rooms || typeof rooms.get !== 'function') return null;
    const room = rooms.get(sessionId);
    return room ? room.size : 0;
  }

  function cancelCleanup(sessionId) {
    const normalized = normalizeSessionId(sessionId);
    if (!normalized) return;
    const timer = cleanupTimers.get(normalized);
    if (timer) {
      clearTimeout(timer);
      cleanupTimers.delete(normalized);
    }
  }

  function cleanupSessionIfUnused(sessionId) {
    const normalized = normalizeSessionId(sessionId);
    if (!normalized || normalized === DEFAULT_SESSION_ID) return;
    const roomSize = getRoomSize(normalized);
    if (roomSize !== 0) return;
    cancelCleanup(normalized);
    if (sessionState.has(normalized)) {
      sessionState.delete(normalized);
      fastify.log.info(`Session ${normalized} terminated (no active sockets)`);
    }
  }

  function scheduleCleanup(sessionId, { disconnecting = false } = {}) {
    const normalized = normalizeSessionId(sessionId);
    if (!normalized || normalized === DEFAULT_SESSION_ID) return;
    const roomSize = getRoomSize(normalized);
    if (roomSize === null || (!disconnecting && roomSize > 0) || (disconnecting && roomSize > 1)) {
      cancelCleanup(normalized);
      return;
    }
    cancelCleanup(normalized);
    const timer = setTimeout(() => {
      cleanupSessionIfUnused(normalized);
    }, SESSION_GRACE_MS);
    cleanupTimers.set(normalized, timer);
  }

  function sessionExists(sessionId) {
    const normalized = normalizeSessionId(sessionId);
    if (!normalized) return false;
    if (sessionState.has(normalized)) return true;
    const roomSize = getRoomSize(normalized);
    return typeof roomSize === 'number' && roomSize > 0;
  }

  function releasePresenterLock(sessionId, socketId) {
    const normalized = normalizeSessionId(sessionId);
    if (!normalized || normalized === DEFAULT_SESSION_ID) return;
    const state = sessionState.get(normalized);
    if (state && state.presenterSocketId === socketId) {
      state.presenterSocketId = null;
      state.updatedAt = Date.now();
    }
  }

  function hasConnectedSocket(socketId) {
    if (!socketId) return false;
    const socketMap = io && io.sockets && io.sockets.sockets;
    if (!socketMap) return false;
    if (typeof socketMap.has === 'function') return socketMap.has(socketId);
    if (typeof socketMap.get === 'function') return Boolean(socketMap.get(socketId));
    return false;
  }

  function clearStalePresenterLock(state) {
    if (!state || !state.presenterSocketId) return;
    if (!hasConnectedSocket(state.presenterSocketId)) {
      state.presenterSocketId = null;
      state.updatedAt = Date.now();
    }
  }

  function ensurePresenterAccess(sessionId, socket) {
    const state = getSessionState(sessionId);
    clearStalePresenterLock(state);
    if (state.presenterSocketId && state.presenterSocketId !== socket.id) {
      const error = { message: 'Another presenter is active in this session' };
      socket.emit('session-error', error);
      return false;
    }
    if (!state.presenterSocketId) {
      state.presenterSocketId = socket.id;
      state.updatedAt = Date.now();
    }
    return true;
  }

  io.on('connection', (socket) => {
    console.log('a user connected');
    let activeSessionId = DEFAULT_SESSION_ID;
    let activeRole = 'viewer';
    socket.join(activeSessionId);
    getSessionState(activeSessionId);

    const joinSession = (candidateSessionId, role = 'viewer') => {
      const normalized = normalizeSessionId(candidateSessionId);
      if (!normalized) return null;
      const previousSessionId = activeSessionId;
      if (role === 'presenter') {
        const state = getSessionState(normalized);
        clearStalePresenterLock(state);
        if (state.presenterSocketId && state.presenterSocketId !== socket.id) {
          // Phase 1: alert the current presenter that a takeover was attempted
          io.to(state.presenterSocketId).emit('presenter-takeover-attempt', {
            message: 'Another device attempted to join your session as presenter',
          });
          return { error: 'Another presenter is active in this session' };
        }
      }
      if (activeSessionId && activeSessionId !== normalized) {
        socket.leave(activeSessionId);
        if (activeRole === 'presenter') {
          releasePresenterLock(previousSessionId, socket.id);
        } else {
          // Viewer leaving previous session
          decrementViewerCount(previousSessionId);
        }
        scheduleCleanup(previousSessionId);
      }
      activeSessionId = normalized;
      activeRole = role;
      socket.join(activeSessionId);
      cancelCleanup(activeSessionId);
      const state = getSessionState(activeSessionId);
      if (role === 'presenter') {
        state.presenterSocketId = socket.id;
      } else {
        incrementViewerCount(activeSessionId);
      }
      // Tell the joining socket it's in the session
      socket.emit('session-joined', { sessionId: activeSessionId });
      if (state.theme) socket.emit('update-theme', state.theme);
      if (state.liveVerse) socket.emit('update-verse', state.liveVerse);
      if (state.highlightedText) socket.emit('highlight-text', state.highlightedText);
      socket.emit('viewer-count', {
        sessionId: activeSessionId,
        count: sessionViewerCounts.get(activeSessionId) || 0,
      });
      // If a Presenter just joined, tell everyone else in the room (i.e. the
      // Client/TV) so it can close the QR screen and enter display mode.
      if (role === 'presenter') {
        socket.to(activeSessionId).emit('presenter-joined', { sessionId: activeSessionId });
      }
      return { sessionId: activeSessionId };
    };

    const leaveActiveSession = () => {
      if (!activeSessionId || activeSessionId === DEFAULT_SESSION_ID) {
        return { sessionId: DEFAULT_SESSION_ID };
      }
      const previousSessionId = activeSessionId;
      if (activeRole === 'presenter') {
        releasePresenterLock(previousSessionId, socket.id);
      } else {
        decrementViewerCount(previousSessionId);
      }
      socket.leave(previousSessionId);
      activeSessionId = DEFAULT_SESSION_ID;
      activeRole = 'viewer';
      socket.join(DEFAULT_SESSION_ID);
      scheduleCleanup(previousSessionId);
      socket.emit('session-left', { sessionId: previousSessionId });
      return { sessionId: previousSessionId };
    };

    socket.on('create-session', (payload, callback) => {
      const sessionId = generateSessionId();
      if (!sessionId) {
        const error = { message: 'Server session limit reached — please try again later' };
        socket.emit('session-error', error);
        if (typeof callback === 'function') callback({ ok: false, ...error });
        return;
      }
      const role = payload && payload.role === 'presenter' ? 'presenter' : 'presenter';
      const joined = joinSession(sessionId, role);
      if (joined && joined.error) {
        const error = { message: joined.error };
        socket.emit('session-error', error);
        if (typeof callback === 'function') callback({ ok: false, ...error });
        return;
      }
      socket.emit('session-created', { sessionId: joined.sessionId });
      if (typeof callback === 'function') callback({ ok: true, sessionId: joined.sessionId });
    });

    // ── TV/Client-initiated sessions ──────────────────────────────────────────
    // The Client display (e.g. a TV) calls this to create a named session that
    // the Presenter then joins by scanning the QR code or typing the short code.
    //
    // Phase 2 addition: accepts an optional `preferredSessionId` so a TV that
    // has reloaded (browser crash, power-save) can request its previous code
    // back.  If that session still exists in state, the TV silently rejoins it
    // without changing the QR code — the Presenter never notices the hiccup.
    socket.on('create-client-session', (payload, callback) => {
      const preferred = normalizeSessionId(payload && payload.preferredSessionId);
      let sessionId;

      if (preferred && sessionExists(preferred)) {
        // The TV's previous session is still alive — rejoin it seamlessly
        sessionId = preferred;
        fastify.log.info(`TV rejoining existing client session ${sessionId}`);
      } else {
        // Create a fresh session room
        sessionId = generateSessionId();
        if (!sessionId) {
          const error = { message: 'Server session limit reached' };
          socket.emit('session-error', error);
          if (typeof callback === 'function') callback({ ok: false, ...error });
          return;
        }
      }

      // Leave any previous session cleanly
      if (activeSessionId && activeSessionId !== DEFAULT_SESSION_ID && activeSessionId !== sessionId) {
        socket.leave(activeSessionId);
        decrementViewerCount(activeSessionId);
        scheduleCleanup(activeSessionId);
      }

      activeSessionId = sessionId;
      activeRole = 'viewer';
      socket.join(sessionId);
      cancelCleanup(sessionId);
      getSessionState(sessionId); // ensure state map entry exists
      incrementViewerCount(sessionId);

      socket.emit('client-session-created', { sessionId });
      if (typeof callback === 'function') callback({ ok: true, sessionId });
    });

    socket.on('join-session', (payload, callback) => {
      const requested = normalizeSessionId(payload && payload.sessionId);
      const role = payload && payload.role === 'presenter' ? 'presenter' : 'viewer';
      if (!sessionExists(requested)) {
        const error = { message: 'Session not found' };
        socket.emit('session-error', error);
        if (typeof callback === 'function') callback({ ok: false, ...error });
        return;
      }
      const joined = joinSession(requested, role);
      if (!joined || joined.error) {
        const error = { message: joined && joined.error ? joined.error : 'Valid session code is required' };
        socket.emit('session-error', error);
        if (typeof callback === 'function') callback({ ok: false, ...error });
        return;
      }
      if (!joined.sessionId) {
        const error = { message: 'Valid session code is required' };
        socket.emit('session-error', error);
        if (typeof callback === 'function') callback({ ok: false, ...error });
        return;
      }
      if (typeof callback === 'function') callback({ ok: true, sessionId: joined.sessionId });
    });

    socket.on('leave-session', (payload, callback) => {
      const left = leaveActiveSession();
      if (typeof callback === 'function') callback({ ok: true, sessionId: left.sessionId });
    });

    socket.on('search', (payload) => {
        const query    = typeof payload === 'string' ? payload : payload?.query;
        const page     = Number(payload?.page)     || 0;
        const pageSize = Number(payload?.pageSize) || 10;
        const language = payload?.language ? String(payload.language).toLowerCase().trim() : 'en';

        if (!query || !String(query).trim()) {
          socket.emit('search-results', { results: [], total: 0, page: 0, pageSize });
          return;
        }

        fastify.log.info(`search: "${query}" page=${page} pageSize=${pageSize} lang=${language}`);

        // Route search to the correct database for the active language.
        // TL and CEB have their own scriptures tables; English is the default.
        // searchScripture uses the module-level `db` var so we temporarily swap
        // it via a language-aware wrapper rather than refactoring the whole function.
        let searchResults;
        if (language === 'ceb') {
          searchResults = searchScriptureInDb(query, page, pageSize, db_cebuano);
        } else if (language === 'tl') {
          searchResults = searchScriptureInDb(query, page, pageSize, db_tagalog);
        } else {
          searchResults = searchScripture(query, page, pageSize);
        }

        const { results, total } = searchResults;
        socket.emit('search-results', { results, total, page, pageSize, query, language });
    });

    socket.on('update-verse', (payload) => {
      const verse = payload && payload.verse ? payload.verse : payload;
      const sessionId = activeSessionId || normalizeSessionId(payload && payload.sessionId) || DEFAULT_SESSION_ID;
      if (!ensurePresenterAccess(sessionId, socket)) return;
      console.log('updating verse:', verse);
      const state = getSessionState(sessionId);
      state.liveVerse = verse;
      state.updatedAt = Date.now();
      emitToSession(sessionId, 'update-verse', verse);
    });

    socket.on('update-theme', (payload) => {
      const theme = payload && payload.theme ? payload.theme : payload;
      const sessionId = activeSessionId || normalizeSessionId(payload && payload.sessionId) || DEFAULT_SESSION_ID;
      if (!ensurePresenterAccess(sessionId, socket)) return;
      console.log('updating theme:', theme);
      const state = getSessionState(sessionId);
      state.updatedAt = Date.now();
    });

    socket.on('highlight-text', (payload) => {
      const text = payload && Object.prototype.hasOwnProperty.call(payload, 'text') ? payload.text : payload;
      const sessionId = activeSessionId || normalizeSessionId(payload && payload.sessionId) || DEFAULT_SESSION_ID;
      if (!ensurePresenterAccess(sessionId, socket)) return;
      console.log('highlighting text:', text);
      const state = getSessionState(sessionId);
      state.highlightedText = text ? String(text).trim() : '';
      state.updatedAt = Date.now();
      emitToSession(sessionId, 'highlight-text', state.highlightedText);
    });

    // ── clear-screen ─────────────────────────────────────────────────────────
    // Presenter hits "End Live" → blank the TV, return Client to QR idle state.
    // Session stays alive — QR code is unchanged — presenter can go live again.
    socket.on('clear-screen', (payload, callback) => {
      const sessionId = activeSessionId || normalizeSessionId(payload && payload.sessionId) || DEFAULT_SESSION_ID;
      if (!ensurePresenterAccess(sessionId, socket)) return;
      const state = getSessionState(sessionId);
      state.liveVerse      = null;
      state.highlightedText = '';
      state.updatedAt      = Date.now();
      emitToSession(sessionId, 'clear-screen', {});
      fastify.log.info(`clear-screen broadcast to session ${sessionId}`);
      if (typeof callback === 'function') callback({ ok: true });
    });

    // ── update-language ──────────────────────────────────────────────────────
    // Presenter switches language while a verse is already live.
    // Fetch the same verse from the correct database and re-broadcast it
    // so the TV updates immediately without requiring a new go-live.
    socket.on('update-language', (payload) => {
      const lang      = payload?.language ? String(payload.language).toLowerCase().trim() : 'en';
      const sessionId = activeSessionId || normalizeSessionId(payload?.sessionId) || DEFAULT_SESSION_ID;
      if (!ensurePresenterAccess(sessionId, socket)) return;

      const state = getSessionState(sessionId);
      state.language  = lang;
      state.updatedAt = Date.now();

      // If there's a live verse, re-fetch it in the new language and re-broadcast
      if (state.liveVerse) {
        const verseId  = Number(state.liveVerse.verse_id);
        const targetDb = lang === 'ceb' ? db_cebuano : lang === 'tl' ? db_tagalog : db;
        try {
          const row = targetDb.prepare(
            `SELECT scripture_text, verse_title, book_title FROM scriptures WHERE verse_id = ?`
          ).get(verseId);
          if (row) {
            const updated = {
              ...state.liveVerse,
              scripture_text: row.scripture_text || state.liveVerse.scripture_text,
              book_title:     row.book_title     || state.liveVerse.book_title,
              verse_title:    row.verse_title    || state.liveVerse.verse_title,
              segments:       segmentVerseText(row.scripture_text || state.liveVerse.scripture_text),
              currentSegment: 0,
            };
            updated.totalSegments = updated.segments.length;
            state.liveVerse = updated;
            emitToSession(sessionId, 'update-verse', updated);
          }
        } catch (err) {
          fastify.log.warn(`update-language: failed to fetch verse in ${lang}:`, err?.message);
        }
      }

      fastify.log.info(`update-language: session ${sessionId} → ${lang}`);
    });

    socket.on('go-live', ({verse, theme, language, sessionId: rawSessionId}) => {
      const sessionId = activeSessionId || normalizeSessionId(rawSessionId) || DEFAULT_SESSION_ID;
      if (!ensurePresenterAccess(sessionId, socket)) return;
      console.log('go-live triggered', verse, theme, language, sessionId);
      
      let scriptureText = verse.scripture_text;
      let verseTitle = verse.book_title + ' ' + verse.chapter_number + ':' + verse.verse_number; 
      let bookTitle = verse.book_title;
      
      // Normalize language input
      const normalizedLanguage = language ? language.toLowerCase().trim() : null;
      
      // Determine target database with streamlined mapping
      let targetDb = db;
      const isTranslation = normalizedLanguage && ['ceb', 'tl'].includes(normalizedLanguage);
      if (isTranslation) {
        targetDb = normalizedLanguage === 'ceb' ? db_cebuano : db_tagalog;
      }

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
      
      const state = getSessionState(sessionId);
      state.liveVerse = verseWithSegments;
      state.highlightedText = '';
      state.updatedAt = Date.now();

      // Send only to clients in the same session
      emitToSession(sessionId, 'update-verse', verseWithSegments);
      emitToSession(sessionId, 'update-theme', theme);
    });

    socket.on('disconnecting', () => {
      if (socket.rooms && typeof socket.rooms.forEach === 'function') {
        socket.rooms.forEach((roomId) => {
          if (roomId !== socket.id) {
            releasePresenterLock(roomId, socket.id);
            if (activeRole !== 'presenter') decrementViewerCount(roomId);
            scheduleCleanup(roomId, { disconnecting: true });
          }
        });
      } else {
        releasePresenterLock(activeSessionId, socket.id);
        if (activeRole !== 'presenter') decrementViewerCount(activeSessionId);
        scheduleCleanup(activeSessionId, { disconnecting: true });
      }
    });

    socket.on('disconnect', () => {
      releasePresenterLock(activeSessionId, socket.id);
      scheduleCleanup(activeSessionId);
      console.log('user disconnected');
    });
  });
}

// Only register handlers in production runtime
if (require.main === module) {
  registerSocketHandlers(io, { segmentVerseText, db, db_cebuano, db_tagalog });
}

const start = async () => {
  try {
    const port = process.env.PORT || 3000 // default to 3095 if PORT is not set;
    await fastify.listen({ port, host: '0.0.0.0' })
    console.log(`Server running on ${port}`)
    // Initialize FTS in background so health checks can pass immediately.
    setImmediate(() => {
      initializeFts();
    });
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}


// only start the server if the file is run directly; this makes the module importable for tests
if (require.main === module) {
  start();
}

module.exports = { parseScriptureReference, searchScripture, segmentVerseText, fastify, registerSocketHandlers };