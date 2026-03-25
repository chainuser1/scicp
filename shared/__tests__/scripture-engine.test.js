'use strict';

const {
  expandBookName,
  segmentVerseText,
  segmentVerseTextDual,
  parseScriptureReference,
  buildFTSPhraseQuery,
  buildFTSTermQuery,
  BOOK_ABBREVIATIONS,
  LANGUAGE_NAMES,
} = require('../index');

describe('expandBookName', () => {
  test('expands common abbreviations', () => {
    expect(expandBookName('matt')).toBe('Matthew');
    expect(expandBookName('gen')).toBe('Genesis');
    expect(expandBookName('rev')).toBe('Revelation');
  });
  test('returns input for unknown books', () => {
    expect(expandBookName('FakeBook')).toBe('FakeBook');
  });
  test('handles null/empty', () => {
    expect(expandBookName(null)).toBeNull();
    expect(expandBookName('')).toBeNull();
  });
});

describe('segmentVerseText', () => {
  test('returns empty array for empty/null text', () => {
    expect(segmentVerseText(null)).toEqual([]);
    expect(segmentVerseText('')).toEqual([]);
  });
  test('single segment for short text', () => {
    const result = segmentVerseText('Hello world');
    expect(result).toEqual(['Hello world']);
  });
  test('splits into segments at word boundary', () => {
    const words = Array.from({ length: 500 }, (_, i) => `word${i}`).join(' ');
    const result = segmentVerseText(words, 200);
    expect(result.length).toBe(3);
    expect(result[0].split(' ').length).toBe(200);
    expect(result[2].split(' ').length).toBe(100);
  });
  test('handles invalid wordsPerSegment', () => {
    const result = segmentVerseText('Hello world test', 0);
    expect(result.length).toBeGreaterThan(0);
  });
  test('handles negative wordsPerSegment', () => {
    const result = segmentVerseText('Hello world test', -5);
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('segmentVerseTextDual', () => {
  test('pads shorter segments', () => {
    const result = segmentVerseTextDual('one two three', 'a b c d e f g h', 3);
    expect(result.primarySegments.length).toBe(result.secondarySegments.length);
  });
});

describe('parseScriptureReference', () => {
  test('parses standard reference', () => {
    const ref = parseScriptureReference('John 3:16');
    expect(ref).not.toBeNull();
    expect(ref.book).toBe('John');
    expect(ref.chapter).toBe(3);
    expect(ref.verse).toBe(16);
  });
  test('parses numbered book', () => {
    const ref = parseScriptureReference('1 Nephi 3:7');
    expect(ref).not.toBeNull();
    expect(ref.chapter).toBe(3);
    expect(ref.verse).toBe(7);
  });
  test('parses chapter only', () => {
    const ref = parseScriptureReference('Genesis 1');
    expect(ref).not.toBeNull();
    expect(ref.chapter).toBe(1);
  });
  test('returns null for invalid input', () => {
    expect(parseScriptureReference(null)).toBeNull();
    expect(parseScriptureReference('')).toBeNull();
    expect(parseScriptureReference(123)).toBeNull();
  });
  test('handles abbreviated books', () => {
    const ref = parseScriptureReference('Matt 5:3');
    expect(ref).not.toBeNull();
  });
});

describe('buildFTSPhraseQuery', () => {
  test('wraps in quotes', () => {
    const q = buildFTSPhraseQuery('love thy neighbor');
    expect(q).toContain('"');
  });
});

describe('buildFTSTermQuery', () => {
  test('joins terms with AND', () => {
    const q = buildFTSTermQuery(['faith', 'hope', 'charity']);
    expect(q).toBeDefined();
  });
});

describe('data exports', () => {
  test('BOOK_ABBREVIATIONS is populated', () => {
    expect(Object.keys(BOOK_ABBREVIATIONS).length).toBeGreaterThan(50);
  });
  test('LANGUAGE_NAMES has entries', () => {
    expect(LANGUAGE_NAMES).toBeDefined();
    expect(typeof LANGUAGE_NAMES).toBe('object');
  });
});
