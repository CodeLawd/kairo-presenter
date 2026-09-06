const MIME_BY_EXT: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/x-m4v',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.ogv': 'video/ogg',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
}

export function mediaMimeType(filePath: string): string {
  const dot = filePath.lastIndexOf('.')
  const ext = dot >= 0 ? filePath.slice(dot).toLowerCase() : ''
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

/** Inclusive byte range for a `Range` header, or null to send the whole file. */
export function parseByteRange(rangeHeader: string | null | undefined, size: number): { start: number; end: number } | null {
  if (!rangeHeader || size <= 0) return null
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim())
  if (!match) return null
  const hasStart = match[1] !== ''
  const hasEnd = match[2] !== ''
  if (!hasStart && !hasEnd) return null
  if (!hasStart) {
    const suffix = Number(match[2])
    if (!Number.isInteger(suffix) || suffix <= 0) return null
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(match[1])
  const end = hasEnd ? Number(match[2]) : size - 1
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= size || start > end) {
    return null
  }
  return { start, end: Math.min(end, size - 1) }
}

export function rangeResponseHeaders(
  size: number,
  type: string,
  range: { start: number; end: number } | null,
): { status: number; headers: Record<string, string> } {
  if (!range) {
    return {
      status: 200,
      headers: {
        'Content-Type': type,
        'Content-Length': String(size),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache',
      },
    }
  }
  return {
    status: 206,
    headers: {
      'Content-Type': type,
      'Content-Length': String(range.end - range.start + 1),
      'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
    },
  }
}
