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

// Create an FTS5 virtual table for fast, relevance-aware scripture search
try {
  // Create FTS5 virtual table (simplified structure)
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS scriptures_fts USING fts5(
      verse_id UNINDEXED,
      scripture_text,
      verse_title,
      book_title,
      chapter_number UNINDEXED,
      verse_number UNINDEXED
    )
  `);
  fastify.log.info('FTS5 virtual table created');

  // Populate FTS table if empty
  const ftsCount = db.prepare('SELECT count(*) as c FROM scriptures_fts').get();
  fastify.log.info(`FTS5 table has ${ftsCount.c} verses`);
  
  if (!ftsCount || ftsCount.c === 0) {
    fastify.log.info('Populating FTS5 table from verses...');
    const insertStmt = db.prepare(`
      INSERT INTO scriptures_fts(verse_id, scripture_text, verse_title, book_title, chapter_number, verse_number)
      SELECT verses.id, verses.scripture_text, 
             (books.book_title || ' ' || chapters.chapter_number || ':' || verses.verse_number),
             books.book_title,
             chapters.chapter_number,
             verses.verse_number
      FROM verses
      JOIN chapters ON chapters.id = verses.chapter_id
      JOIN books ON books.id = chapters.book_id
    `);
    const result = insertStmt.run();
    fastify.log.info(`FTS5 table populated with ${result.changes} verses`);
  }
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
  'oa': 'Olive Garden Account' // Placeholder, adjust as needed
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

// Try to interpret simple scripture references like
// "John 3:16", "John 3", "1 Nephi 3", "1 Ne 3:2", "D&C 1:1" etc.  Returns an object or null.
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
const buildFTSMatchQuery = (input) => {
  if (!input) return '';
  const trimmed = input.trim();
  if (!trimmed) return '';
  const quoted = trimmed.match(/^"(.+)"$/);
  if (quoted) {
    // escape double quotes inside phrase
    return `"${quoted[1].replace(/"/g, '""')}"`;
  }
  const terms = trimmed.split(/\s+/).map(t => t.replace(/["']/g, ''))
    .filter(Boolean);
  if (terms.length === 0) return '';
  // Require all terms with AND for better precision
  return terms.map(t => t).join(' AND ');
};

const searchScripture = (input) => {
    // first, attempt to parse a structured reference
    const ref = parseScriptureReference(input);
    if (ref) {
        let sql = `
    SELECT
        volume_id,
        book_title,
        verse_id,
        chapter_number,
        verse_number,
        scripture_text,
        verse_title
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

// Fallback: phrase search using FTS5 across all text fields
const phraseSearch = (phrase) => {
  const terms = phrase.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  
  // Build FTS5 MATCH query across all relevant text fields with proper tokenization
  const query = terms.map(t => {
    const escaped = escapeFtsQuery(t);
    return `(
      book_title MATCH '${escaped}' OR 
      scripture_text MATCH '${escaped}' OR 
      verse_title MATCH '${escaped}'
    )`;
  }).join(' AND ');
  
  const sql = `
    SELECT
      volume_id,
      book_title,
      chapter_number,
      verse_number,
      scripture_text,
      verse_id,
      verse_title
    FROM scriptures_fts
    WHERE ${query}
    ORDER BY rank
    LIMIT 200
  `;
  
  try {
    const stmt = db.prepare(sql);
    return stmt.all();
  } catch (err) {
    fastify.log.error('FTS5 search failed', err);
    return [];
  }
};

// Helper to safely escape FTS5 query terms
const escapeFtsQuery = (term) => {
  return term
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map(t => `"${t}*"`)
    .join(' ');
};

// retrieve the next or previous verse within the same book & chapter
// direction should be 'next' or 'prev'
// retrieve the next or previous verse using sequential verse_id
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
    let verseTitle = verse.verse_title;
    let bookTitle = verse.book_title;
    
    // Normalize language parameter for reliable comparison
    const normalizedLanguage = language?.trim().toLowerCase();
    
    // Apply multi-language translation for Bible volumes per specification
    if (normalizedLanguage && ['ceb', 'tl'].includes(normalizedLanguage) && verse.volume_id) {
      // Bible volume: volume_id 1 (per specification)
      if (Number(verse.volume_id) === 1) {
        const targetDb = normalizedLanguage === 'ceb' ? db_cebuano : db_tagalog;
        const query = `
          SELECT scripture_text, verse_title, book_title
          FROM scriptures 
          WHERE verse_id = ?
        `;
        try {
          const stmt = targetDb.prepare(query);
          const result = stmt.get(Number(verse.verse_id));
          if (result) {
            if (result.scripture_text) scriptureText = result.scripture_text;
            if (result.verse_title) verseTitle = result.verse_title;
            if (result.book_title) bookTitle = result.book_title;
          }
        } catch (err) {
          fastify.log.error(`Failed to fetch ${normalizedLanguage} translation`, err);
        }
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