// The emulator's sound system opens an AudioContext and listens to it. Shutting the emulator down doesn't close it, and
// the browser keeps an open AudioContext (and through its listener, the whole emulator with the game in its memory)
// alive for good. So the AudioContexts opened on the page are kept track of, to be closed when a game is exited.
//
// Each one also plays through a volume control of its own: what the emulator sends to the speakers goes through it
// first, so the volume set in the pause menu works the same for every emulator.
const openAudioContexts = new Set<AudioContext>()
const outputs = new Map<AudioContext, GainNode>()
const entries = new Map<AudioContext, GainNode>()

// The volume, from 0 to 100, and whether it's muted. Kept in this browser, so each device has its own
const volumeStorageKey = 'retroassembly-volume'
export interface Volume {
  level: number
  muted: boolean
}

function loadVolume(): Volume {
  try {
    const saved: unknown = JSON.parse(globalThis.localStorage?.getItem(volumeStorageKey) ?? 'null')
    if (saved && typeof saved === 'object' && 'level' in saved && 'muted' in saved) {
      const { level, muted } = saved
      if (typeof level === 'number' && typeof muted === 'boolean') {
        return { level: Math.min(100, Math.max(0, level)), muted }
      }
    }
  } catch {}
  return { level: 100, muted: false }
}

let volume = loadVolume()

// Loudness is heard on a curve, so the slider's middle sounds about half as loud rather than barely quieter
function getGain({ level, muted }: Volume) {
  return muted ? 0 : (level / 100) ** 2
}

if (typeof AudioContext === 'function' && !Reflect.get(AudioContext, 'tracked')) {
  const OriginalAudioContext = AudioContext
  class TrackedAudioContext extends OriginalAudioContext {
    static readonly tracked = true

    constructor(...args: ConstructorParameters<typeof AudioContext>) {
      super(...args)
      openAudioContexts.add(this)
      const speakers = super.destination
      const output = this.createGain()
      output.gain.value = getGain(volume)
      output.connect(speakers)
      // The game's sound as the emulator makes it, before the volume: what's sent to someone playing along elsewhere
      const entry = this.createGain()
      entry.connect(output)
      // Sound systems that ask how many channels the speakers have still get the answer
      Object.defineProperty(entry, 'maxChannelCount', { get: () => speakers.maxChannelCount })
      outputs.set(this, output)
      entries.set(this, entry)
    }

    // What the emulator connects to as the speakers is the way in to the volume control in front of them
    override get destination() {
      return (entries.get(this) ?? super.destination) as unknown as AudioDestinationNode
    }
  }
  globalThis.AudioContext = TrackedAudioContext
}

export function getVolume() {
  return volume
}

const volumeListeners = new Set<(gain: number) => void>()

/** Follows the volume as a gain from 0 to 1, starting with the one now, for sound played without the emulator, such as
 * a game streamed from the server. Returns how to stop following it */
export function followVolume(listener: (gain: number) => void) {
  volumeListeners.add(listener)
  listener(getGain(volume))
  return () => {
    volumeListeners.delete(listener)
  }
}

export function applyVolume(newVolume: Volume) {
  volume = { level: Math.min(100, Math.max(0, Math.round(newVolume.level))), muted: newVolume.muted }
  for (const [context, output] of outputs) {
    output.gain.setTargetAtTime(getGain(volume), context.currentTime, 0.02)
  }
  for (const listener of volumeListeners) {
    listener(getGain(volume))
  }
  try {
    globalThis.localStorage?.setItem(volumeStorageKey, JSON.stringify(volume))
  } catch {}
}

/** The sound system the game plays through: its sample rate, whether it's running, and its delay where the browser says */
export function getAudioInfo() {
  const context = [...openAudioContexts].findLast((candidate) => candidate.state !== 'closed')
  if (!context) {
    return
  }
  const delays = [context.baseLatency, context.outputLatency].filter((delay) => Number.isFinite(delay) && delay > 0)
  return {
    /** In milliseconds: the delay the browser adds, and where it knows it, the device's own; nothing when it says neither */
    latency: delays.length > 0 ? delays.reduce((sum, delay) => sum + delay, 0) * 1000 : undefined,
    sampleRate: context.sampleRate,
    state: context.state,
  }
}

/**
 * The game's sound as a stream that can be sent elsewhere, taken before the volume, so turning this device down or
 * muting it doesn't quieten it for anyone else. Nothing when no game is making sound. `stop()` lets go of it
 */
export function captureGameAudio() {
  const context = [...openAudioContexts].findLast((candidate) => candidate.state !== 'closed')
  const entry = context && entries.get(context)
  if (!context || !entry) {
    return
  }
  const tap = context.createMediaStreamDestination()
  entry.connect(tap)
  return {
    stop() {
      try {
        entry.disconnect(tap)
      } catch {}
      for (const track of tap.stream.getTracks()) {
        track.stop()
      }
    },
    stream: tap.stream,
  }
}

export async function closeAudioContexts() {
  const contexts = [...openAudioContexts]
  openAudioContexts.clear()
  outputs.clear()
  entries.clear()
  const closing = contexts.filter((context) => context.state !== 'closed').map((context) => context.close())
  await Promise.allSettled(closing)
}
