import { parse } from 'goodcodes-parser'

// How names are compared, the same when the database is built and when a game is looked up. From msleuth (MIT)

/** Letters and digits only, lowercase: "Super Mario Bros. 3" is "supermariobros3" */
export function getCompactName(name: string) {
  return name.replaceAll(/[^\p{Letter}\p{Mark}\p{Number}]/gu, '').toLowerCase()
}

/** The name without its GoodTools tags: "Tetris (World) [!]" is "Tetris" */
export function getGoodcodesBase(name: string) {
  return parse(`0 - ${name}`).rom
}

/** The name without its GoodTools tags, compacted: "Tetris (World) [!]" is "tetris" */
export function getGoodcodesBaseCompactName(name: string) {
  return getCompactName(getGoodcodesBase(name))
}

/** "Legend of Zelda, The (USA)" is "The Legend of Zelda (USA)" */
export function restoreTitleForSorting(title: string) {
  const match = /^(?<title>.*),\s*(?<article>A|An|The)(?<rest>\s*(?:\S.*)?)$/u.exec(title)
  if (match?.groups) {
    return `${match.groups.article} ${match.groups.title}${match.groups.rest}`
  }
  return title
}

/**
 * The countries a GoodTools or No-Intro name says it's for, by name: "Tetris (UE)" is USA and Europe. "(Disc 4)" is
 * left out, as GoodTools would read its 4 as a country code
 */
export function getCountries(name: string) {
  const { countries = [] } = parse(`0 - ${name.replaceAll(/\(Disc \d+\)/giu, '')}.x`).codes as {
    countries?: { name: string }[]
  }
  return countries.flatMap((country) => country.name.split(' & '))
}
