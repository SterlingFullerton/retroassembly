import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { it } from 'node:test'

// Radix's own tabs open when focused, which here means under a passing mouse. The app's (src/pages/components/tabs.tsx)
// open only when pressed, so nothing else may take Tabs from Radix

const source = new URL('../../src/', import.meta.url).pathname
const wrapper = path.join(source, 'pages/components/tabs.tsx')

async function sourceFiles() {
  const names = await readdir(source, { recursive: true })
  return names.filter((name) => /\.tsx?$/u.test(name)).map((name) => path.join(source, name))
}

await it('takes its tabs from the app’s own, which open only when pressed', async () => {
  const offenders: string[] = []
  for (const file of await sourceFiles()) {
    if (file === wrapper) {
      continue
    }
    const content = await readFile(file, 'utf8')
    for (const { groups } of content.matchAll(/import\s*\{(?<names>[^}]*)\}\s*from\s*'(?<from>[^']+)'/gu)) {
      const { from = '', names = '' } = groups ?? {}
      const takesTabs = names.split(',').some((name) => /^Tabs(?:\s+as\s+\w+)?$/u.test(name.trim()))
      if (takesTabs && (from.startsWith('@radix-ui/') || from === 'radix-ui')) {
        offenders.push(path.relative(source, file))
      }
    }
  }
  assert.deepEqual(offenders, [], 'Import Tabs from #@/pages/components/tabs.tsx instead')
})
