// Game search: every word typed has to start a word of the game's name, so "zel lin" finds "The Legend of Zelda - A
// Link to the Past" but "mario" doesn't find every title that happens to contain an m, an a, an r, an i and an o.
// Names are compared without accents, punctuation, case or region tags, and with "&" read as "and"

export interface SearchableRom {
  fileName: null | string
  gameDeveloper?: null | string
  gameName?: null | string
  gamePublisher?: null | string
}

interface PreparedText {
  compact: string
  initials: string
  text: string
  words: string[]
}

/** Lowercase words without accents or punctuation: "Pokémon: Let's Go & Fly!" → "pokemon lets go and fly" */
export function normalizeSearchText(text: string) {
  return text
    .normalize('NFKD')
    .replaceAll(/\p{Mark}/gu, '')
    .toLowerCase()
    .replaceAll('&', ' and ')
    .replaceAll(/['’`]/gu, '')
    .replaceAll(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim()
}

/** A file's name as the library shows it: no extension, region or other tags in brackets */
export function getSearchTitle(fileName: string) {
  const base = fileName.replace(/\.[^.\s]{1,5}$/u, '')
  return base.replaceAll(/\s*[([][^)\]]*[)\]]/gu, '').trim() || base
}

const romanNumerals = new Map(
  Object.entries({ ii: 2, iii: 3, iv: 4, ix: 9, v: 5, vi: 6, vii: 7, viii: 8, xi: 11, xii: 12, xiii: 13 }).map(
    ([numeral, number]) => [numeral, String(number)],
  ),
)

function prepare(text: null | string | undefined): PreparedText | undefined {
  if (!text) {
    return
  }
  // "Legend of Zelda, The - A Link to the Past" is read as "The Legend of Zelda - A Link to the Past"
  const normalized = normalizeSearchText(
    text.replace(/^(?<name>[^,]+), (?<article>The|A|An)\b/iu, '$<article> $<name>'),
  )
  if (!normalized) {
    return
  }
  const words = normalized.split(' ')
  // A Roman numeral also matches its number, so "final fantasy 7" finds "Final Fantasy VII"
  const numbers = words.map((word) => romanNumerals.get(word)).filter((number) => number !== undefined)
  // First letters, with numbers whole: "ff7" finds "Final Fantasy VII", "sm64" finds "Super Mario 64"
  const initials = words.map((word) => romanNumerals.get(word) ?? (/^\d+$/u.test(word) ? word : word[0])).join('')
  return { compact: normalized.replaceAll(' ', ''), initials, text: normalized, words: [...words, ...numbers] }
}

// Tiers of how a name matches. Within a tier, better-known games come first (see the server's ranking)
function scoreText(target: PreparedText, query: PreparedText) {
  if (target.text === query.text) {
    return 100
  }
  // The words typed, together, at the start of a word of the name
  if (` ${target.text}`.includes(` ${query.text}`)) {
    return 80
  }
  // Every word typed starts a word of the name, in any order
  if (query.words.every((word) => target.words.some((targetWord) => targetWord.startsWith(word)))) {
    return 60
  }
  if (query.words.length === 1 && query.compact.length > 2) {
    if (target.initials.startsWith(query.compact)) {
      return 55
    }
    // Without spaces: "spiderman" finds "Spider-Man", "mario64" finds "Mario 64"
    if (target.compact.includes(query.compact)) {
      return 50
    }
  }
  return 0
}

/**
 * How well a game matches a search, from 0 (not at all) to 100 (its exact name). Its name counts most; the developer or
 * publisher only when every word typed is found there.
 */
export function scoreRom(rom: SearchableRom, query: string) {
  const preparedQuery = prepare(query)
  if (!preparedQuery) {
    return 0
  }
  const names = [prepare(rom.fileName ? getSearchTitle(rom.fileName) : ''), prepare(rom.gameName)]
  let score = Math.max(0, ...names.map((name) => (name ? scoreText(name, preparedQuery) : 0)))
  if (!score) {
    const credits = [prepare(rom.gameDeveloper), prepare(rom.gamePublisher)]
    if (credits.some((credit) => credit && scoreText(credit, preparedQuery) >= 60)) {
      score = 30
    }
  }
  return score
}

/** Where in `text` the words of a search match, as [start, end) ranges, for highlighting */
export function getSearchMatchRanges(text: string, query: string) {
  const queryWords = normalizeSearchText(query).split(' ').filter(Boolean)
  const ranges: [number, number][] = []
  for (const match of text.matchAll(/[\p{Letter}\p{Number}'’]+/gu)) {
    const word = normalizeSearchText(match[0]).replaceAll(' ', '')
    const queryWord = queryWords.find((candidate) => word.startsWith(candidate))
    if (queryWord) {
      // Count characters of the original word until as many letters as the search word has are covered
      let covered = 0
      let length = 0
      for (const char of match[0]) {
        if (covered >= queryWord.length) {
          break
        }
        covered += normalizeSearchText(char).length
        length += char.length
      }
      ranges.push([match.index, match.index + length])
    }
  }
  return ranges
}
