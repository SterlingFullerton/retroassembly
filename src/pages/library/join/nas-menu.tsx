import { useEffect, useState } from 'react'
import { getNASStatePicture, listNASStates, loadNASState, type NASState, saveNASState } from '#@/emulator/nas-games.ts'

// The pause menu of a game on the NAS, which pauses it for everyone in it while it's open. Its save states are the
// NAS's own, kept for whoever started the game: the NAS's emulators are other builds than the browser's, and their
// states don't load in each other. In English, like the rest of the join page, until it's decided whether to keep it

const pill =
  'flex min-h-12 items-center gap-3 rounded-full border border-solid border-white px-5 py-2 hover:bg-white/15 disabled:opacity-50'
const focusStyle = JSON.stringify({ backgroundColor: 'rgba(255, 255, 255, 0.2)', borderRadius: '24px' })

type Saving = 'failed' | 'idle' | 'saved' | 'saving'

function formatSaved(created: string) {
  const date = new Date(created)
  const today = new Date().toDateString() === date.toDateString()
  return new Intl.DateTimeFormat(
    undefined,
    today ? { timeStyle: 'short' } : { dateStyle: 'medium', timeStyle: 'short' },
  ).format(date)
}

export function NASMenu({
  code,
  onEnd,
  onLeave,
  onRestart,
  onResume,
  startedHere,
  title,
}: Readonly<{
  code: string
  onEnd: () => void
  onLeave: () => void
  onRestart: () => void
  onResume: () => void
  startedHere: boolean
  title: string
}>) {
  const [view, setView] = useState<'load' | 'main'>('main')
  const [saving, setSaving] = useState<Saving>('idle')
  const [states, setStates] = useState<NASState[]>()
  const [loadFailed, setLoadFailed] = useState(false)

  // "Saved" for a moment, then the button is itself again
  useEffect(() => {
    if (saving !== 'saved' && saving !== 'failed') {
      return
    }
    const timer = setTimeout(() => setSaving('idle'), 2000)
    return () => clearTimeout(timer)
  }, [saving])

  async function save() {
    setSaving('saving')
    try {
      await saveNASState(code)
      setSaving('saved')
    } catch {
      setSaving('failed')
    }
  }

  async function showStates() {
    setView('load')
    setStates(undefined)
    setLoadFailed(false)
    try {
      setStates(await listNASStates(code))
    } catch {
      setStates([])
      setLoadFailed(true)
    }
  }

  async function load(state: NASState) {
    try {
      await loadNASState(code, state.id)
      setView('main')
      onResume()
    } catch {
      setLoadFailed(true)
    }
  }

  return (
    <div
      className='absolute inset-0 flex items-center justify-center bg-black/70'
      data-sn-section=''
      data-testid='nas-menu'
    >
      {view === 'main' ? (
        <div className='flex w-full max-w-xs flex-col items-stretch gap-3 p-6'>
          <p className='mb-2 text-center text-lg font-semibold'>{title}</p>
          <button className={pill} data-sn-enabled data-sn-focus-style={focusStyle} onClick={onResume} type='button'>
            <span className='icon-[mdi--play] size-6 shrink-0' />
            Resume
          </button>
          <button
            className={pill}
            data-sn-enabled
            data-sn-focus-style={focusStyle}
            data-testid='nas-save'
            disabled={saving === 'saving'}
            onClick={save}
            type='button'
          >
            <span
              className={
                saving === 'saving'
                  ? 'icon-[svg-spinners--180-ring] size-6 shrink-0'
                  : 'icon-[mdi--content-save] size-6 shrink-0'
              }
            />
            {{ failed: 'Couldn’t save', idle: 'Save', saved: 'Saved', saving: 'Saving' }[saving]}
          </button>
          <button
            className={pill}
            data-sn-enabled
            data-sn-focus-style={focusStyle}
            data-testid='nas-load'
            onClick={showStates}
            type='button'
          >
            <span className='icon-[mdi--history] size-6 shrink-0' />
            Load
          </button>
          <button className={pill} data-sn-enabled data-sn-focus-style={focusStyle} onClick={onRestart} type='button'>
            <span className='icon-[mdi--restart] size-6 shrink-0' />
            Restart
          </button>
          {startedHere ? (
            <button
              className={pill}
              data-sn-enabled
              data-sn-focus-style={focusStyle}
              data-testid='nas-end'
              onClick={onEnd}
              type='button'
            >
              <span className='icon-[mdi--stop] size-6 shrink-0' />
              End game
            </button>
          ) : (
            <button className={pill} data-sn-enabled data-sn-focus-style={focusStyle} onClick={onLeave} type='button'>
              <span className='icon-[mdi--exit-to-app] size-6 shrink-0' />
              Leave
            </button>
          )}
        </div>
      ) : (
        <div className='flex max-h-full w-full max-w-2xl flex-col gap-4 overflow-auto p-6' data-testid='nas-states'>
          <div className='flex items-center gap-3'>
            <button
              aria-label='Back'
              className='flex size-11 items-center justify-center rounded-full hover:bg-white/15'
              data-sn-enabled
              data-sn-focus-style={focusStyle}
              onClick={() => setView('main')}
              type='button'
            >
              <span className='icon-[mdi--arrow-left] size-6' />
            </button>
            <p className='text-lg font-semibold'>Load</p>
          </div>
          {states === undefined ? <span className='icon-[mdi--loading] size-8 animate-spin self-center' /> : null}
          {states?.length === 0 && !loadFailed ? (
            <p className='text-center text-white/70'>No save states yet.</p>
          ) : null}
          {loadFailed ? <p className='text-center text-[#ffc46b]'>Couldn’t load that.</p> : null}
          <div className='grid grid-cols-2 gap-3 sm:grid-cols-3'>
            {states?.map((state) => (
              <button
                className='flex flex-col gap-1.5 rounded-lg p-1.5 text-left hover:bg-white/15'
                data-sn-enabled
                data-sn-focus-style={JSON.stringify({
                  backgroundColor: 'rgba(255, 255, 255, 0.2)',
                  borderRadius: '8px',
                })}
                key={state.id}
                onClick={() => load(state)}
                type='button'
              >
                <img
                  alt=''
                  className='aspect-4/3 w-full rounded-lg bg-white/10 object-contain'
                  src={getNASStatePicture(code, state.id)}
                />
                <span className='px-1 text-sm'>{formatSaved(state.created)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
