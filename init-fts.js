const db = require('better-sqlite3')('./resources/db/lds-scriptures-sqlite.db');

console.log('=== Setting up FTS5 Search ===\n');

try {
  // Drop old FTS table if it exists
  db.exec('DROP TABLE IF EXISTS scriptures_fts');
  console.log('✓ Dropped old FTS5 table');

  // Create FTS5 virtual table (without external content)
  db.exec(`
    CREATE VIRTUAL TABLE scriptures_fts USING fts5(
      verse_id UNINDEXED,
      scripture_text,
      verse_title,
      book_title,
      chapter_number UNINDEXED,
      verse_number UNINDEXED
    )
  `);
  console.log('✓ Created FTS5 virtual table');

  // Populate FTS table
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
  console.log(`✓ Populated FTS5 with ${result.changes} verses`);

  // Verify population
  const count = db.prepare('SELECT count(*) as c FROM scriptures_fts').get();
  console.log(`✓ Verified: ${count.c} verses in FTS5 table`);

  // Test a search query
  const testResults = db.prepare(`
    SELECT verse_id, verse_title FROM scriptures_fts 
    WHERE scriptures_fts MATCH 'love' 
    LIMIT 5
  `).all();
  console.log(`✓ Test search "love": ${testResults.length} results`);
  testResults.forEach(r => console.log(`  - ${r.verse_title}`));

  // Test multi-term search
  const multiResults = db.prepare(`
    SELECT verse_id, verse_title FROM scriptures_fts 
    WHERE scriptures_fts MATCH 'eternal AND life' 
    LIMIT 3
  `).all();
  console.log(`✓ Test search "eternal AND life": ${multiResults.length} results`);

  // Test phrase search
  const phraseResults = db.prepare(`
    SELECT verse_id, verse_title FROM scriptures_fts 
    WHERE scriptures_fts MATCH '"eternal life"' 
    LIMIT 3
  `).all();
  console.log(`✓ Test search "eternal life" (phrase): ${phraseResults.length} results`);

  console.log('\n✅ FTS5 initialization complete!');
} catch (err) {
  console.error('❌ Error:', err.message);
  process.exit(1);
} finally {
  db.close();
}
