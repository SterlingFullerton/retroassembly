const mimeTypes: Record<string, string> = {
  '.avi': 'video/x-msvideo',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.mp4': 'video/mp4',
  '.ogv': 'video/ogg',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
}

function getContentType(fileId: string) {
  const dotIndex = fileId.lastIndexOf('.')
  if (dotIndex !== -1) {
    return mimeTypes[fileId.slice(dotIndex).toLowerCase()]
  }
}

// A stored file, or the part of it a range request asked for
export interface StoredFile {
  body: ReadableStream<Uint8Array>
  httpEtag: string
  range?: { end: number; offset: number }
  size: number
}

export function createFileResponse(object: StoredFile, fileId?: string) {
  const headers = new Headers()
  if (fileId) {
    const contentType = getContentType(fileId)
    if (contentType) {
      headers.set('Content-Type', contentType)
    }
  }
  // A stored file is only ever data: box art, a game, a save. One that holds a script, such as an uploaded SVG, can't
  // run it on this site when opened on its own, and a browser never guesses a type the file wasn't given
  headers.set(
    'Content-Security-Policy',
    "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'",
  )
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('ETag', object.httpEtag)
  headers.set('Accept-Ranges', 'bytes')
  let start = 0
  let end = object.size - 1
  if (object.range) {
    start = object.range.offset
    ;({ end } = object.range)
    headers.set('Content-Range', `bytes ${start}-${end}/${object.size}`)
  }
  headers.set('Content-Length', String(end - start + 1))
  const status = headers.has('Content-Range') ? 206 : 200
  return new Response(object.body, { headers, status })
}
