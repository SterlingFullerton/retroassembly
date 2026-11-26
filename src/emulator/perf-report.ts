import type { FrameSummary } from './perf.ts'

// The performance overlay's report: what the pause menu shows about a game's setup, and the text its Copy report button
// puts on the clipboard. The report is for sending to whoever is looking into a slow game, so it's always in English

const browsers: [name: string, pattern: RegExp][] = [
  ['Edge', /Edg(?:e|A|iOS)?\/(?<version>\d+)/u],
  ['Firefox', /(?:Firefox|FxiOS)\/(?<version>\d+)/u],
  ['Chrome', /(?:Chrome|CriOS)\/(?<version>\d+)/u],
  ['Safari', /Version\/(?<version>\d+)[\d.]* (?:Mobile\/\S+ )?Safari/u],
]

const devices: [name: string, pattern: RegExp][] = [
  ['iPhone', /iPhone/u],
  ['iPad', /iPad/u],
  ['Android', /Android/u],
  ['Windows', /Windows/u],
  ['Mac', /Macintosh/u],
  ['ChromeOS', /CrOS/u],
  ['Linux', /Linux/u],
]

/**
 * The browser and device a user agent names, in a few words: "Safari 26, iPhone". An iPad says it's a Mac, and is told
 * from one by its touch screen
 */
export function describeBrowser(userAgent: string, touchPoints = 0) {
  let browser = ''
  for (const [name, pattern] of browsers) {
    const version = pattern.exec(userAgent)?.groups?.version
    if (version) {
      browser = `${name} ${version}`
      break
    }
  }
  let device = devices.find(([, pattern]) => pattern.test(userAgent))?.[0] ?? ''
  if (device === 'Mac' && touchPoints > 1) {
    device = 'iPad'
  }
  return [browser, device].filter(Boolean).join(', ') || 'Unknown'
}

export function formatMilliseconds(value: number) {
  return value < 10 ? value.toFixed(1) : String(Math.round(value))
}

export function formatMegabytes(bytes: number) {
  return `${Math.round(bytes / 1024 / 1024)} MB`
}

export interface PerfDetails {
  /** The app's version, when it knows it */
  appVersion?: string
  browser: string
  /** The size of the emulator's memory, in bytes, when it can be read */
  emulatorMemory?: number
  emulator: string
  /** Whether the frames counted are the game's own; otherwise they're the screen's */
  exact: boolean
  game: string
  /** The size of the picture the emulator draws, in the screen's own pixels */
  picture: string
  platform: string
  rewind: boolean
  /** The page's size and how many of the screen's pixels make one of its own: "390 × 844 at 3×" */
  screen: string
  /** How long the summary covers, in seconds */
  seconds: number
  /** The shader's name, or nothing when it's off */
  shader: string
  summary: FrameSummary
  userAgent: string
}

/** The report as text, a line for each thing */
export function formatPerfReport(details: PerfDetails) {
  const { summary } = details
  const lines = [
    'RetroAssembly performance report',
    `Game: ${details.game} (${details.platform})`,
    `Emulator: ${details.emulator}`,
    `Last ${details.seconds} s of play: ${Math.round(summary.fps)} fps, ${summary.slow} slow of ${summary.frames} frames`,
    `Frame time: typical ${formatMilliseconds(summary.typical)} ms, 95% within ${formatMilliseconds(summary.p95)} ms, worst ${formatMilliseconds(summary.worst)} ms`,
    `Frames counted: ${details.exact ? "the game's own" : "the screen's (the game's can't be seen)"}`,
    `Shader: ${details.shader || 'off'}`,
    `Rewind: ${details.rewind ? 'on' : 'off'}`,
    `Screen: ${details.screen}`,
    `Picture: ${details.picture}`,
    details.emulatorMemory ? `Emulator memory: ${formatMegabytes(details.emulatorMemory)}` : '',
    `Browser: ${details.browser}`,
    `User agent: ${details.userAgent}`,
    details.appVersion ? `App version: ${details.appVersion}` : '',
  ]
  return lines.filter(Boolean).join('\n')
}
