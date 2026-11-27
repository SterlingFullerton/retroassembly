// How the picture of a game played together is travelling, for the performance overlay: read from the figures the
// browser keeps about a connection, at either end. Most of them are running totals, so what's shown is the change
// between one reading and the next

/** One of the browser's records about a connection: loosely typed, since each browser keeps what it likes */
export type StatsRecord = Record<string, unknown>

/** The running totals a reading leaves for the next to be measured against */
export interface StreamTotals {
  at: number
  bytes: number
  codeTime: number
  dropped: number
  frames: number
  lost: number
  packets: number
  waited: number
  waitedFor: number
}

export interface StreamStats {
  /** Bits a second, over the time since the last reading */
  bitrate?: number
  /** Milliseconds a frame waits at the guest before it's shown, so that late ones don't stutter */
  buffer?: number
  /** Milliseconds to encode a frame at the host, or decode one at the guest */
  codeTime?: number
  /** The video format: H264, VP8, VP9, AV1 */
  codec?: string
  /** The name of what does the coding, as the browser gives it: it tells a video chip from software where `hardware` is unknown */
  coder?: string
  /** Frames the guest received and didn't show, since the last reading */
  dropped?: number
  /** Times the guest's picture has stood still since it joined */
  freezes?: number
  /** Frames a second */
  fps?: number
  /** Whether the device's video chip does the coding, which costs it little; unknown where the browser doesn't say */
  hardware?: boolean
  height?: number
  /** What's holding the host's picture back from its best: none, cpu, bandwidth or other */
  limitedBy?: string
  /** The share of the picture's packets lost on the way, 1 being all of them */
  loss?: number
  role: 'guest' | 'host'
  /** Milliseconds for a message to go to the other end and back */
  roundTrip?: number
  /** Whether the two devices talk straight to each other or by way of a relay */
  route?: 'direct' | 'relayed'
  width?: number
}

function number(record: StatsRecord | undefined, field: string) {
  const value = record?.[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function text(record: StatsRecord | undefined, field: string) {
  const value = record?.[field]
  return typeof value === 'string' && value ? value : undefined
}

function find(records: readonly StatsRecord[], type: string, test?: (record: StatsRecord) => boolean) {
  return records.find((record) => record.type === type && (!test || test(record)))
}

function isVideo(record: StatsRecord) {
  return record.kind === 'video' || record.mediaType === 'video'
}

/** A change in a running total over a change in another, when both moved forward; nothing otherwise */
function rate(now: number | undefined, before: number | undefined, over: number) {
  if (now === undefined || before === undefined || over <= 0 || now < before) {
    return
  }
  return (now - before) / over
}

/**
 * What the browser's records say about the picture at one end, and the totals to measure the next reading against.
 * `previous` is the totals of the last reading; without them, what's worked out from a change is left out
 */
export function readStream(records: readonly StatsRecord[], role: 'guest' | 'host', previous?: StreamTotals) {
  const picture = find(records, role === 'host' ? 'outbound-rtp' : 'inbound-rtp', isVideo)
  const codec = find(records, 'codec', (record) => record.id === picture?.codecId)
  const pair =
    find(records, 'candidate-pair', (record) => record.nominated === true && record.state === 'succeeded') ??
    find(records, 'candidate-pair', (record) => record.selected === true)
  const far = find(records, 'remote-inbound-rtp', isVideo)
  const ends = [pair?.localCandidateId, pair?.remoteCandidateId].map((id) =>
    records.find((record) => record.id === id && typeof record.candidateType === 'string'),
  )

  const totals: StreamTotals = {
    at: number(picture, 'timestamp') ?? 0,
    bytes: number(picture, role === 'host' ? 'bytesSent' : 'bytesReceived') ?? 0,
    codeTime: number(picture, role === 'host' ? 'totalEncodeTime' : 'totalDecodeTime') ?? 0,
    dropped: number(picture, 'framesDropped') ?? 0,
    frames: number(picture, role === 'host' ? 'framesEncoded' : 'framesDecoded') ?? 0,
    lost: number(picture, 'packetsLost') ?? 0,
    packets: number(picture, 'packetsReceived') ?? 0,
    waited: number(picture, 'jitterBufferDelay') ?? 0,
    waitedFor: number(picture, 'jitterBufferEmittedCount') ?? 0,
  }

  const stats: StreamStats = { role }
  if (!picture) {
    return { stats, totals }
  }
  const mimeType = text(codec, 'mimeType')
  stats.codec = mimeType?.split('/')[1]
  stats.coder = text(picture, role === 'host' ? 'encoderImplementation' : 'decoderImplementation')
  const efficient = picture[role === 'host' ? 'powerEfficientEncoder' : 'powerEfficientDecoder']
  if (typeof efficient === 'boolean') {
    stats.hardware = efficient
  }
  stats.width = number(picture, 'frameWidth')
  stats.height = number(picture, 'frameHeight')
  stats.fps = number(picture, 'framesPerSecond')
  if (role === 'host') {
    stats.limitedBy = text(picture, 'qualityLimitationReason')
    stats.loss = number(far, 'fractionLost')
  } else {
    stats.freezes = number(picture, 'freezeCount')
  }
  const seconds = number(pair, 'currentRoundTripTime') ?? number(far, 'roundTripTime')
  stats.roundTrip = seconds === undefined ? undefined : seconds * 1000
  if (ends.every(Boolean)) {
    stats.route = ends.some((end) => end?.candidateType === 'relay') ? 'relayed' : 'direct'
  }

  if (previous && totals.at > previous.at) {
    const elapsed = (totals.at - previous.at) / 1000
    const frames = totals.frames - previous.frames
    const bytes = rate(totals.bytes, previous.bytes, elapsed)
    stats.bitrate = bytes === undefined ? undefined : bytes * 8
    const perFrame = rate(totals.codeTime, previous.codeTime, frames)
    stats.codeTime = perFrame === undefined ? undefined : perFrame * 1000
    if (role === 'guest') {
      const wait = rate(totals.waited, previous.waited, totals.waitedFor - previous.waitedFor)
      stats.buffer = wait === undefined ? undefined : wait * 1000
      stats.dropped = Math.max(0, totals.dropped - previous.dropped)
      const lost = Math.max(0, totals.lost - previous.lost)
      const arrived = Math.max(0, totals.packets - previous.packets)
      stats.loss = lost + arrived > 0 ? lost / (lost + arrived) : 0
    }
  }
  return { stats, totals }
}

function megabits(bits: number) {
  return `${(bits / 1_000_000).toFixed(bits < 10_000_000 ? 1 : 0)} Mbps`
}

function milliseconds(value: number) {
  return `${value < 100 ? value.toFixed(1) : Math.round(value)} ms`
}

function coder(stats: StreamStats) {
  if (!stats.codec) {
    return
  }
  // Whether it's the video chip, where the browser says; otherwise the coder's name, which usually tells
  let kind = stats.coder
  if (stats.hardware !== undefined) {
    kind = stats.hardware ? 'hardware' : 'software'
  }
  return kind ? `${stats.codec}, ${kind}` : stats.codec
}

/**
 * The stream as rows to show, a label and a value each. A row whose value isn't known is left out, so a reading with
 * nothing in it gives none
 */
export function getStreamRows(stats: StreamStats): [label: string, value: string][] {
  const host = stats.role === 'host'
  const rows: [string, string | undefined][] = [
    [host ? 'Encoder' : 'Decoder', coder(stats)],
    [host ? 'Sent' : 'Received', stats.width && stats.height ? `${stats.width} x ${stats.height}` : undefined],
    ['Frame rate', stats.fps === undefined ? undefined : `${Math.round(stats.fps)} fps`],
    [host ? 'Encode time' : 'Decode time', stats.codeTime === undefined ? undefined : milliseconds(stats.codeTime)],
    ['Data rate', stats.bitrate === undefined ? undefined : megabits(stats.bitrate)],
    ['Round trip', stats.roundTrip === undefined ? undefined : milliseconds(stats.roundTrip)],
    ['Wait before showing', stats.buffer === undefined ? undefined : milliseconds(stats.buffer)],
    ['Frames dropped', stats.dropped === undefined ? undefined : String(stats.dropped)],
    ['Freezes', stats.freezes === undefined ? undefined : String(stats.freezes)],
    ['Packets lost', stats.loss === undefined ? undefined : `${(stats.loss * 100).toFixed(1)}%`],
    ['Limited by', stats.limitedBy],
    ['Route', stats.route],
  ]
  return rows.filter((row): row is [string, string] => row[1] !== undefined)
}
