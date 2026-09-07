import assert from 'node:assert/strict';
import test from 'node:test';
import { singleVerseSuggestion, splitVerseSuggestions } from '../src/lib/single-verse-presentation';
import type { ScriptureSuggestion } from '../src/lib/ipc';
const range: ScriptureSuggestion = { id: 'range', reference: 'Acts 4:8–9', verses: [8,9].map(verse => ({ book: 'Acts', chapter: 4, verse, text: `Verse ${verse}` })), translation: 'NKJV', confidence: 1, source: 'manual', triggerText: 'Acts 4', planId: 'sermon', planItemId: 'item' };
test('a range stages separate verses and presents only one', () => {
  const slides = splitVerseSuggestions(range);
  assert.deepEqual(slides.map(s => [s.reference, s.verses.length, s.passageIndex]), [['Acts 4:8',1,0],['Acts 4:9',1,1]]);
  assert.equal(slides[1].planItemId, 'item');
  assert.equal(slides[0].passageId, slides[1].passageId);
  assert.deepEqual(singleVerseSuggestion(range).verses, [range.verses[0]]);
  assert.equal(singleVerseSuggestion(range).reference, 'Acts 4:8');
});
