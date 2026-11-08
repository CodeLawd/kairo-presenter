import assert from 'node:assert/strict'
import test from 'node:test'
import { canonicalText } from '../src/main/services/lyrics/normalize'
import { rankResults } from '../src/main/services/lyrics/online'
test('Yoruba tone marks do not prevent a title match', () => {
 assert.equal(canonicalText('Jésù Ọlọ́rùkọ́ Àpènírẹ́'), canonicalText('Jesu Oloruko Apenire'))
})
test('song search retains non-Latin titles and distinguishes unrelated songs', () => {
 assert.equal(canonicalText('耶稣爱你'), '耶稣爱你')
 assert.equal(canonicalText('Иисус любит тебя'), 'иисус любит тебя')
 const hits = rankResults('耶稣爱你', [
  { id:'other',provider:'web',title:'奇异恩典',artist:'合唱团',url:'https://example.com/other' },
  { id:'match',provider:'web',title:'耶稣爱你',artist:'合唱团',url:'https://example.com/match' },
 ])
 assert.equal(hits[0]?.id,'match')
})
