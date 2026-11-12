// Writes Brotli (.br) and gzip (.gz) copies of the built text files next to them. The Node server's static file
// handler sends a copy instead of the original when the browser accepts it, so styles and scripts are compressed
// without any work per request.
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { brotliCompress, constants, gzip } from 'node:zlib'

const root = path.resolve(import.meta.dirname, '../dist/client')
const textExtensions = new Set(['.css', '.html', '.js', '.json', '.mjs', '.svg', '.txt', '.webmanifest', '.xml'])
// Below this, compressing saves too little to be worth a second request path
const minimumSize = 1024

const brotli = promisify(brotliCompress)
const gzipAsync = promisify(gzip)

async function* walk(directory: string): AsyncGenerator<string> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      yield* walk(entryPath)
    } else if (entry.isFile()) {
      yield entryPath
    }
  }
}

let files = 0
let originalBytes = 0
let brotliBytes = 0
for await (const file of walk(root)) {
  if (!textExtensions.has(path.extname(file))) {
    continue
  }
  const { size } = await stat(file)
  if (size < minimumSize) {
    continue
  }
  const content = await readFile(file)
  const [br, gz] = await Promise.all([
    brotli(content, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }),
    gzipAsync(content, { level: 9 }),
  ])
  await Promise.all([writeFile(`${file}.br`, br), writeFile(`${file}.gz`, gz)])
  files += 1
  originalBytes += content.length
  brotliBytes += br.length
}

console.info(
  `Precompressed ${files} files: ${Math.round(originalBytes / 1024)} KB -> ${Math.round(brotliBytes / 1024)} KB with Brotli`,
)
