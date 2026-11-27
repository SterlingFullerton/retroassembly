import { client, parseResponse } from '#@/api/client.ts'

// Games run on the NAS, for a device that can't run them itself: the NAS sends the picture and sound, as a person's
// device does when sharing a game, and each player joins it from the join page. Whoever starts one is its first
// player, and only they, or an admin, can end it. See server/internal/nasgames

let cores: Promise<string[]> | undefined

async function askForCores() {
  try {
    return await parseResponse(client.nas_games.cores.$get())
  } catch {
    return []
  }
}

/** The emulators the NAS has, by name: none where games on the NAS aren't set up. Asked for once a page load */
export function getNASCores() {
  cores ??= askForCores()
  return cores
}

/** Runs a game from the library on the NAS, and is the code that joins it */
export async function startNASGame(start: { controls: string; core: string; rom: string }) {
  const { code } = await parseResponse(client.nas_games.$post({ json: start }))
  return code
}

/** Ends a game on the NAS */
export async function stopNASGame(code: string) {
  await parseResponse(client.nas_games[':code'].$delete({ param: { code } }))
}

/** Whether a code joins a game on the NAS: theirs start with a zero, which a person's never has */
export function isNASCode(code: string) {
  return code.trim().startsWith('0')
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
