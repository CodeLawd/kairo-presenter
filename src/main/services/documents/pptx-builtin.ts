import { BrowserWindow } from 'electron'
import { promises as fs } from 'fs'
import { join, dirname, resolve, relative, isAbsolute } from 'path'
import { load } from 'cheerio'
import { pathToFileURL } from 'url'
import { parseSlide, slideHtml, slideSize, themeColors } from './pptx-slides'
import { extractPptxStatic, pptxSlidePaths } from './pptx-videos'

async function readIfExists(path: string): Promise<string> {
  try {
    return await fs.readFile(path, 'utf8')
  } catch {
    return ''
  }
}

async function relatedPart(root: string, file: string, type: string): Promise<string | null> {
  const rels = await readIfExists(join(dirname(file), '_rels', file.split(/[\\/]/).pop()! + '.rels'))
  const $ = load(rels, { xml: true })
  const relation = $('Relationship').toArray().find((node) => $(node).attr('Type')?.endsWith('/' + type) && $(node).attr('TargetMode') !== 'External')
  if (!relation) return null
  const target = $(relation).attr('Target') ?? ''
  const path = target.startsWith('/') ? resolve(root, '.' + target) : resolve(dirname(file), target)
  const rel = relative(root, path)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Invalid PowerPoint style relationship.')
  return path
}

export async function convertPptxBuiltin(source: string, destPdf: string, workDir: string): Promise<void> {
  const extract = join(workDir, 'pptx')
  try {
    await extractPptxStatic(await fs.readFile(source), extract)
  } catch {
    throw new Error('This PowerPoint file could not be opened. Save it as .pptx or export a PDF and import that instead.')
  }
  const slidesDir = join(extract, 'ppt', 'slides')
  let names: string[]
  try {
    names = pptxSlidePaths(
      await fs.readFile(join(extract, 'ppt', 'presentation.xml'), 'utf8'),
      await fs.readFile(join(extract, 'ppt', '_rels', 'presentation.xml.rels'), 'utf8'),
    ).map((path) => path.split('/').pop()!)
  } catch {
    throw new Error('This older .ppt file needs PowerPoint, WPS, Keynote, or LibreOffice. Save it as .pptx or PDF and import that instead.')
  }
  if (names.length < 1 || names.length > 500) {
    throw new Error('Documents can contain up to 500 pages. Split this document into smaller files.')
  }
  const size = slideSize(await readIfExists(join(extract, 'ppt', 'presentation.xml')))
  const colors = themeColors(await readIfExists(join(extract, 'ppt', 'theme', 'theme1.xml')))
  const mediaDir = join(extract, 'ppt', 'media')
  const slides = await Promise.all(names.map(async (name) => {
    const slidePath = join(slidesDir, name)
    const xml = await fs.readFile(slidePath, 'utf8')
    const rels = await readIfExists(join(slidesDir, '_rels', `${name}.rels`))
    const layoutPath = await relatedPart(extract, slidePath, 'slideLayout')
    const masterPath = layoutPath ? await relatedPart(extract, layoutPath, 'slideMaster') : null
    const themePath = masterPath ? await relatedPart(extract, masterPath, 'theme') : null
    const master = masterPath ? await readIfExists(masterPath) : ''
    const layout = layoutPath ? await readIfExists(layoutPath) : ''
    const slideColors = themePath ? themeColors(await readIfExists(themePath)) : { ...colors }
    const mapping = master.match(/<p:clrMap\b[^>]*>/)?.[0] ?? ''
    const colorSnapshot = { ...slideColors }
    for (const match of mapping.matchAll(/\b(bg[12]|tx[12]|accent[1-6]|hlink|folHlink)="([^"]+)"/g)) {
      if (colorSnapshot[match[2]]) slideColors[match[1]] = colorSnapshot[match[2]]
    }
    const readRels = (path: string | null): Promise<string> => path ? readIfExists(join(dirname(path), '_rels', path.split(/[\\/]/).pop()! + '.rels')) : Promise.resolve('')
    return parseSlide(xml, rels, size, slideColors, { layout, master, layoutRels: await readRels(layoutPath), masterRels: await readRels(masterPath) })
  }))
  const height = Math.round(1920 * size.cy / size.cx)
  const html = slideHtml(slides, (file) => pathToFileURL(join(mediaDir, file)).href, colors, size)
  const htmlPath = join(workDir, 'slides.html')
  await fs.writeFile(htmlPath, html)
  const win = new BrowserWindow({
    width: 1920,
    height,
    show: false,
    frame: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  try {
    await win.loadFile(htmlPath)
    await win.webContents.executeJavaScript(
      `Promise.all([...document.images].map((img) => img.complete ? null : new Promise((resolve) => { img.onload = resolve; img.onerror = resolve })))`,
    )
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      landscape: height <= 1920,
      pageSize: { width: 508000, height: Math.round(height * 508000 / 1920) },
      margins: { marginType: 'none' },
    })
    if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('Could not render this PowerPoint file.')
    await fs.writeFile(destPdf, pdf)
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}
