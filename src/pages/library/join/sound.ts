import { noop } from 'es-toolkit'

// The sound of a game joined from the join page. Browsers only play sound a press has allowed, and the picture arrives
// seconds after the press that joined, so the video starts muted and its sound is let in by a press: the one that joined
// where the browser still counts it, else a tap on "Tap for sound".
//
// iPhones and iPads don't let a page set a video's volume, so there the sound plays through an AudioContext instead,
// whose volume the app sets (see emulator/audio.ts), and the video stays muted. Such a context can only start in a
// press, so it's made in the press that joins, or in the tap for sound

let context: AudioContext | undefined
let source: { node: MediaStreamAudioSourceNode; track: MediaStreamTrack } | undefined
let settable: boolean | undefined

/** Whether this browser lets a page set a video's volume: not on an iPhone or iPad, where it reads back as 1 */
export function canSetVolume() {
  if (settable === undefined) {
    const probe = document.createElement('video')
    probe.volume = 0.5
    settable = probe.volume === 0.5
  }
  return settable
}

/** In a press: readies the sound where it plays through an AudioContext, so a picture that arrives later has it */
export function readySound() {
  if (canSetVolume() || typeof AudioContext !== 'function') {
    return
  }
  try {
    context ??= new AudioContext()
    // oxlint-disable-next-line promise/prefer-await-to-then -- not waited for: the press is what counts
    context.resume().catch(noop)
  } catch {
    // No sound but the video's own
  }
}

/** Whether the sound is ready to play through the AudioContext, which then plays a stream without a press */
export function contextReady() {
  return context?.state === 'running'
}

/** Plays a stream's sound through the AudioContext; false where there's none ready, or the stream has no sound yet */
export function playThroughContext(stream: MediaStream) {
  const [track] = stream.getAudioTracks()
  if (!context || !track) {
    return false
  }
  if (source?.track !== track) {
    source?.node.disconnect()
    const node = context.createMediaStreamSource(new MediaStream([track]))
    node.connect(context.destination)
    source = { node, track }
  }
  return true
}

/** Stops the sound, as the game is left */
export function closeSound() {
  source?.node.disconnect()
  source = undefined
  // oxlint-disable-next-line promise/prefer-await-to-then -- nothing to wait for
  context?.close().catch(noop)
  context = undefined
}
