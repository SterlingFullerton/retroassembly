import type { Config } from '@react-router/dev/config'

export default {
  appDirectory: 'src/pages',
  buildDirectory: 'dist',
  // The browser draws every page and loads its data from /api/v1/pages; the Go server sends the same index.html for all
  ssr: false,
} satisfies Config
