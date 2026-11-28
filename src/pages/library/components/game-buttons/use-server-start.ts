import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { resolveConsole } from '#@/consoles/registry.ts'
import { getNASCores, startNASGame } from '#@/emulator/nas-games.ts'
import { usePreference } from '#@/pages/library/hooks/use-preference.ts'
import { routes } from '#@/pages/routes.ts'

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
        setAvailable(cores.includes(core))
      }
    }
    // oxlint-disable-next-line typescript/no-floating-promises -- getNASCores() never fails: no cores is its answer
    look()
    return () => {
      current = false
    }
  }, [core, enabled])

  async function start() {
    setStarting(true)
    setFailure(undefined)
    try {
      const resolved = resolveConsole(rom.platform, core)
      const controls = resolved.controls ?? ''
      // An emulator that keeps its own save, such as the DS's, keeps it in a file of its own kind
      const code = await startNASGame({ controls, core, rom: rom.id, saveFileType: resolved.saveFileType })
      // Whoever starts it joins first, and is its first player
      await navigate(`${routes.libraryJoin}?code=${encodeURIComponent(code)}&started=1`)
    } catch (error) {
      setFailure(describeFailure(error, t('nasGames.full')))
      setStarting(false)
    }
  }

  return { available, failure, start, starting }
}

/** What went wrong starting a game on the server, in words: a server already running all the games it may is said plainly */
function describeFailure(error: unknown, full: string) {
  const { detail, message, statusCode } = (error ?? {}) as {
    detail?: { data?: unknown }
    message?: unknown
    statusCode?: number
  }
  if (statusCode === 503) {
    return full
  }
  const data = detail?.data as { message?: unknown } | string | undefined
  const said = typeof data === 'string' ? data : data?.message
  if (typeof said === 'string' && said) {
    return said
  }
  return typeof message === 'string' ? message : ''
}
