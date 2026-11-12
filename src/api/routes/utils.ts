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

export function createFileResponse(
  object:
    | { body: ReadableStream<Uint8Array>; httpEtag: string; range?: { end: number; offset: number }; size: number }
    | R2ObjectBody,
  fileId?: string,
) {
  const headers = new Headers()
  // this may fail when using miniflare
  if ('writeHttpMetadata' in object) {
    try {
      object.writeHttpMetadata(headers)
    } catch {}
  }
  if (!headers.get('Content-Type') && fileId) {
    const contentType = getContentType(fileId)
    if (contentType) {
      headers.set('Content-Type', contentType)
    }
  }
  headers.set('ETag', object.httpEtag)
  headers.set('Accept-Ranges', 'bytes')
  let start = 0
  let end = object.size - 1
  const { range } = object
  if (range && 'offset' in range && range.offset !== undefined) {
    start = range.offset
    if ('end' in range) {
      ;({ end } = range)
    } else if ('length' in range && range.length !== undefined) {
      end = start + range.length - 1
    }
    headers.set('Content-Range', `bytes ${start}-${end}/${object.size}`)
  }
  headers.set('Content-Length', String(end - start + 1))
  const status = headers.has('Content-Range') ? 206 : 200
  return new Response(object.body, { headers, status })
}
