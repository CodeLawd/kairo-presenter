import { BrowserWindow } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { parseSlide, slideHtml, slideSize, themeColors } from './pptx-slides'

const run = promisify(execFile)

async function unzipPptx(source: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true })
  if (process.platform === 'darwin') {
    await run('ditto', ['-x', '-k', source, dest], { timeout: 60_000, maxBuffer: 1024 * 1024 })
    return
  }
  if (process.platform === 'win32') {
    await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -Force -LiteralPath ${JSON.stringify(source)} -DestinationPath ${JSON.stringify(dest)}`],
      { timeout: 60_000, maxBuffer: 1024 * 1024 },
    )
    return
  }
  await run('unzip', ['-o', '-q', source, '-d', dest], { timeout: 60_000, maxBuffer: 1024 * 1024 })
}

async function readIfExists(path: string): Promise<string> {
  try {
    return await fs.readFile(path, 'utf8')
  } catch {
    return ''
  }
}

export async function convertPptxBuiltin(source: string, destPdf: string, workDir: string): Promise<void> {
  const extract = join(workDir, 'pptx')
  try {
    await unzipPptx(source, extract)
  } catch {
    throw new Error('This PowerPoint file could not be opened. Save it as .pptx or export a PDF and import that instead.')
  }
  const slidesDir = join(extract, 'ppt', 'slides')
  let names: string[]
  try {
    names = (await fs.readdir(slidesDir))
      .filter((name) => /^slide\d+\.xml$/i.test(name))
      .sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')))
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
    const xml = await fs.readFile(join(slidesDir, name), 'utf8')
    const rels = await readIfExists(join(slidesDir, '_rels', `${name}.rels`))
    return parseSlide(xml, rels, size, colors)
  }))
  const html = slideHtml(slides, (file) => pathToFileURL(join(mediaDir, file)).href, colors)
  const htmlPath = join(workDir, 'slides.html')
  await fs.writeFile(htmlPath, html)
  const win = new BrowserWindow({
    width: 1920,
    height: 1080,
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
      landscape: true,
      pageSize: { width: 508000, height: 285750 },
      margins: { marginType: 'none' },
    })
    if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('Could not render this PowerPoint file.')
    await fs.writeFile(destPdf, pdf)
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}
