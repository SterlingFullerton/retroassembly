import type { Nostalgist } from 'nostalgist'
import { attachPlayerGamepad, captureGameAudio, type EmulatorGamepad } from './adapter.ts'
import { type PictureArea, watchGamePicture } from './game-picture.ts'
import { copyGamePicture } from './picture-copy.ts'

// Playing a game together across a network, as if on one couch. One player's browser, the host's, runs the game and
// sends its picture and sound to the other's, the guest's, which sends back what its controller is doing. The host
// hands that to the emulator as one more controller, so the game sees a second player and knows nothing of the network.
//
// The two browsers talk straight to each other. To find each other they swap two pieces of text, an offer and an
// answer, which this file makes and reads; getting them from one browser to the other is someone else's job.

export const padButtonCount = 17
const padAxisCount = 4
/** Three bytes of buttons, a bit each, then a byte for each axis */
export const padStateSize = 3 + padAxisCount

type PadState = Pick<EmulatorGamepad, 'axes' | 'buttons'>

/** A controller's buttons and sticks as a few bytes, small enough to send every time they change */
export function encodePadState(
  pad: {
    axes: readonly number[]
    buttons: readonly { pressed: boolean }[]
  },
  stylus?: Stylus,
): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(stylus ? padStateSize + stylusSize : padStateSize)
  for (let index = 0; index < padButtonCount; index += 1) {
    if (pad.buttons[index]?.pressed) {
      bytes[Math.floor(index / 8)] += 2 ** (index % 8)
    }
  }
  for (let index = 0; index < padAxisCount; index += 1) {
    const value = Math.max(-1, Math.min(1, pad.axes[index] ?? 0))
    // A signed byte: -127 to 127, with 0 the stick at rest
    bytes[3 + index] = (Math.round(value * 127) + 256) % 256
  }
  if (stylus) {
    // Where it is across the picture, 0 to 65535 each way, low byte first, then whether it's down
    const x = acrossPicture(stylus.x)
    const y = acrossPicture(stylus.y)
    bytes.set([x % 256, Math.floor(x / 256), y % 256, Math.floor(y / 256), stylus.down ? 1 : 0], padStateSize)
  }
  return bytes
}

/**
 * A stylus or pointer on the game's picture, for a DS's touch screen: where, each way a share of the picture from its
 * top left, and whether it's down. Only a game on the NAS takes it, after the controller
 */
export interface Stylus {
  down: boolean
  x: number
  y: number
}

const stylusSize = 5

/** A share of the picture, 0 to 1, as two bytes' worth */
function acrossPicture(share: number) {
  return Math.round(Math.max(0, Math.min(1, share)) * 65_535)
}

/** Sets `pad` to what `bytes` say. Bytes of the wrong length are someone else's, and are ignored */
export function decodePadState(bytes: Uint8Array, pad: PadState) {
  if (bytes.length !== padStateSize) {
    return false
  }
  for (let index = 0; index < padButtonCount; index += 1) {
    const pressed = Math.floor(bytes[Math.floor(index / 8)] / 2 ** (index % 8)) % 2 === 1
    pad.buttons[index] = { pressed, touched: pressed, value: pressed ? 1 : 0 }
  }
  for (let index = 0; index < padAxisCount; index += 1) {
    const byte = bytes[3 + index]
    pad.axes[index] = Math.max(-1, (byte > 127 ? byte - 256 : byte) / 127)
  }
  return true
}

function createGuestGamepad(): EmulatorGamepad {
  return {
    axes: Array.from({ length: padAxisCount }, () => 0),
    buttons: Array.from({ length: padButtonCount }, () => ({ pressed: false, touched: false, value: 0 })),
    connected: true,
    id: 'RetroAssembly guest',
    index: 1,
    mapping: 'standard',
    timestamp: 0,
  }
}

// The channel the guest's controller travels on. Both ends open it under the same number, so it needs no arranging.
// What's sent is the controller as it is now, so a message lost is made up for by the next and never sent again
const inputChannel = { id: 0, label: 'input', options: { maxRetransmits: 0, negotiated: true, ordered: false } }

// The channel the host tells the guest on where the game's picture is in what's sent, and its shape. What's sent is
// usually the picture alone; where it's the host's whole canvas, with black around the picture, the guest shows the
// picture alone. It changes rarely, and every message must arrive, in order
const pictureChannel = { id: 1, label: 'picture', options: { negotiated: true, ordered: true } }

function isPictureArea(value: unknown): value is PictureArea {
  return (
    typeof value === 'object' &&
    value !== null &&
    ['aspect', 'height', 'left', 'top', 'width'].every((side) => {
      const number: unknown = Reflect.get(value, side)
      return typeof number === 'number' && Number.isFinite(number) && number >= 0
    })
  )
}

// The channel a game on the NAS takes its players' pause menus on, and sends them its numbers on, once a second. A
// person's game has no such channel, so a guest only opens it for a game on the NAS
const commandChannel = { id: 2, label: 'commands', options: { negotiated: true, ordered: true } }

/** What a game on the NAS asks of its players' pause menus */
export type NASCommand = 'pause' | 'restart' | 'resume'

/** A game on the NAS's numbers, for the performance overlay: over the last second, times in milliseconds */
export interface NASNumbers {
  encodeAvg: number
  fps: number
  paused: boolean
  players: number
  runAvg: number
  runMax: number
}

function isNASNumbers(value: unknown): value is NASNumbers {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'fps') === 'number' &&
    typeof Reflect.get(value, 'paused') === 'boolean'
  )
}

// How long to wait for the browser to list the ways it can be reached. It usually takes a moment; what's found by then
// is what's offered
const gatheringTimeout = 3000

const hostCandidate =
  /^a=candidate:(?<foundation>\S+) (?<component>\d+) udp (?<priority>\d+) (?<address>\S+) (?<port>\d+) typ host(?<rest>.*)$/iu

/**
 * A connection's description with `address` added as a way to reach this browser. A browser lists the ways it can be
 * reached, but hides its own addresses from the page behind made-up names that only work on the same local network.
 * The server sees the address each browser reaches it from, over a VPN as much as at home, and two browsers that both
 * reach the server can usually reach each other there. So each way the browser lists is offered again at that address
 */
export function withReachableAddress(sdp: string, address: string) {
  if (!address) {
    return sdp
  }
  const lines = sdp.split('\r\n')
  const added = new Set<string>()
  const result: string[] = []
  for (const line of lines) {
    result.push(line)
    const candidate = hostCandidate.exec(line)?.groups
    if (candidate && candidate.address !== address) {
      const { component, foundation, port, priority, rest } = candidate
      const key = `${component} ${port}`
      const known = lines.some((other) => other.includes(` ${address} ${port} typ host`))
      if (!known && !added.has(key)) {
        added.add(key)
        // A foundation of its own: it's a different way in, though it leads to the same place
        result.push(`a=candidate:${foundation}9 ${component} udp ${priority} ${address} ${port} typ host${rest}`)
      }
    }
  }
  return result.join('\r\n')
}

/**
 * The connection's description once the browser has listed the ways it can be reached, as text to hand to the other
 * end, with `address` added to them when it's known
 */
async function describe(connection: RTCPeerConnection, address = '') {
  if (connection.iceGatheringState !== 'complete') {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, gatheringTimeout)
      function done() {
        clearTimeout(timer)
        connection.removeEventListener('icegatheringstatechange', check)
        resolve()
      }
      function check() {
        if (connection.iceGatheringState === 'complete') {
          done()
        }
      }
      connection.addEventListener('icegatheringstatechange', check)
    })
  }
  const description = connection.localDescription
  return JSON.stringify(description && { sdp: withReachableAddress(description.sdp, address), type: description.type })
}

function parseDescription(text: string, type: 'answer' | 'offer'): RTCSessionDescriptionInit {
  const description: unknown = JSON.parse(text)
  if (
    !description ||
    typeof description !== 'object' ||
    !('type' in description) ||
    description.type !== type ||
    !('sdp' in description) ||
    typeof description.sdp !== 'string'
  ) {
    throw new Error(`Not ${type === 'offer' ? 'an offer' : 'an answer'}`)
  }
  return { sdp: description.sdp, type }
}

// The tallest picture sent. Games are drawn far larger than they are, to fill the screen; sending that would cost the
// host's time and the network's for nothing a guest would see
const tallestPicture = 720
const pictureBitrate = 6_000_000
// What the picture is sent at from the start, in kilobits a second. Left to itself a browser starts low and works up,
// which showed a guest a blurred picture for its first 15 seconds. The guest is on the same network, or a VPN, where
// this is little; if it's too much the browser comes down from it within a second or two
const startingBitrate = 3000

const pictureFormats = /^(?:av1|h264|vp8|vp9)$/iu

/**
 * A description with each video format in it marked to be sent at `kilobits` a second from the start. Only Chrome and
 * the browsers built on it read the mark, and others pass over it. It goes on the guest's answer before the host takes
 * it, as the host is the one sending
 */
export function withStartingBitrate(sdp: string, kilobits: number) {
  const lines = sdp.split('\r\n')
  const formats = new Set<string>()
  const described = new Set<string>()
  let video = false
  for (const line of lines) {
    if (line.startsWith('m=')) {
      video = line.startsWith('m=video')
    }
    const format = /^a=rtpmap:(?<type>\d+) (?<name>[^/]+)\//u.exec(line)?.groups
    if (video && format && pictureFormats.test(format.name)) {
      formats.add(format.type)
    }
    const parameters = /^a=fmtp:(?<type>\d+) /u.exec(line)?.groups
    if (video && parameters) {
      described.add(parameters.type)
    }
  }
  const mark = `x-google-start-bitrate=${kilobits}`
  const result: string[] = []
  video = false
  for (const line of lines) {
    if (line.startsWith('m=')) {
      video = line.startsWith('m=video')
    }
    const parameters = /^a=fmtp:(?<type>\d+) /u.exec(line)?.groups
    if (video && parameters && formats.has(parameters.type) && !line.includes('x-google-start-bitrate')) {
      result.push(`${line};${mark}`)
      continue
    }
    result.push(line)
    const format = /^a=rtpmap:(?<type>\d+) /u.exec(line)?.groups
    if (video && format && formats.has(format.type) && !described.has(format.type)) {
      result.push(`a=fmtp:${format.type} ${mark}`)
    }
  }
  return result.join('\r\n')
}

/**
 * Has the picture sent smoothly before sharply, and no larger than a guest needs. `height` is the height of the game's
 * picture in what's sent, in pixels: the black around it doesn't count towards how sharp it is
 */
async function tunePicture(sender: RTCRtpSender, height: number) {
  const parameters = sender.getParameters()
  if (parameters.encodings.length === 0) {
    return
  }
  parameters.degradationPreference = 'maintain-framerate'
  for (const encoding of parameters.encodings) {
    encoding.maxBitrate = pictureBitrate
    encoding.scaleResolutionDownBy = Math.max(1, height / tallestPicture)
  }
  try {
    await sender.setParameters(parameters)
  } catch {
    // A browser that won't take these settings sends the picture its own way
  }
}

export interface HostOptions {
  canvas: HTMLCanvasElement
  emulator: Nostalgist
  /** Services that tell a browser how it can be reached from outside its own network, where they're needed */
  iceServers?: RTCIceServer[]
  /**
   * Told when the guest arrives, with the player they play as (counting from 1; none when every controller's place is
   * taken), and when they leave or can't be reached at all
   */
  onGuest?: (connected: boolean, player?: number) => void
  /** The address this browser reaches the server from, where the guest can probably reach it too */
  reachableAt?: string
}

/**
 * Shares the game on `canvas` with one guest: its picture and sound go to them, and their controller plays as the next
 * player. `offer()` is the text for the guest, and `accept()` takes the text they give back. `close()` ends it and takes
 * the guest's controller away
 */
export function hostGame({ canvas, emulator, iceServers = [], onGuest, reachableAt }: HostOptions) {
  const connection = new RTCPeerConnection({ iceServers })
  // The picture alone, copied off the canvas. Should the emulator draw where that can't be seen, the whole canvas is
  // sent instead, with where the picture is in it
  const copy = copyGamePicture(canvas, tallestPicture)
  let whole: MediaStream | undefined
  const sound = captureGameAudio()
  const senders: RTCRtpSender[] = []
  for (const track of copy.stream.getVideoTracks()) {
    // A game is all movement: frames are kept coming even when that costs sharpness
    track.contentHint = 'motion'
    senders.push(connection.addTrack(track, copy.stream))
  }
  // The sound travels apart from the picture. Sent together, the guest's browser holds each frame back to keep it in
  // step with the sound, which it buffers for 100 ms or so: the picture arrived in 10 and was shown 100 ms late. Out of
  // step by a few hundredths of a second is felt far less than late
  const soundStream = new MediaStream()
  for (const track of sound?.stream.getAudioTracks() ?? []) {
    connection.addTrack(track, soundStream)
  }

  const gamepad = createGuestGamepad()
  let detachGamepad: (() => void) | undefined
  // Whether the guest has arrived, and whether they've gone again: each is told once
  let joined = false
  let ended = false
  const channel = connection.createDataChannel(inputChannel.label, { ...inputChannel.options, id: inputChannel.id })
  channel.binaryType = 'arraybuffer'
  channel.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (event.data instanceof ArrayBuffer) {
      decodePadState(new Uint8Array(event.data), gamepad)
    }
  })

  // Where the picture is, told to the guest once they're there and whenever it moves
  let area: PictureArea | undefined
  const areaChannel = connection.createDataChannel(pictureChannel.label, {
    ...pictureChannel.options,
    id: pictureChannel.id,
  })
  function tellArea() {
    if (area && areaChannel.readyState === 'open') {
      // The copy is the picture and nothing else; the whole canvas has it somewhere inside
      const told = whole ? area : { aspect: area.aspect, height: 1, left: 0, top: 0, width: 1 }
      areaChannel.send(JSON.stringify(told))
    }
  }
  areaChannel.addEventListener('open', tellArea)
  // A guest who leaves closes the channels at once; one whose network fails is noticed by the connection failing
  areaChannel.addEventListener('close', () => {
    if (joined) {
      endGuest()
    }
  })
  async function tune() {
    // The copy is already no taller than it needs to be. The whole canvas is sized by the picture in it, so a small
    // picture on a large canvas is still sent sharp
    const height = whole && area ? area.height * canvas.height : 0
    await Promise.all(senders.map((sender) => tunePicture(sender, height)))
  }
  const stopWatchingPicture = watchGamePicture(canvas, async (found) => {
    area = found
    copy.setArea(found)
    tellArea()
    if (connection.connectionState === 'connected') {
      await tune()
    }
  })

  // How long the game has to run, once the guest is there, drawing nothing the copy can see before the whole canvas is
  // sent. Time paused doesn't count: a paused game draws nothing
  const copyWithin = 2000
  const checkEvery = 250
  let runningFor = 0
  let checkCopy: ReturnType<typeof setInterval> | undefined
  async function checkCopying() {
    if (whole || copy.copies > 0) {
      clearInterval(checkCopy)
      return
    }
    if (emulator.getStatus() === 'running') {
      runningFor += checkEvery
    }
    if (runningFor >= copyWithin) {
      clearInterval(checkCopy)
      await sendWholeCanvas()
    }
  }
  async function sendWholeCanvas() {
    if (whole || connection.connectionState !== 'connected') {
      return
    }
    whole = canvas.captureStream(60)
    const [track] = whole.getVideoTracks()
    if (track) {
      track.contentHint = 'motion'
      await Promise.all(senders.map((sender) => sender.replaceTrack(track)))
    }
    copy.stop()
    tellArea()
    await tune()
  }

  function endGuest() {
    if (ended) {
      return
    }
    ended = true
    detachGamepad?.()
    detachGamepad = undefined
    onGuest?.(false)
  }
  async function handleState() {
    const state = connection.connectionState
    if (state === 'connected' && !joined) {
      joined = true
      detachGamepad = attachPlayerGamepad(emulator, gamepad)
      onGuest?.(true, detachGamepad ? gamepad.index + 1 : undefined)
      clearInterval(checkCopy)
      checkCopy = setInterval(checkCopying, checkEvery)
      await tune()
    } else if (state === 'disconnected') {
      // A guest whose network changes is out of reach for a moment and usually back within seconds, so the game goes
      // on. Their buttons are let go meanwhile, rather than held down until they're back
      decodePadState(new Uint8Array(padStateSize), gamepad)
    } else if (state === 'failed' || state === 'closed') {
      // Gone for good, or never reached: a guest whose network can't reach this one gets as far as answering
      endGuest()
    }
  }
  connection.addEventListener('connectionstatechange', handleState)

  return {
    async accept(answer: string) {
      const { sdp, type } = parseDescription(answer, 'answer')
      await connection.setRemoteDescription({ sdp: withStartingBitrate(sdp ?? '', startingBitrate), type })
    },
    close() {
      ended = true
      connection.removeEventListener('connectionstatechange', handleState)
      clearInterval(checkCopy)
      detachGamepad?.()
      detachGamepad = undefined
      stopWatchingPicture()
      channel.close()
      areaChannel.close()
      connection.close()
      sound?.stop()
      copy.stop()
      for (const track of whole?.getTracks() ?? []) {
        track.stop()
      }
    },
    connection,
    async offer() {
      await connection.setLocalDescription(await connection.createOffer())
      return describe(connection, reachableAt)
    },
  }
}

export interface GuestOptions {
  /** Whether the host is a game on the NAS, which takes pause menu requests and sends its numbers */
  commands?: boolean
  iceServers?: RTCIceServer[]
  /** The host's offer */
  offer: string
  /**
   * Told the moment the host ends the game, as its channels close. A host that simply goes away is noticed by the
   * connection failing instead, which takes a while longer
   */
  onEnd?: () => void
  /** Told a game on the NAS's numbers, once a second */
  onNumbers?: (numbers: NASNumbers) => void
  /** Told where the game's picture is in what arrives, and again whenever it moves */
  onPicture?: (area: PictureArea) => void
  /** Given the game's picture and sound once they arrive, to show and play */
  onStream: (stream: MediaStream) => void
  /** The address this browser reaches the server from, where the host can probably reach it too */
  reachableAt?: string
}

/**
 * Joins a game a host shares. `answer` is the text for the host; once they've taken it, the game arrives through
 * `onStream`. `sendPad()` tells the host what this end's controller is doing. `close()` leaves
 */
export async function joinGame({
  commands = false,
  iceServers = [],
  offer,
  onEnd,
  onNumbers,
  onPicture,
  onStream,
  reachableAt,
}: GuestOptions) {
  const connection = new RTCPeerConnection({ iceServers })
  // The picture and the sound arrive apart, so neither waits for the other, and are played together here
  const game = new MediaStream()
  connection.addEventListener('track', (event) => {
    // Shown the moment it arrives, not held back to smooth it out: late is worse than uneven in a game
    for (const receiver of connection.getReceivers()) {
      if ('jitterBufferTarget' in receiver) {
        receiver.jitterBufferTarget = 0
      }
    }
    if (!game.getTracks().includes(event.track)) {
      game.addTrack(event.track)
    }
    onStream(game)
  })
  const channel = connection.createDataChannel(inputChannel.label, { ...inputChannel.options, id: inputChannel.id })
  const areaChannel = connection.createDataChannel(pictureChannel.label, {
    ...pictureChannel.options,
    id: pictureChannel.id,
  })
  const commandsChannel = commands
    ? connection.createDataChannel(commandChannel.label, { ...commandChannel.options, id: commandChannel.id })
    : undefined
  commandsChannel?.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (typeof event.data !== 'string') {
      return
    }
    try {
      const numbers: unknown = JSON.parse(event.data)
      if (isNASNumbers(numbers)) {
        onNumbers?.(numbers)
      }
    } catch {
      // Not the game's numbers: ignored
    }
  })
  let leaving = false
  areaChannel.addEventListener('close', () => {
    if (!leaving) {
      onEnd?.()
    }
  })
  areaChannel.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (typeof event.data !== 'string') {
      return
    }
    try {
      const area: unknown = JSON.parse(event.data)
      if (isPictureArea(area)) {
        onPicture?.(area)
      }
    } catch {
      // Not an area: ignored
    }
  })
  await connection.setRemoteDescription(parseDescription(offer, 'offer'))
  await connection.setLocalDescription(await connection.createAnswer())

  return {
    answer: await describe(connection, reachableAt),
    close() {
      leaving = true
      channel.close()
      areaChannel.close()
      commandsChannel?.close()
      connection.close()
    },
    connection,
    /** Asks a game on the NAS to pause, resume or restart; nothing for a person's game */
    sendCommand(command: NASCommand) {
      if (commandsChannel?.readyState === 'open') {
        commandsChannel.send(JSON.stringify({ do: command }))
      }
    },
    /** Sends the controller as it is now; dropped silently until the host is reached */
    sendPad(pad: Parameters<typeof encodePadState>[0], stylus?: Stylus) {
      if (channel.readyState === 'open') {
        channel.send(encodePadState(pad, stylus))
      }
    },
  }
}
