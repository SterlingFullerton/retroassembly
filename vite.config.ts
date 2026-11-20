import { once } from 'node:events'
import net from 'node:net'
import path from 'node:path'
import { createConfig } from '@arianrhodsandlot/vite-plus-config'
import { reactRouter } from '@react-router/dev/vite'
import tailwindcss from '@tailwindcss/vite'
import { attemptAsync } from 'es-toolkit'
import { defaults, noop } from 'es-toolkit/compat'
import { $, execa, type ResultPromise } from 'execa'
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

async function isPortFree(port: number) {
  const server = net.createServer()
  server.listen(port, '0.0.0.0')
  // once() rejects when the server emits an error instead, as when the port is taken
  const [error] = await attemptAsync(() => once(server, 'listening'))
  if (error) {
    return false
  }
  server.close()
  await once(server, 'close')
  return true
}

async function freePort(from: number) {
  for (let port = from; port < from + 100; port += 1) {
    if (await isPortFree(port)) {
      return port
    }
  }
  throw new Error(`No free port from ${from} to ${from + 99} for the Go server`)
}

// Without the API nothing works, so development stops with it rather than answering every request with an error
async function stopWithApi(api: ResultPromise, stopping: { current: boolean }) {
  const { exitCode, signal } = await api
  if (!stopping.current) {
    console.error(`The Go server stopped (${exitCode ?? signal}), so the dev server is stopping too`)
    process.exit(1)
  }
}

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
    // React Router's dev server loads this config more than once in the same process; the server is started once, on
    // the first free port after the app's, so another server already listening there is never proxied to by mistake
    let apiPort: number | undefined = Reflect.get(globalThis, 'retroassemblyGoServerPort')
    if (!apiPort) {
      apiPort = await freePort(port + 1)
      Reflect.set(globalThis, 'retroassemblyGoServerPort', apiPort)
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
      const stopping = { current: false }
      process.once('exit', function stopApi() {
        stopping.current = true
        api.kill()
      })
      queueMicrotask(() => stopWithApi(api, stopping))
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
