import { client, parseResponse } from '#@/api/client.ts'

// Games run on the NAS, for a device that can't run them itself: the NAS sends the picture and sound, as a person's
// device does when sharing a game, and each player joins it from the join page. Whoever starts one is its first
// player, and only they, or an admin, can end it. See server/internal/nasgames

let cores: Promise<string[]> | undefined

async function askForCores() {
  try {
    return await parseResponse(client.nas_games.cores.$get())
  } catch {
    // Not kept: a server that was restarting is asked again the next time a game's buttons are shown
    cores = undefined
    return []
  }
}

/**
 * The emulators the NAS has, by name: none where games on the NAS aren't set up. Asked for once a page load, unless the
 * server couldn't be asked
 */
export function getNASCores() {
  cores ??= askForCores()
  return cores
}

/**
 * Runs a game from the library on the NAS, and is the code that joins it. A linked one is a DS game on two consoles
 * linked as by local wireless, the starter's and a friend's: the code is the starter's
 */
export async function startNASGame(start: {
  controls: string
  core: string
  linked?: boolean
  rom: string
  saveFileType?: string
}) {
  const { code } = await parseResponse(client.nas_games.$post({ json: start }))
  return code
}

/** Ends a game on the NAS */
export async function stopNASGame(code: string) {
  await parseResponse(client.nas_games[':code'].$delete({ param: { code } }))
}

/**
 * A code as it was meant: without spaces, in capitals, and with the letter O read as the zero it can only be. No code
 * has an O, and only a game on the NAS's has a zero, at its start
 */
export function normalizeCode(code: string) {
  return code.replaceAll(/\s/gu, '').toUpperCase().replaceAll('O', '0')
}

/** Whether a code joins a game on the NAS: theirs start with a zero, which a person's never has */
export function isNASCode(code: string) {
  return normalizeCode(code).startsWith('0')
}

// What the app server says went wrong with a game on the server, by the stable code it gives with its message, as the
// name of the words that say it in the player's language. A failure with no code, or one not listed here, is said in
// general words by whoever asked
const serverDown = 'join.serverUnavailable'
const busy = 'join.busy'
const saveProblem = 'join.saveProblem'
const notYours = 'join.notYours'
const failureWords: Record<string, string> = {
  server_busy: busy,
  server_failed: serverDown,
  server_full: 'nasGames.full',
  server_game_full: 'join.gameFull',
  server_game_not_found: 'playTogether.notFound',
  server_linked_states: busy,
  server_not_yours: notYours,
  server_off: serverDown,
  server_one_game: 'join.gameLimit',
  server_out_of_date: serverDown,
  server_places_waiting: busy,
  server_refused: serverDown,
  server_save_missing: saveProblem,
  server_save_too_large: saveProblem,
  server_save_unreadable: saveProblem,
  server_save_waiting: 'join.saveWaiting',
  server_start_timeout: serverDown,
  server_starting: busy,
  server_states_not_yours: notYours,
  server_unreachable: serverDown,
  // A person's shared game: someone else is joining it, or has joined it
  together_answered: 'join.alreadyJoined',
  together_joining: 'join.someoneJoining',
  // fetch() itself failed: the app couldn't be reached
  unreachable: 'join.serverUnreachable',
}

/** The failure's code, from what the API threw: the server's JSON, or what the request threw */
export function failureCode(error: unknown) {
  if (error instanceof TypeError) {
    return 'unreachable'
  }
  const { code, data, detail } = (error ?? {}) as {
    code?: unknown
    data?: { code?: unknown }
    detail?: { data?: { code?: unknown } }
  }
  const found = code ?? data?.code ?? detail?.data?.code
  return typeof found === 'string' ? found : undefined
}

/** Whether a failure says there's no game by the code: one that ended, or never was */
export function isGameGone(error: unknown) {
  if (typeof Response !== 'undefined' && error instanceof Response) {
    return error.status === 404
  }
  const { status, statusCode } = (error ?? {}) as { status?: unknown; statusCode?: unknown }
  return failureCode(error) === 'server_game_not_found' || status === 404 || statusCode === 404
}

/** The name of the words for what went wrong, where they're known */
export function failureWordsFor(error: unknown) {
  const code = failureCode(error)
  if (code) {
    return failureWords[code]
  }
  return isGameGone(error) ? 'playTogether.notFound' : undefined
}

/** A save state of a game on the NAS */
export type NASState = Awaited<ReturnType<typeof listNASStates>>[number]

/** A game on the NAS's save states, newest first */
export function listNASStates(code: string) {
  return parseResponse(client.nas_games[':code'].states.$get({ param: { code } }))
}

/** Saves the game on the NAS as it is now */
export function saveNASState(code: string) {
  return parseResponse(client.nas_games[':code'].states.$post({ param: { code } }))
}

/** Puts the game on the NAS back as it was in a state, for everyone in it */
export async function loadNASState(code: string, state: string) {
  await parseResponse(client.nas_games[':code'].states[':state'].load.$post({ param: { code, state } }))
}

/** Where a state's picture is */
export function getNASStatePicture(code: string, state: string) {
  return `/api/v1/nas_games/${encodeURIComponent(code)}/states/${encodeURIComponent(state)}/picture`
}
