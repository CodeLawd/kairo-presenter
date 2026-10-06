import JSZip from 'jszip'
import { load, type CheerioAPI } from 'cheerio'
import { dirname, join, posix } from 'path'
import { promises as fs } from 'fs'
import { formatDocumentSize } from '@shared/documents'
import type { DocumentVideo } from '@shared/documents'

type XmlSelection = ReturnType<CheerioAPI>
const tags = (scope: XmlSelection, name: string): XmlSelection =>
  scope.find('*').filter((_, node) => 'name' in node && node.name.split(':').pop() === name)
function attr(node: XmlSelection, name: string): string | undefined {
  return Object.entries(node.attr() ?? {}).find(([key]) => key.split(':').pop() === name)?.[1]
}
function relationships(xml: string): Map<string, { target: string; external: boolean }> {
  const $ = load(xml, { xml: true })
  const result = new Map<string, { target: string; external: boolean }>()
  tags($.root(), 'Relationship').each((_, node) => {
    const item = $(node)
    result.set(attr(item, 'Id') ?? '', { target: attr(item, 'Target') ?? '', external: attr(item, 'TargetMode') === 'External' })
  })
  return result
}

const packagePath = (base: string, target: string): string =>
  posix.normalize(target.startsWith('/') ? target.slice(1) : posix.join(base, target))

/** Follow sldIdLst rather than the creation-time numbers in slide filenames. */
export function pptxSlidePaths(xml: string, relsXml: string): string[] {
  const $ = load(xml, { xml: true })
  const rels = relationships(relsXml)
  return tags(tags($.root(), 'sldIdLst'), 'sldId').map((_, node) => {
    // sldId also has a numeric unqualified id; select the relationship attribute.
    const attributes = $(node).attr() ?? {}
    const id = Object.entries(attributes).find(([key]) => key.includes(':') && key.split(':').pop() === 'id')?.[1]
    const rel = rels.get(id ?? '')
    if (!rel || rel.external) throw new Error('Invalid PowerPoint slide relationship.')
    const path = packagePath('ppt', rel.target)
    if (!/^ppt\/slides\/[^/\\]+\.xml$/i.test(path)) throw new Error('Invalid PowerPoint slide path.')
    return path
  }).get()
}

/** The static fallback needs XML and slide artwork, never arbitrary ZIP contents. */
export async function extractPptxStatic(data: Buffer, destination: string): Promise<void> {
  const zip = await JSZip.loadAsync(data)
  let total = 0
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || !name.startsWith('ppt/')) continue
    const original = (entry as JSZip.JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName
    if ((original && original !== name) || name.includes('\\') || name.split('/').some((part) => part === '..' || part === '.')) {
      throw new Error('Invalid PowerPoint archive path.')
    }
    const xml = /\.(xml|rels)$/i.test(name)
    if (!xml && !/^ppt\/media\/[^/]+\.(png|jpe?g|gif|svg|bmp|webp|tiff?|emf|wmf)$/i.test(name)) continue
    const bytes = await entryBytes(zip, name, (xml ? 5 : 20) * 1024 * 1024)
    if (!bytes) continue
    total += bytes.length
    if (total > 100 * 1024 * 1024) throw new Error('PowerPoint slide artwork exceeds 100 MB.')
    const file = join(destination, ...name.split('/'))
    await fs.mkdir(dirname(file), { recursive: true })
    await fs.writeFile(file, bytes)
  }
}

/** Bounded streaming decompression: imported archives cannot expand without limit. */
async function entryBytes(zip: JSZip, path: string, maxBytes: number): Promise<Buffer | null> {
  const entry = zip.file(path)
  if (!entry) return null
  const limitError = (): Error => {
    const label = /\.(xml|rels)$/i.test(path) ? 'PowerPoint metadata' : /\.(mp4|m4v|webm|mov|ogv)$/i.test(path) ? 'Embedded video' : 'PowerPoint artwork'
    const declaredSize = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize
    const size = declaredSize && Number.isFinite(declaredSize) && declaredSize > maxBytes ? ` is ${formatDocumentSize(declaredSize)} and` : ''
    return new Error(`${label} “${posix.basename(path)}”${size} exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB limit. Reduce its size and import again.`)
  }
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = []
    let bytes = 0
    const stream = entry.nodeStream('nodebuffer')
    stream.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > maxBytes) {
        stream.pause()
        reject(limitError())
        return
      }
      parts.push(chunk)
    })
    stream.on('error', reject)
    stream.on('end', () => resolve(Buffer.concat(parts)))
  })
}

export async function readPptxVideos(data: Buffer): Promise<{
  width: number; height: number; slides: DocumentVideo[][]; media: Map<string, Buffer>; warnings: string[]
}> {
  const zip = await JSZip.loadAsync(data)
  let xmlBytes = 0
  const xml = async (path: string): Promise<string> => {
    const bytes = await entryBytes(zip, path, 5 * 1024 * 1024)
    xmlBytes += bytes?.length ?? 0
    if (xmlBytes > 50 * 1024 * 1024) throw new Error('PowerPoint slide metadata exceeds 50 MB.')
    return bytes?.toString('utf8') ?? ''
  }
  const presentation = await xml('ppt/presentation.xml')
  const paths = pptxSlidePaths(presentation, await xml('ppt/_rels/presentation.xml.rels'))
  if (!paths.length || paths.length > 500) throw new Error('PowerPoint must contain between 1 and 500 slides.')
  const $p = load(presentation, { xml: true })
  const size = tags($p.root(), 'sldSz')
  const width = Number(attr(size, 'cx')) || 12192000
  const height = Number(attr(size, 'cy')) || 6858000
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('Invalid PowerPoint slide size.')
  const media = new Map<string, Buffer>()
  const warnings: string[] = []
  const slides: DocumentVideo[][] = []
  let total = 0
  for (const [page, path] of paths.entries()) {
    const $ = load(await xml(path), { xml: true })
    const rels = relationships(await xml(posix.join(posix.dirname(path), '_rels', posix.basename(path) + '.rels')))
    const videos: DocumentVideo[] = []
    for (const node of tags($.root(), 'pic').toArray()) {
      const picture = $(node)
      const reference = tags(picture, 'media').first()
      const legacy = tags(picture, 'videoFile').first()
      if (!legacy.length) continue // Audio-only shapes aren't document videos.
      const relation = rels.get(attr(reference, 'embed') ?? attr(legacy, 'link') ?? '')
      const warn = (reason: string): void => { warnings.push(`Slide ${page + 1}: ${reason}`) }
      if (!relation || relation.external) {
        warn('Linked or online video cannot be played. Embed the video in PowerPoint and import again.')
        continue
      }
      const target = packagePath(posix.dirname(path), relation.target)
      if (!/^ppt\/media\/[^/\\]+\.(mp4|m4v|webm|mov|ogv)$/i.test(target)) {
        warn('Video is missing or uses an unsupported format. Use an embedded MP4 or WebM file.')
        continue
      }
      const xfrm = tags(tags(picture, 'spPr'), 'xfrm').first()
      // Group transforms and rotation need a richer compositor; surface them honestly.
      const grouped = picture.parents().toArray().some((parent) => 'name' in parent && parent.name.split(':').pop() === 'grpSp')
      if (grouped || Number(attr(xfrm, 'rot')) || attr(xfrm, 'flipH') === '1' || attr(xfrm, 'flipV') === '1') {
        warn('Grouped, flipped or rotated video placement is not supported yet.')
        continue
      }
      const off = tags(xfrm, 'off').first()
      const ext = tags(xfrm, 'ext').first()
      const box = { x: Number(attr(off, 'x')) / width, y: Number(attr(off, 'y')) / height, width: Number(attr(ext, 'cx')) / width, height: Number(attr(ext, 'cy')) / height }
      if (!Object.values(box).every(Number.isFinite) || box.width <= 0 || box.height <= 0) {
        warn('Video placement could not be read.')
        continue
      }
      const overlapping = picture.nextAll().toArray().some((sibling) => {
        if (!('name' in sibling) || !['sp', 'pic', 'graphicFrame', 'grpSp', 'cxnSp'].includes(sibling.name.split(':').pop() ?? '')) return false
        const item = $(sibling)
        if (tags(item, 'videoFile').length) return false
        const transform = tags(item, 'xfrm').first()
        const offset = tags(transform, 'off').first()
        const extent = tags(transform, 'ext').first()
        if (!offset.length || !extent.length) return true // Layout-inherited geometry is unknown.
        const x = Number(attr(offset, 'x')) / width, y = Number(attr(offset, 'y')) / height
        const w = Number(attr(extent, 'cx')) / width, h = Number(attr(extent, 'cy')) / height
        return x < box.x + box.width && x + w > box.x && y < box.y + box.height && y + h > box.y
      })
      if (overlapping) warn('Video playback appears above overlapping slide text or shapes. Move those objects beside the video for reliable playback.')
      const file = posix.basename(target)
      if (!media.has(file)) {
        const bytes = await entryBytes(zip, target, 200 * 1024 * 1024)
        if (!bytes) { warn('Embedded video file is missing.'); continue }
        total += bytes.length
        if (total > 500 * 1024 * 1024) throw new Error('Embedded videos exceed 500 MB. Split this presentation into smaller files.')
        media.set(file, bytes)
      }
      const trim = tags(picture, 'trim').first()
      const start = Math.max(0, Number(attr(trim, 'st')) / 1000 || 0)
      const end = Number(attr(trim, 'end')) / 1000
      videos.push({ file, box, start, ...(Number.isFinite(end) && end > start ? { end } : {}) })
    }
    slides.push(videos)
  }
  return { width, height, slides, media, warnings }
}
