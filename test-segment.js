function segmentVerseText(text, wordsPerSegment = 20) {
  if (!text) return [];
  
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const segments = [];
  
  for (let i = 0; i < words.length; i += wordsPerSegment) {
    segments.push(words.slice(i, i + wordsPerSegment).join(' '));
  }
  
  return segments.length > 0 ? segments : [text];
}

const testText = 'For God so loved the world that he gave his only begotten Son that whosoever believeth in him should not perish but have everlasting life';
const result = segmentVerseText(testText);
console.log('Total words:', testText.split(/\s+/).length);
console.log('Segments:', result.length);
console.log('Segment details:');
result.forEach((seg, i) => console.log(`  [${i}]: "${seg}" (${seg.split(/\s+/).length} words)`));
