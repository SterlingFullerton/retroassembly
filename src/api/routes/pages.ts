import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { getConsolesPageData } from '#@/controllers/pages/get-consoles-page-data.ts'
import { getHomePageData } from '#@/controllers/pages/get-home-page-data.ts'
import { getLibraryLayoutData } from '#@/controllers/pages/get-library-layout-data.ts'
import { getLoginPageData } from '#@/controllers/pages/get-login-page-data.ts'
import { getPlatformPageData } from '#@/controllers/pages/get-platform-page-data.ts'
import { getRomPageData } from '#@/controllers/pages/get-rom-page-data.ts'
import { requireUser } from '#@/middlewares/require-user.ts'
import { loadFavoritesPage, loadGamesPage, loadHistoryPage } from '#@/utils/server/list-page.ts'
import { getCommonLoaderData } from '#@/utils/server/loader-data.ts'

// A list's sort, order, page and search, as the page has them in its address. Read from the query by getRomsQuery, which
// falls back to the defaults for anything it can't use
const listQuery = z
  .object({ direction: z.string(), favorite: z.string(), page: z.string(), q: z.string(), sort: z.string() })
  .partial()

// What each page shows, loaded by the page in the browser
const library = new Hono()
  .use(requireUser())
  .get('', async (c) => c.json(await getLibraryLayoutData()))
  .get('home', async (c) => c.json(await getHomePageData()))
  .get('roms', zValidator('query', listQuery), async (c) => c.json(await loadGamesPage()))
  .get('consoles', async (c) => c.json(await getConsolesPageData()))
  .get('favorites', zValidator('query', listQuery), async (c) => c.json(await loadFavoritesPage()))
  .get('history', zValidator('query', listQuery), async (c) => c.json(await loadHistoryPage()))
  .get('platform', zValidator('query', listQuery.extend({ platform: z.string() })), async (c) =>
    c.json(await getPlatformPageData(c.req.valid('query').platform)),
  )
  .get('rom', zValidator('query', z.object({ file_name: z.string().min(1), platform: z.string() })), async (c) => {
    const { file_name: fileName, platform } = c.req.valid('query')
    return c.json(await getRomPageData({ fileName, platform }))
  })

export const pages = new Hono()
  // What every page shares; `path` is the page's, which decides its language
  .get('common', zValidator('query', z.object({ path: z.string().optional() })), (c) => c.json(getCommonLoaderData()))
  .get(
    'login',
    zValidator('query', z.object({ error: z.string().optional(), redirect_to: z.string().optional() })),
    async (c) => {
      const { error, redirect_to: redirectTo } = c.req.valid('query')
      return c.json(await getLoginPageData({ error, redirectTo }))
    },
  )
  .route('library', library)
