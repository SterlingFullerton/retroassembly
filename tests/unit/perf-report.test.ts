import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { describeBrowser, formatMegabytes, formatMilliseconds, formatPerfReport } from '#@/emulator/perf-report.ts'

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

await describe('the report', async () => {
  const details = {
    appVersion: 'a7b9da75',
    browser: 'Safari 26, iPhone',
    emulator: 'melonDS',
    emulatorMemory: 212 * 1024 * 1024,
    exact: true,
    game: 'Mario Kart DS',
    picture: '1170 × 1755',
    platform: 'nds',
    rewind: false,
    screen: '390 × 844 at 3×',
    seconds: 10,
    shader: '',
    summary: { fps: 57.6, frames: 600, p95: 12.4, slow: 4, typical: 9.42, worst: 31.2 },
    userAgent: iphone,
  }

  await it('says each thing on a line of its own', () => {
    assert.deepEqual(formatPerfReport(details).split('\n'), [
      'RetroAssembly performance report',
      'Game: Mario Kart DS (nds)',
      'Emulator: melonDS',
      'Last 10 s of play: 58 fps, 4 slow of 600 frames',
      'Frame time: typical 9.4 ms, 95% within 12 ms, worst 31 ms',
      "Frames counted: the game's own",
      'Shader: off',
      'Rewind: off',
      'Screen: 390 × 844 at 3×',
      'Picture: 1170 × 1755',
      'Emulator memory: 212 MB',
      'Browser: Safari 26, iPhone',
      `User agent: ${iphone}`,
      'App version: a7b9da75',
    ])
  })

  await it('leaves out what isn’t known, and says when the frames are the screen’s', () => {
    const report = formatPerfReport({
      ...details,
      appVersion: undefined,
      emulatorMemory: undefined,
      exact: false,
      rewind: true,
      shader: 'crt-aperture',
    })
    assert.ok(!report.includes('Emulator memory'))
    assert.ok(!report.includes('App version'))
    assert.ok(report.includes("Frames counted: the screen's"))
    assert.ok(report.includes('Shader: crt-aperture'))
    assert.ok(report.includes('Rewind: on'))
  })

  await it('writes short times to a tenth and long ones whole, and memory in whole megabytes', () => {
    assert.equal(formatMilliseconds(0.84), '0.8')
    assert.equal(formatMilliseconds(9.96), '10.0')
    assert.equal(formatMilliseconds(31.4), '31')
    assert.equal(formatMegabytes(268_435_456), '256 MB')
  })
})
