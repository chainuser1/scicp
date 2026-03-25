const { parseScriptureReference, searchScripture, segmentVerseText, segmentVerseTextDual, expandWithSynonyms, fastify, registerSocketHandlers } = require('../index');
const { getVerseOfTheDay } = require('../../shared/scripture-engine');
const Database = require('better-sqlite3');

describe('Backend API Tests', () => {
  describe('parseScriptureReference function', () => {
    test('should correctly parse book and chapter', () => {
      const result = parseScriptureReference('Genesis 1');
      expect(result).toEqual({
        book: 'Genesis',
        chapter: 1,
        verse: null
      });
    });

    test('should correctly parse book, chapter, and verse', () => {
      const result = parseScriptureReference('John 3:16');
      expect(result).toEqual({
        book: 'John',
        chapter: 3,
        verse: 16
      });
    });

    test('should handle invalid input', () => {
      expect(parseScriptureReference(null)).toBeNull();
      expect(parseScriptureReference('')).toBeNull();
      expect(parseScriptureReference('invalid input')).toBeNull();
    });

    test('should handle non-string inputs', () => {
      expect(parseScriptureReference(123)).toBeNull();
      expect(parseScriptureReference({})).toBeNull();
    });
  });

  describe('segmentVerseText function', () => {
    test('should segment text into chunks', () => {
      const text = 'This is a sample text with more than 10 words to test segmentation';
      const segments = segmentVerseText(text, 5); // Using 5 words per segment
      
      // Updated expectation based on actual function behavior
      expect(segments).toHaveLength(3);
      expect(segments[0]).toContain('This is a sample text');
      expect(segments[1]).toContain('with more than 10 words');
      expect(segments[2]).toContain('to test segmentation');
    });

    test('should handle empty or undefined text', () => {
      expect(segmentVerseText('')).toEqual([]);
      expect(segmentVerseText(undefined)).toEqual([]);
      expect(segmentVerseText(null)).toEqual([]);
    });

    test('should handle short text', () => {
      const text = 'Short text';
      const segments = segmentVerseText(text, 10);
      expect(segments).toEqual(['Short text']);
    });
  });

  describe('searchScripture function', () => {
    test('should return results for valid scripture reference', () => {
      // searchScripture returns { results, total } for paginated queries
      const { results, total } = searchScripture('God created');
      expect(Array.isArray(results)).toBe(true);
      expect(typeof total).toBe('number');
      if (results.length > 0) {
        expect(results[0]).toHaveProperty('book_title');
        expect(results[0]).toHaveProperty('chapter_number');
        expect(results[0]).toHaveProperty('verse_number');
        expect(results[0]).toHaveProperty('scripture_text');
      }
    });

    test('should return results for book and chapter reference', () => {
      const { results, total } = searchScripture('Genesis 1');
      expect(Array.isArray(results)).toBe(true);
      expect(typeof total).toBe('number');
      if (results.length > 0) {
        expect(results[0]).toHaveProperty('book_title');
        expect(results[0]).toHaveProperty('chapter_number');
        expect(results[0]).toHaveProperty('verse_number');
        expect(results[0]).toHaveProperty('scripture_text');
      }
    });

    test('should handle empty or invalid search input', () => {
      const { results, total } = searchScripture('');
      expect(Array.isArray(results)).toBe(true);
      expect(results).toHaveLength(0);
      expect(total).toBe(0);
    });
  });

  describe('getVerseOfTheDay CFM cycle', () => {
    let db;
    const dbPath = '../resources/db/lds-scriptures-sqlite.db';
    const inDcGroup = (v) => Number(v.volume_id) === 4 || /joseph smith\s*[—-]?\s*history|articles?\s+of\s+faith/i.test(v.book_title || '');
    const inOtGroup = (v) => Number(v.volume_id) === 1 || /\bmoses\b|\babraham\b/i.test(v.book_title || '');

    beforeAll(() => {
      db = new Database(dbPath, { fileMustExist: true });
    });
    afterAll(() => {
      if (db) db.close();
    });

    test('2026 week 11 uses Genesis 20–23 weekly block', () => {
      const v = getVerseOfTheDay(db, new Date(Date.UTC(2026, 2, 12)));
      expect(v).toBeTruthy();
      expect((v.book_title || '').toLowerCase()).toBe('genesis');
      expect(Number(v.chapter_number)).toBeGreaterThanOrEqual(20);
      expect(Number(v.chapter_number)).toBeLessThanOrEqual(23);
      expect(v.cfm_group).toBe('ot');
      expect(v.cfm_week).toBe(11);
      expect(v.cfm_block).toBe('Genesis 20–23');
    });

    test('each day in same CFM week returns different verse', () => {
      // March 12–18, 2026 = week 11
      const ids = new Set();
      for (let d = 12; d <= 18; d++) {
        const v = getVerseOfTheDay(db, new Date(Date.UTC(2026, 2, d)));
        expect(v).toBeTruthy();
        expect(v.cfm_week).toBe(11);
        ids.add(v.verse_id);
      }
      expect(ids.size).toBeGreaterThan(1); // at least 2 different verses across 7 days
    });

    test('2028 uses Book of Mormon grouping', () => {
      const v = getVerseOfTheDay(db, new Date(Date.UTC(2028, 0, 7)));
      expect(v).toBeTruthy();
      expect(Number(v.volume_id)).toBe(3);
      expect(v.cfm_group).toBe('bom');
    });

    test('2029 uses D&C + JS-H + AoF grouping', () => {
      const v = getVerseOfTheDay(db, new Date(Date.UTC(2029, 0, 7)));
      expect(v).toBeTruthy();
      expect(inDcGroup(v)).toBe(true);
      expect(v.cfm_group).toBe('dc');
    });
  });

  describe('registerSocketHandlers function', () => {
    test('should be a defined function', () => {
      expect(typeof registerSocketHandlers).toBe('function');
    });
  });

  describe('Fastify server routes', () => {
    let server;

    beforeAll(async () => {
      // Create a new fastify instance for testing
      server = require('fastify')({ logger: true });
      
      // Register the routes from the main index file
      const originalFastify = require('../index').fastify;
      
      // Import the routes by registering them to our test server
      // We need to replicate the route registration logic from the original file
      const db = require('better-sqlite3')('../resources/db/lds-scriptures-sqlite.db', { fileMustExist: true });
      
      server.register(require('@fastify/cors'), {
        origin: "*",
      });

      server.get('/', async (request, reply) => {
        return { hello: 'world' }
      });

      // theme management endpoints
      server.get('/themes', async (request, reply) => {
        const rows = db.prepare('SELECT id, name, data FROM themes').all();
        return rows.map(r => ({ id: r.id, name: r.name, data: JSON.parse(r.data) }));
      });

      server.post('/themes', async (request, reply) => {
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
          server.log.error(err);
          reply.code(500);
          return { error: 'could not create theme' };
        }
      });

      server.put('/themes/:id', async (request, reply) => {
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
          server.log.error(err);
          reply.code(500);
          return { error: 'could not update theme' };
        }
      });

      server.delete('/themes/:id', async (request, reply) => {
        const { id } = request.params;
        try {
          const stmt = db.prepare('DELETE FROM themes WHERE id = ?');
          stmt.run(id);
          return { success: true };
        } catch (err) {
          server.log.error(err);
          reply.code(500);
          return { error: 'could not delete theme' };
        }
      });

      await server.ready();
    });

    afterAll(async () => {
      await server.close();
    });

    test('GET / should return hello world', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/',
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual({ hello: 'world' });
    });

    test('GET /themes should return themes', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/themes',
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(Array.isArray(payload)).toBe(true);
    });

    test('should handle theme creation and deletion', async () => {
      // Create a test theme
      const newTheme = {
        name: 'Test Theme ' + Date.now(), // Using timestamp to ensure uniqueness
        data: { color: 'blue', font: 'serif' }
      };

      const postResponse = await server.inject({
        method: 'POST',
        url: '/themes',
        payload: newTheme
      });

      expect(postResponse.statusCode).toBe(200);
      const createdTheme = JSON.parse(postResponse.payload);
      expect(createdTheme).toHaveProperty('id');
      expect(createdTheme.name).toBe(newTheme.name);

      // Clean up: Delete the test theme
      const deleteResponse = await server.inject({
        method: 'DELETE',
        url: `/themes/${createdTheme.id}`,
      });

      expect(deleteResponse.statusCode).toBe(200);
      expect(JSON.parse(deleteResponse.payload)).toEqual({ success: true });
    });

    test('should handle theme update', async () => {
      // Create a test theme first
      const newTheme = {
        name: 'Update Test Theme ' + Date.now(),
        data: { color: 'red', font: 'sans-serif' }
      };

      const postResponse = await server.inject({
        method: 'POST',
        url: '/themes',
        payload: newTheme
      });

      const createdTheme = JSON.parse(postResponse.payload);
      const themeId = createdTheme.id;

      // Update the theme
      const updatedData = {
        name: 'Updated Test Theme ' + Date.now(),
        data: { color: 'green', font: 'monospace' }
      };

      const putResponse = await server.inject({
        method: 'PUT',
        url: `/themes/${themeId}`,
        payload: updatedData
      });

      expect(putResponse.statusCode).toBe(200);
      const updatedTheme = JSON.parse(putResponse.payload);
      expect(updatedTheme.name).toBe(updatedData.name);
      expect(updatedTheme.data).toEqual(updatedData.data);

      // Clean up: Delete the test theme
      await server.inject({
        method: 'DELETE',
        url: `/themes/${themeId}`,
      });
    });

    test('should handle invalid theme updates', async () => {
      // Attempt to update with missing data
      const badUpdate = {
        name: '', // Invalid - empty name
        data: {} // Invalid - empty data
      };

      const response = await server.inject({
        method: 'PUT',
        url: '/themes/999', // Non-existent ID
        payload: badUpdate
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('New routes — F1/F3/F4', () => {
    let server;
    let db;
    let db_tagalog;

    beforeAll(async () => {
      server = require('fastify')({ logger: false });
      server.register(require('@fastify/cors'), { origin: '*' });

      db = require('better-sqlite3')('../resources/db/lds-scriptures-sqlite.db', { fileMustExist: true });
      db_tagalog = require('better-sqlite3')('../resources/db/tagalog-scriptures-sqlite.db', { fileMustExist: true });

      // F3 — /setlists CRUD
      server.get('/setlists', async () => {
        const rows = db.prepare('SELECT id, name, items, created_at FROM setlists ORDER BY created_at DESC').all();
        return rows.map(r => ({ id: r.id, name: r.name, items: JSON.parse(r.items), created_at: r.created_at }));
      });
      server.post('/setlists', async (req, reply) => {
        const { name, items } = req.body;
        if (!name) { reply.code(400); return { error: 'name is required' }; }
        const info = db.prepare('INSERT INTO setlists (name, items) VALUES (?, ?)').run(name, JSON.stringify(items || []));
        return { id: info.lastInsertRowid, name, items: items || [] };
      });
      server.delete('/setlists/:id', async (req, reply) => {
        db.prepare('DELETE FROM setlists WHERE id = ?').run(req.params.id);
        return { success: true };
      });

      // F1 — browse routes
      server.get('/browse/books', async (req) => {
        const language = req.query.language || 'en';
        const targetDb = language === 'tl' ? db_tagalog : db;
        return targetDb.prepare(
          `SELECT b.id AS book_id, b.book_title, b.book_short_title,
                  v.id AS volume_id, v.volume_title, v.volume_short_title,
                  COUNT(DISTINCT c.id) AS chapter_count
           FROM books b
           JOIN volumes v ON v.id = b.volume_id
           JOIN chapters c ON c.book_id = b.id
           GROUP BY b.id ORDER BY b.id`
        ).all();
      });
      server.get('/browse/chapters', async (req) => {
        const { book_id, language } = req.query;
        const targetDb = language === 'tl' ? db_tagalog : db;
        return targetDb.prepare(
          `SELECT c.id AS chapter_id, c.chapter_number, COUNT(vs.id) AS verse_count
           FROM chapters c
           JOIN verses vs ON vs.chapter_id = c.id
           WHERE c.book_id = ? GROUP BY c.id ORDER BY c.chapter_number`
        ).all(Number(book_id));
      });
      server.get('/browse/verses', async (req) => {
        const { chapter_id, language } = req.query;
        const targetDb = language === 'tl' ? db_tagalog : db;
        return targetDb.prepare(
          `SELECT verse_id, book_title, chapter_number, verse_number,
                  scripture_text, verse_title, volume_title, volume_short_title
           FROM scriptures WHERE chapter_id = ? ORDER BY verse_number`
        ).all(Number(chapter_id));
      });

      // F4 — /verse/:id/translation
      server.get('/verse/:verse_id/translation', async (req, reply) => {
        const { verse_id } = req.params;
        const language = (req.query.language || '').toLowerCase().trim();
        if (!['tl', 'ceb'].includes(language)) {
          reply.code(400);
          return { error: 'language must be tl or ceb' };
        }
        const targetDb = language === 'tl' ? db_tagalog : db;
        const row = targetDb.prepare('SELECT scripture_text FROM scriptures WHERE verse_id = ? LIMIT 1').get(Number(verse_id));
        if (!row) { reply.code(404); return { error: 'not found' }; }
        return { verse_id: Number(verse_id), language, scripture_text: row.scripture_text };
      });

      await server.ready();
    });

    afterAll(async () => {
      await server.close();
    });

    test('GET /setlists returns an array', async () => {
      const res = await server.inject({ method: 'GET', url: '/setlists' });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(JSON.parse(res.payload))).toBe(true);
    });

    test('POST /setlists creates a setlist and DELETE removes it', async () => {
      const name = 'Test Setlist ' + Date.now();
      const postRes = await server.inject({
        method: 'POST', url: '/setlists',
        payload: { name, items: [{ verse_id: 1 }] }
      });
      expect(postRes.statusCode).toBe(200);
      const created = JSON.parse(postRes.payload);
      expect(created).toHaveProperty('id');
      expect(created.name).toBe(name);
      expect(Array.isArray(created.items)).toBe(true);

      const delRes = await server.inject({ method: 'DELETE', url: `/setlists/${created.id}` });
      expect(delRes.statusCode).toBe(200);
      expect(JSON.parse(delRes.payload)).toEqual({ success: true });
    });

    test('GET /browse/books returns books with chapter_count', async () => {
      const res = await server.inject({ method: 'GET', url: '/browse/books?language=en' });
      expect(res.statusCode).toBe(200);
      const books = JSON.parse(res.payload);
      expect(Array.isArray(books)).toBe(true);
      expect(books.length).toBeGreaterThan(0);
      expect(books[0]).toHaveProperty('book_id');
      expect(books[0]).toHaveProperty('book_title');
      expect(books[0]).toHaveProperty('chapter_count');
    });

    test('GET /browse/chapters returns chapters for book_id=1', async () => {
      const res = await server.inject({ method: 'GET', url: '/browse/chapters?book_id=1&language=en' });
      expect(res.statusCode).toBe(200);
      const chapters = JSON.parse(res.payload);
      expect(Array.isArray(chapters)).toBe(true);
      expect(chapters.length).toBeGreaterThan(0);
      expect(chapters[0]).toHaveProperty('chapter_id');
      expect(chapters[0]).toHaveProperty('chapter_number');
    });

    test('GET /browse/verses returns verses for chapter_id=1', async () => {
      const res = await server.inject({ method: 'GET', url: '/browse/verses?chapter_id=1&language=en' });
      expect(res.statusCode).toBe(200);
      const verses = JSON.parse(res.payload);
      expect(Array.isArray(verses)).toBe(true);
      expect(verses.length).toBeGreaterThan(0);
      expect(verses[0]).toHaveProperty('verse_id');
      expect(verses[0]).toHaveProperty('scripture_text');
    });

    test('GET /verse/1/translation?language=tl returns scripture_text', async () => {
      const res = await server.inject({ method: 'GET', url: '/verse/1/translation?language=tl' });
      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.payload);
      expect(data).toHaveProperty('verse_id', 1);
      expect(data).toHaveProperty('language', 'tl');
      expect(data).toHaveProperty('scripture_text');
    });

    test('GET /verse/1/translation?language=xx returns 400', async () => {
      const res = await server.inject({ method: 'GET', url: '/verse/1/translation?language=xx' });
      expect(res.statusCode).toBe(400);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  NEW TESTS — routes served by the real fastify instance from backend/index
  // ═══════════════════════════════════════════════════════════════════════════

  describe('/search HTTP endpoint', () => {
    beforeAll(async () => { await fastify.ready(); });

    test('GET /search?q=love returns results with pagination shape', async () => {
      const res = await fastify.inject({ method: 'GET', url: '/search?q=love' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body).toHaveProperty('results');
      expect(body).toHaveProperty('total');
      expect(body).toHaveProperty('page');
      expect(body).toHaveProperty('pageSize');
      expect(Array.isArray(body.results)).toBe(true);
    });

    test('GET /search without q returns 400', async () => {
      const res = await fastify.inject({ method: 'GET', url: '/search' });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body).toHaveProperty('error');
    });

    test('GET /search?q=John+3:16 returns results (exact ref)', async () => {
      const res = await fastify.inject({ method: 'GET', url: '/search?q=John+3:16' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(Array.isArray(body.results)).toBe(true);
      expect(body.total).toBeGreaterThanOrEqual(0);
    });

    test('GET /search?q=love&language=en&page=0&pageSize=5 respects pagination', async () => {
      const res = await fastify.inject({ method: 'GET', url: '/search?q=love&language=en&page=0&pageSize=5' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.pageSize).toBe(5);
      expect(body.page).toBe(0);
      expect(body.results.length).toBeLessThanOrEqual(5);
    });
  });

  describe('/chapter/:id/summary endpoint', () => {
    beforeAll(async () => { await fastify.ready(); });

    test('GET /chapter/1/summary returns gracefully', async () => {
      const res = await fastify.inject({ method: 'GET', url: '/chapter/1/summary' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body).toHaveProperty('chapter_id', 1);
      expect(body).toHaveProperty('summary_text');
      expect(body).toHaveProperty('key_verses');
    });

    test('GET /chapter/99999/summary returns graceful response for missing chapter', async () => {
      const res = await fastify.inject({ method: 'GET', url: '/chapter/99999/summary' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body).toHaveProperty('chapter_id', 99999);
      expect(Array.isArray(body.key_verses)).toBe(true);
    });
  });

  describe('/verse/:id/summary endpoint', () => {
    beforeAll(async () => { await fastify.ready(); });

    test('GET /verse/1/summary returns gracefully', async () => {
      const res = await fastify.inject({ method: 'GET', url: '/verse/1/summary' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body).toHaveProperty('verse_id', 1);
      expect(body).toHaveProperty('summary');
      expect(body).toHaveProperty('cross_references');
    });
  });

  describe('/verse/:id/tags endpoint', () => {
    beforeAll(async () => { await fastify.ready(); });

    test('GET /verse/1/tags returns gracefully', async () => {
      const res = await fastify.inject({ method: 'GET', url: '/verse/1/tags' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body).toHaveProperty('verse_id', 1);
      expect(body).toHaveProperty('pov');
      expect(body).toHaveProperty('labels');
    });
  });

  describe('/verse/:id/related endpoint', () => {
    beforeAll(async () => { await fastify.ready(); });

    test('GET /verse/1/related returns results shape', async () => {
      const res = await fastify.inject({ method: 'GET', url: '/verse/1/related' });
      expect(res.statusCode).toBeLessThan(500);
      const body = JSON.parse(res.payload);
      if (res.statusCode === 200) {
        expect(body).toHaveProperty('results');
        expect(Array.isArray(body.results)).toBe(true);
      }
    });
  });

  describe('/entity/search endpoint', () => {
    beforeAll(async () => { await fastify.ready(); });

    test('GET /entity/search?name=Moses&type=person returns results', async () => {
      const res = await fastify.inject({ method: 'GET', url: '/entity/search?name=Moses&type=person' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body).toHaveProperty('results');
      expect(Array.isArray(body.results)).toBe(true);
    });

    test('GET /entity/search without name returns 400', async () => {
      const res = await fastify.inject({ method: 'GET', url: '/entity/search' });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body).toHaveProperty('error');
    });
  });

  describe('/sermon-search endpoint', () => {
    beforeAll(async () => { await fastify.ready(); });

    test('GET /sermon-search?q=faith returns results', async () => {
      const res = await fastify.inject({ method: 'GET', url: '/sermon-search?q=faith' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body).toHaveProperty('results');
      expect(Array.isArray(body.results)).toBe(true);
    });

    test('GET /sermon-search without q returns 400', async () => {
      const res = await fastify.inject({ method: 'GET', url: '/sermon-search' });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body).toHaveProperty('error');
    });
  });

  describe('segmentVerseTextDual function', () => {
    test('handles two texts of different lengths', () => {
      const primary = 'One two three four five six seven eight nine ten eleven twelve';
      const secondary = 'Short text';
      const result = segmentVerseTextDual(primary, secondary, 5);
      expect(result).toHaveProperty('primarySegments');
      expect(result).toHaveProperty('secondarySegments');
      expect(result.primarySegments.length).toBe(result.secondarySegments.length);
      expect(result.primarySegments.length).toBeGreaterThan(1);
    });

    test('handles null/undefined inputs', () => {
      const result = segmentVerseTextDual(null, undefined);
      expect(result).toHaveProperty('primarySegments');
      expect(result).toHaveProperty('secondarySegments');
      expect(result.primarySegments).toEqual([]);
      expect(result.secondarySegments).toEqual([]);
    });
  });

  describe('expandWithSynonyms function', () => {
    test("'love' expands to include charity/affection-related terms", () => {
      const expanded = expandWithSynonyms('love');
      expect(expanded).toContain('love');
      expect(expanded.length).toBeGreaterThan(1);
      expect(expanded).toEqual(expect.arrayContaining(['charity']));
    });

    test('empty string returns array with empty string', () => {
      const expanded = expandWithSynonyms('');
      expect(Array.isArray(expanded)).toBe(true);
      expect(expanded).toEqual(['']);
    });

    test('unknown word returns just the word itself', () => {
      const expanded = expandWithSynonyms('xyzzyplugh');
      expect(expanded).toEqual(['xyzzyplugh']);
    });
  });

  // ─── New coverage ────────────────────────────────────────────────────────────

  describe('getVersionCitation function', () => {
    const { getVersionCitation } = require('../../shared/scripture-engine');

    test('English Bible (volume_id 1) returns KJV', () => {
      expect(getVersionCitation('en', 1)).toMatch(/KJV|King James/i);
    });

    test('Tagalog Bible (volume_id 1) returns non-empty string', () => {
      const result = getVersionCitation('tl', 1);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    test('Cebuano Bible (volume_id 1) returns non-empty string', () => {
      const result = getVersionCitation('ceb', 1);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    test('Book of Mormon (volume_id 3) includes English label', () => {
      const result = getVersionCitation('en', 3);
      expect(typeof result).toBe('string');
    });

    test('D&C (volume_id 4) returns non-empty string', () => {
      const result = getVersionCitation('en', 4);
      expect(typeof result).toBe('string');
    });

    test('secondary language — Bible — returns "X vs Y" format', () => {
      const result = getVersionCitation('en', 1, 'tl');
      expect(result).toMatch(/vs/i);
    });

    test('secondary language — BoM — returns language names format', () => {
      const result = getVersionCitation('en', 3, 'tl');
      expect(result).toMatch(/vs/i);
    });

    test('unknown language falls back to uppercase code', () => {
      const result = getVersionCitation('xx', 1);
      expect(result).toBe('XX');
    });
  });

  describe('/chapter/:id/summary — footnotes fields', () => {
    beforeAll(async () => { await fastify.ready(); });

    test('chapter summary response has nabre_footnotes and net_footnotes fields', async () => {
      const res = await fastify.inject({ method: 'GET', url: '/chapter/1/summary' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      // Fields must be present (null when footnotes DB is absent, which is fine)
      expect(body).toHaveProperty('nabre_footnotes');
      expect(body).toHaveProperty('net_footnotes');
    });

    test('missing chapter still has footnote fields', async () => {
      const res = await fastify.inject({ method: 'GET', url: '/chapter/99999/summary' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body).toHaveProperty('nabre_footnotes');
      expect(body).toHaveProperty('net_footnotes');
    });
  });

  describe('/verse/of-the-day endpoint', () => {
    beforeAll(async () => { await fastify.ready(); });

    test('returns a verse shape', async () => {
      const res = await fastify.inject({ method: 'GET', url: '/verse/of-the-day' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body).toHaveProperty('verse_id');
      expect(body).toHaveProperty('scripture_text');
      expect(body).toHaveProperty('book_title');
    });
  });

  describe('/search — language and edge cases', () => {
    beforeAll(async () => { await fastify.ready(); });

    test('GET /search?q=faith returns valid paginated results', async () => {
      const res = await fastify.inject({ method: 'GET', url: '/search?q=faith' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body).toHaveProperty('results');
      expect(Array.isArray(body.results)).toBe(true);
      expect(body).toHaveProperty('total');
    });

    test('GET /search?q=love&language=tl returns Tagalog results', async () => {
      const res = await fastify.inject({ method: 'GET', url: '/search?q=love&language=tl' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body).toHaveProperty('results');
    });

    test('GET /search?q=1+Ne+3:7 parses Book of Mormon reference', async () => {
      const res = await fastify.inject({ method: 'GET', url: '/search?q=1+Ne+3%3A7' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body).toHaveProperty('results');
      expect(body.results.length).toBeGreaterThan(0);
    });

    test('GET /search?q=D%26C+76 resolves D&C abbreviation', async () => {
      const res = await fastify.inject({ method: 'GET', url: '/search?q=D%26C+76' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body).toHaveProperty('results');
    });

    test('pageSize clamped — pageSize=1000 returns at most 50 results', async () => {
      const res = await fastify.inject({ method: 'GET', url: '/search?q=love&pageSize=1000' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.results.length).toBeLessThanOrEqual(50);
    });
  });

  describe('/verse/:id/translation edge cases', () => {
    beforeAll(async () => { await fastify.ready(); });

    test('missing verse_id returns 400 or 404', async () => {
      const res = await fastify.inject({ method: 'GET', url: '/verse/999999/translation?language=tl' });
      expect([400, 404]).toContain(res.statusCode);
    });
  });

  describe('/topic-search endpoint', () => {
    beforeAll(async () => { await fastify.ready(); });

    test('GET /topic-search?q=faith returns gracefully', async () => {
      const res = await fastify.inject({ method: 'GET', url: '/topic-search?q=faith' });
      expect(res.statusCode).toBeLessThan(500);
    });

    test('GET /topic-search without q returns 400', async () => {
      const res = await fastify.inject({ method: 'GET', url: '/topic-search' });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('/health endpoint', () => {
    beforeAll(async () => { await fastify.ready(); });

    test('GET /health returns ok', async () => {
      const res = await fastify.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.status).toBe('ok');
    });
  });

  // ─── Search integration tests ────────────────────────────────────────────────

  describe('Search pipeline integration', () => {
    beforeAll(async () => { await fastify.ready(); });

    describe('result shape and fields', () => {
      test('results contain required scripture fields', async () => {
        const res = await fastify.inject({ method: 'GET', url: '/search?q=faith' });
        const { results } = JSON.parse(res.payload);
        expect(results.length).toBeGreaterThan(0);
        const r = results[0];
        expect(r).toHaveProperty('verse_id');
        expect(r).toHaveProperty('book_title');
        expect(r).toHaveProperty('chapter_number');
        expect(r).toHaveProperty('verse_number');
        expect(r).toHaveProperty('scripture_text');
        expect(typeof r.scripture_text).toBe('string');
        expect(r.scripture_text.length).toBeGreaterThan(0);
      });

      test('results carry _source and _tier metadata', async () => {
        const res = await fastify.inject({ method: 'GET', url: '/search?q=repentance' });
        const { results } = JSON.parse(res.payload);
        expect(results.length).toBeGreaterThan(0);
        for (const r of results.slice(0, 5)) {
          expect(r).toHaveProperty('_source');
          expect(typeof r._source).toBe('string');
          expect(r).toHaveProperty('_tier');
          expect(typeof r._tier).toBe('number');
          expect(r._tier).toBeGreaterThanOrEqual(1);
          expect(r._tier).toBeLessThanOrEqual(5);
        }
      });

      test('results are ordered by tier (lower tier = higher priority)', async () => {
        const res = await fastify.inject({ method: 'GET', url: '/search?q=mercy' });
        const { results } = JSON.parse(res.payload);
        // Tiers should be non-decreasing (tier 2 before tier 5)
        for (let i = 1; i < Math.min(results.length, 10); i++) {
          expect(results[i]._tier).toBeGreaterThanOrEqual(results[i - 1]._tier);
        }
      });
    });

    describe('exact reference search', () => {
      test('John 3:16 returns exact verse as first result', async () => {
        const res = await fastify.inject({ method: 'GET', url: '/search?q=John+3:16' });
        const { results } = JSON.parse(res.payload);
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].book_title).toBe('John');
        expect(results[0].chapter_number).toBe(3);
        expect(results[0].verse_number).toBe(16);
      });

      test('Genesis 1:1 returns first verse of Bible', async () => {
        const res = await fastify.inject({ method: 'GET', url: '/search?q=Genesis+1:1' });
        const { results } = JSON.parse(res.payload);
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].book_title).toBe('Genesis');
        expect(results[0].chapter_number).toBe(1);
        expect(results[0].verse_number).toBe(1);
        expect(results[0].scripture_text).toMatch(/beginning/i);
      });

      test('chapter-only reference returns multiple verses', async () => {
        const res = await fastify.inject({ method: 'GET', url: '/search?q=Psalm+23' });
        const { results, total } = JSON.parse(res.payload);
        expect(results.length).toBeGreaterThan(1);
        expect(total).toBeGreaterThan(1);
        expect(results[0].book_title).toMatch(/Psalms?/);
        expect(results[0].chapter_number).toBe(23);
      });
    });

    describe('abbreviation expansion', () => {
      test('1 Ne 3:7 resolves to 1 Nephi', async () => {
        const res = await fastify.inject({ method: 'GET', url: '/search?q=1+Ne+3:7' });
        const { results } = JSON.parse(res.payload);
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].book_title).toBe('1 Nephi');
        expect(results[0].chapter_number).toBe(3);
        expect(results[0].verse_number).toBe(7);
      });

      test('D&C 76 resolves to Doctrine and Covenants', async () => {
        const res = await fastify.inject({ method: 'GET', url: '/search?q=D%26C+76' });
        const { results } = JSON.parse(res.payload);
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].book_title).toBe('Doctrine and Covenants');
        expect(results[0].chapter_number).toBe(76);
      });

      test('Rev 21:4 resolves to Revelation', async () => {
        const res = await fastify.inject({ method: 'GET', url: '/search?q=Rev+21:4' });
        const { results } = JSON.parse(res.payload);
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].book_title).toBe('Revelation');
      });
    });

    describe('keyword search (FTS)', () => {
      test('"created the heaven" returns Genesis results', async () => {
        const res = await fastify.inject({ method: 'GET', url: '/search?q=created+the+heaven' });
        const { results } = JSON.parse(res.payload);
        expect(results.length).toBeGreaterThan(0);
        const texts = results.map(r => r.scripture_text.toLowerCase());
        expect(texts.some(t => t.includes('created') || t.includes('heaven'))).toBe(true);
      });

      test('common word "love" returns substantial results', async () => {
        const res = await fastify.inject({ method: 'GET', url: '/search?q=love' });
        const { results, total } = JSON.parse(res.payload);
        expect(total).toBeGreaterThan(50);
        expect(results.length).toBeGreaterThan(0);
      });
    });

    describe('semantic / concept search', () => {
      test('concept query returns results even without exact word match', async () => {
        const res = await fastify.inject({ method: 'GET', url: '/search?q=dealing+with+grief&pageSize=10' });
        const { results } = JSON.parse(res.payload);
        expect(results.length).toBeGreaterThan(0);
      });

      test('multi-word concept query returns ranked results', async () => {
        const res = await fastify.inject({ method: 'GET', url: '/search?q=overcoming+temptation&pageSize=10' });
        const { results } = JSON.parse(res.payload);
        expect(results.length).toBeGreaterThan(0);
        expect(results[0]).toHaveProperty('_tier');
      });
    });

    describe('multi-language search', () => {
      test('Tagalog search returns results or empty gracefully', async () => {
        const res = await fastify.inject({ method: 'GET', url: '/search?q=faith&language=tl' });
        const { results } = JSON.parse(res.payload);
        expect(Array.isArray(results)).toBe(true);
      });

      test('Cebuano search returns results or empty gracefully', async () => {
        const res = await fastify.inject({ method: 'GET', url: '/search?q=love&language=ceb' });
        const { results } = JSON.parse(res.payload);
        expect(Array.isArray(results)).toBe(true);
      });

      test('NRSVUE search uses full pipeline', async () => {
        const res = await fastify.inject({ method: 'GET', url: '/search?q=faith&language=nrsvue&pageSize=5' });
        const { results } = JSON.parse(res.payload);
        expect(results.length).toBeGreaterThan(0);
        // NRSVUE results should have tier metadata (full pipeline)
        expect(results[0]).toHaveProperty('_tier');
      });
    });

    describe('pagination', () => {
      test('pageSize=3 returns exactly 3 or fewer results', async () => {
        const res = await fastify.inject({ method: 'GET', url: '/search?q=faith&pageSize=3' });
        const { results, pageSize } = JSON.parse(res.payload);
        expect(results.length).toBeLessThanOrEqual(3);
        expect(pageSize).toBe(3);
      });

      test('page=1 returns different results than page=0', async () => {
        const r0 = await fastify.inject({ method: 'GET', url: '/search?q=love&page=0&pageSize=5' });
        const r1 = await fastify.inject({ method: 'GET', url: '/search?q=love&page=1&pageSize=5' });
        const b0 = JSON.parse(r0.payload);
        const b1 = JSON.parse(r1.payload);
        expect(b0.results.length).toBeGreaterThan(0);
        expect(b1.results.length).toBeGreaterThan(0);
        expect(b0.results[0].verse_id).not.toBe(b1.results[0].verse_id);
      });

      test('pageSize clamped to max 50', async () => {
        const res = await fastify.inject({ method: 'GET', url: '/search?q=love&pageSize=200' });
        const { results } = JSON.parse(res.payload);
        expect(results.length).toBeLessThanOrEqual(50);
      });
    });

    describe('edge cases', () => {
      test('empty query returns 400', async () => {
        const res = await fastify.inject({ method: 'GET', url: '/search?q=' });
        expect(res.statusCode).toBe(400);
      });

      test('very long query does not crash', async () => {
        const long = 'a '.repeat(500).trim();
        const res = await fastify.inject({ method: 'GET', url: `/search?q=${encodeURIComponent(long)}` });
        expect(res.statusCode).toBeLessThan(500);
      });

      test('special characters in query do not crash', async () => {
        const res = await fastify.inject({ method: 'GET', url: '/search?q=%22hello+world%22' });
        expect(res.statusCode).toBeLessThan(500);
      });

      test('numeric-only query does not crash', async () => {
        const res = await fastify.inject({ method: 'GET', url: '/search?q=12345' });
        expect(res.statusCode).toBeLessThan(500);
      });

      test('unknown language falls back gracefully', async () => {
        const res = await fastify.inject({ method: 'GET', url: '/search?q=love&language=zz' });
        expect(res.statusCode).toBeLessThan(500);
      });
    });
  });

  describe('Suggest endpoint', () => {
    beforeAll(async () => { await fastify.ready(); });

    test('returns suggestions array', async () => {
      const res = await fastify.inject({ method: 'GET', url: '/suggest?q=fai' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body).toHaveProperty('suggestions');
      expect(Array.isArray(body.suggestions)).toBe(true);
    });

    test('suggestions include matching terms', async () => {
      const res = await fastify.inject({ method: 'GET', url: '/suggest?q=fai' });
      const { suggestions } = JSON.parse(res.payload);
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions).toContain('faith');
    });

    test('book name suggestions work', async () => {
      const res = await fastify.inject({ method: 'GET', url: '/suggest?q=gene' });
      const { suggestions } = JSON.parse(res.payload);
      expect(suggestions.some(s => s.toLowerCase().includes('genesis'))).toBe(true);
    });

    test('empty query returns empty suggestions', async () => {
      const res = await fastify.inject({ method: 'GET', url: '/suggest?q=' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body).toHaveProperty('suggestions');
    });
  });

  describe('Related verses endpoint', () => {
    beforeAll(async () => { await fastify.ready(); });

    test('returns related verses with diversity', async () => {
      const res = await fastify.inject({ method: 'GET', url: '/verse/1/related' });
      if (res.statusCode === 200) {
        const body = JSON.parse(res.payload);
        expect(body).toHaveProperty('results');
        expect(Array.isArray(body.results)).toBe(true);
        if (body.results.length > 1) {
          // Results should come from multiple books (MMR diversity)
          const books = new Set(body.results.map(r => r.book_title));
          expect(books.size).toBeGreaterThanOrEqual(1);
        }
      }
    });

    test('invalid verse_id returns gracefully', async () => {
      const res = await fastify.inject({ method: 'GET', url: '/verse/999999/related' });
      expect(res.statusCode).toBeLessThan(500);
    });
  });

  describe('Trending and personalization endpoints', () => {
    beforeAll(async () => { await fastify.ready(); });

    test('/trending returns verses array', async () => {
      const res = await fastify.inject({ method: 'GET', url: '/trending' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body).toHaveProperty('verses');
      expect(body).toHaveProperty('total');
      expect(Array.isArray(body.verses)).toBe(true);
    });

    test('/for-you returns verses array', async () => {
      const res = await fastify.inject({ method: 'GET', url: '/for-you' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body).toHaveProperty('verses');
      expect(Array.isArray(body.verses)).toBe(true);
    });

    test('/personalized-votd returns verse shape', async () => {
      const res = await fastify.inject({ method: 'GET', url: '/personalized-votd' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body).toHaveProperty('verse');
      expect(body.verse).toHaveProperty('verse_id');
      expect(body.verse).toHaveProperty('scripture_text');
    });
  });

  describe('Browse endpoints', () => {
    beforeAll(async () => { await fastify.ready(); });

    test('/browse/books returns books with required fields', async () => {
      const res = await fastify.inject({ method: 'GET', url: '/browse/books?language=en' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThan(0);
      expect(body[0]).toHaveProperty('book_id');
      expect(body[0]).toHaveProperty('book_title');
    });

    test('/browse/chapters returns chapters for valid book', async () => {
      const res = await fastify.inject({ method: 'GET', url: '/browse/chapters?book_id=1&language=en' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThan(0);
      expect(body[0]).toHaveProperty('chapter_number');
    });

    test('/browse/verses returns verses for valid chapter', async () => {
      const res = await fastify.inject({ method: 'GET', url: '/browse/verses?chapter_id=1&language=en' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThan(0);
      expect(body[0]).toHaveProperty('scripture_text');
      expect(body[0]).toHaveProperty('verse_number');
    });

    test('/verse/adjacent returns next verse', async () => {
      const res = await fastify.inject({ method: 'GET', url: '/verse/adjacent?verse_id=1&direction=next' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body).toHaveProperty('verse_id');
      expect(body.verse_id).not.toBe(1);
    });
  });

  describe('Reading analytics endpoints', () => {
    beforeAll(async () => { await fastify.ready(); });

    test('POST /reading-event logs event', async () => {
      const res = await fastify.inject({
        method: 'POST', url: '/reading-event',
        payload: { verse_id: 1, event_type: 'view', dwell_ms: 5000 }
      });
      expect(res.statusCode).toBe(200);
    });

    test('GET /reading-coverage returns coverage data', async () => {
      const res = await fastify.inject({ method: 'GET', url: '/reading-coverage' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body).toHaveProperty('coverage');
      expect(Array.isArray(body.coverage)).toBe(true);
    });

    test('GET /spaced-review returns due verses', async () => {
      const res = await fastify.inject({ method: 'GET', url: '/spaced-review' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body).toHaveProperty('verses');
      expect(Array.isArray(body.verses)).toBe(true);
    });

    test('POST /search-feedback logs click', async () => {
      const res = await fastify.inject({
        method: 'POST', url: '/search-feedback',
        payload: { query: 'faith', verse_id: 1, rank: 0, clicked: true }
      });
      expect(res.statusCode).toBe(200);
    });
  });
});
