import type { Nostalgist } from 'nostalgist'
import { attachPlayerGamepad, captureGameAudio, type EmulatorGamepad } from './adapter.ts'

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
export function encodePadState(pad: {
  axes: readonly number[]
  buttons: readonly { pressed: boolean }[]
}): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(padStateSize)
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
  return bytes
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

/** Has the picture sent smoothly before sharply, and no larger than a guest needs */
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
  /** Told when the guest arrives and when they leave */
  onGuest?: (connected: boolean) => void
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
  const picture = canvas.captureStream(60)
  const sound = captureGameAudio()
  const senders: RTCRtpSender[] = []
  for (const track of picture.getVideoTracks()) {
    // A game is all movement: frames are kept coming even when that costs sharpness
    track.contentHint = 'motion'
    senders.push(connection.addTrack(track, picture))
  }
  for (const track of sound?.stream.getAudioTracks() ?? []) {
    connection.addTrack(track, picture)
  }

  const gamepad = createGuestGamepad()
  let detachGamepad: (() => void) | undefined
  const channel = connection.createDataChannel(inputChannel.label, { ...inputChannel.options, id: inputChannel.id })
  channel.binaryType = 'arraybuffer'
  channel.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (event.data instanceof ArrayBuffer) {
      decodePadState(new Uint8Array(event.data), gamepad)
    }
  })

  async function handleState() {
    const connected = connection.connectionState === 'connected'
    if (connected && !detachGamepad) {
      detachGamepad = attachPlayerGamepad(emulator, gamepad)
      onGuest?.(true)
      await Promise.all(senders.map((sender) => tunePicture(sender, canvas.height)))
    } else if (!connected && detachGamepad) {
      detachGamepad()
      detachGamepad = undefined
      onGuest?.(false)
    }
  }
  connection.addEventListener('connectionstatechange', handleState)

  return {
    async accept(answer: string) {
      await connection.setRemoteDescription(parseDescription(answer, 'answer'))
    },
    close() {
      connection.removeEventListener('connectionstatechange', handleState)
      detachGamepad?.()
      detachGamepad = undefined
      channel.close()
      connection.close()
      sound?.stop()
      for (const track of picture.getTracks()) {
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
  iceServers?: RTCIceServer[]
  /** The host's offer */
  offer: string
  /** Given the game's picture and sound once they arrive, to show and play */
  onStream: (stream: MediaStream) => void
  /** The address this browser reaches the server from, where the host can probably reach it too */
  reachableAt?: string
}

/**
 * Joins a game a host shares. `answer` is the text for the host; once they've taken it, the game arrives through
 * `onStream`. `sendPad()` tells the host what this end's controller is doing. `close()` leaves
 */
export async function joinGame({ iceServers = [], offer, onStream, reachableAt }: GuestOptions) {
  const connection = new RTCPeerConnection({ iceServers })
  connection.addEventListener('track', (event) => {
    const [stream] = event.streams
    // Shown the moment it arrives, not held back to smooth it out: late is worse than uneven in a game
    for (const receiver of connection.getReceivers()) {
      if ('jitterBufferTarget' in receiver) {
        receiver.jitterBufferTarget = 0
      }
    }
    if (stream) {
      onStream(stream)
    }
  })
  const channel = connection.createDataChannel(inputChannel.label, { ...inputChannel.options, id: inputChannel.id })
  await connection.setRemoteDescription(parseDescription(offer, 'offer'))
  await connection.setLocalDescription(await connection.createAnswer())

  return {
    answer: await describe(connection, reachableAt),
    close() {
      channel.close()
      connection.close()
    },
    connection,
    /** Sends the controller as it is now; dropped silently until the host is reached */
    sendPad(pad: Parameters<typeof encodePadState>[0]) {
      if (channel.readyState === 'open') {
        channel.send(encodePadState(pad))
      }
    },
  }
}
