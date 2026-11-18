import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createFileResponse } from '#@/api/routes/utils.ts'

// Stored files are data, whatever is in them: an uploaded SVG can't run script on the site when opened on its own
await describe('stored file responses', async () => {
  await it('forbid scripts and type guessing', () => {
    const body = new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>']).stream()
    const response = createFileResponse({ body, httpEtag: '"x"', size: 70 }, 'attachments/u/nes/r/art.svg')
    assert.equal(response.headers.get('Content-Type'), 'image/svg+xml')
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff')
    const policy = response.headers.get('Content-Security-Policy') ?? ''
    assert.match(policy, /\bsandbox\b/u)
    assert.match(policy, /default-src 'none'/u)
    assert.doesNotMatch(policy, /script-src/u)
  })
})
