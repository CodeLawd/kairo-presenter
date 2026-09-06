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
