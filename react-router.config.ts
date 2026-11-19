import type { Config } from '@react-router/dev/config'
import { $ } from 'execa'
import fs from 'fs-extra'

export default {
  appDirectory: 'src/pages',
  buildDirectory: 'dist',
  async buildEnd() {
    await $({ stderr: 'inherit', stdout: 'inherit' })`vp pack`
    await fs.move('dist/scripts', 'dist/server', { overwrite: true })
  },
  // The browser draws every page and loads its data from /api/v1/pages; the server sends the same index.html for all
  ssr: false,
} satisfies Config
