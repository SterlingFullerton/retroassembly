// Packs the emulators that come from RetroArch's official browser build into public/cores, so the app serves them
// itself. The archive is downloaded once from libretro's build server, checked against its known fingerprint, and
// only the emulators the app uses are kept, each as a zip of its .js and .wasm as the app loads them.
// Needs `bsdtar` (libarchive), which reads the 7z archive and writes the zips.
//
//   node scripts/retroarch-cores.ts [folder for emulators, public/cores by default]
//
// They go in a subfolder named for the RetroArch version, the address the app loads them from
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { officialRetroArch } from '../src/consoles/assets.ts'
import { emulators } from '../src/consoles/emulators.ts'

const outputDir = path.resolve(
  process.argv[2] ?? path.join('public', 'cores'),
  `retroarch-${officialRetroArch.version}`,
)
const archivePath =
  process.env.RETROARCH_ARCHIVE ?? path.join(tmpdir(), `RetroArch-${officialRetroArch.version}-emscripten.7z`)

async function sha256(file: string) {
  const hash = createHash('sha256')
  await pipeline(createReadStream(file), hash)
  return hash.digest('hex')
}

async function download() {
  if (existsSync(archivePath) && (await sha256(archivePath)) === officialRetroArch.sha256) {
    return
  }
  console.info(`Downloading ${officialRetroArch.url}`)
  const response = await fetch(officialRetroArch.url)
  if (!response.ok || !response.body) {
    throw new Error(`Couldn't download RetroArch: ${response.status}`)
  }
  await pipeline(
    Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
    createWriteStream(archivePath),
  )
  const actual = await sha256(archivePath)
  if (actual !== officialRetroArch.sha256) {
    rmSync(archivePath, { force: true })
    throw new Error(`RetroArch's archive doesn't match its fingerprint: ${actual}`)
  }
}

async function main() {
  const cores = Object.entries(emulators)
    .filter(([, { source }]) => source === 'retroarch')
    .map(([name]) => name)
  const missing = cores.filter((core) => !existsSync(path.join(outputDir, `${core}_libretro.zip`)))
  if (missing.length === 0) {
    console.info(`RetroArch emulators already in ${outputDir}`)
    return
  }

  await download()
  const work = mkdtempSync(path.join(tmpdir(), 'retroarch-'))
  try {
    const members = missing.flatMap((core) => [`retroarch/${core}_libretro.js`, `retroarch/${core}_libretro.wasm`])
    execFileSync('bsdtar', ['-xf', archivePath, '-C', work, ...members], { stdio: 'inherit' })
    mkdirSync(outputDir, { recursive: true })
    for (const core of missing) {
      const zip = path.join(outputDir, `${core}_libretro.zip`)
      execFileSync(
        'bsdtar',
        [
          '--format',
          'zip',
          '-cf',
          zip,
          '-C',
          path.join(work, 'retroarch'),
          `${core}_libretro.js`,
          `${core}_libretro.wasm`,
        ],
        { stdio: 'inherit' },
      )
    }
    console.info(`Packed ${missing.length} RetroArch emulators into ${outputDir}`)
  } finally {
    rmSync(work, { force: true, recursive: true })
  }
}

await main()
