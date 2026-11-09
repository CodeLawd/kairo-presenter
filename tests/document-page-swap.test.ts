import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

const html = readFileSync('src/main/services/output/overlay.html', 'utf8')
const source = html.slice(html.indexOf('      window.__swapDocumentPage ='), html.indexOf('      // Decode the page after'))

test('document swaps keep the visible page until decoding and ignore stale requests', async () => {
  const pending: Array<() => void> = []
  const image = { src: 'first' }
  let clears = 0
  const context = vm.createContext({
    window: {}, layers: { bg: {} }, live: () => image,
    clearDocumentVideos: () => { clears++ },
    Image: class { src = ''; decode() { return new Promise<void>(resolve => pending.push(resolve)) } },
    requestAnimationFrame: (callback: () => void) => callback(),
  })
  vm.runInContext(source, context)
  const swap = context.window.__swapDocumentPage as (src: string) => Promise<boolean>
  const second = swap('second')
  assert.equal(image.src, 'first', 'the old page stays visible during decoding')
  assert.equal(clears, 0, 'old video overlays stay until the page is ready')
  const third = swap('third')
  pending[1]()
  assert.equal(await third, true)
  assert.equal(image.src, 'third')
  pending[0]()
  assert.equal(await second, false)
  assert.equal(image.src, 'third', 'late decoding cannot restore an older page')
})

test('a page decode failure preserves the current page and its video overlays', async () => {
  const image = { src: 'first' }
  let clears = 0
  const context = vm.createContext({
    window: {}, layers: { bg: {} }, live: () => image,
    clearDocumentVideos: () => { clears++ },
    Image: class { src = ''; decode() { return Promise.reject(new Error('decode failed')) } },
    requestAnimationFrame: (callback: () => void) => callback(),
  })
  vm.runInContext(source, context)
  assert.equal(await context.window.__swapDocumentPage('broken'), false)
  assert.equal(image.src, 'first')
  assert.equal(clears, 0)
})
