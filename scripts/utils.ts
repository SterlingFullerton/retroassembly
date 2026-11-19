import { styleText } from 'node:util'
import { $ } from 'execa'
import isDocker from 'is-docker'
import { metadata } from '../src/constants/metadata.ts'

export const exec = $({ env: { FORCE_COLOR: 'true' }, verbose: 'short' })

export function logServerInfo(hostname: string, port: number | string, isDev = false) {
  const banner = styleText(
    'red',
    String.raw`
╔═════════════════════════════════════════════════════════╗
║ ___     _             _                     _    _      ║
║| _ \___| |_ _ _ ___  /_\   ______ ___ _ __ | |__| |_  _ ║
║|   / -_)  _| '_/ _ \/ _ \ (_-<_-</ -_) '  \| '_ \ | || |║
║|_|_\___|\__|_| \___/_/ \_\/__/__/\___|_|_|_|_.__/_|\_, |║
║                                                    |__/ ║
╚═════════════════════════════════════════════════════════╝`,
  )
  const title = `${styleText('bold', metadata.title)}${isDev ? ' dev server' : ''}`
  const url = new URL('', `http://${hostname}`)
  url.port = port.toString()
  const link = styleText(['green', 'underline'], url.href)
  const messages = [title, `is running at ${link}`]
  if (isDocker()) {
    messages.push(styleText('blue', 'inside a Docker container'))
  }
  console.info(banner)
  console.info('\n', messages.join(' '), '\n')
}
