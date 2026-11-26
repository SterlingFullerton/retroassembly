import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  describeBrowser,
  formatMegabytes,
  formatMilliseconds,
  formatPercent,
  formatPerfReport,
  getPerfSections,
  getTimingRows,
  type PerfDetails,
} from '#@/emulator/perf-report.ts'
import { frameBudget, type FrameSample, summarizeFrames } from '#@/emulator/perf.ts'

const iphone =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1'
const macSafari =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15'
const macChrome =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36'
const androidChrome =
  'Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36'
const windowsEdge =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36 Edg/156.0.0.0'
const linuxFirefox = 'Mozilla/5.0 (X11; Linux x86_64; rv:150.0) Gecko/20100101 Firefox/150.0'
const iphoneChrome =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/156.0.0.0 Mobile/15E148 Safari/604.1'

// A second of a 60 fps game doing 6 ms of work a frame, three draw calls each, with one frame that took two refreshes
function playedFrames() {
  const budget = frameBudget()
  const samples: FrameSample[] = Array.from({ length: 60 }, (_, index) => ({ at: index * budget, draws: 3, work: 6 }))
  for (let index = 30; index < samples.length; index += 1) {
    samples[index].at += budget
  }
  samples[29].work = 30
  return samples
}

const details: PerfDetails = {
  appVersion: 'a7b9da75',
  browser: 'Safari 26, iPhone',
  emulator: 'melonDS',
  exact: true,
  game: 'Mario Kart DS',
  platform: 'nds',
  rewind: false,
  runAhead: false,
  seconds: 10,
  shader: '',
  summary: summarizeFrames(playedFrames()),
  system: {
    audio: { latency: 21.3, sampleRate: 48_000, state: 'running' },
    browserMemory: undefined,
    canvas: { height: 1755, width: 1170 },
    cores: 6,
    emulatorMemory: 128 * 1024 * 1024,
    isolated: false,
    pixelRatio: 3,
    refreshRate: 120,
    renderer: { gpu: 'Apple GPU', version: 'WebGL2' },
    viewport: { height: 844, width: 390 },
  },
  threads: false,
  userAgent: iphone,
}

function rowsOf(input: PerfDetails, title: string) {
  return Object.fromEntries(getPerfSections(input).find((section) => section.title === title)?.rows ?? [])
}

await describe('the browser, in a few words', async () => {
  await it('names the browser, its version and the device', () => {
    assert.equal(describeBrowser(iphone), 'Safari 26, iPhone')
    assert.equal(describeBrowser(macSafari), 'Safari 26, Mac')
    assert.equal(describeBrowser(macChrome), 'Chrome 156, Mac')
    assert.equal(describeBrowser(androidChrome), 'Chrome 156, Android')
    assert.equal(describeBrowser(windowsEdge), 'Edge 156, Windows')
    assert.equal(describeBrowser(linuxFirefox), 'Firefox 150, Linux')
    assert.equal(describeBrowser(iphoneChrome), 'Chrome 156, iPhone')
  })

  await it('tells an iPad, which says it’s a Mac, by its touch screen', () => {
    assert.equal(describeBrowser(macSafari, 5), 'Safari 26, iPad')
    assert.equal(describeBrowser(macSafari, 0), 'Safari 26, Mac')
  })

  await it('says so when it can’t tell', () => {
    assert.equal(describeBrowser(''), 'Unknown')
    assert.equal(describeBrowser('SomeBot/1.0 (Windows)'), 'Windows')
  })
})

await describe('the overlay’s numbers as text', async () => {
  await it('writes times to a tenth, shares as whole percentages and memory in whole megabytes', () => {
    assert.equal(formatMilliseconds(0.84), '0.8')
    assert.equal(formatMilliseconds(31.44), '31.4')
    assert.equal(formatMilliseconds(236.4), '236')
    assert.equal(formatPercent(0.564), '56%')
    assert.equal(formatPercent(1.86), '186%')
    assert.equal(formatMegabytes(268_435_456), '256 MB')
  })

  await it('gives the timing table a row for the frames’ intervals and one for the emulator’s work', () => {
    const [interval, work] = getTimingRows(details.summary)
    assert.equal(interval.label, 'Frame interval')
    assert.deepEqual(interval.values, ['16.7', '16.9', '16.7', '16.7', '33.3', '33.3'])
    assert.equal(work.label, 'Emulator time')
    assert.deepEqual(work.values, ['6.0', '6.4', '6.0', '6.0', '30.0', '30.0'])
  })

  await it('sets out the frames', () => {
    assert.deepEqual(rowsOf(details, 'Frames'), {
      '0.1% low': '30.0 fps',
      '1% low': '30.0 fps',
      'Dropped frames': '1 of 60',
      'Frame rate': '59.0 of 60 fps',
      'Frames over budget': '1 of 60',
      'Load, average': '38%',
      'Load, peak': '180%',
      'Longest stall': '33.3 ms',
    })
  })

  await it('sets out the video, audio, memory and setup', () => {
    assert.deepEqual(rowsOf(details, 'Video and audio'), {
      'Audio latency': '21 ms',
      'Audio rate': '48000 Hz',
      'Audio state': 'running',
      Canvas: '1170 x 1755',
      'Draw calls': '3.0 per frame',
      GPU: 'Apple GPU',
      'Pixel density': '3x',
      Renderer: 'WebGL2',
      'Screen refresh': '120 Hz',
      Viewport: '390 x 844',
    })
    assert.deepEqual(rowsOf(details, 'Memory'), { Emulator: '128 MB' })
    assert.deepEqual(rowsOf(details, 'Setup'), {
      Console: 'nds',
      'Cross-origin isolation': 'off',
      Device: 'Safari 26, iPhone',
      Emulator: 'melonDS',
      'Processor cores': '6',
      Rewind: 'off',
      'Run-ahead': 'off',
      Shader: 'off',
      Threads: 'off',
    })
  })

  await it('leaves out what the browser doesn’t give, and a section with nothing in it', () => {
    const bare: PerfDetails = {
      ...details,
      system: {
        ...details.system,
        audio: undefined,
        cores: undefined,
        emulatorMemory: undefined,
        refreshRate: 0,
        renderer: undefined,
      },
    }
    assert.deepEqual(Object.keys(rowsOf(bare, 'Video and audio')), [
      'Canvas',
      'Viewport',
      'Pixel density',
      'Draw calls',
    ])
    assert.ok(!getPerfSections(bare).some((section) => section.title === 'Memory'))
    assert.ok(!('Processor cores' in rowsOf(bare, 'Setup')))
  })

  await it('gives the browser’s memory where it’s known, and audio without a delay where that isn’t', () => {
    const chrome: PerfDetails = {
      ...details,
      system: {
        ...details.system,
        audio: { latency: undefined, sampleRate: 44_100, state: 'suspended' },
        browserMemory: { limit: 4096 * 1024 * 1024, used: 84 * 1024 * 1024 },
      },
    }
    assert.equal(rowsOf(chrome, 'Memory').Browser, '84 of 4096 MB')
    const video = rowsOf(chrome, 'Video and audio')
    assert.equal(video['Audio rate'], '44100 Hz')
    assert.equal(video['Audio state'], 'suspended')
    assert.ok(!('Audio latency' in video))
  })

  await it('says when the frames counted are the screen’s, and then gives no draw calls', () => {
    const unseen = { ...details, exact: false }
    assert.equal(rowsOf(unseen, 'Frames')['Frames counted'], "the screen's, not the game's")
    assert.ok(!('Draw calls' in rowsOf(unseen, 'Video and audio')))
    assert.ok(!('Frames counted' in rowsOf(details, 'Frames')))
  })

  await it('names the shader, and says what’s on', () => {
    const setup = rowsOf({ ...details, rewind: true, runAhead: true, shader: 'crt-aperture', threads: true }, 'Setup')
    assert.equal(setup.Shader, 'crt-aperture')
    assert.equal(setup.Rewind, 'on')
    assert.equal(setup['Run-ahead'], 'on')
    assert.equal(setup.Threads, 'on')
  })
})

await describe('the report', async () => {
  await it('is the timing table, then each section, a line for each thing', () => {
    assert.deepEqual(formatPerfReport(details).split('\n'), [
      'RetroAssembly performance report',
      'Game: Mario Kart DS',
      'Window: last 10 s of play, 60 frames',
      '',
      'Timing, ms        min    avg    p50    p95    p99    max',
      'Frame interval   16.7   16.9   16.7   16.7   33.3   33.3',
      'Emulator time     6.0    6.4    6.0    6.0   30.0   30.0',
      '',
      'Frames',
      'Frame rate: 59.0 of 60 fps',
      '1% low: 30.0 fps',
      '0.1% low: 30.0 fps',
      'Load, average: 38%',
      'Load, peak: 180%',
      'Dropped frames: 1 of 60',
      'Frames over budget: 1 of 60',
      'Longest stall: 33.3 ms',
      "Frames counted: the game's own",
      '',
      'Video and audio',
      'Screen refresh: 120 Hz',
      'Canvas: 1170 x 1755',
      'Viewport: 390 x 844',
      'Pixel density: 3x',
      'Draw calls: 3.0 per frame',
      'Renderer: WebGL2',
      'GPU: Apple GPU',
      'Audio rate: 48000 Hz',
      'Audio latency: 21 ms',
      'Audio state: running',
      '',
      'Memory',
      'Emulator: 128 MB',
      '',
      'Setup',
      'Emulator: melonDS',
      'Console: nds',
      'Threads: off',
      'Cross-origin isolation: off',
      'Shader: off',
      'Rewind: off',
      'Run-ahead: off',
      'Device: Safari 26, iPhone',
      'Processor cores: 6',
      `User agent: ${iphone}`,
      'App version: a7b9da75',
    ])
  })

  await it('says once when the frames counted are the screen’s, and leaves out an unknown version', () => {
    const report = formatPerfReport({ ...details, appVersion: undefined, exact: false })
    assert.equal(report.match(/Frames counted/gu)?.length, 1)
    assert.ok(report.includes("Frames counted: the screen's (the game's can't be seen)"))
    assert.ok(!report.includes('App version'))
    assert.ok(!report.includes('Draw calls'))
  })
})
