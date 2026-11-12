import { Hono } from 'hono'
import { getRunTimeEnv } from '#@/constants/env.ts'
import { getFileContent } from '#@/utils/server/misc.ts'
import { createFileResponse } from '../utils.ts'

// A single "bytes=start-end" or "bytes=start-" range; anything else is answered with the whole file
function parseRange(header?: string) {
  const match = header?.match(/^bytes=(?<start>\d+)-(?<end>\d*)$/u)
  if (!match?.groups) {
    return
  }
  const offset = Number(match.groups.start)
  const end = match.groups.end ? Number(match.groups.end) : undefined
  if (end !== undefined && end < offset) {
    return
  }
  return { length: end === undefined ? undefined : end - offset + 1, offset }
}

export const files = new Hono().get(':id{.+}', async (c) => {
  const id = c.req.param('id')
  const runTimeEnv = getRunTimeEnv()
  if (runTimeEnv.RETROASSEMBLY_RUN_TIME_STORAGE_HOST) {
    return c.redirect(new URL(id, runTimeEnv.RETROASSEMBLY_RUN_TIME_STORAGE_HOST))
  }
  const file = await getFileContent(id, { range: parseRange(c.req.header('Range')) })
  if (file) {
    // The browser already has this exact file
    if (c.req.header('If-None-Match') === file.httpEtag) {
      await file.body?.cancel()
      return c.body(null, 304, { ETag: file.httpEtag })
    }
    return createFileResponse(file, id)
  }
})
