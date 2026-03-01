const { parseScriptureReference, searchScripture } = require('../index');

// we will use a small in-memory copy of the real database for tests if possible,
// but for now we can test parsing logic independently and run a few queries
// against the existing DB. The DB file is large but read-only, so tests should
// still be fast enough.

describe('parseScriptureReference', () => {
  test('simple book chapter', () => {
    expect(parseScriptureReference('John 3')).toEqual({ book: 'John', chapter: 3, verse: null });
    expect(parseScriptureReference('1 Nephi 4')).toEqual({ book: '1 Nephi', chapter: 4, verse: null });
  });

  test('book chapter verse', () => {
    expect(parseScriptureReference('John 3:16')).toEqual({ book: 'John', chapter: 3, verse: 16 });
    expect(parseScriptureReference('Mosiah 2:1')).toEqual({ book: 'Mosiah', chapter: 2, verse: 1 });
  });

  test('expands book abbreviations', () => {
    expect(parseScriptureReference('1 Ne 1:1')).toEqual({ book: '1 Nephi', chapter: 1, verse: 1 });
    expect(parseScriptureReference('D&C 1:1')).toEqual({ book: 'Doctrine and Covenants', chapter: 1, verse: 1 });
    expect(parseScriptureReference('Matt 3:16')).toEqual({ book: 'Matthew', chapter: 3, verse: 16 });
  });

  test('invalid input returns null', () => {
    expect(parseScriptureReference('')).toBeNull();
    expect(parseScriptureReference('random text')).toBeNull();
    expect(parseScriptureReference('3:16')).toBeNull();
  });
});

// due to dependence on a real DB we won't verify results, but we can at least
// ensure the function executes without throwing and returns an array.

describe('searchScripture', () => {
  test('text search returns array', () => {
    const results = searchScripture('love');
    expect(Array.isArray(results)).toBe(true);
  });

  test('structured search by reference', () => {
    // choose a known verse to ensure at least one hit
    const results = searchScripture('John 3:16');
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('verse_title');
  });
});
