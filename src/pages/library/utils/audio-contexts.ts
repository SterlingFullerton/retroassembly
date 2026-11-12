// The emulator's sound system opens an AudioContext and listens to it. Shutting the emulator down doesn't close it, and
// the browser keeps an open AudioContext (and through its listener, the whole emulator with the game in its memory)
// alive for good. So the AudioContexts opened on the page are kept track of, to be closed when a game is exited.
const openAudioContexts = new Set<AudioContext>()

if (typeof AudioContext === 'function' && !Reflect.get(AudioContext, 'tracked')) {
  const OriginalAudioContext = AudioContext
  class TrackedAudioContext extends OriginalAudioContext {
    static readonly tracked = true

    constructor(...args: ConstructorParameters<typeof AudioContext>) {
      super(...args)
      openAudioContexts.add(this)
    }
  }
  globalThis.AudioContext = TrackedAudioContext
}

export async function closeAudioContexts() {
  const contexts = [...openAudioContexts]
  openAudioContexts.clear()
  const closing = contexts.filter((context) => context.state !== 'closed').map((context) => context.close())
  await Promise.allSettled(closing)
}
