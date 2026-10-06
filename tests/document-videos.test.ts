import test from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readPptxVideos, pptxSlidePaths, extractPptxStatic } from '../src/main/services/documents/pptx-videos'

const presentation = '<p:presentation><p:sldSz cx="1000" cy="500"/><p:sldIdLst><p:sldId r:id="second"/><p:sldId r:id="first"/></p:sldIdLst></p:presentation>'
const relationships = '<Relationships><Relationship Id="first" Target="slides/slide1.xml"/><Relationship Id="second" Target="slides/slide2.xml"/></Relationships>'
const picture = (id = 'clip', target = 'r:embed') => `<p:pic><p:nvPicPr><p:cNvPr id="4"/><p:nvPr><a:videoFile r:link="legacy"/><p:extLst><p14:media ${target}="${id}"/></p:extLst></p:nvPr></p:nvPicPr><p:spPr><a:xfrm><a:off x="100" y="50"/><a:ext cx="400" cy="200"/></a:xfrm></p:spPr></p:pic>`
async function deck(slide: string, rels: string): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('ppt/presentation.xml', presentation)
  zip.file('ppt/_rels/presentation.xml.rels', relationships)
  zip.file('ppt/slides/slide1.xml', '<p:sld/>')
  zip.file('ppt/slides/slide2.xml', `<p:sld><p:cSld><p:spTree>${slide}</p:spTree></p:cSld></p:sld>`)
  zip.file('ppt/slides/_rels/slide2.xml.rels', `<Relationships>${rels}</Relationships>`)
  zip.file('ppt/media/video1.mp4', Buffer.from('fixture video bytes'))
  return zip.generateAsync({ type: 'nodebuffer' })
}

test('presentation order wins over slide filenames', () => {
  assert.deepEqual(pptxSlidePaths(presentation, relationships), ['ppt/slides/slide2.xml', 'ppt/slides/slide1.xml'])
})
test('extracts embedded video on its reordered slide with normalized placement', async () => {
  const result = await readPptxVideos(await deck(picture(), '<Relationship Id="clip" Target="../media/video1.mp4"/>'))
  assert.equal(result.slides.length, 2)
  assert.equal(result.slides[1].length, 0)
  const clip = result.slides[0][0]
  assert.deepEqual(clip.box, { x: 0.1, y: 0.1, width: 0.4, height: 0.4 })
  assert.equal(clip.file, 'video1.mp4')
  assert.equal(result.media.get(clip.file)?.toString(), 'fixture video bytes')
  assert.deepEqual(result.warnings, [])
})
test('external and missing videos become visible warnings without breaking regular slides', async () => {
  for (const rel of ['<Relationship Id="clip" Target="https://example.com/v.mp4" TargetMode="External"/>', '<Relationship Id="clip" Target="../media/missing.mp4"/>']) {
    const result = await readPptxVideos(await deck(picture(), rel))
    assert.equal(result.slides[0].length, 0)
    assert.match(result.warnings[0], /Slide 1/)
  }
})
test('rejects media relationships escaping the presentation media folder', async () => {
  const result = await readPptxVideos(await deck(picture(), '<Relationship Id="clip" Target="../../../private.mp4"/>'))
  assert.equal(result.media.size, 0)
  assert.equal(result.slides[0].length, 0)
  assert.match(result.warnings[0], /unsupported|missing/i)
})
test('unsupported formats and rotated shapes are reported instead of silently misrendered', async () => {
  const result = await readPptxVideos(await deck(picture().replace('<a:xfrm>', '<a:xfrm rot="60000">'), '<Relationship Id="clip" Target="../media/video1.mp4"/>'))
  assert.equal(result.slides[0].length, 0)
  assert.match(result.warnings[0], /rotat/i)
})

test('absolute package relationships and alternate XML prefixes are supported', async () => {
  const alternate = presentation.replaceAll('p:', 'deck:').replaceAll('r:', 'rel:')
  assert.deepEqual(pptxSlidePaths(alternate, relationships.replaceAll('slides/', '/ppt/slides/')), ['ppt/slides/slide2.xml', 'ppt/slides/slide1.xml'])
  const result = await readPptxVideos(await deck(picture(), '<Relationship Id="clip" Target="/ppt/media/video1.mp4"/>'))
  assert.equal(result.slides[0].length, 1)
})

test('Windows backslash traversal is rejected before media can be written', async () => {
  const result = await readPptxVideos(await deck(picture(), '<Relationship Id="clip" Target="../media/..\\..\\payload.mp4"/>'))
  assert.equal(result.media.size, 0)
  assert.equal(result.slides[0].length, 0)
  assert.match(result.warnings[0], /unsupported|missing/i)
})

test('warns when foreground slide objects may cover an embedded video', async () => {
  const foreground = '<p:sp><p:spPr><a:xfrm><a:off x="100" y="50"/><a:ext cx="400" cy="200"/></a:xfrm></p:spPr><p:txBody><a:p><a:t>Title over video</a:t></a:p></p:txBody></p:sp>'
  const result = await readPptxVideos(await deck(picture() + foreground, '<Relationship Id="clip" Target="../media/video1.mp4"/>'))
  assert.equal(result.slides[0].length, 1)
  assert.match(result.warnings[0], /overlap|above/i)
})


test('static fallback extracts only bounded slide metadata and artwork', async () => {
  const zip = new JSZip()
  zip.file('ppt/slides/slide1.xml', '<p:sld/>')
  zip.file('ppt/media/poster.png', Buffer.from('poster'))
  zip.file('ppt/media/video.mp4', Buffer.from('video'))
  zip.file('unrelated.bin', Buffer.from('ignored'))
  const dir = await fs.mkdtemp(join(tmpdir(), 'pptx-static-test-'))
  try {
    await extractPptxStatic(await zip.generateAsync({ type: 'nodebuffer' }), dir)
    assert.equal(await fs.readFile(join(dir, 'ppt/slides/slide1.xml'), 'utf8'), '<p:sld/>')
    assert.equal(await fs.readFile(join(dir, 'ppt/media/poster.png'), 'utf8'), 'poster')
    await assert.rejects(fs.access(join(dir, 'ppt/media/video.mp4')))
    await assert.rejects(fs.access(join(dir, 'unrelated.bin')))
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('static fallback rejects ZIP traversal and oversized XML', async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), 'pptx-static-invalid-'))
  try {
    const malicious = new JSZip()
    malicious.file('ppt/slides/../payload.xml', '<payload/>')
    await assert.rejects(extractPptxStatic(await malicious.generateAsync({ type: 'nodebuffer' }), dir), /archive path/)
    const oversized = new JSZip()
    oversized.file('ppt/slides/slide1.xml', 'x'.repeat(5 * 1024 * 1024 + 1))
    await assert.rejects(extractPptxStatic(await oversized.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), dir), /slide1\.xml.*5 MB limit/)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})
