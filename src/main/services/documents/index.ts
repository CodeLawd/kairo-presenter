import { app, dialog, nativeImage } from 'electron'
import { promises as fs } from 'fs'
import { basename, extname, join } from 'path'
import { randomUUID } from 'crypto'
import log from 'electron-log/main'
import type { DocumentSlide, DocumentsCapabilities, ProjectionDocument, DocumentImportInfo } from '@shared/documents'
import { formatDocumentSize, POWERPOINT_NEEDS_CONVERTER, normalizeDocumentName, validDocumentPage } from '@shared/documents'
import { allowPickedOverlayMedia } from '../ndi/media-allowlist'
import {
  convertPowerPointToPdf,
  detectPowerpointConverters,
} from './converters'
import { convertPptxBuiltin } from './pptx-builtin'
import { readPptxVideos } from './pptx-videos'

class DocumentsService {
  private pending = new Map<string, ProjectionDocument>()
  private get root(): string { return join(app.getPath('userData'), 'documents') }
  private directory(id: string): string {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid document ID.')
    return join(this.root, id)
  }
  async capabilities(): Promise<DocumentsCapabilities> {
    const converters = await detectPowerpointConverters()
    return {
      converters: [...converters, 'builtin'],
      canConvertPowerPoint: true,
      libreOffice: converters.includes('libreoffice'),
    }
  }
  async list(): Promise<ProjectionDocument[]> {
    await fs.mkdir(this.root, { recursive: true })
    const documents: ProjectionDocument[] = []
    for (const id of await fs.readdir(this.root)) {
      try {
        const dir = this.directory(id)
        const metadata = JSON.parse(await fs.readFile(join(dir, 'document.json'), 'utf8')) as ProjectionDocument
        if (typeof metadata.name !== 'string' || !['pdf', 'ppt', 'pptx'].includes(metadata.format) || !Array.isArray(metadata.pages) || !Number.isInteger(metadata.pages.length) || metadata.pages.length < 1 || metadata.pages.length > 500) continue
        metadata.id = id
        metadata.pages = metadata.pages.map((_, i) => join(dir, `${i}.png`))
        metadata.pages.forEach(allowPickedOverlayMedia)
        this.allowVideos(metadata, dir)
        documents.push(metadata)
      } catch { /* Incomplete imports are never listed. */ }
    }
    return documents.sort((a, b) => a.name.localeCompare(b.name))
  }
  async prepare(kind?: 'pdf' | 'powerpoint', onPreparing?: (document: DocumentImportInfo) => void): Promise<{ id: string; data: Uint8Array; name: string; format: ProjectionDocument['format'] } | null> {
    if (kind !== undefined && kind !== 'pdf' && kind !== 'powerpoint') throw new Error('Unsupported document type.')
    const extensions = kind === 'pdf'
      ? ['pdf']
      : kind === 'powerpoint'
        ? ['ppt', 'pptx']
        : ['pdf', 'ppt', 'pptx']
    // With no kind the picker takes both formats in one pass, so the operator
    // never has to know in advance which one they are reaching for.
    const filters = kind
      ? [{ name: kind === 'powerpoint' ? 'PowerPoint' : 'PDF', extensions }]
      : [
          { name: 'PDF or PowerPoint', extensions },
          { name: 'PDF', extensions: ['pdf'] },
          { name: 'PowerPoint', extensions: ['ppt', 'pptx'] },
        ]
    const result = await dialog.showOpenDialog({
      title: kind === 'powerpoint' ? 'Import PowerPoint' : kind === 'pdf' ? 'Import PDF' : 'Import document',
      properties: ['openFile'],
      filters,
    })
    if (result.canceled || !result.filePaths[0]) return null
    const source = result.filePaths[0]
    const format = extname(source).slice(1).toLowerCase() as ProjectionDocument['format']
    if (!['pdf', 'ppt', 'pptx'].includes(format)) throw new Error('Choose a PDF or PowerPoint file.')
    const maxMB = format === 'pptx' ? 500 : 100
    const sizeBytes = (await fs.stat(source)).size
    onPreparing?.({ name: basename(source, extname(source)), format, sizeBytes, maxSizeBytes: maxMB * 1024 * 1024 })
    if (sizeBytes > maxMB * 1024 * 1024) throw new Error(`This document is ${formatDocumentSize(sizeBytes)}. The maximum for ${format.toUpperCase()} files is ${maxMB} MB.`)
    const id = randomUUID()
    const dir = this.directory(id)
    await fs.mkdir(dir, { recursive: true })
    try {
      const copy = join(dir, `source.${format}`)
      await fs.copyFile(source, copy)
      const metadata: ProjectionDocument = { id, name: basename(source, extname(source)), format, pages: [] }
      if (format === 'pptx') {
        const embedded = await readPptxVideos(await fs.readFile(copy))
        metadata.slideSize = { width: embedded.width, height: embedded.height }
        metadata.videos = embedded.slides
        metadata.warnings = embedded.warnings
        const mediaDir = join(dir, 'media')
        await fs.mkdir(mediaDir, { recursive: true })
        for (const [file, bytes] of embedded.media) await fs.writeFile(join(mediaDir, file), bytes)
      } else if (format === 'ppt') {
        metadata.warnings = ['Embedded video playback requires .pptx. Save this presentation as .pptx and import again to play its videos.']
      }
      let pdf = copy
      if (format !== 'pdf') {
        const dest = join(dir, 'source.pdf')
        let used: string
        try {
          used = await convertPowerPointToPdf(copy, dest, dir)
        } catch (error) {
          if (format !== 'pptx') {
            throw error instanceof Error && /needs an app that can convert/.test(error.message)
              ? new Error(POWERPOINT_NEEDS_CONVERTER)
              : error
          }
          await convertPptxBuiltin(copy, dest, dir)
          used = 'builtin'
        }
        log.info('[Documents] Converted PowerPoint', { converter: used, format })
        pdf = dest
      }
      const data = await fs.readFile(pdf)
      if (data.length > 100 * 1024 * 1024) throw new Error('Converted PDF exceeds 100 MB.')
      this.pending.set(id, metadata)
      return { id, data, name: metadata.name, format }
    } catch (error) {
      await fs.rm(dir, { recursive: true, force: true })
      throw error
    }
  }
  async savePage(id: string, page: number, png: Uint8Array): Promise<void> {
    const doc = this.pending.get(id)
    if (!doc || page !== doc.pages.length || !validDocumentPage(page, 500)) throw new Error('Invalid import page.')
    if (!(png instanceof Uint8Array) || png.length > 20 * 1024 * 1024) throw new Error('Page image is too large.')
    const image = nativeImage.createFromBuffer(Buffer.from(png))
    const size = image.getSize()
    if (image.isEmpty() || size.width > 3840 || size.height > 3840) throw new Error('Invalid page image.')
    const path = join(this.directory(id), `${page}.png`)
    await fs.writeFile(path, image.toPNG())
    doc.pages.push(path)
  }
  async finish(id: string): Promise<ProjectionDocument[]> {
    const doc = this.pending.get(id)
    if (!doc?.pages.length) throw new Error('No pages were rendered.')
    if (doc.videos && doc.videos.length !== doc.pages.length) throw new Error('PowerPoint conversion changed the slide count. Export this deck again before importing.')
    const dir = this.directory(id)
    await fs.writeFile(join(dir, 'document.json.tmp'), JSON.stringify(doc))
    await fs.rename(join(dir, 'document.json.tmp'), join(dir, 'document.json'))
    this.pending.delete(id)
    return this.list()
  }
  async cancel(id: string): Promise<void> {
    if (!this.pending.has(id)) return
    this.pending.delete(id)
    await fs.rm(this.directory(id), { recursive: true, force: true })
  }
  async rename(id: string, name: string): Promise<ProjectionDocument[]> {
    const nextName = normalizeDocumentName(name)
    const dir = this.directory(id)
    const metadataPath = join(dir, 'document.json')
    let metadata: ProjectionDocument
    try {
      metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8')) as ProjectionDocument
    } catch {
      throw new Error('Document not found.')
    }
    if (metadata.name === nextName) return this.list()
    metadata.name = nextName
    metadata.id = id
    await fs.writeFile(join(dir, 'document.json.tmp'), JSON.stringify(metadata))
    await fs.rename(join(dir, 'document.json.tmp'), metadataPath)
    return this.list()
  }
  async remove(id: string): Promise<ProjectionDocument[]> {
    if (!(await this.list()).some(doc => doc.id === id)) throw new Error('Document not found.')
    await fs.rm(this.directory(id), { recursive: true, force: true })
    return this.list()
  }
  /**
   * Path of one page, read without scanning the library.
   *
   * `list()` opens and parses every document on disk; doing that on each page
   * turn put the whole library between a clicker press and the screen. Only
   * this document's metadata is read, and the page is allowlisted for the
   * pa-media protocol exactly as a listing would do.
   */
  async page(id: string, page: number): Promise<string> {
    const dir = this.directory(id)
    let metadata: ProjectionDocument
    try {
      metadata = JSON.parse(await fs.readFile(join(dir, 'document.json'), 'utf8')) as ProjectionDocument
    } catch {
      throw new Error('Document page not found.')
    }
    if (!Array.isArray(metadata.pages) || !validDocumentPage(page, metadata.pages.length)) {
      throw new Error('Document page not found.')
    }
    const path = join(dir, `${page}.png`)
    await fs.access(path)
    allowPickedOverlayMedia(path)
    return path
  }

  private allowVideos(doc: ProjectionDocument, dir: string): void {
    for (const videos of doc.videos ?? []) {
      for (const video of videos) {
        if (!/^[^/\\]+\.(mp4|m4v|webm|mov|ogv)$/i.test(video.file)) throw new Error('Invalid document video filename.')
        allowPickedOverlayMedia(join(dir, 'media', video.file))
      }
    }
  }

  async slide(id: string, page: number): Promise<DocumentSlide> {
    const path = await this.page(id, page)
    const dir = this.directory(id)
    const doc = JSON.parse(await fs.readFile(join(dir, 'document.json'), 'utf8')) as ProjectionDocument
    this.allowVideos(doc, dir)
    const videos = (doc.videos?.[page] ?? []).map((video) => ({ ...video, file: join(dir, 'media', video.file) }))
    for (const video of videos) await fs.access(video.file)
    const size = doc.slideSize ?? nativeImage.createFromPath(path).getSize()
    return { id, page, path, width: size.width, height: size.height, videos }
  }
}
export const documentsService = new DocumentsService()
