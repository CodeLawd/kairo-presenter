import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {
  POWERPOINT_NEEDS_CONVERTER,
  canConvertPowerPoint,
} from '../src/lib/documents'
import {
  POWERPOINT_CONVERTER_ORDER,
  escapeAppleScriptString,
} from '../src/main/services/documents/converters'
import { isWpsAppName, isPowerPointAppName } from '../src/main/services/documents/office-apps'
import {
  parseSlide,
  parseTable,
  slideBackground,
  slideHtml,
  slideImages,
  slideSize,
  slideTexts,
  themeColors,
} from '../src/main/services/documents/pptx-slides'

const read = (relative: string): string =>
  fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8')

test('PowerPoint conversion prefers Office, then WPS, then Keynote, then LibreOffice', () => {
  assert.deepEqual([...POWERPOINT_CONVERTER_ORDER], [
    'powerpoint',
    'wps',
    'keynote',
    'libreoffice',
  ])
})

test('AppleScript paths escape quotes and backslashes', () => {
  assert.equal(escapeAppleScriptString('/tmp/Sunday "slides".pptx'), '/tmp/Sunday \\"slides\\".pptx')
  assert.equal(escapeAppleScriptString('C:\\decks\\a.pptx'), 'C:\\\\decks\\\\a.pptx')
})

test('capabilities treat any installed converter as enough', () => {
  assert.equal(
    canConvertPowerPoint({ converters: ['powerpoint'], canConvertPowerPoint: true, libreOffice: false }),
    true,
  )
  assert.equal(
    canConvertPowerPoint({ converters: [], canConvertPowerPoint: false, libreOffice: false }),
    false,
  )
  assert.equal(
    canConvertPowerPoint({ converters: [], canConvertPowerPoint: false, libreOffice: true }),
    true,
  )
})

test('help text is for legacy .ppt when no Office app can open it', () => {
  assert.match(POWERPOINT_NEEDS_CONVERTER, /\.ppt/)
  assert.match(POWERPOINT_NEEDS_CONVERTER, /WPS/)
  assert.match(POWERPOINT_NEEDS_CONVERTER, /PDF/)
  const service = read('src/main/services/documents/index.ts')
  assert.match(service, /convertPptxBuiltin/)
  assert.doesNotMatch(service, /POWERPOINT_NEEDS_LIBREOFFICE/)
})

test('WPS detection accepts numbered Mac installs like wpsoffice 2.app', () => {
  assert.equal(isWpsAppName('wpsoffice 2.app'), true)
  assert.equal(isWpsAppName('wpsoffice.app'), true)
  assert.equal(isWpsAppName('WPS Office.app'), true)
  assert.equal(isWpsAppName('Microsoft Teams.app'), false)
  assert.equal(isPowerPointAppName('Microsoft PowerPoint.app'), true)
})

test('built-in slide parser reads text, images, and background', () => {
  const xml = '<p:bg><a:srgbClr val="1A2B3C"/></p:bg><a:p><a:t>Sunday</a:t></a:p><a:p><a:t>Welcome</a:t></a:p>'
  const rels = '<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>'
  assert.deepEqual(slideTexts(xml), ['Sunday', 'Welcome'])
  assert.equal(slideBackground(xml), '#1A2B3C')
  assert.deepEqual(slideImages(rels), ['image1.png'])
})

test('built-in parser keeps PowerPoint tables as tables', () => {
  const table = parseTable(
    '<a:tbl><a:tblPr firstRow="1"/><a:tr><a:tc><a:p><a:t>GROUP</a:t></a:p></a:tc><a:tc><a:p><a:t>VENUE</a:t></a:p></a:tc></a:tr><a:tr><a:tc><a:p><a:t>1</a:t></a:p></a:tc><a:tc><a:p><a:t>Hall</a:t></a:p></a:tc></a:tr></a:tbl>',
    { x: 0, y: 0, w: 100, h: 100 },
  )
  assert.equal(table.header, true)
  assert.deepEqual(table.rows, [['GROUP', 'VENUE'], ['1', 'Hall']])
  const slide = parseSlide(
    '<p:sld><p:sp><a:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="1000000"/></a:xfrm><a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="4800"/></a:r><a:t>Know Your Group</a:t></a:p></p:sp><p:graphicFrame><p:xfrm><a:off x="0" y="1000000"/><a:ext cx="12192000" cy="5000000"/></p:xfrm><a:tbl><a:tblPr firstRow="1"/><a:tr><a:tc><a:p><a:t>GROUP</a:t></a:p></a:tc></a:tr></a:tbl></p:graphicFrame></p:sld>',
    '',
    slideSize('<p:sldSz cx="12192000" cy="6858000"/>'),
    themeColors('<a:dk2><a:srgbClr val="1E5155"/></a:dk2><a:lt2><a:srgbClr val="EBEBEB"/></a:lt2><a:accent1><a:srgbClr val="B01513"/></a:accent1>'),
  )
  assert.equal(slide.elements[0]?.kind, 'text')
  assert.equal(slide.elements[1]?.kind, 'table')
  if (slide.elements[0]?.kind === 'text') assert.deepEqual(slide.elements[0].lines.map((line) => line.text), ['Know Your Group'])
})

test('built-in parser keeps PowerPoint layer order and run colors', () => {
  const colors = themeColors('<a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:accent2><a:srgbClr val="EA6312"/></a:accent2>')
  const slide = parseSlide(
    '<p:sld><p:pic><a:blip r:embed="rId3"/><a:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="6858000"/></a:xfrm></p:pic><p:sp><a:xfrm><a:off x="0" y="5000000"/><a:ext cx="5000000" cy="800000"/></a:xfrm><a:p><a:r><a:rPr sz="2400"/><a:solidFill><a:schemeClr val="bg1"/></a:solidFill><a:t>MASTER OLAOLUWA</a:t></a:r></a:p><a:p><a:r><a:rPr sz="2400"/><a:solidFill><a:schemeClr val="accent2"/></a:solidFill><a:t>10th Birthday Thanksgiving</a:t></a:r></a:p></p:sp><p:pic><a:blip r:embed="rId4"/><a:srcRect t="9524" b="5080"/><a:xfrm><a:off x="6000000" y="0"/><a:ext cx="6000000" cy="6858000"/></a:xfrm></p:pic></p:sld>',
    '<Relationship Id="rId3" Target="../media/image3.png"/><Relationship Id="rId4" Target="../media/image4.jpg"/>',
    slideSize('<p:sldSz cx="12192000" cy="6858000"/>'),
    colors,
  )
  assert.deepEqual(slide.elements.map((element) => element.kind), ['image', 'text', 'image'])
  const text = slide.elements[1]
  assert.equal(text?.kind, 'text')
  if (text?.kind === 'text') {
    assert.deepEqual(text.lines.map((line) => line.text), ['MASTER OLAOLUWA', '10th Birthday Thanksgiving'])
    assert.equal(text.lines[0]?.color, '#FFFFFF')
    assert.equal(text.lines[1]?.color, '#EA6312')
  }
  const photo = slide.elements[2]
  assert.equal(photo?.kind, 'image')
  if (photo?.kind === 'image') {
    assert.ok(photo.crop)
    assert.ok((photo.crop?.t ?? 0) > 0)
  }
})

test('built-in conversion preserves a 4:3 slide canvas and media coordinates', async () => {
  const { slideHtml } = await import('../src/main/services/documents/pptx-slides')
  const size = { cx: 1200, cy: 900 }
  const slide = parseSlide('<p:sld><p:pic><a:blip r:embed="rId9"/><a:xfrm><a:off x="120" y="90"/><a:ext cx="480" cy="360"/></a:xfrm></p:pic></p:sld>', '<Relationship Id="rId9" Target="../media/poster.png"/>', size, {})
  const image = slide.elements[0]
  assert.equal(image.kind, 'image')
  assert.deepEqual(image.box, { x: 192, y: 144, w: 768, h: 576 })
  assert.match(slideHtml([slide], (file) => file, {}, size), /size: 1920px 1440px/)
})

test('fallback inherits master background and layout artwork without rendering placeholder text twice', async () => {
  const { slideHtml } = await import('../src/main/services/documents/pptx-slides')
  const size = { cx: 9144000, cy: 5143500 }
  const master = '<p:sldMaster><p:cSld><p:bg><p:bgPr><a:solidFill><a:schemeClr val="dk1"/></a:solidFill></p:bgPr></p:bg></p:cSld></p:sldMaster>'
  const layout = '<p:sldLayout><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="100" y="100"/><a:ext cx="1000" cy="1000"/></a:xfrm><a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="DAFF80"/></a:solidFill></p:spPr></p:sp></p:spTree></p:cSld></p:sldLayout>'
  const xml = '<p:sld><p:cSld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="259050" y="2207719"/><a:ext cx="5760900" cy="2050800"/></a:xfrm></p:spPr><p:txBody><a:bodyPr anchor="b"/><a:p><a:r><a:rPr sz="3800"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>Betpikr</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'
  const slide = parseSlide(xml, '', size, { dk1: '#000000' }, { master, layout })
  assert.equal(slide.background, '#000000')
  assert.deepEqual(slide.elements.map((element) => element.kind), ['shape', 'text'])
  const html = slideHtml([slide], (file) => file, {}, size)
  assert.match(html, /background:#DAFF80/)
  assert.match(html, /font-size:101\.33px/)
  assert.match(html, /justify-content:flex-end/)
})

test('video pictures use their poster image rather than their embedded media reference', () => {
  const slide = parseSlide('<p:sld><p:pic><p:nvPicPr><p:nvPr><p14:media r:embed="rIdVideo"/></p:nvPr></p:nvPicPr><p:blipFill><a:blip r:embed="rIdPoster"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9144000" cy="5143500"/></a:xfrm></p:spPr></p:pic></p:sld>', '<Relationships><Relationship Id="rIdVideo" Target="../media/clip.mp4"/><Relationship Id="rIdPoster" Target="../media/poster.png"/></Relationships>', { cx: 9144000, cy: 5143500 }, {})
  assert.equal(slide.elements[0]?.kind, 'image')
  assert.equal(slide.elements[0]?.file, 'poster.png')
  assert.doesNotMatch(slideHtml([slide], file => file, {}), /clip\.mp4/)
})
