import { BlobReader, BlobWriter, ZipReader } from '@zip.js/zip.js'
import { isBrowser } from 'es-toolkit'
import { Nostalgist } from 'nostalgist'
import { relocateShaderFiles } from '#@/emulator/adapter.ts'
import { toCDNCacheUrl } from '#@/utils/isomorphic/cdn.ts'
import { getCoreUrl, getShaderUrls } from '#@/utils/isomorphic/emulator-files.ts'
import { bundledCoreUrls } from './bundled-cores.ts'
import { downloadWithProgress } from './download.ts'

const extractCache = new Map<string, ReturnType<typeof extractCore>>()

type CoreProgressListener = (core: string, loaded: number, total: number | undefined) => void
const coreProgressListeners = new Set<CoreProgressListener>()

/** Listens to emulators' downloads, for a game that's loading to show; returns a function that stops listening */
export function onCoreDownloadProgress(listener: CoreProgressListener) {
  coreProgressListeners.add(listener)
  return () => {
    coreProgressListeners.delete(listener)
  }
}

async function extractCore(core: string) {
  const url = bundledCoreUrls[core] ?? toCDNCacheUrl(getCoreUrl(core))
  const buffer = await downloadWithProgress(url, {
    kind: 'emulator',
    onProgress(loaded, total) {
      for (const listener of coreProgressListeners) {
        listener(core, loaded, total)
      }
    },
  })
  const zipFileReader = new BlobReader(new Blob([buffer]))
  const zipReader = new ZipReader(zipFileReader)
  const entries = await zipReader.getEntries()
  const result: { js?: Blob; wasm?: Blob } = {}
  await Promise.all(
    entries.map(async (entry) => {
      if (entry && !entry.directory) {
        if (entry.filename.endsWith('.js')) {
          // Typed as JavaScript: an emulator that runs on several threads (the PSP's) starts each thread from this
          // file, and browsers only start a module worker from JavaScript
          result.js = await entry.getData?.(new BlobWriter('text/javascript'))
        } else if (entry.filename.endsWith('.wasm')) {
          result.wasm = await entry.getData?.(new BlobWriter('application/octet-stream'))
        }
      }
    }),
  )
  if (!result.js || !result.wasm) {
    throw new Error(`Failed to extract core files for ${core}`)
  }
  return result as { js: Blob; wasm: Blob }
}

async function extractCoreWithCache(core: string) {
  if (extractCache.has(core)) {
    return extractCache.get(core) as ReturnType<typeof extractCore>
  }
  const promise = extractCore(core)
  extractCache.set(core, promise)
  const result = await promise
  extractCache.delete(core)
  return result
}

const style: Partial<CSSStyleDeclaration> = {
  backgroundPosition: ['left center', 'right center'].join(','),
  backgroundRepeat: 'no-repeat',
  backgroundSize: 'contain',
  border: 'none',
  cursor: 'none',
  opacity: '0',
  outline: 'none',
  transition: 'opacity .1s',
}

if (isBrowser()) {
  const { path } = Nostalgist.vendors
  Nostalgist.configure({
    beforeLaunch(nostalgist) {
      relocateShaderFiles(nostalgist, path)
    },
    // Everything fetched is kept between games except the game itself, or every game reached for would stay in memory
    // for as long as the tab is open
    cache: { bios: true, core: true, rom: false, shader: true, sram: true, state: true },
    async resolveCoreJs(core) {
      if (typeof core !== 'string') {
        throw new TypeError('Invalid core js file')
      }
      const response = await extractCoreWithCache(core)
      return response.js
    },
    async resolveCoreWasm(core) {
      if (typeof core !== 'string') {
        throw new TypeError('Invalid core js file')
      }
      const response = await extractCoreWithCache(core)
      return response.wasm
    },
    resolveShader(name) {
      return getShaderUrls(name).map((url) => toCDNCacheUrl(url))
    },
    style,
  })
}
