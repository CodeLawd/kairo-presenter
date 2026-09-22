import assert from 'node:assert/strict'
import test from 'node:test'

import { looksLikeRtf, rtfToPlainText } from '../src/lib/rtf-text'

/** A document in the shape TextEdit and WordPad actually save. */
const TEXTEDIT = String.raw`{\rtf1\ansi\ansicpg1252\cocoartf2758
{\fonttbl\f0\fswiss\fcharset0 Helvetica;}
{\colortbl;\red255\green255\blue255;}
\pard\tx720\partightenfactor0
\f0\fs28 \cf0 [Verse 1]\
Line one of the song\
Line two of the song\
\
[Chorus]\
The chorus line\
}`

test('the body text comes out, the font and colour tables do not', () => {
  const text = rtfToPlainText(TEXTEDIT)
  assert.ok(text.includes('Line one of the song'))
  assert.ok(!text.includes('Helvetica'))
  assert.ok(!/red255|fonttbl|colortbl/.test(text))
})

test('paragraph breaks survive, because sections are read from them', () => {
  const text = rtfToPlainText(TEXTEDIT)
  assert.deepEqual(text.split('\n'), [
    '[Verse 1]',
    'Line one of the song',
    'Line two of the song',
    '',
    '[Chorus]',
    'The chorus line',
  ])
})

test('\\par is a line break too', () => {
  const text = rtfToPlainText(String.raw`{\rtf1\ansi One\par Two\par Three}`)
  assert.deepEqual(text.split('\n'), ['One', 'Two', 'Three'])
})

test("Word's curly quotes and dashes are decoded, not dropped", () => {
  // \'92 is a right single quote in Windows-1252 — a control char in Latin-1.
  const text = rtfToPlainText(String.raw`{\rtf1\ansi Jesus\'92 name \'97 forever}`)
  assert.equal(text, 'Jesus’ name — forever')
})

test('escaped braces and backslashes are literal text', () => {
  assert.equal(rtfToPlainText(String.raw`{\rtf1\ansi \{C\} 1 \\ 2}`), '{C} 1 \\ 2')
})

test('non-Latin lyrics survive as unicode escapes', () => {
  // 舠? is how a writer encodes a character outside the codepage, with a
  // fallback character that must be swallowed.
  const text = rtfToPlainText(String.raw`{\rtf1\ansi\uc1 \u200?s\u233?`)
  assert.equal(text, 'Èsé')
})

test('a \\uc0 document keeps the character that follows', () => {
  assert.equal(rtfToPlainText(String.raw`{\rtf1\ansi\uc0 \u200 se}`), 'Èse')
})

test('control words with parameters never leak into the lyrics', () => {
  const text = rtfToPlainText(String.raw`{\rtf1\ansi\fs24\b\i Holy\b0\i0  Spirit\fs20}`)
  assert.equal(text, 'Holy Spirit')
})

test('an ignorable destination contributes nothing', () => {
  const text = rtfToPlainText(
    String.raw`{\rtf1\ansi{\*\generator Riched20 10.0}{\info{\title Draft}}Real lyric}`,
  )
  assert.equal(text, 'Real lyric')
})

test('indentation and padding collapse to single spaces', () => {
  // Song sheets are laid out with tabs and runs of spaces; a lyric line wants
  // neither, and the slide formatter measures the text it is given.
  assert.equal(rtfToPlainText(String.raw`{\rtf1\ansi A\tab B     C}`), 'A B C')
})

test('input that is not RTF returns nothing at all', () => {
  assert.equal(rtfToPlainText('[Verse 1]\nJust a text file'), '')
  assert.equal(rtfToPlainText(''), '')
  assert.equal(looksLikeRtf('{\\rtf1\\ansi x}'), true)
  assert.equal(looksLikeRtf('plain text'), false)
})

test('an ignorable destination is skipped whole', () => {
  // TextEdit writes {\*\expandedcolortbl;;} on every save. Read as body text,
  // its ";;" lands on the first line — which is where the title comes from.
  const text = rtfToPlainText(
    String.raw`{\rtf1\ansi{\*\expandedcolortbl;;}{\*\somethingnew x}Sample Song Title\
\
First line}`,
  )
  assert.deepEqual(text.split('\n'), ['Sample Song Title', '', 'First line'])
})
