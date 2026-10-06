const SLIDE_W = 1920
const DEFAULT_CX = 12_192_000
const DEFAULT_CY = 6_858_000

export interface SlideBox {
  x: number
  y: number
  w: number
  h: number
}

export interface SlideLine {
  text: string
  color: string
  sizePt: number
  fontFamily?: string
  bold?: boolean
  italic?: boolean
  beforePt?: number
  afterPt?: number
  lineHeight?: number
}

export interface SlideText {
  kind: 'text'
  box: SlideBox
  align: 'left' | 'center' | 'right'
  sizePt: number
  lines: SlideLine[]
  anchor?: 'top' | 'center' | 'bottom'
  insets?: { top: number; right: number; bottom: number; left: number }
}

export interface SlideShape {
  kind: 'shape'
  box: SlideBox
  fill: string
  border?: string
  borderWidth?: number
  geometry: string
}

export interface SlideTable {
  kind: 'table'
  box: SlideBox
  header: boolean
  rows: string[][]
}

export interface SlideCrop {
  t: number
  b: number
  l: number
  r: number
}

export interface SlideImage {
  kind: 'image'
  box: SlideBox
  file: string
  crop?: SlideCrop
}

export type SlideElement = SlideText | SlideTable | SlideImage | SlideShape

export interface ParsedSlide {
  background: string
  elements: SlideElement[]
}

function decodeXml(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function attr(xml: string, name: string): string | null {
  return xml.match(new RegExp(`\\b${name}="([^"]+)"`))?.[1] ?? null
}

export function slideSize(presentationXml: string): { cx: number; cy: number } {
  const match = presentationXml.match(/<p:sldSz\b[^>]*>/)
  if (!match) return { cx: DEFAULT_CX, cy: DEFAULT_CY }
  return {
    cx: Number(attr(match[0], 'cx')) || DEFAULT_CX,
    cy: Number(attr(match[0], 'cy')) || DEFAULT_CY,
  }
}

export function themeColors(themeXml: string): Record<string, string> {
  const colors: Record<string, string> = {}
  for (const match of themeXml.matchAll(/<a:(dk1|lt1|dk2|lt2|accent[1-6]|hlink|folHlink)>[\s\S]*?<\/a:\1>/g)) {
    const hex = match[0].match(/lastClr="([0-9A-Fa-f]{6})"/)?.[1] ?? match[0].match(/val="([0-9A-Fa-f]{6})"/)?.[1]
    if (hex) colors[match[1]] = `#${hex}`
  }
  colors.bg1 = colors.lt1 ?? '#FFFFFF'
  colors.bg2 = colors.lt2 ?? '#EBEBEB'
  colors.tx1 = colors.dk1 ?? '#111111'
  colors.tx2 = colors.dk2 ?? '#1E5155'
  return colors
}

function emuBox(xml: string, cx: number, cy: number): SlideBox | null {
  const xfrm = xml.match(/<a:xfrm\b[\s\S]*?<\/a:xfrm>|<p:xfrm\b[\s\S]*?<\/p:xfrm>/)
  if (!xfrm) return null
  const off = xfrm[0].match(/<(?:a:)?off\b[^>]*>/)
  const ext = xfrm[0].match(/<(?:a:)?ext\b[^>]*>/)
  if (!off || !ext) return null
  const height = SLIDE_W * cy / cx
  return {
    x: (Number(attr(off[0], 'x')) || 0) / cx * SLIDE_W,
    y: (Number(attr(off[0], 'y')) || 0) / cy * height,
    w: (Number(attr(ext[0], 'cx')) || 0) / cx * SLIDE_W,
    h: (Number(attr(ext[0], 'cy')) || 0) / cy * height,
  }
}

function paragraphText(xml: string): string {
  return [...xml.matchAll(/<a:t(?=\s|>)[^>]*>([\s\S]*?)<\/a:t>/g)]
    .map((match) => decodeXml(match[1]).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ')
}

function blockLines(xml: string): string[] {
  return [...xml.matchAll(/<a:p\b[\s\S]*?<\/a:p>/g)]
    .map((match) => paragraphText(match[0]))
    .filter(Boolean)
}

function fontPt(xml: string, fallback = 24): number {
  const sz = xml.match(/\bsz="(\d+)"/)
  return sz ? Number(sz[1]) / 100 : fallback
}

function align(xml: string): 'left' | 'center' | 'right' {
  const value = xml.match(/\balgn="(ctr|r|l)"/)?.[1]
  if (value === 'ctr') return 'center'
  if (value === 'r') return 'right'
  return 'left'
}

export function parseTable(xml: string, box: SlideBox): SlideTable {
  const rows = [...xml.matchAll(/<a:tr\b[\s\S]*?<\/a:tr>/g)].map((row) =>
    [...row[0].matchAll(/<a:tc\b[\s\S]*?<\/a:tc>/g)].map((cell) => blockLines(cell[0]).join('\n')),
  )
  return { kind: 'table', box, header: /<a:tblPr\b[^>]*\bfirstRow="1"/.test(xml), rows }
}

function resolveColor(xml: string, colors: Record<string, string>, fallback: string): string {
  const hex = xml.match(/<a:solidFill>\s*<a:srgbClr\s+val="([0-9A-Fa-f]{6})"/)?.[1]
  if (hex) return `#${hex}`
  const scheme = xml.match(/<a:solidFill>\s*<a:schemeClr\s+val="([^"]+)"/)?.[1]
  if (scheme && colors[scheme]) return colors[scheme]
  return fallback
}

function textLines(xml: string, colors: Record<string, string>, inherited = ''): SlideLine[] {
  const defaults = xml.match(/<a:lstStyle\b[\s\S]*?<\/a:lstStyle>/)?.[0] ?? ''
  const fallback = resolveColor(defaults || inherited, colors, colors.tx1 ?? '#111111')
  return [...xml.matchAll(/<a:p\b[\s\S]*?<\/a:p>/g)].flatMap((match) => {
    const text = paragraphText(match[0])
    if (!text) return []
    const paragraph = match[0]
    const fontFamily = paragraph.match(/<a:latin\b[^>]*typeface="([^"]+)"/)?.[1] ?? (defaults + inherited).match(/<a:latin\b[^>]*typeface="([^"]+)"/)?.[1] ?? 'Arial'
    const before = paragraph.match(/<a:spcBef>\s*<a:spcPts\b[^>]*val="(\d+)"/)?.[1]
    const after = paragraph.match(/<a:spcAft>\s*<a:spcPts\b[^>]*val="(\d+)"/)?.[1]
    const spacing = paragraph.match(/<a:lnSpc>\s*<a:spcPct\b[^>]*val="(\d+)"/)?.[1]
    return [{ text, color: resolveColor(paragraph, colors, fallback), sizePt: fontPt(paragraph, fontPt(defaults || inherited)), fontFamily,
      bold: /\bb="1"/.test(paragraph + defaults + inherited), italic: /\bi="1"/.test(paragraph),
      beforePt: Number(before ?? 0) / 100, afterPt: Number(after ?? 0) / 100, lineHeight: Number(spacing ?? 100000) / 100000 }]
  })
}

function imageCrop(xml: string): SlideCrop | undefined {
  const rect = xml.match(/<a:srcRect\b[^>]*>/)
  if (!rect) return undefined
  const part = (name: string): number => Number(attr(rect[0], name) || 0) / 100_000
  const crop = { t: part('t'), b: part('b'), l: part('l'), r: part('r') }
  if (!crop.t && !crop.b && !crop.l && !crop.r) return undefined
  return crop
}

function sliceTagged(xml: string, start: number, tag: string): string | null {
  const rest = xml.slice(start)
  const self = rest.match(new RegExp(`^<${tag}\\b[^>]*/>`))
  if (self) return self[0]
  let depth = 0
  const token = new RegExp(`<(${tag}\\b[^>]*/>|/?${tag}\\b[^>]*>)`, 'g')
  let match: RegExpExecArray | null
  while ((match = token.exec(rest))) {
    if (match[1].startsWith('/') ) depth -= 1
    else if (match[1].endsWith('/>')) {
      if (depth === 0) return rest.slice(0, match.index + match[0].length)
    } else depth += 1
    if (depth === 0) return rest.slice(0, match.index + match[0].length)
  }
  return null
}

function eachChild(xml: string): Array<{ tag: string; xml: string }> {
  const tags = ['p:sp', 'p:pic', 'p:graphicFrame', 'p:grpSp', 'p:cxnSp']
  const open = new RegExp(`<(${tags.join('|')})\\b`, 'g')
  const found: Array<{ tag: string; xml: string }> = []
  let match: RegExpExecArray | null
  while ((match = open.exec(xml))) {
    const sliced = sliceTagged(xml, match.index, match[1])
    if (!sliced) continue
    found.push({ tag: match[1], xml: sliced })
    open.lastIndex = match.index + sliced.length
  }
  return found
}

function relTargets(rels: string): Record<string, string> {
  const embeds: Record<string, string> = {}
  for (const match of rels.matchAll(/Id="(rId[^"]+)"[^>]*Target="([^"]+)"|Target="([^"]+)"[^>]*Id="(rId[^"]+)"/g)) {
    const id = match[1] || match[4]
    const target = match[2] || match[3]
    if (id && target) embeds[id] = target.replace(/.*\//, '')
  }
  return embeds
}

function collectElements(
  xml: string,
  size: { cx: number; cy: number },
  embeds: Record<string, string>,
  colors: Record<string, string>,
  elements: SlideElement[],
  inherited = '',
  skipPlaceholders = false,
): void {
  for (const child of eachChild(xml)) {
    if (child.tag === 'p:grpSp') {
      const inner = child.xml.replace(/^<p:grpSp\b[^>]*>/, '').replace(/<\/p:grpSp>$/, '')
      collectElements(inner, size, embeds, colors, elements, inherited, skipPlaceholders)
      continue
    }
    if (skipPlaceholders && /<p:ph\b/.test(child.xml)) continue
    const ph = child.xml.match(/<p:ph\b[^>]*>/)?.[0]
    const inheritedShape = ph ? eachChild(inherited).find((item) => {
      const other = item.xml.match(/<p:ph\b[^>]*>/)?.[0]
      return other && (attr(ph, 'idx') ?? '0') === (attr(other, 'idx') ?? '0') && (attr(ph, 'type') ?? 'obj') === (attr(other, 'type') ?? 'obj')
    })?.xml ?? '' : ''
    const box = emuBox(child.xml, size.cx, size.cy) ?? emuBox(inheritedShape, size.cx, size.cy)
    if (!box) continue
    if (child.tag === 'p:sp' || child.tag === 'p:cxnSp') {
      const properties = child.xml.match(/<p:spPr\b[\s\S]*?<\/p:spPr>/)?.[0] ?? ''
      const line = properties.match(/<a:ln\b[\s\S]*?<\/a:ln>/)?.[0] ?? ''
      const fill = resolveColor(properties.replace(line, ''), colors, 'transparent')
      const border = resolveColor(line, colors, 'transparent')
      if (fill !== 'transparent' || border !== 'transparent') elements.push({ kind: 'shape', box, fill, border,
        borderWidth: Number(attr(line, 'w') ?? 9525) * SLIDE_W / size.cx,
        geometry: properties.match(/<a:prstGeom\b[^>]*prst="([^"]+)"/)?.[1] ?? 'rect' })
      const lines = textLines(child.xml, colors, inheritedShape)
      if (!lines.length) continue
      const body = child.xml.match(/<a:bodyPr\b[^>]*>/)?.[0] ?? ''
      const px = (name: string): number => Number(attr(body, name) ?? 91440) * SLIDE_W / size.cx
      elements.push({ kind: 'text', box, align: align(child.xml), sizePt: lines[0].sizePt, lines,
        anchor: attr(body, 'anchor') === 'b' ? 'bottom' : attr(body, 'anchor') === 'ctr' ? 'center' : 'top',
        insets: { top: px('tIns'), right: px('rIns'), bottom: px('bIns'), left: px('lIns') } })
      continue
    }
    if (child.tag === 'p:graphicFrame') {
      const table = child.xml.match(/<a:tbl\b[\s\S]*?<\/a:tbl>/)
      if (table) elements.push(parseTable(table[0], box))
      continue
    }
    const blip = child.xml.match(/<a:blip\b[^>]*>/)?.[0] ?? ''
    const embed = attr(blip, 'r:embed')
    const file = embed ? embeds[embed] : null
    if (!file) continue
    elements.push({ kind: 'image', box, file, crop: imageCrop(child.xml) })
  }
}

export function parseSlide(xml: string, rels: string, size: { cx: number; cy: number }, colors: Record<string, string>, inherited: { master?: string; layout?: string; masterRels?: string; layoutRels?: string } = {}): ParsedSlide {
  const elements: SlideElement[] = []
  if (!/\bshowMasterSp="0"/.test(xml)) {
    collectElements(inherited.master ?? '', size, relTargets(inherited.masterRels ?? ''), colors, elements, '', true)
    collectElements(inherited.layout ?? '', size, relTargets(inherited.layoutRels ?? ''), colors, elements, '', true)
  }
  collectElements(xml, size, relTargets(rels), colors, elements, (inherited.layout ?? '') + (inherited.master ?? ''))
  const background = [xml, inherited.layout, inherited.master].map((part) => part?.match(/<p:bg\b[\s\S]*?<\/p:bg>/)?.[0]).find(Boolean) ?? ''
  const scheme = background.match(/<a:schemeClr\s+val="([^"]+)"/)?.[1]
  const hex = background.match(/<a:srgbClr\s+val="([0-9A-Fa-f]{6})"/)?.[1]
  return {
    background: hex ? `#${hex}` : colors[scheme ?? 'bg2'] ?? colors.bg2 ?? '#EBEBEB',
    elements,
  }
}

function boxStyle(box: SlideBox): string {
  return `left:${box.x.toFixed(1)}px;top:${box.y.toFixed(1)}px;width:${box.w.toFixed(1)}px;height:${box.h.toFixed(1)}px`
}

function renderElement(element: SlideElement, mediaHref: (file: string) => string, _colors: Record<string, string>, pxPerPt: number): string {
  if (element.kind === 'shape') {
    const rounded = element.geometry === 'ellipse' ? 'border-radius:50%;' : element.geometry === 'roundRect' ? 'border-radius:12%;' : ''
    const snip = element.geometry === 'snip2DiagRect' ? 'clip-path:polygon(0 0,50% 0,100% 50%,100% 100%,50% 100%,0 50%);' : ''
    return `<div class="shape" style="${boxStyle(element.box)};background:${escapeHtml(element.fill)};border:${element.borderWidth ?? 0}px solid ${escapeHtml(element.border ?? 'transparent')};${rounded}${snip}"></div>`
  }
  if (element.kind === 'image') {
    const src = escapeHtml(mediaHref(element.file))
    const crop = element.crop
    if (!crop) return `<img class="pic" style="${boxStyle(element.box)}" src="${src}" alt="">`
    const width = 100 / Math.max(0.01, 1 - crop.l - crop.r)
    const height = 100 / Math.max(0.01, 1 - crop.t - crop.b)
    return `<div class="pic crop" style="${boxStyle(element.box)}"><img src="${src}" alt="" style="width:${width}%;height:${height}%;left:${(-crop.l * width).toFixed(2)}%;top:${(-crop.t * height).toFixed(2)}%"></div>`
  }
  if (element.kind === 'text') {
    const lines = element.lines
      .map((line) => `<div style="color:${escapeHtml(line.color)};font-size:${(line.sizePt * pxPerPt).toFixed(2)}px;font-family:&quot;${escapeHtml(line.fontFamily ?? 'Arial')}&quot;,Arial,sans-serif;font-weight:${line.bold ? 700 : 400};font-style:${line.italic ? 'italic' : 'normal'};line-height:${line.lineHeight ?? 1};margin-top:${(line.beforePt ?? 0) * pxPerPt}px;margin-bottom:${(line.afterPt ?? 0) * pxPerPt}px">${escapeHtml(line.text)}</div>`)
      .join('')
    const insets = element.insets ?? { top: 0, right: 0, bottom: 0, left: 0 }
    const anchor = element.anchor === 'bottom' ? 'flex-end' : element.anchor === 'center' ? 'center' : 'flex-start'
    return `<div class="text" style="${boxStyle(element.box)};text-align:${element.align};justify-content:${anchor};padding:${insets.top}px ${insets.right}px ${insets.bottom}px ${insets.left}px">${lines}</div>`
  }
  const rows = element.rows.map((row, index) => {
    const tag = element.header && index === 0 ? 'th' : 'td'
    return `<tr>${row.map((cell) => `<${tag}>${escapeHtml(cell).replace(/\n/g, '<br>')}</${tag}>`).join('')}</tr>`
  }).join('')
  return `<div class="table" style="${boxStyle(element.box)}"><table>${rows}</table></div>`
}

export function slideHtml(slides: ParsedSlide[], mediaHref: (file: string) => string, colors: Record<string, string>, size = { cx: DEFAULT_CX, cy: DEFAULT_CY }): string {
  const height = SLIDE_W * size.cy / size.cx
  const accent = colors.accent1 ?? '#B01513'
  const ink = colors.tx1 ?? '#111111'
  const pages = slides.map((slide) => {
    const body = slide.elements.map((element) => renderElement(element, mediaHref, colors, 12700 * SLIDE_W / size.cx)).join('')
    return `<section class="slide" style="background:${escapeHtml(slide.background)}">${body}</section>`
  })
  return `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  @page { size: ${SLIDE_W}px ${height}px; margin: 0 }
  html, body { margin: 0; padding: 0; background: #000 }
  .slide {
    width: ${SLIDE_W}px;
    height: ${height}px;
    position: relative;
    overflow: hidden;
    page-break-after: always;
    break-after: page;
    font-family: "Calibri", "Segoe UI", system-ui, sans-serif;
  }
  .text, .pic, .table, .shape { position: absolute; box-sizing: border-box }
  .text { display: flex; flex-direction: column; overflow:hidden }
  .text > div { flex-shrink: 0; white-space:pre-wrap }
  .pic { object-fit: cover }
  .pic.crop { overflow: hidden }
  .pic.crop img { position: absolute; max-width: none }
  .table { padding: 0 }
  table { width: 100%; height: 100%; border-collapse: collapse; table-layout: fixed }
  th, td {
    border: 1px solid ${escapeHtml(accent)};
    padding: 10px 14px;
    font-size: 22px;
    line-height: 1.25;
    color: ${escapeHtml(ink)};
    background: #fff;
    vertical-align: middle;
    word-wrap: break-word;
  }
  th {
    background: ${escapeHtml(accent)};
    color: #fff;
    font-size: 18px;
    letter-spacing: .04em;
    text-transform: uppercase;
  }
  tr:nth-child(even) td { background: #f4f4f4 }
</style></head><body>${pages.join('')}</body></html>`
}

/** @deprecated kept for older tests that only extracted loose text */
export function slideTexts(xml: string): string[] {
  return blockLines(xml)
}

export function slideBackground(xml: string): string {
  const fromBg = xml.match(/<p:bg[\s\S]*?<a:srgbClr\s+val="([0-9A-Fa-f]{6})"/)
  if (fromBg) return `#${fromBg[1]}`
  const any = xml.match(/<a:srgbClr\s+val="([0-9A-Fa-f]{6})"/)
  return any ? `#${any[1]}` : '#EBEBEB'
}

export function slideImages(rels: string): string[] {
  const images: string[] = []
  for (const match of rels.matchAll(/Type="[^"]*\/image"[^>]*Target="([^"]+)"|Target="([^"]+)"[^>]*Type="[^"]*\/image"/g)) {
    const target = match[1] || match[2]
    if (target) images.push(target.replace(/.*\//, '').replace(/\\/g, '/'))
  }
  return images
}
