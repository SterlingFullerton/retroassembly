import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getStreamRows, readStream, type StatsRecord } from '#@/emulator/stream-stats.ts'

const codec: StatsRecord = { id: 'codec-1', mimeType: 'video/H264', type: 'codec' }
// Made afresh each time, so a test that changes one doesn't change it for the rest
function route(): StatsRecord[] {
  return [
    {
      currentRoundTripTime: 0.004,
      localCandidateId: 'local-1',
      nominated: true,
      remoteCandidateId: 'remote-1',
      state: 'succeeded',
      type: 'candidate-pair',
    },
    { candidateType: 'host', id: 'local-1', type: 'local-candidate' },
    { candidateType: 'host', id: 'remote-1', type: 'remote-candidate' },
  ]
}

function sent(at: number, frames: number, more: StatsRecord = {}): StatsRecord[] {
  return [
    {
      bytesSent: frames * 12_500,
      codecId: 'codec-1',
      frameHeight: 720,
      framesEncoded: frames,
      framesPerSecond: 60,
      frameWidth: 960,
      kind: 'video',
      powerEfficientEncoder: true,
      qualityLimitationReason: 'none',
      timestamp: at,
      totalEncodeTime: frames * 0.0036,
      type: 'outbound-rtp',
      ...more,
    },
    { bytesSent: 999_999, kind: 'audio', timestamp: at, type: 'outbound-rtp' },
    { fractionLost: 0.01, kind: 'video', roundTripTime: 0.02, type: 'remote-inbound-rtp' },
    codec,
    ...route(),
  ]
}

function received(at: number, frames: number, more: StatsRecord = {}): StatsRecord[] {
  return [
    {
      bytesReceived: frames * 12_500,
      codecId: 'codec-1',
      frameHeight: 720,
      framesDecoded: frames,
      framesDropped: 0,
      framesPerSecond: 59,
      frameWidth: 960,
      freezeCount: 1,
      jitterBufferDelay: frames * 0.012,
      jitterBufferEmittedCount: frames,
      kind: 'video',
      packetsLost: 0,
      packetsReceived: frames * 10,
      powerEfficientDecoder: false,
      timestamp: at,
      totalDecodeTime: frames * 0.0011,
      type: 'inbound-rtp',
      ...more,
    },
    codec,
    ...route(),
  ]
}

function near(actual: number | undefined, expected: number, within = 0.001) {
  assert.ok(actual !== undefined && Math.abs(actual - expected) <= within, `${actual} is not ${expected}`)
}

await describe('a host’s reading of the stream', async () => {
  await it('gives what the browser says outright on the first reading, and nothing worked out from a change', () => {
    const { stats } = readStream(sent(1000, 60), 'host')
    assert.equal(stats.codec, 'H264')
    assert.equal(stats.hardware, true)
    assert.deepEqual([stats.width, stats.height, stats.fps], [960, 720, 60])
    assert.equal(stats.limitedBy, 'none')
    assert.equal(stats.route, 'direct')
    near(stats.roundTrip, 4)
    near(stats.loss, 0.01)
    assert.equal(stats.bitrate, undefined)
    assert.equal(stats.codeTime, undefined)
  })

  await it('works out the data rate and the time to encode a frame from the change since the last reading', () => {
    const first = readStream(sent(1000, 60), 'host')
    const { stats } = readStream(sent(2000, 120), 'host', first.totals)
    // 60 frames of 12,500 bytes in a second
    near(stats.bitrate, 6_000_000, 1)
    near(stats.codeTime, 3.6)
  })

  await it('reads the picture, not the sound', () => {
    const first = readStream(sent(1000, 60), 'host')
    assert.equal(first.totals.bytes, 60 * 12_500)
  })

  await it('says when a relay carries it, and what holds it back', () => {
    const records = sent(1000, 60, { qualityLimitationReason: 'cpu' })
    const remote = records.find((record) => record.id === 'remote-1')
    if (remote) {
      remote.candidateType = 'relay'
    }
    const { stats } = readStream(records, 'host')
    assert.equal(stats.route, 'relayed')
    assert.equal(stats.limitedBy, 'cpu')
  })

  await it('leaves the coder’s kind unknown where the browser doesn’t say', () => {
    const { stats } = readStream(sent(1000, 60, { powerEfficientEncoder: undefined }), 'host')
    assert.equal(stats.hardware, undefined)
    assert.deepEqual(getStreamRows(stats)[0], ['Encoder', 'H264'])
    const named = readStream(
      sent(1000, 60, { encoderImplementation: 'libvpx', powerEfficientEncoder: undefined }),
      'host',
    )
    assert.deepEqual(getStreamRows(named.stats)[0], ['Encoder', 'H264, libvpx'])
  })

  await it('is empty before there’s a picture, and after a reading that didn’t move on', () => {
    assert.deepEqual(readStream([], 'host').stats, { role: 'host' })
    assert.deepEqual(getStreamRows(readStream([], 'host').stats), [])
    const first = readStream(sent(1000, 60), 'host')
    assert.equal(readStream(sent(1000, 60), 'host', first.totals).stats.bitrate, undefined)
  })
})

await describe('a guest’s reading of the stream', async () => {
  await it('works out decoding, waiting, dropped frames and lost packets from the change', () => {
    const first = readStream(received(1000, 60), 'guest')
    const { stats } = readStream(
      received(2000, 120, { framesDropped: 3, packetsLost: 12, packetsReceived: 1188 }),
      'guest',
      first.totals,
    )
    assert.equal(stats.codec, 'H264')
    assert.equal(stats.hardware, false)
    near(stats.bitrate, 6_000_000, 1)
    near(stats.codeTime, 1.1)
    near(stats.buffer, 12)
    assert.equal(stats.dropped, 3)
    assert.equal(stats.freezes, 1)
    // 12 lost of the 600 that should have arrived
    near(stats.loss, 12 / 600)
    assert.equal(stats.limitedBy, undefined)
  })

  await it('counts nothing lost when nothing arrived or went missing', () => {
    const first = readStream(received(1000, 60), 'guest')
    const { stats } = readStream(received(2000, 60), 'guest', first.totals)
    assert.equal(stats.loss, 0)
    assert.equal(stats.dropped, 0)
    assert.equal(stats.codeTime, undefined)
  })
})

await describe('the stream as rows', async () => {
  await it('names each end’s rows its own way, with units', () => {
    const first = readStream(sent(1000, 60), 'host')
    const rows = Object.fromEntries(getStreamRows(readStream(sent(2000, 120), 'host', first.totals).stats))
    assert.deepEqual(rows, {
      'Data rate': '6.0 Mbps',
      'Encode time': '3.6 ms',
      Encoder: 'H264, hardware',
      'Frame rate': '60 fps',
      'Limited by': 'none',
      'Packets lost': '1.0%',
      'Round trip': '4.0 ms',
      Route: 'direct',
      Sent: '960 x 720',
    })

    const before = readStream(received(1000, 60), 'guest')
    const guest = Object.fromEntries(getStreamRows(readStream(received(2000, 120), 'guest', before.totals).stats))
    assert.deepEqual(guest, {
      'Data rate': '6.0 Mbps',
      'Decode time': '1.1 ms',
      Decoder: 'H264, software',
      'Frame rate': '59 fps',
      'Frames dropped': '0',
      Freezes: '1',
      'Packets lost': '0.0%',
      Received: '960 x 720',
      'Round trip': '4.0 ms',
      Route: 'direct',
      'Wait before showing': '12.0 ms',
    })
  })
})
