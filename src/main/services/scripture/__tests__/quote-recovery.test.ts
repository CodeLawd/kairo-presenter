import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { matchChapterQuote, recoverDamagedQuote, tokenizeChapter } from '../quote-recovery';

test('chapter quotes tolerate one changed word only when the verse remains unique', () => {
  const candidates = tokenizeChapter([
    { book: 'Nahum', chapter: 2, verse: 6, text: 'The gates of the rivers shall be opened, and the palace shall be dissolved.' },
    { book: 'Nahum', chapter: 2, verse: 7, text: 'And Huzzab shall be led away captive.' },
  ]);
  assert.equal(matchChapterQuote('The gates of the rivers shall be unexpected, and the palace shall be dissolved.', candidates)?.verse, 6);

  const repeated = tokenizeChapter([
    { book: 'Haggai', chapter: 1, verse: 5, text: 'Now therefore thus saith the LORD of hosts; Consider your ways.' },
    { book: 'Haggai', chapter: 1, verse: 7, text: 'Thus saith the LORD of hosts; Consider your ways.' },
  ]);
  assert.equal(matchChapterQuote('Thus saith the LORD of hosts; Consider your ways.', repeated), null);
  assert.equal(matchChapterQuote('Now therefore thus saith unexpected hosts; Consider your ways.', repeated)?.verse, 5);
});

test('recovers exact Psalm 115:12-13 using the bundled verse text, without AI', () => {
  const db = new Database('resources/bible.db', { readonly: true });
  try {
    const candidates = db.prepare(`SELECT b.name as book, v.chapter, v.verse, v.text FROM verses v JOIN books b ON b.id=v.book_id WHERE b.name='Psalms' AND v.chapter=115 AND v.verse=12`).all() as Array<{book:string;chapter:number;verse:number;text:string}>;
    const refs = recoverDamagedQuote('Psalm 1one512-thirteen says, The Lord has been mindful of you. Put your name there.', () => candidates);
    assert.deepEqual(refs.map(r => [r.book, r.chapter, r.verseStart, r.verseEnd]), [['Psalms', 115, 12, 13]]);
    for (const text of [
      'Psalm 1one512-thirteen says, The Lord',
      'Psalm 1one513-thirteen says, The Lord has been mindful of you.',
      'Psalm 1one512-hundred says, The Lord has been mindful of you.',
      'Psalm 1one512-thirteen says, The Lord is good to all people.',
    ]) assert.deepEqual(recoverDamagedQuote(text, () => candidates), [], text);
  } finally { db.close(); }
});

test('production local search finds the Psalm candidate among the whole Bible', async () => {
  const { mkdtempSync, copyFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { BibleDatabase } = await import('../bible-db');
  const { ScriptureService } = await import('../index');
  const folder = mkdtempSync(join(tmpdir(), 'kairo-quote-'));
  const file = join(folder, 'bible.db');
  copyFileSync('resources/bible.db', file);
  const db = new BibleDatabase(file);
  try {
    const service = new ScriptureService();
    Object.assign(service, { db });
    const refs = recoverDamagedQuote(
      'Psalm 1one512-thirteen says, The Lord has been mindful of you.',
      phrase => service.searchLocalQuoteCandidates(phrase),
    );
    assert.deepEqual(refs.map(r => [r.book, r.chapter, r.verseStart, r.verseEnd]), [['Psalms', 115, 12, 13]]);
  } finally { db.close(); rmSync(folder, { recursive: true, force: true }); }
});
