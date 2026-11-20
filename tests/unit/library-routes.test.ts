import assert from 'node:assert/strict'
import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { getLoginUrl } from '#@/utils/client/page-data.ts'

// What each library address answers, signed in and out. Every page is the same index.html, which loads the page's data
// from /api/v1/pages; this checks that data, and where a signed-out visitor is sent. It needs the app built (dist), and
// is skipped otherwise
const serverPath = path.resolve('dist/server/serve.js')
const built = existsSync(serverPath)
const port = 18_000 + Math.trunc(Math.random() * 2000)
const base = `http://127.0.0.1:${port}`
let server: ChildProcess | undefined

const directory = await mkdtemp(path.join(os.tmpdir(), 'retroassembly-library-routes-'))
process.env.RETROASSEMBLY_RUN_TIME_DATA_DIRECTORY = path.join(directory, 'data')
process.env.RETROASSEMBLY_RUN_TIME_STORAGE_DIRECTORY = path.join(directory, 'data', 'storage')
// No game info database, so games are added by their file names alone
process.env.RETROASSEMBLY_RUN_TIME_GAME_INFO_DATABASE = path.join(directory, 'game-info.sqlite')

let cookie = ''

function request(url: string, signedIn: boolean, headers: Record<string, string> = {}) {
  return fetch(new URL(url, base), { headers: signedIn ? { ...headers, Cookie: cookie } : headers, redirect: 'manual' })
}

async function post(url: string, body: BodyInit, headers: Record<string, string> = {}) {
  return await fetch(new URL(url, base), { body, headers, method: 'POST' })
}

await describe('where a signed-out visitor is sent to log in', async () => {
  const signedOut: [url: string, location: string][] = [
    ['/library', '/login'],
    ['/library/roms', '/login?redirect_to=%2Flibrary%2Froms'],
    ['/library/roms?page=2&sort=added', '/login?redirect_to=%2Flibrary%2Froms%3Fpage%3D2%26sort%3Dadded'],
    ['/library/favorites', '/login?redirect_to=%2Flibrary%2Ffavorites'],
    ['/library/history', '/login?redirect_to=%2Flibrary%2Fhistory'],
    ['/library/platform/nes', '/login?redirect_to=%2Flibrary%2Fplatform%2Fnes'],
    [
      '/library/platform/nes/rom/Test%20Game.nes',
      '/login?redirect_to=%2Flibrary%2Fplatform%2Fnes%2From%2FTest%2520Game.nes',
    ],
  ]
  for (const [url, location] of signedOut) {
    await it(`sends a signed-out visitor from ${url} to log in, and back after`, () => {
      assert.equal(getLoginUrl(new Request(new URL(url, 'http://localhost'))), location)
    })
  }
})

await describe('library routes', { skip: built ? false : 'the app is not built' }, async () => {
  before(async () => {
    await mkdir(path.join(directory, 'data', 'storage'), { recursive: true })
    server = spawn(process.execPath, [serverPath], {
      env: { ...process.env, NODE_ENV: 'production', PORT: String(port), RETROASSEMBLY_RUN_TIME_PORT: String(port) },
      stdio: 'ignore',
    })
    for (let attempt = 0; attempt < 200; attempt += 1) {
      try {
        await fetch(new URL('/robots.txt', base))
        break
      } catch {
        await new Promise((resolve) => {
          setTimeout(resolve, 100)
        })
      }
    }

    const form = new FormData()
    form.append('username', 'player')
    form.append('password', 'library-routes-1')
    const response = await post('/api/v1/auth/register', form)
    cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ')
    await post('/api/v1/preference', JSON.stringify({ ui: { platforms: ['nes'] } }), {
      'Content-Type': 'application/json',
      Cookie: cookie,
    })
    const upload = new FormData()
    upload.append('platform', 'nes')
    upload.append('file', new File([new Uint8Array(4096).fill(7)], 'Test Game.nes'))
    await post('/api/v1/roms', upload, { Cookie: cookie })
  })

  after(async () => {
    server?.kill()
    await rm(directory, { force: true, recursive: true })
  })

  const pageData = [
    '/api/v1/pages/library',
    '/api/v1/pages/library/home',
    '/api/v1/pages/library/roms',
    '/api/v1/pages/library/consoles',
    '/api/v1/pages/library/favorites',
    '/api/v1/pages/library/history',
    '/api/v1/pages/library/platform?platform=nes',
    '/api/v1/pages/library/rom?platform=nes&file_name=Test%20Game.nes',
  ]
  for (const url of pageData) {
    await it(`answers ${url} with 401 when signed out`, async () => {
      const response = await request(url, false)
      assert.equal(response.status, 401)
    })
  }

  const signedIn: [url: string, status: number][] = [
    ...pageData.map((url): [string, number] => [url, 200]),
    ['/api/v1/pages/library/roms?page=1&sort=added&direction=desc', 200],
    ['/api/v1/pages/library/platform?platform=nes&favorite=true', 200],
    ['/api/v1/pages/library/rom?platform=nes&file_name=Missing.nes', 404],
    ['/api/v1/pages/library/rom?platform=not-a-console&file_name=Test%20Game.nes', 404],
    ['/api/v1/pages/library/platform?platform=not-a-console', 404],
  ]
  for (const [url, status] of signedIn) {
    await it(`answers ${url} with ${status} when signed in`, async () => {
      const response = await request(url, true)
      assert.equal(response.status, status)
    })
  }

  await it("gives the game's page its name for the title", async () => {
    const response = await request('/api/v1/pages/library/rom?platform=nes&file_name=Test%20Game.nes', true)
    const data = await response.json()
    assert.equal(data.title, 'Test Game')
  })

  await it('sends a signed-in visitor from the login page to the page they wanted', async () => {
    const response = await request('/api/v1/pages/login?redirect_to=%2Flibrary%2Froms', true)
    assert.deepEqual(await response.json(), { redirect: '/library/roms' })
  })

  await it('answers every page with the same page, which draws itself', async () => {
    const pages = ['/library', '/library/roms', '/library/platform/nes/rom/Test%20Game.nes', '/login']
    const htmls = await Promise.all(
      pages.map(async (url) => {
        const response = await request(url, false)
        assert.equal(response.status, 200, url)
        return response.text()
      }),
    )
    for (const html of htmls) {
      assert.equal(html, htmls[0])
    }
    assert.match(htmls[0], /"isSpaMode":true/u)
  })

  await it('sends a visit to / on to the library', async () => {
    const response = await request('/', false)
    assert.equal(response.status, 302)
    assert.equal(response.headers.get('Location'), '/library')
  })

  await it('logs out only when asked from the app itself', async () => {
    const fromElsewhere = await request('/logout', true, { 'Sec-Fetch-Site': 'cross-site' })
    assert.equal(fromElsewhere.status, 302)
    const stillSignedIn = await request('/api/v1/pages/library', true)
    assert.equal(stillSignedIn.status, 200)

    const fromApp = await request('/logout', true, { 'Sec-Fetch-Site': 'same-origin' })
    assert.equal(fromApp.status, 302)
    const signedOut = await request('/api/v1/pages/library', true)
    assert.equal(signedOut.status, 401)
  })
})
