import { noop } from 'es-toolkit'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { resolveConsole } from '#@/consoles/registry.ts'
import { goesFullscreen } from '#@/constants/preference.ts'
import { failureWordsFor, getNASCores, startNASGame } from '#@/emulator/nas-games.ts'
import { usePreference } from '#@/pages/library/hooks/use-preference.ts'
import { closeSound, readySound } from '#@/pages/library/join/sound.ts'
import { routes } from '#@/pages/routes.ts'

/** Whether the server can play a console's game with an emulator: not one played with a keyboard it doesn't send */
function playsOnServer(platform: string, core: string) {
  try {
    // The Odyssey²'s and Videopac's keyboard has no way to the server yet, and their games wait for a key at the start
    return resolveConsole(platform, core).keyboard !== 'odyssey2'
  } catch {
    return false
  }
}

/**
 * Starting a game on the server, from the menu beside Continue on a game's page: the game runs on the server, and this
 * device shows it and plays it, as a guest does a game someone shares. Only where the server has the emulator chosen
 * for the game's console
 */
export function useServerStart(rom: { id: string; platform: string }, enabled = true) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { preference } = usePreference()
  const { core } = preference.emulator.platform[rom.platform as keyof typeof preference.emulator.platform]
  const [available, setAvailable] = useState(false)
  // A DS game can also be played with a friend, on two consoles linked as by local wireless, where the server has
  // the emulator that links them
  const [linkable, setLinkable] = useState(false)
  const [starting, setStarting] = useState(false)
  const [failure, setFailure] = useState<string>()

  useEffect(() => {
    if (!enabled) {
      return
    }
    let current = true
    async function look() {
      const cores = await getNASCores()
      if (current) {
        setAvailable(cores.includes(core) && playsOnServer(rom.platform, core))
        setLinkable(rom.platform === 'nds' && cores.includes(linkedCore))
      }
    }
    // oxlint-disable-next-line typescript/no-floating-promises -- getNASCores() never fails: no cores is its answer
    look()
    return () => {
      current = false
    }
  }, [core, enabled, rom.platform])

  async function start({ linked = false } = {}) {
    if (starting) {
      return
    }
    // The sound, where it needs a press to play, and fullscreen, as a game on this device goes: now, while the press
    // still lets the page ask for them
    readySound()
    if (goesFullscreen(preference.emulator.fullscreen) && !document.fullscreenElement) {
      // oxlint-disable-next-line promise/prefer-await-to-then -- not waited for: the game starts all the same
      document.body.requestFullscreen?.().catch(noop)
    }
    setStarting(true)
    setFailure(undefined)
    try {
      const resolved = resolveConsole(rom.platform, core)
      const controls = resolved.controls ?? ''
      // An emulator that keeps its own save, such as the DS's, keeps it in a file of its own kind
      const code = await startNASGame(
        linked
          ? { controls, core, linked, rom: rom.id }
          : { controls, core, rom: rom.id, saveFileType: resolved.saveFileType },
      )
      // Whoever starts it joins first, and is its first player. The join page drops the code from the address once it
      // has it, so going back to it doesn't join again
      await navigate(`${routes.libraryJoin}?code=${encodeURIComponent(code)}`, { state: { started: true } })
    } catch (error) {
      const words = failureWordsFor(error)
      setFailure(words ? t(words) : '')
      setStarting(false)
      closeSound()
      if (document.fullscreenElement) {
        // oxlint-disable-next-line promise/prefer-await-to-then -- nothing to wait for
        document.exitFullscreen().catch(noop)
      }
    }
  }

  return { available, failure, linkable, start, starting }
}

/** The emulator the server runs a linked DS game with */
const linkedCore = 'melondsds'
