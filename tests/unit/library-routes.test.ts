import assert from 'node:assert/strict'
import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

// What each library address answers, signed in and out, through the real pages. It needs the app built (dist), and is
// skipped otherwise
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

function request(url: string, signedIn: boolean) {
  return fetch(new URL(url, base), { headers: signedIn ? { Cookie: cookie } : {}, redirect: 'manual' })
}

async function post(url: string, body: BodyInit, headers: Record<string, string> = {}) {
  return await fetch(new URL(url, base), { body, headers, method: 'POST' })
}

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
        await new Promise((resolve) => setTimeout(resolve, 100))
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
    await it(`sends a signed-out visitor from ${url} to log in, and back after`, async () => {
      const response = await request(url, false)
      assert.equal(response.status, 302)
      assert.equal(response.headers.get('Location'), location)
    })
  }

  const signedIn: [url: string, status: number][] = [
    ['/library', 200],
    ['/library/roms', 200],
    ['/library/roms?page=1&sort=added&direction=desc', 200],
    ['/library/favorites', 200],
    ['/library/history', 200],
    ['/library/platform/nes', 200],
    ['/library/platform/nes?favorite=true', 200],
    ['/library/platform/nes/rom/Test%20Game.nes', 200],
    ['/library/platform/nes/rom/Missing.nes', 404],
    ['/library/platform/not-a-console', 404],
  ]
  for (const [url, status] of signedIn) {
    await it(`answers ${url} with ${status} when signed in`, async () => {
      const response = await request(url, true)
      assert.equal(response.status, status)
    })
  }

  await it("shows the game's page with its name in the title", async () => {
    const response = await request('/library/platform/nes/rom/Test%20Game.nes', true)
    const html = await response.text()
    assert.match(html, /<title>Test Game - RetroAssembly<\/title>/u)
  })

  await it('shows the shared layout around every page', async () => {
    for (const [url] of signedIn.filter(([, status]) => status === 200)) {
      const response = await request(url, true)
      const html = await response.text()
      assert.match(html, /library-layout/u, url)
    }
  })
})
