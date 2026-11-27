import { groupBy } from 'es-toolkit'
import { useTranslation } from 'react-i18next'
import { useGameStates } from '../hooks/use-game-states.ts'
import { GameState } from './game-state.tsx'

export function GameStates() {
  const { t } = useTranslation()
  const { states } = useGameStates()

  const { auto, manual } = groupBy(states, ({ type }) => type)

  return (
    <>
      <h3 className='flex shrink-0 items-center gap-2 text-sm font-semibold tracking-wide text-white/70 uppercase'>
        <span className='icon-[mdi--database] size-4' />
        {t('emulator.savedStates')}
      </h3>
      <div className='shrink-0'>
        {manual && manual.length > 0 ? (
          <div className='grid grid-cols-2 gap-3'>
            {manual.map((state) => (
              <GameState key={state.id} state={state} />
            ))}
          </div>
        ) : (
          <div className='flex items-center justify-center gap-2 py-6 text-sm text-neutral-400'>
            <span className='icon-[mdi--database-outline] text-2xl' />
            {t('empty.noSavedStates')}
          </div>
        )}
      </div>

      <h3 className='mt-2 flex shrink-0 items-center gap-2 text-sm font-semibold tracking-wide text-white/70 uppercase'>
        <span className='icon-[mdi--timer] size-4' />
        {t('emulator.autoSavedStates')}
      </h3>
      <div className='shrink-0'>
        {auto && auto.length > 0 ? (
          <div className='grid grid-cols-2 gap-3'>
            {auto.map((state) => (
              <GameState key={state.id} state={state} />
            ))}
          </div>
        ) : (
          <div className='flex items-center justify-center gap-2 py-6 text-sm text-neutral-400'>
            <span className='icon-[mdi--timer-outline] text-2xl' />
            {t('empty.noAutoSavedStates')}
          </div>
        )}
      </div>
    </>
  )
}
