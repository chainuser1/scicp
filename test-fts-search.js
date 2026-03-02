const db = require('better-sqlite3')('./resources/db/lds-scriptures-sqlite.db');

// Test queries
const testQueries = [
  'love',
  'eternal life',
  'faith hope charity',
  '"faith and works"',
  'John 3:16',
  'Alma 32',
  'Doctrine and Covenants',
];

console.log('=== FTS5 Search Test ===\n');

testQueries.forEach(query => {
  console.log(`Query: "${query}"`);
  
  try {
    // Check if FTS table exists
    const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='scriptures_fts'").get();
    if (!exists) {
      console.log('  ❌ FTS5 table not found\n');
      return;
    }

    // Build match query
    const trimmed = query.trim();
    const quoted = trimmed.match(/^"(.+)"$/);
    let matchQuery;
    
    if (quoted) {
      matchQuery = `"${quoted[1].replace(/"/g, '""')}"`;
    } else {
      const terms = trimmed.split(/\s+/).filter(Boolean);
      matchQuery = terms.join(' AND ');
    }

    // Run FTS query - use correct join syntax for FTS5
    const stmt = db.prepare(`
      SELECT
        s.verse_title,
        s.book_title,
        SUBSTR(s.scripture_text, 1, 60) as text_preview
      FROM scriptures s
      WHERE s.rowid IN (
        SELECT rowid FROM scriptures_fts WHERE scriptures_fts MATCH ?
      )
      LIMIT 3
    `);

    const results = stmt.all(matchQuery);
    console.log(`  Results: ${results.length} matches`);
    results.forEach(r => {
      console.log(`    • ${r.verse_title} (${r.book_title})`);
      console.log(`      "${r.text_preview}..."`);
    });
  } catch (err) {
    console.log(`  ❌ Error: ${err.message}`);
  }
  
  console.log();
});

db.close();
