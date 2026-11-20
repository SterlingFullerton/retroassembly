import path from 'node:path'
import { createConfig } from '@arianrhodsandlot/vite-plus-config'
import { reactRouter } from '@react-router/dev/vite'
import tailwindcss from '@tailwindcss/vite'
import { defaults, noop } from 'es-toolkit/compat'
import { $, execa } from 'execa'
import fs from 'fs-extra'
import { DateTime } from 'luxon'
import devtoolsJson from 'vite-plugin-devtools-json'
import { defineConfig, type Plugin, type UserConfig } from 'vite-plus'
import { logServerInfo } from './scripts/utils.ts'
import { getDirectories } from './src/constants/env.ts'

defaults(process.env, {
  RETROASSEMBLY_BUILD_TIME_VITE_BUILD_TIME: DateTime.now().setZone('utc').toISO(),
  RETROASSEMBLY_BUILD_TIME_VITE_VERSION: await getVersion(),
  RETROASSEMBLY_RUN_TIME_PORT: '8000',
})

async function getVersion() {
  return (await getGitDescription()) ?? ''
}

async function getGitDescription() {
  try {
    const {
      stdout: [revision],
    } = await $({ lines: true })`git describe --tags`
    return revision
  } catch {}
}

function serverInfo() {
  const plugin: Plugin = {
    configureServer(server) {
      const { httpServer } = server
      server.printUrls = noop
      server.bindCLIShortcuts = noop
      server.config.logger.info = noop
      httpServer?.on('listening', () => {
        const address = httpServer?.address()
        if (address && typeof address === 'object') {
          logServerInfo('localhost', address.port, true)
        }
      })
    },
    name: 'log-server-info',
  }
  return plugin
}

export default defineConfig(async (env) => {
  const envPort = process.env.RETROASSEMBLY_RUN_TIME_PORT || process.env.PORT
  const port = envPort ? Math.trunc(Number(envPort)) || 8000 : 8000
  const plugins = [tailwindcss({ optimize: false }), reactRouter(), [devtoolsJson()], serverInfo()]
  const config: UserConfig = {
    build: { chunkSizeWarningLimit: 1024 },
    clearScreen: false,
    envPrefix: 'RETROASSEMBLY_BUILD_TIME_VITE_',
    plugins: plugins as UserConfig['plugins'],
    server: {
      allowedHosts: true,
      hmr: { overlay: true },
      host: true,
      open: true,
      port,
    },
  }

  if (env.command === 'serve') {
    // The API is the Go server's (server/), started here on the next port, with the same settings and data folder
    const { dataDirectory, storageDirectory } = getDirectories()
    await fs.ensureDir(dataDirectory)
    await fs.ensureDir(storageDirectory)
    const apiPort = port + 1
    // React Router's dev server loads this config more than once in the same process; the server is started once
    if (!Reflect.get(globalThis, 'retroassemblyGoServer')) {
      Reflect.set(globalThis, 'retroassemblyGoServer', true)
      // Built rather than run with `go run`, so it starts in this folder, where its defaults (the migrations, the game
      // info database, the built browser app) are
      const binary = path.resolve('node_modules', '.cache', 'retroassembly', 'retroassembly-dev')
      await $({
        stderr: 'inherit',
        stdout: 'inherit',
      })`go -C server build -tags nodynamic -o ${binary} ./cmd/retroassembly`
      const api = execa(binary, {
        env: { RETROASSEMBLY_RUN_TIME_PORT: String(apiPort) },
        reject: false,
        stderr: 'inherit',
        stdout: 'inherit',
      })
      process.once('exit', () => api.kill())
    }
    const target = `http://localhost:${apiPort}`
    config.server = {
      ...config.server,
      proxy: Object.fromEntries(['/api/', '/cdn/', '/login/oidc', '/logout'].map((prefix) => [prefix, { target }])),
    }
  }
  config.resolve = {
    alias: {
      '@entry.server.tsx': path.resolve(
        'node_modules',
        '@react-router',
        'dev',
        'dist',
        'config',
        'defaults',
        'entry.server.node.tsx',
      ),
    },
  }

  return createConfig(config)
})
