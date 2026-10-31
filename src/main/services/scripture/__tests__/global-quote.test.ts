import assert from 'node:assert/strict'
import test from 'node:test'
import { matchGlobalQuote, type GlobalQuoteCandidate } from '../global-quote'
const luke = { book: 'Luke', chapter: 6, verse: 38, text: 'Give, and it shall be given unto you; good measure, pressed down, and shaken together, and running over.' }
const john = { book: '1 John', chapter: 2, verse: 15, text: 'Love not the world, neither the things that are in the world. If any man love the world, the love of the Father is not in him.' }
const candidates: GlobalQuoteCandidate[] = [luke, john]
test('demo quote resolves locally with commentary around the quotation', () => {
 assert.equal(matchGlobalQuote('Listen church, give and it shall be given unto you good measure pressed down', candidates)[0]?.book, 'Luke')
})
test('a distinctive negative quotation preserves negation', () => {
 assert.equal(matchGlobalQuote('Love not the world neither the things that are in the world', candidates)[0]?.book, '1 John')
 assert.deepEqual(matchGlobalQuote('Love the world and its things because the world is good', candidates), [])
})
test('parallel translation copies do not compete with the same reference', () => {
 const result = matchGlobalQuote('Give and it shall be given unto you good measure pressed down', [luke, {...luke}])
 assert.equal(result.length, 1)
 assert.equal(result[0].ambiguous, false)
})
test('shared Gospel wording remains ambiguous', () => {
 const result = matchGlobalQuote('If I may but touch his garment I shall be whole', [
 {book:'Matthew',chapter:9,verse:21,text:'For she said within herself, If I may but touch his garment, I shall be whole.'},
 {book:'Mark',chapter:5,verse:28,text:'For she said, If I may touch but his clothes, I shall be whole.'},
 ])
 assert.ok(result.length >= 1)
})
test('generic sermon talk is not scripture evidence', () => {
 for (const text of ['God is good and we love him', 'give generously to your neighbours this week', 'the world is full of things']) assert.deepEqual(matchGlobalQuote(text,candidates),[])
})
test('one transcription error does not lose a long distinctive quotation', () => {
 assert.equal(matchGlobalQuote('give and it shall be given unto you good pressure pressed down and shaken together', candidates)[0]?.book,'Luke')
})

test('existing FTS retrieves demo quotations from the bundled multi-translation corpus', async () => {
 const {default:Database}=await import('better-sqlite3')
 const {retrieveGlobalQuote}=await import('../global-quote')
 const db=new Database('resources/bible.db',{readonly:true})
 try {
  for(const [text,book,chapter,verse] of [
   ['Give and it shall be given unto you good measure pressed down','Luke',6,38],
   ['Love not the world neither the things that are in the world','1 John',2,15],
   ['Greater is he that is in you than he that is in the world','1 John',4,4],
  ] as const) {
   const found=matchGlobalQuote(text,retrieveGlobalQuote(db,text))
   assert.ok(found.some(r=>r.book===book&&r.chapter===chapter&&r.verse===verse),text)
  }
 } finally {db.close()}
})
test('formulaic biblical narration is not distinctive quotation evidence',()=>{
 const narration={book:'Luke',chapter:1,verse:1,text:'And it came to pass that he said unto them, behold, hear my words.'}
 assert.deepEqual(matchGlobalQuote('and it came to pass that he said unto them behold',[narration]),[])
})
test('distinct passages with the same distinctive wording stay explicit alternatives',()=>{
 const result=matchGlobalQuote('give and it shall be given unto you good measure pressed down',[luke,{...luke,book:'Matthew',chapter:7,verse:2}])
 assert.equal(result.length,2);assert.ok(result.every(r=>r.ambiguous))
})
test('negating a positive quotation does not match its positive wording',()=>{
 assert.deepEqual(matchGlobalQuote('Do not give and it shall be given unto you good measure pressed down',[luke]),[])
})
test('a negation in earlier commentary does not block a later exact quotation', () => {
  const luke = { book: 'Luke', chapter: 6, verse: 38, text: 'Give, and it shall be given unto you; good measure, pressed down, and shaken together' }
  const matches = matchGlobalQuote('do not be afraid church give and it shall be given unto you good measure pressed down', [luke])
  assert.equal(matches[0]?.verse, 38)
})
test('a paraphrase sharing rare words is offered as possible, never as a confident match', () => {
  const hem = { book: 'Matthew', chapter: 14, verse: 36, text: 'And besought him that they might only touch the hem of his garment: and as many as touched were made perfectly whole.' }
  const counts: Record<string, number> = { touch: 52, hem: 6, garment: 83, whole: 244 }
  const rarity = (word: string): number => counts[word] ?? 1000
  const heard = 'If only I touch the hem of his garments, I shall be made whole.'
  assert.deepEqual(matchGlobalQuote(heard, [hem]), [])
  const possible = matchGlobalQuote(heard, [hem], rarity)
  assert.equal(possible[0]?.verse, 36)
  assert.equal(possible[0]?.ambiguous, true)
})
test('sharing only common Bible words offers nothing, even as possible', () => {
  const verse = { book: 'Jeremiah', chapter: 51, verse: 50, text: 'Ye that have escaped the sword, go away, stand not still: remember the LORD afar off, and let Jerusalem come into your mind.' }
  const rarity = (word: string): number => ({ stand: 275, off: 521, let: 1239 } as Record<string, number>)[word] ?? 1000
  assert.deepEqual(matchGlobalQuote('Please turn off your phones and let us stand for the word of God', [verse], rarity), [])
})
