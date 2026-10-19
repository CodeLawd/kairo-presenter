import assert from 'node:assert/strict';
import test from 'node:test';

import type { ScriptureVerse } from '../../../../lib/ipc';
import { lookupWithTranslationFallback } from '../detection-lookup';

const verse = (text: string): ScriptureVerse => ({ book: 'John', chapter: 3, verse: 16, text });

/** A Bible that only holds the translations given. */
function bible(held: Record<string, string>) {
  const asked: string[] = [];
  const lookup = async (translation: string): Promise<ScriptureVerse[]> => {
    asked.push(translation);
    return held[translation] ? [verse(held[translation])] : [];
  };
  return { lookup, asked };
}

test('a named translation that is available is shown as asked', async () => {
  const { lookup } = bible({ NLT: 'For this is how God loved the world', NKJV: 'For God so loved the world' });
  const found = await lookupWithTranslationFallback(lookup, 'NLT', 'NLT', 'NKJV');
  assert.equal(found.translation, 'NLT');
  assert.equal(found.requestedTranslation, undefined);
  assert.equal(found.verses[0]?.text, 'For this is how God loved the world');
});

test('a named translation that is missing falls back to the default and says so', async () => {
  const { lookup, asked } = bible({ NKJV: 'For God so loved the world' });
  const found = await lookupWithTranslationFallback(lookup, 'NIV', 'NIV', 'NKJV');
  assert.deepEqual(asked, ['NIV', 'NKJV']);
  assert.equal(found.translation, 'NKJV');
  assert.equal(found.requestedTranslation, 'NIV');
  assert.equal(found.verses[0]?.text, 'For God so loved the world');
});

test('with nothing named, a missing verse is not retried in another translation', async () => {
  const { lookup, asked } = bible({});
  const found = await lookupWithTranslationFallback(lookup, 'NKJV', null, 'NKJV');
  assert.deepEqual(asked, ['NKJV']);
  assert.deepEqual(found.verses, []);
  assert.equal(found.requestedTranslation, undefined);
});
