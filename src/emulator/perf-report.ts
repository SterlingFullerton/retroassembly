import type { SystemReading } from './perf-monitor.ts'
import type { FrameSummary, Spread } from './perf.ts'
import { getStreamRows, type StreamStats } from './stream-stats.ts'

// What the performance overlay says, as text: the rows the pause menu shows, section by section, and the report its
// Copy report button puts on the clipboard. It's a technical readout for looking into a slow game, in the terms such
// readouts use everywhere, so it's in English whatever the app's language

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

/** Milliseconds, to a tenth; whole from 100 up, where the tenth says nothing */
export function formatMilliseconds(value: number) {
  return value < 100 ? value.toFixed(1) : String(Math.round(value))
}

export function formatFps(value: number) {
  return value.toFixed(1)
}

/** A share, 1 being all of it, as a whole percentage */
export function formatPercent(share: number) {
  return `${Math.round(share * 100)}%`
}

export function formatMegabytes(bytes: number) {
  return `${Math.round(bytes / 1024 / 1024)} MB`
}

function onOff(value: boolean) {
  return value ? 'on' : 'off'
}

export interface PerfDetails {
  /** The app's version, when it knows it */
  appVersion?: string
  browser: string
  emulator: string
  /** Whether the frames counted are the game's own; otherwise they're the screen's */
  exact: boolean
  game: string
  platform: string
  rewind: boolean
  runAhead: boolean
  /** How long the summary covers, in seconds */
  seconds: number
  /** The shader's name, or nothing when it's off */
  shader: string
  /** How the picture is travelling to a guest, while the game is shared with one */
  stream?: StreamStats
  summary: FrameSummary
  system: SystemReading
  /** Whether the emulator runs on several threads */
  threads: boolean
  userAgent: string
}

export const timingColumns = ['min', 'avg', 'p50', 'p95', 'p99', 'max'] as const

function spreadValues(spread: Spread) {
  return timingColumns.map((column) => formatMilliseconds(spread[column]))
}

/** The timing table's rows: how long frames took to arrive and how long the emulator worked in them, in milliseconds */
export function getTimingRows(summary: FrameSummary) {
  return [
    { label: 'Frame interval', values: spreadValues(summary.interval) },
    { label: 'Emulator time', values: spreadValues(summary.work) },
  ]
}

export interface PerfSection {
  rows: [label: string, value: string][]
  title: string
}

/** Everything but the timing table, section by section. A row whose value the browser doesn't give is left out */
export function getPerfSections(details: PerfDetails): PerfSection[] {
  const { summary, system } = details
  const { audio, renderer } = system

  const frames: PerfSection['rows'] = [
    ['Frame rate', `${formatFps(summary.fps)} of ${summary.target} fps`],
    ['1% low', `${formatFps(summary.low1)} fps`],
    ['0.1% low', `${formatFps(summary.low01)} fps`],
    ['Load, average', formatPercent(summary.loadAverage)],
    ['Load, peak', formatPercent(summary.loadPeak)],
    ['Dropped frames', `${summary.dropped} of ${summary.frames}`],
    ['Frames over budget', `${summary.overBudget} of ${summary.frames}`],
    ['Longest stall', `${formatMilliseconds(summary.interval.max)} ms`],
  ]
  if (!details.exact) {
    frames.push(['Frames counted', "the screen's, not the game's"])
  }

  const video: PerfSection['rows'] = []
  if (system.refreshRate > 0) {
    video.push(['Screen refresh', `${system.refreshRate} Hz`])
  }
  video.push(
    ['Canvas', `${system.canvas.width} x ${system.canvas.height}`],
    ['Viewport', `${system.viewport.width} x ${system.viewport.height}`],
    ['Pixel density', `${Math.round(system.pixelRatio * 100) / 100}x`],
  )
  if (details.exact) {
    video.push(['Draw calls', `${summary.draws.toFixed(1)} per frame`])
  }
  if (renderer) {
    video.push(['Renderer', renderer.version])
    if (renderer.gpu) {
      video.push(['GPU', renderer.gpu])
    }
  }
  if (audio) {
    video.push(['Audio rate', `${audio.sampleRate} Hz`])
    if (audio.latency !== undefined) {
      video.push(['Audio latency', `${Math.round(audio.latency)} ms`])
    }
    video.push(['Audio state', audio.state])
  }

  const memory: PerfSection['rows'] = []
  if (system.emulatorMemory) {
    memory.push(['Emulator', formatMegabytes(system.emulatorMemory)])
  }
  if (system.browserMemory) {
    const { limit, used } = system.browserMemory
    memory.push(['Browser', `${Math.round(used / 1024 / 1024)} of ${formatMegabytes(limit)}`])
  }

  const setup: PerfSection['rows'] = [
    ['Emulator', details.emulator],
    ['Console', details.platform],
    ['Threads', onOff(details.threads)],
    ['Cross-origin isolation', onOff(system.isolated)],
    ['Shader', details.shader || 'off'],
    ['Rewind', onOff(details.rewind)],
    ['Run-ahead', onOff(details.runAhead)],
    ['Device', details.browser],
  ]
  if (system.cores) {
    setup.push(['Processor cores', String(system.cores)])
  }

  return [
    { rows: frames, title: 'Frames' },
    { rows: video, title: 'Video and audio' },
    { rows: details.stream ? getStreamRows(details.stream) : [], title: 'Stream, to guest' },
    { rows: memory, title: 'Memory' },
    { rows: setup, title: 'Setup' },
  ].filter((section) => section.rows.length > 0)
}

function pad(text: string, width: number) {
  return text.padStart(width)
}

/** The report as text: the timing table, then each section, a line for each thing */
export function formatPerfReport(details: PerfDetails) {
  const { summary } = details
  const timing = getTimingRows(summary)
  const labelWidth = Math.max(...timing.map((row) => row.label.length), 'Timing, ms'.length)
  const lines = [
    'RetroAssembly performance report',
    `Game: ${details.game}`,
    `Window: last ${details.seconds} s of play, ${summary.frames} frames`,
    '',
    `${'Timing, ms'.padEnd(labelWidth)}${timingColumns.map((column) => pad(column, 7)).join('')}`,
    ...timing.map((row) => `${row.label.padEnd(labelWidth)}${row.values.map((value) => pad(value, 7)).join('')}`),
  ]
  for (const section of getPerfSections(details)) {
    const rows = section.rows.filter(([label]) => label !== 'Frames counted')
    lines.push('', section.title, ...rows.map(([label, value]) => `${label}: ${value}`))
    if (section.title === 'Frames') {
      lines.push(`Frames counted: ${details.exact ? "the game's own" : "the screen's (the game's can't be seen)"}`)
    }
  }
  lines.push(`User agent: ${details.userAgent}`)
  if (details.appVersion) {
    lines.push(`App version: ${details.appVersion}`)
  }
  return lines.join('\n')
}
