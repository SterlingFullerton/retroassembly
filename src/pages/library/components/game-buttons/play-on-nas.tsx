import { Button } from '@radix-ui/themes'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { resolveConsole } from '#@/consoles/registry.ts'
import { getNASCores, startNASGame } from '#@/emulator/nas-games.ts'
import { usePreference } from '#@/pages/library/hooks/use-preference.ts'
import { routes } from '#@/pages/routes.ts'

/**
 * Play on the NAS, under Continue and Start on a game's page: the game runs on the NAS, and this device shows it and
 * plays it, as a guest does a game someone shares. Only where the NAS has the emulator chosen for the game's console
 */
export function PlayOnNAS({ rom }: Readonly<{ rom: { id: string; platform: string } }>) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { preference } = usePreference()
  const { core } = preference.emulator.platform[rom.platform as keyof typeof preference.emulator.platform]
  const [available, setAvailable] = useState(false)
  const [starting, setStarting] = useState(false)
  const [failure, setFailure] = useState<string>()

  useEffect(() => {
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
  }, [core])

  if (!available) {
    return null
  }

  async function handleClick() {
    setStarting(true)
    setFailure(undefined)
    try {
      const controls = resolveConsole(rom.platform, core).controls ?? ''
      const code = await startNASGame({ controls, core, rom: rom.id })
      // Whoever starts it joins first, and is its first player
      await navigate(`${routes.libraryJoin}?code=${encodeURIComponent(code)}&started=1`)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
      setStarting(false)
    }
  }

  return (
    <div className='mt-3 flex w-full flex-col gap-1.5 lg:w-80'>
      <Button
        className='w-full!'
        data-testid='play-on-nas'
        disabled={starting}
        onClick={handleClick}
        size='3'
        type='button'
        variant='soft'
      >
        <span className={starting ? 'icon-[svg-spinners--180-ring]' : 'icon-[mdi--server-network]'} />
        {starting ? t('nasGames.starting') : t('nasGames.playOnNAS')}
      </Button>
      {failure ? (
        <p className='text-sm text-(--red-11)' data-testid='play-on-nas-failure'>
          {t('nasGames.failed')} <span className='[overflow-wrap:anywhere] opacity-70'>{failure}</span>
        </p>
      ) : null}
    </div>
  )
}
