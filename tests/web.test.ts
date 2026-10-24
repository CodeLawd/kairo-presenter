import assert from 'node:assert/strict'
import test from 'node:test'
import { displayAddress, normalizeWebSettings, webAddress, withoutFrameAncestors } from '../src/lib/web'

test('typed hosts become https addresses', () => {
  assert.equal(webAddress('youtube.com'), 'https://youtube.com/')
  assert.equal(webAddress('  www.bible.com/bible/1/JHN.3.KJV '), 'https://www.bible.com/bible/1/JHN.3.KJV')
  assert.equal(webAddress('http://church.example/give'), 'http://church.example/give')
  assert.equal(webAddress('localhost:8080/slides'), 'https://localhost:8080/slides')
})

test('words are a search, other schemes never load', () => {
  assert.equal(webAddress('john 3 16'), 'https://www.google.com/search?q=john%203%2016')
  assert.equal(webAddress('javascript:alert(1)', false), null)
  assert.equal(webAddress('file:///C:/Windows/win.ini', false), null)
  assert.equal(webAddress('file:///etc/passwd'), null)
  assert.equal(webAddress('words only', false), null)
  assert.equal(webAddress(''), null)
})

test('the address bar drops the scheme and a lone slash', () => {
  assert.equal(displayAddress('https://youtube.com/'), 'youtube.com')
  assert.equal(displayAddress('https://www.youtube.com/watch?v=x'), 'www.youtube.com/watch?v=x')
})

test('bookmarks keep only safe addresses and get a name', () => {
  const settings = normalizeWebSettings({
    bookmarks: [
      { id: 'a', name: ' Giving ', url: 'church.example/give' },
      { id: 'b', name: '', url: 'https://youtube.com/' },
      { id: 'c', name: 'Bad', url: 'javascript:alert(1)' },
      { id: '', name: 'No id', url: 'https://x.example' },
    ],
  })
  assert.deepEqual(settings.bookmarks, [
    { id: 'a', name: 'Giving', url: 'https://church.example/give' },
    { id: 'b', name: 'youtube.com', url: 'https://youtube.com/' },
  ])
  assert.deepEqual(normalizeWebSettings(undefined), { bookmarks: [] })
})

test('framing is allowed by dropping only frame-ancestors from a policy', () => {
  assert.equal(
    withoutFrameAncestors("default-src 'self'; frame-ancestors 'none'; script-src 'self'"),
    "default-src 'self'; script-src 'self'",
  )
  assert.equal(withoutFrameAncestors("Frame-Ancestors https://a.example"), '')
  assert.equal(withoutFrameAncestors("img-src *"), 'img-src *')
})
