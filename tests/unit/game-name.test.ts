import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { moveArticleToFront } from '#@/utils/client/library.ts'

// File names put an article last, and names are shown with it first
await describe('moveArticleToFront', async () => {
  await it('moves a trailing article to the front', () => {
    assert.equal(moveArticleToFront('Legend of Zelda, The'), 'The Legend of Zelda')
    assert.equal(moveArticleToFront('Boy and His Blob, A'), 'A Boy and His Blob')
  })

  await it('keeps a subtitle after the name', () => {
    assert.equal(
      moveArticleToFront("Legend of Zelda, The - Link's Awakening DX"),
      "The Legend of Zelda - Link's Awakening DX",
    )
  })

  await it('leaves other names alone', () => {
    assert.equal(moveArticleToFront('Pokemon - Crystal Version'), 'Pokemon - Crystal Version')
    assert.equal(moveArticleToFront('Dragon, Then'), 'Dragon, Then')
    assert.equal(moveArticleToFront('Tetris'), 'Tetris')
  })
})
