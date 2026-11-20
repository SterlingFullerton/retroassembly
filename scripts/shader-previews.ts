// Makes the shader previews in public/assets/shaders: libretro's test card (the one its own previews show) drawn through
// each shader in the list, at 8 times its size, as RetroArch draws it. Run it again when shaders are added:
//
//   node scripts/shader-previews.ts [--out <folder>] [--png] [shader id ...]
//
// It needs git and Chrome. The shaders come from libretro/glsl-shaders at the version the app pins, the card from
// libretro/docs (MIT).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { chromium } from '@playwright/test'
import { shadersRepository } from '../src/consoles/assets.ts'
import { shaders } from '../src/consoles/shaders.ts'

const card = {
  // libretro/docs, docs/image/shader/upscale-test.png: 64 by 64
  url: 'https://raw.githubusercontent.com/libretro/docs/35b22b41444b7d547d7f239669332c634acb455b/docs/image/shader/upscale-test.png',
}
const scale = 8
const origin = 'http://shader-previews.local'

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { out: { default: path.join('public', 'assets', 'shaders'), type: 'string' }, png: { type: 'boolean' } },
})

const cache = path.resolve('node_modules', '.cache', 'retroassembly')
const repository = path.join(cache, 'glsl-shaders')

async function getShaders() {
  try {
    await fs.access(path.join(repository, '.git'))
  } catch {
    await fs.mkdir(cache, { recursive: true })
    execFileSync(
      'git',
      [
        'clone',
        '--quiet',
        '--filter=blob:none',
        '--no-checkout',
        `https://github.com/${shadersRepository.repository}.git`,
        repository,
      ],
      {
        stdio: 'inherit',
      },
    )
  }
  execFileSync('git', ['-C', repository, 'fetch', '--quiet', 'origin', shadersRepository.version], { stdio: 'inherit' })
  execFileSync('git', ['-C', repository, 'checkout', '--quiet', shadersRepository.version], { stdio: 'inherit' })
}

async function getCard() {
  const file = path.join(cache, 'upscale-test.png')
  try {
    return await fs.readFile(file)
  } catch {
    const response = await fetch(card.url)
    if (!response.ok) {
      throw new Error(`Failed to fetch the test card: ${response.status}`)
    }
    const content = Buffer.from(await response.arrayBuffer())
    await fs.writeFile(file, content)
    return content
  }
}

await getShaders()
const picture = await getCard()
const wanted = shaders.filter(({ id }) => id && (positionals.length === 0 || positionals.includes(id)))

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  channel: 'chrome',
})
const page = await browser.newPage()
const renderer = await fs.readFile(path.join(import.meta.dirname, 'shader-previews', 'render.js'), 'utf8')
await page.route(`${origin}/**`, async (route) => {
  const requested = decodeURIComponent(new URL(route.request().url()).pathname)
  if (requested === '/') {
    return route.fulfill({ body: `<!doctype html><script>${renderer}</script>`, contentType: 'text/html' })
  }
  if (requested === '/card.png') {
    return route.fulfill({ body: picture, contentType: 'image/png' })
  }
  const file = path.join(repository, requested)
  if (!file.startsWith(repository + path.sep)) {
    return route.fulfill({ status: 404 })
  }
  try {
    return route.fulfill({ body: await fs.readFile(file), contentType: 'text/plain' })
  } catch {
    return route.fulfill({ status: 404 })
  }
})
await page.goto(`${origin}/`)

await fs.mkdir(values.out, { recursive: true })
const failed: string[] = []
for (const { id } of wanted) {
  try {
    const dataUrl = await page.evaluate(
      async ([preset, size, type]) => {
        const png = await globalThis.renderPreset(preset, '/card.png', size)
        if (type === 'image/png') {
          return png
        }
        // Encoded again as WebP by the browser itself
        const image = new Image()
        image.src = png
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        canvas.getContext('2d')?.drawImage(image, 0, 0)
        return canvas.toDataURL(type, 0.9)
      },
      [`/${id}.glslp`, 64 * scale, values.png ? 'image/png' : 'image/webp'] as const,
    )
    const file = path.join(values.out, `${id}.${values.png ? 'png' : 'webp'}`)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, Buffer.from(dataUrl.split(',')[1], 'base64'))
    console.info(`${id}: ${file}`)
  } catch (error) {
    failed.push(id)
    console.error(`${id}: ${error instanceof Error ? error.message : error}`)
  }
}
await browser.close()
if (failed.length > 0) {
  console.error(`Failed: ${failed.join(', ')}`)
  process.exitCode = 1
}
