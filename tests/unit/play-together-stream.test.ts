import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getCopySize } from '#@/emulator/picture-copy.ts'
import { withStartingBitrate } from '#@/emulator/play-together.ts'

await describe('the copy of the game’s picture sent to a guest', async () => {
  await it('is the whole canvas while the picture’s place isn’t known', () => {
    assert.deepEqual(getCopySize(undefined, { height: 480, width: 640 }, 720), {
      height: 480,
      sourceHeight: 480,
      sourceLeft: 0,
      sourceTop: 0,
      sourceWidth: 640,
      width: 640,
    })
  })

  await it('is the picture alone on a phone’s tall canvas', () => {
    // A picture across the top half of a 1080 by 2144 canvas
    const size = getCopySize(
      { aspect: 1080 / 1013, height: 1013 / 2144, left: 0, top: 0.05, width: 1 },
      { height: 2144, width: 1080 },
      720,
    )
    assert.equal(size.sourceTop, 107)
    assert.equal(size.sourceWidth, 1080)
    assert.equal(size.sourceHeight, 1013)
    assert.equal(size.height, 720)
    assert.equal(size.width, 768)
  })

  await it('is no larger than the picture when it’s small', () => {
    const size = getCopySize(
      { aspect: 4 / 3, height: 0.5, left: 0.25, top: 0.25, width: 0.5 },
      { height: 480, width: 640 },
      720,
    )
    assert.deepEqual([size.sourceLeft, size.sourceTop, size.width, size.height], [160, 120, 320, 240])
  })

  await it('is an even number of pixels each way', () => {
    const size = getCopySize(
      { aspect: 1, height: 0.5, left: 0, top: 0, width: 0.5 },
      { height: 3001, width: 1001 },
      720,
    )
    assert.equal(size.width % 2, 0)
    assert.equal(size.height % 2, 0)
  })
})

await describe('a description marked to send the picture sharp from the start', async () => {
  const answer = [
    'v=0',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111',
    'a=rtpmap:111 opus/48000/2',
    'a=fmtp:111 minptime=10;useinbandfec=1',
    'm=video 9 UDP/TLS/RTP/SAVPF 96 97 102',
    'a=rtpmap:96 VP8/90000',
    'a=rtpmap:97 rtx/90000',
    'a=fmtp:97 apt=96',
    'a=rtpmap:102 H264/90000',
    'a=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f',
    '',
  ].join('\r\n')
  const marked = withStartingBitrate(answer, 3000).split('\r\n')

  await it('marks each video format', () => {
    assert.ok(marked.includes('a=fmtp:96 x-google-start-bitrate=3000'))
    assert.ok(
      marked.includes(
        'a=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f;x-google-start-bitrate=3000',
      ),
    )
    assert.equal(marked.indexOf('a=fmtp:96 x-google-start-bitrate=3000'), marked.indexOf('a=rtpmap:96 VP8/90000') + 1)
  })

  await it('leaves the sound and the resend format alone', () => {
    assert.ok(marked.includes('a=fmtp:111 minptime=10;useinbandfec=1'))
    assert.ok(marked.includes('a=fmtp:97 apt=96'))
  })

  await it('marks once, however often it’s asked', () => {
    assert.equal(withStartingBitrate(withStartingBitrate(answer, 3000), 3000), withStartingBitrate(answer, 3000))
  })
})
