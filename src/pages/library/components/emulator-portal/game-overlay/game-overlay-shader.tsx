import { clsx } from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { client } from '#@/api/client.ts'
import { shadersRepository } from '#@/consoles/assets.ts'
import { orderedShaders } from '#@/consoles/shaders.ts'
import { deferShader } from '#@/pages/library/components/emulator-portal/deferred-shaders.ts'
import { useSession } from '#@/pages/library/components/emulator-portal/emulator-session-provider.tsx'
import { ShaderBar } from '#@/pages/library/components/shader-bar.tsx'
import { usePreference } from '#@/pages/library/hooks/use-preference.ts'
import { useRom } from '#@/pages/library/hooks/use-rom.ts'
import { toCDNCacheUrl } from '#@/utils/isomorphic/cdn.ts'

// Switching shaders live in the pause menu

// Where RetroArch looks for the shaders it steps through with SHADER_NEXT and SHADER_PREV (video_shader_dir)
const cycleDirectory = '/home/web_user/retroarch/bundle/shaders'
const repository = `https://cdn.jsdelivr.net/gh/${shadersRepository.repository}@${shadersRepository.version}/`

interface Look {
  id: string
  name: string
}

function mkdirs(fs: any, directory: string) {
  let current = ''
  for (const part of directory.split('/').filter(Boolean)) {
    current += `/${part}`
    try {
      fs.mkdir(current)
    } catch {}
  }
}

async function fetchText(path: string) {
  const response = await fetch(toCDNCacheUrl(repository + path))
  if (!response.ok) {
    throw new Error(`${response.status} ${path}`)
  }
  return response.text()
}

// The file RetroArch is pointed at: the only preset in its shader folder, so SHADER_NEXT always loads it again, whatever
// it loaded before. A look is shown by writing its preset here and sending SHADER_NEXT: nothing depends on counting
const lookPreset = `${cycleDirectory}/look.glslp`

// The shader files already put in each emulator
const writtenFiles = new WeakMap<object, Set<string>>()

// The look each running emulator shows, once changed here: the menu is made afresh each time it opens, and the settings
// in the page still say the one the game started with
const shownLooks = new WeakMap<object, { id: string; inherited: boolean }>()

/** The shader last picked in the pause menu for the game `emulator` runs, if one was: its id, or '' for off */
export function getShownShader(emulator: object) {
  return shownLooks.get(emulator)?.id
}

/** Puts a look's preset, and the shader files it names (in lib/, beside it), in the emulator's file system */
async function writeLook(fs: any, written: Set<string>, look: Look) {
  async function writeFile(path: string) {
    if (written.has(path)) {
      return
    }
    const target = `${cycleDirectory}/lib/${path}`
    mkdirs(fs, target.slice(0, target.lastIndexOf('/')))
    fs.writeFile(target, await fetchText(path))
    written.add(path)
  }
  // No shader is libretro's plain one, with square pixels
  let preset = 'shaders = 1\nshader0 = lib/stock.glsl\nfilter_linear0 = false\n'
  if (look.id) {
    const folder = look.id.slice(0, look.id.lastIndexOf('/') + 1)
    const original = await fetchText(`${look.id}.glslp`)
    const files: string[] = []
    preset = original.replaceAll(/^(?<key>\s*shader\d+\s*=\s*)"?(?<file>[^"\n]+?)"?\s*$/gmu, (...match) => {
      const { file, key } = match.at(-1) as Record<string, string>
      const path = folder + file.trim()
      files.push(path)
      return `${key}"lib/${path}"`
    })
    await Promise.all(files.map((file) => writeFile(file)))
  } else {
    await writeFile('stock.glsl')
  }
  fs.writeFile(lookPreset, preset)
}

/**
 * The shader, on the pause menu's settings page: the one shown, and where it is in the list by kind,
 * and arrows to the one before and after. It changes on the paused game at once, and the menu fades back while it does,
 * so the game shows. The one picked is kept for the console; Reset has the console use the shader for all consoles again
 */
export function GameOverlayShader() {
  const { t } = useTranslation()
  const { emulator } = useSession()
  const rom = useRom()
  const { preference } = usePreference()
  const platform = rom?.platform
  const own = preference.emulator.platform[platform]?.shader
  const forAll = preference.emulator.shader || ''
  // Off, then each kind's shaders together, in the order of the bar under them
  const looks: Look[] = orderedShaders.map(({ id, name }) => ({ id, name: id ? name : t('settings.shaderOff') }))
  // What was changed here last, else the settings the game started with
  const changed = emulator ? shownLooks.get(emulator) : undefined
  const startsInherited = changed ? changed.inherited : own === 'inherit' || own === undefined
  let startId = startsInherited ? forAll : own || ''
  if (changed) {
    startId = changed.id
  }
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      looks.findIndex((look) => look.id === startId),
    ),
  )
  const [inherited, setInherited] = useState(startsInherited)
  const [status, setStatus] = useState<'failed' | 'idle' | 'loading'>('idle')
  const control = useRef<HTMLButtonElement>(null)
  const peekTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // While shaders change, the menu fades back for a moment so the game can be seen
  function peek() {
    const overlay = document.querySelector<HTMLElement>('.game-overlay')
    if (overlay) {
      overlay.dataset.peek = ''
    }
    clearTimeout(peekTimer.current)
    peekTimer.current = setTimeout(() => {
      if (overlay) {
        delete overlay.dataset.peek
      }
    }, 2500)
  }
  useEffect(() => () => clearTimeout(peekTimer.current), [])

  // The look shown, at once on every press; RetroArch is given only the one the presses stop on
  const indexRef = useRef(index)
  const applyTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const applying = useRef(0)
  useEffect(() => () => clearTimeout(applyTimer.current), [])

  async function apply(lookIndex: number, inherit: boolean) {
    // Only a game that's started can change its shader; anything else is said, not passed over
    const gameStatus = emulator?.getStatus()
    if (!emulator || (gameStatus !== 'running' && gameStatus !== 'paused')) {
      setStatus('failed')
      return
    }
    applying.current += 1
    const attempt = applying.current
    let written = writtenFiles.get(emulator)
    if (!written) {
      written = new Set()
      writtenFiles.set(emulator, written)
    }
    setStatus('loading')
    try {
      await writeLook(emulator.getEmscriptenFS(), written, looks[lookIndex])
    } catch {
      setStatus('failed')
      return
    }
    // A later press has taken over
    if (attempt !== applying.current) {
      return
    }
    emulator.sendCommand('SHADER_NEXT')
    shownLooks.set(emulator, { id: looks[lookIndex].id, inherited: inherit })
    setStatus('idle')
    peek()
    const saved = inherit ? 'inherit' : looks[lookIndex].id
    // Saved on the server only: the settings in the page are what the running game was started with, and changing them
    // would have the page prepare a fresh emulator in its place, leaving the menu's buttons on one that isn't running.
    // Leaving the game puts it in them (see deferred-shaders.ts)
    try {
      await client.preference.$post({ json: { emulator: { platform: { [platform]: { shader: saved } } } } })
    } catch {
      // Shown on the game, but not kept for the next one: said with the alert beside the name
      if (attempt === applying.current) {
        setStatus('failed')
      }
      return
    }
    deferShader(platform, saved)
  }

  function step(direction: -1 | 1) {
    indexRef.current = (indexRef.current + direction + looks.length) % looks.length
    setIndex(indexRef.current)
    setInherited(false)
    peek()
    clearTimeout(applyTimer.current)
    applyTimer.current = setTimeout(() => apply(indexRef.current, false), 200)
  }

  // Back to the shader for all consoles
  async function reset() {
    clearTimeout(applyTimer.current)
    indexRef.current = Math.max(
      0,
      looks.findIndex((look) => look.id === forAll),
    )
    setIndex(indexRef.current)
    setInherited(true)
    await apply(indexRef.current, true)
  }

  // Left and right from a gamepad or the keyboard, on the focused control, as the volume's slider takes them
  useEffect(() => {
    const element = control.current
    if (!element) {
      return
    }
    function handleAdjust(event: Event) {
      step(event instanceof CustomEvent && event.detail === 'left' ? -1 : 1)
    }
    element.addEventListener('sn:adjust', handleAdjust)
    return () => element.removeEventListener('sn:adjust', handleAdjust)
  })

  const look = looks[index]
  const arrow = 'flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-white/15'

  return (
    <section className='flex flex-col gap-2'>
      {/* Reset sits by the heading, so the section takes no more height than the volume's and a short screen fits it */}
      <div className='flex items-center justify-between gap-3'>
        <h3 className='text-sm font-semibold tracking-wide text-white/70 uppercase'>{t('settings.shader')}</h3>
        <button
          className='game-overlay-shader-reset flex h-8 items-center gap-1.5 rounded-full border border-solid border-white bg-black/30 px-3 text-xs text-white transition-colors hover:bg-white/15 disabled:pointer-events-none disabled:opacity-40'
          data-sn-enabled
          data-sn-focus-style={JSON.stringify({ backgroundColor: 'rgba(255, 255, 255, 0.2)', borderRadius: '16px' })}
          disabled={inherited}
          onClick={reset}
          title={t('settings.shaderSameAsAll')}
          type='button'
        >
          <span className='icon-[mdi--restore] size-3.5' />
          {t('common.reset')}
        </button>
      </div>
      <div
        className={clsx(
          'game-overlay-shader flex w-full flex-col rounded-3xl border border-solid border-white bg-black/30 p-1.5 text-white',
          'transition-colors duration-300 has-[button[data-sn-adjust]:focus]:bg-white/20',
        )}
      >
        <div className='flex items-center gap-1'>
          <button
            aria-label={t('settings.shaderPrevious')}
            className={arrow}
            onClick={() => step(-1)}
            tabIndex={-1}
            type='button'
          >
            <span className='icon-[mdi--chevron-left] size-7' />
          </button>
          <button
            aria-label={`${t('settings.shader')}: ${look.name}`}
            className='flex min-w-0 flex-1 items-center gap-3 text-left outline-none'
            data-sn-adjust
            data-sn-enabled
            data-sn-focus-parent
            data-sn-focus-style={JSON.stringify({ backgroundColor: 'rgba(255, 255, 255, 0.2)', borderRadius: '24px' })}
            // Reset is above, off to the side: up reaches it while it can be used, else the volume
            data-sn-up={inherited ? undefined : '.game-overlay-shader-reset'}
            onClick={() => step(1)}
            ref={control}
            type='button'
          >
            <span className='flex min-w-0 flex-col'>
              <span className='flex min-w-0 items-center gap-2'>
                <span className='truncate text-lg font-semibold'>{look.name}</span>
                {status === 'idle' ? null : (
                  <span
                    className={clsx(
                      'size-5 shrink-0',
                      status === 'loading'
                        ? 'icon-[mdi--loading] animate-spin'
                        : 'icon-[mdi--alert-circle] text-red-300',
                    )}
                  />
                )}
              </span>
              <span className='truncate text-sm text-white/75'>
                {index + 1}
                {inherited ? ` · ${t('settings.shaderSameAsAll')}` : ''}
              </span>
            </span>
          </button>
          <button
            aria-label={t('settings.shaderNext')}
            className={arrow}
            onClick={() => step(1)}
            tabIndex={-1}
            type='button'
          >
            <span className='icon-[mdi--chevron-right] size-7' />
          </button>
        </div>
        <div className='px-3 pt-1 pb-2'>
          <ShaderBar index={index} tone='overlay' />
        </div>
      </div>
    </section>
  )
}
