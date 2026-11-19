import path from 'node:path'
import { zValidator } from '@hono/zod-validator'
import { pull } from 'es-toolkit'
import { Hono } from 'hono'
import { DateTime } from 'luxon'
import { z } from 'zod'
import type { PlatformName } from '#@/constants/platform.ts'
import { deleteLaunchRecord } from '#@/controllers/launch-records/delete-launch-record.ts'
import { countSearchMatches } from '#@/controllers/roms/count-search-matches.ts'
import { createRom } from '#@/controllers/roms/create-roms.ts'
import { deleteRom } from '#@/controllers/roms/delete-rom.ts'
import { deleteRoms } from '#@/controllers/roms/delete-roms.ts'
import { findRomsByFiles } from '#@/controllers/roms/find-roms-by-files.ts'
import { getOnThisDayPicks, getPlayTogetherPicks, getRediscoverPicks } from '#@/controllers/roms/get-home-picks.ts'
import { getRomContent } from '#@/controllers/roms/get-rom-content.ts'
import { searchRoms } from '#@/controllers/roms/search-roms.ts'
import { updateRom } from '#@/controllers/roms/update-rom.ts'
import { getStates } from '#@/controllers/states/get-states.ts'
import { dateFormatMap } from '#@/utils/isomorphic/i18n.ts'
import { assertCanWriteLibrary, findRom } from '#@/utils/server/library-scope.ts'
import { nanoid } from '#@/utils/server/nanoid.ts'
import { streamFormData } from '#@/utils/server/stream-form-data.ts'
import { createFileResponse } from '../utils.ts'

export const roms = new Hono()
  .post(
    '',

    // Reject read-only users before their upload is written to disk
    async (c, next) => {
      assertCanWriteLibrary(c.var.scope)
      await next()
    },

    // Stream the uploaded ROM to disk instead of letting zValidator buffer the whole body in memory
    streamFormData(),

    zValidator(
      'form',
      z.object({
        file: z.instanceof(File),
        md5: z.string().optional(),
        platform: z.string<PlatformName>(),
      }),
    ),

    async (c) => {
      const form = c.req.valid('form')
      const rom = await createRom(c.var.scope, { file: form.file, md5: form.md5, platform: form.platform })
      return c.json(rom)
    },
  )

  .patch(
    ':id',

    zValidator(
      'form',
      z.object({
        gameBoxartFileIds: z.string().optional(),
        gameDescription: z.string().optional(),
        gameDeveloper: z.string().optional(),
        gameGenres: z.string().optional(),
        gameName: z.string().optional(),
        gamePlayers: z.string().optional(),
        gamePublisher: z.string().optional(),
        gameReleaseDate: z.string().optional(),
        gameThumbnailFileIds: z.string().optional(),
      }),
    ),

    async (c) => {
      const { language, preference } = c.var
      const form = c.req.valid('form')
      const id = c.req.param('id')
      const dateFormat = preference.ui.dateFormat === 'auto' ? dateFormatMap[language] : preference.ui.dateFormat
      const gameReleaseDate = form.gameReleaseDate
        ? DateTime.fromFormat(form.gameReleaseDate, dateFormat, { zone: 'utc' }).setZone('utc').toJSDate() || null
        : null
      const rom = {
        ...Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value || null])),
        gamePlayers: form.gamePlayers ? Math.trunc(Number(form.gamePlayers)) : null,
        gameReleaseDate,
      }

      const ret = await updateRom(c.var.scope, { id, ...rom })
      return c.json(ret)
    },
  )

  .post(
    ':id/boxart',

    zValidator(
      'form',
      z.object({
        file: z.instanceof(File),
      }),
    ),

    async (c) => {
      const form = c.req.valid('form')
      const { scope } = c.var
      const id = c.req.param('id')
      assertCanWriteLibrary(scope)
      const rom = await findRom(scope, id)

      const extname = path.extname(form.file.name)
      const fileId = path.join('attachments', scope.user.id, rom.platform, rom.id, `${nanoid()}${extname}`)
      await scope.storage.put(fileId, form.file)
      const updatedRom = await updateRom(c.var.scope, { gameBoxartFileIds: fileId, id })
      return c.json(updatedRom.gameBoxartFileIds)
    },
  )

  .delete(
    ':id/boxart',

    async (c) => {
      await updateRom(c.var.scope, { gameBoxartFileIds: null, id: c.req.param('id') })
      return c.json(null)
    },
  )

  .post(
    ':id/thumbnail',

    zValidator(
      'form',
      z.object({
        file: z.instanceof(File),
      }),
    ),

    async (c) => {
      const form = c.req.valid('form')
      const { scope } = c.var
      const id = c.req.param('id')
      assertCanWriteLibrary(scope)
      const rom = await findRom(scope, id)

      const gameThumbnailFileIds: string[] = rom.gameThumbnailFileIds?.split(',') || []
      const extname = path.extname(form.file.name)
      const fileId = path.join('attachments', scope.user.id, rom.platform, rom.id, `${nanoid()}${extname}`)
      await scope.storage.put(fileId, form.file)
      gameThumbnailFileIds.push(fileId)
      const updatedRom = await updateRom(c.var.scope, { gameThumbnailFileIds: gameThumbnailFileIds.join(','), id })
      return c.json(updatedRom.gameThumbnailFileIds)
    },
  )

  .delete(
    ':id/thumbnail/:thumbnailId{.+}',

    async (c) => {
      const { scope } = c.var
      const id = c.req.param('id')
      const thumbnailId = c.req.param('thumbnailId')
      assertCanWriteLibrary(scope)
      const rom = await findRom(scope, id)
      const gameThumbnailFileIds: string[] = rom.gameThumbnailFileIds?.split(',') || []
      pull(gameThumbnailFileIds, [thumbnailId])
      const updatedRom = await updateRom(c.var.scope, {
        gameThumbnailFileIds: gameThumbnailFileIds.length > 0 ? gameThumbnailFileIds.join(',') : null,
        id,
      })
      return c.json(updatedRom.gameThumbnailFileIds)
    },
  )

  // Which games are in the given files (comma separated), to name games kept on a device
  .get('by_files', zValidator('query', z.object({ ids: z.string().min(1).max(4000) })), async (c) => {
    const ids = c.req
      .valid('query')
      .ids.split(',')
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(0, 100)
    return c.json(await findRomsByFiles(c.var.scope, ids))
  })

  .get(':id/content', async (c) => {
    const object = await getRomContent(c.var.scope, c.req.param('id'))
    return object ? createFileResponse(object) : c.notFound()
  })

  .get(
    ':id/states',

    zValidator(
      'query',
      z.object({
        type: z.enum(['auto', 'manual']).optional(),
      }),
    ),

    async (c) => {
      const query = c.req.valid('query')
      const rom = c.req.param('id')
      const states = await getStates(c.var.scope, { rom, type: query.type })
      return c.json(states)
    },
  )

  .delete(
    ':id/launch_records',

    async (c) => {
      const rom = c.req.param('id')
      await deleteLaunchRecord(c.var.scope, { rom })
      return c.json(null)
    },
  )

  .delete(':id', async (c) => {
    await deleteRom(c.var.scope, c.req.param('id'))
    return c.json(null)
  })

  .delete(
    '',

    zValidator(
      'query',
      z.object({
        ids: z.string().min(1),
      }),
    ),

    async (c) => {
      const query = c.req.valid('query')
      const ids = query.ids
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
      await deleteRoms(c.var.scope, ids)
      return c.json(null)
    },
  )

  // Home's rows of picks: well-rated games never played, games released on a day (the browser's, as MM-DD), and games
  // for two or more players
  .get('rediscover', async (c) => c.json(await getRediscoverPicks(c.var.scope)))
  .get('on_this_day', zValidator('query', z.object({ date: z.string().regex(/^\d{2}-\d{2}$/u) })), async (c) =>
    c.json(await getOnThisDayPicks(c.var.scope, c.req.valid('query').date)),
  )
  .get('play_together', async (c) => c.json(await getPlayTogetherPicks(c.var.scope)))

  // How many games match a search, in all and on each console, for the counts in the sidebar
  .get('search_counts', zValidator('query', z.object({ query: z.string().min(1).max(100) })), async (c) => {
    const { query } = c.req.valid('query')
    return c.json(await countSearchMatches(c.var.scope, query))
  })

  .get(
    'search',

    zValidator(
      'query',
      z.object({
        page: z.coerce.number().default(1),
        page_size: z.coerce.number().default(100),
        platform: z.string().optional(),
        query: z.string().min(1),
      }),
    ),

    async (c) => {
      const queryParams = c.req.valid('query')
      const result = await searchRoms(c.var.scope, {
        page: queryParams.page,
        pageSize: queryParams.page_size,
        platform: queryParams.platform as PlatformName,
        query: queryParams.query,
      })
      return c.json(result)
    },
  )
