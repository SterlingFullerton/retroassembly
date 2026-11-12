import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getSearchMatchRanges, getSearchTitle, normalizeSearchText, scoreRom } from '#@/utils/isomorphic/search.ts'

function rom(fileName: string, extra: { gameDeveloper?: string; gameName?: string } = {}) {
  return { fileName, ...extra }
}

const library = [
  rom('Super Mario World (USA).sfc'),
  rom('Super Mario 64 (USA).z64'),
  rom('Mario Kart 64 (USA).z64'),
  rom('Dr. Mario (World).nes'),
  rom('Monster Truck Racing in Orbit (USA).nes'),
  rom('Legend of Zelda, The - A Link to the Past (USA).sfc'),
  rom('Pokemon - Diamond Version (USA).nds', { gameName: 'Pokémon Diamond' }),
  rom('Spider-Man (USA).gba'),
  rom("Assassin's Creed II - Discovery.nds"),
  rom('Ed, Edd n Eddy - Jawbreakers! (USA).gba'),
  rom('Tetris (World).gb', { gameDeveloper: 'Nintendo' }),
]

function search(query: string) {
  return library
    .map((item) => ({ name: getSearchTitle(item.fileName), score: scoreRom(item, query) }))
    .filter(({ score }) => score > 0)
    .toSorted((a, b) => b.score - a.score || a.name.length - b.name.length)
    .map(({ name }) => name)
}

await describe('game search', async () => {
  await it('normalizes accents, punctuation, case and &', () => {
    assert.equal(normalizeSearchText("Pokémon: Let's Go & Fly!"), 'pokemon lets go and fly')
    assert.equal(getSearchTitle('Legend of Zelda, The (USA) (Rev 1).sfc'), 'Legend of Zelda, The')
    assert.equal(getSearchTitle('Dr. Mario.nes'), 'Dr. Mario')
  })

  await it("doesn't match titles that only contain the letters typed", () => {
    assert.ok(!search('mario').includes('Monster Truck Racing in Orbit'))
  })

  await it('ranks the words typed together above the same words apart', () => {
    assert.deepEqual(search('mario'), ['Dr. Mario', 'Mario Kart 64', 'Super Mario 64', 'Super Mario World'])
    assert.equal(scoreRom(rom('Mario Kart 64.z64'), 'mario kart'), 80)
    assert.equal(scoreRom(rom('Kart Mario.z64'), 'mario kart'), 60)
    assert.equal(scoreRom(rom('Mario Kart 64.z64'), 'mario kart 64'), 100)
  })

  await it('finds games by initials and by Roman numerals as numbers', () => {
    const finalFantasy = rom('Final Fantasy VII (USA) (Disc 1).chd')
    assert.ok(scoreRom(finalFantasy, 'ff7') > 0)
    assert.ok(scoreRom(finalFantasy, 'final fantasy 7') > 0)
    assert.equal(scoreRom(rom('Final Fantasy VIII.chd'), 'ff7'), 0)
    assert.deepEqual(search('sm64'), ['Super Mario 64'])
    assert.equal(scoreRom(rom('Constructor (Europe).psx'), 'cons'), 80)
  })

  await it('needs every word, in any order, as the start of a word', () => {
    assert.deepEqual(search('zel lin'), ['Legend of Zelda, The - A Link to the Past'])
    assert.deepEqual(search('64 kart'), ['Mario Kart 64'])
    assert.deepEqual(search('the legend of zelda'), ['Legend of Zelda, The - A Link to the Past'])
  })

  await it('finds names typed without accents, spaces or punctuation', () => {
    assert.deepEqual(search('pokemon diamond'), ['Pokemon - Diamond Version'])
    assert.deepEqual(search('spiderman'), ['Spider-Man'])
    assert.deepEqual(search('assassins creed'), ["Assassin's Creed II - Discovery"])
    assert.deepEqual(search('ed edd and eddy').length, 0)
    assert.deepEqual(search('ed edd n eddy'), ['Ed, Edd n Eddy - Jawbreakers!'])
  })

  await it('finds games by developer, below games named that way', () => {
    assert.deepEqual(search('nintendo'), ['Tetris'])
    assert.ok(scoreRom(library[10], 'nintendo') < scoreRom(library[0], 'super mario'))
  })

  await it('highlights the matched start of each word', () => {
    const title = 'Legend of Zelda, The - A Link to the Past'
    assert.deepEqual(
      getSearchMatchRanges(title, 'zel lin').map(([start, end]) => title.slice(start, end)),
      ['Zel', 'Lin'],
    )
    assert.deepEqual(
      getSearchMatchRanges('Pokémon Diamond', 'poke').map(([start, end]) => 'Pokémon Diamond'.slice(start, end)),
      ['Poké'],
    )
  })
})
