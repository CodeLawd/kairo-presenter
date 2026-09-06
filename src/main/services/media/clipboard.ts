import { clipboard } from 'electron'
import { fileURLToPath, pathToFileURL } from 'url'

/**
 * Puts absolute file paths on the system pasteboard the way Finder expects.
 *
 * On macOS each Electron `clipboard.write*` call clears the pasteboard first,
 * so writing text and then buffers in sequence leaves only the last write.
 * We write a single `NSFilenamesPboardType` payload and stop.
 *
 * In-app Paste also keeps its own item-id list in MediaService — that is the
 * reliable path when round-tripping our own Copy/Cut.
 */
export function writeFilePathsToClipboard(paths: readonly string[]): void {
  const absolute = paths.filter((p) => typeof p === 'string' && p.length > 0)
  if (absolute.length === 0) return

  if (process.platform === 'darwin') {
    const plist = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0">',
      '<array>',
      ...absolute.map((p) => `<string>${escapeXml(p)}</string>`),
      '</array>',
      '</plist>',
    ].join('\n')
    clipboard.writeBuffer('NSFilenamesPboardType', Buffer.from(plist, 'utf8'))
    return
  }

  // Linux / Windows: plain paths are enough for our own paste reader.
  clipboard.writeText(absolute.map((p) => pathToFileURL(p).href).join('\n'))
}

/**
 * Absolute paths currently on the pasteboard, if any.
 * Accepts Finder's file list, file URLs, or a plain newline-separated path list.
 */
export function readFilePathsFromClipboard(): string[] {
  if (process.platform === 'darwin') {
    try {
      const names = clipboard.readBuffer('NSFilenamesPboardType').toString('utf8')
      const fromPlist = [...names.matchAll(/<string>([^<]+)<\/string>/g)].map((m) =>
        unescapeXml(m[1]),
      )
      if (fromPlist.length > 0) return fromPlist
    } catch {
      /* empty or wrong type */
    }

    try {
      // Finder sometimes exposes a single file this way.
      const single = clipboard.read('public.file-url')?.trim()
      if (single) {
        try {
          return [fileURLToPath(single.startsWith('file:') ? single : `file://${single}`)]
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* empty */
    }

    try {
      const urls = clipboard.readBuffer('public.file-url').toString('utf8')
      const fromUrls = urls
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((url) => {
          try {
            return fileURLToPath(url.startsWith('file:') ? url : `file://${url}`)
          } catch {
            return ''
          }
        })
        .filter(Boolean)
      if (fromUrls.length > 0) return fromUrls
    } catch {
      /* empty */
    }
  }

  return clipboard
    .readText()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (line.startsWith('file:')) {
        try {
          return fileURLToPath(line)
        } catch {
          return ''
        }
      }
      if (line.startsWith('/') || /^[A-Za-z]:[\\/]/.test(line)) return line
      return ''
    })
    .filter(Boolean)
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function unescapeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
}
