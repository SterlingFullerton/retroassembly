// The emulator's sound system opens an AudioContext and listens to it. Shutting the emulator down doesn't close it, and
// the browser keeps an open AudioContext (and through its listener, the whole emulator with the game in its memory)
// alive for good. So the AudioContexts opened on the page are kept track of, to be closed when a game is exited.
//
// Each one also plays through a volume control of its own: what the emulator sends to the speakers goes through it
// first, so the volume set in the pause menu works the same for every emulator.
const openAudioContexts = new Set<AudioContext>()
const outputs = new Map<AudioContext, GainNode>()

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
      // Sound systems that ask how many channels the speakers have still get the answer
      Object.defineProperty(output, 'maxChannelCount', { get: () => speakers.maxChannelCount })
      outputs.set(this, output)
    }

    // What the emulator connects to as the speakers is the volume control in front of them
    override get destination() {
      return (outputs.get(this) ?? super.destination) as unknown as AudioDestinationNode
    }
  }
  globalThis.AudioContext = TrackedAudioContext
}

export function getVolume() {
  return volume
}

export function applyVolume(newVolume: Volume) {
  volume = { level: Math.min(100, Math.max(0, Math.round(newVolume.level))), muted: newVolume.muted }
  for (const [context, output] of outputs) {
    output.gain.setTargetAtTime(getGain(volume), context.currentTime, 0.02)
  }
  try {
    globalThis.localStorage?.setItem(volumeStorageKey, JSON.stringify(volume))
  } catch {}
}

export async function closeAudioContexts() {
  const contexts = [...openAudioContexts]
  openAudioContexts.clear()
  outputs.clear()
  const closing = contexts.filter((context) => context.state !== 'closed').map((context) => context.close())
  await Promise.allSettled(closing)
}
