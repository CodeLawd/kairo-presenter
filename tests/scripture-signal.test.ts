import assert from 'node:assert/strict'
import test from 'node:test'
import { soundsLikeScripture } from '../src/main/services/scripture/scripture-signal'

for (const text of [
  'Jesus said I am the way, the truth and the life',
  'The Bible says we should not worry about tomorrow',
  'As Paul writes, nothing can separate us from the love of God',
  'It is written, man shall not live by bread alone',
  'Blessed are the poor in spirit',
  'Greater is he that is in thee',
  'In Romans we read that all have sinned',
  'Turn with me to the book of Hebrews',
  'In Mark 4 the disciples were afraid',
  'The gospel of John tells us he is the light',
  'Job chapter one opens with a good man',
  'The Lord opened her heart to heed the things spoken by Paul',
]) test(`asks the AI about: ${text}`, () => assert.equal(soundsLikeScripture(text), true))

for (const text of [
  'So this morning I want us to look at what it means to be faithful in the little things',
  'Please turn off your phones and let us stand',
  'We thank everyone who served in the children ministry last week',
  'If you are visiting for the first time we would love to meet you after the service',
  'When I was a young boy my father worked on a farm',
  'Our youth camp registration closes on Friday',
  'Mark my words, this year will be different',
  'John from the media team will help you after service',
  'Small acts of kindness matter',
  'It says on the sign that parking is full',
  'God bless you all, see you next Sunday',
]) test(`keeps ordinary speech local: ${text}`, () => assert.equal(soundsLikeScripture(text), false))
