import { attemptAsync, delay, noop } from 'es-toolkit'
import NoSleep from 'nosleep.js'
import { Nostalgist } from 'nostalgist'
import { useEffect, useMemo } from 'react'
import { useLoaderData } from 'react-router'
import { unstable_serialize, useSWRConfig } from 'swr'
import useSWRImmutable from 'swr/immutable'
import { client } from '#@/api/client.ts'
import type { Rom } from '#@/controllers/roms/get-roms.ts'
import {
  useEmulatorLaunched,
  useIsFullscreen,
  useLaunchButton,
  useSpatialNavigationPaused,
} from '#@/pages/library/atoms.ts'
import { useIsDemo } from '#@/pages/library/hooks/use-demo.ts'
import { useRom } from '#@/pages/library/hooks/use-rom.ts'
import { useRouter } from '#@/pages/library/hooks/use-router.ts'
import { closeAudioContexts } from '#@/pages/library/utils/audio-contexts.ts'
import { getCoreKeyboardConfig } from '#@/pages/library/utils/core-keyboard.ts'
import { getFileUrl } from '#@/pages/library/utils/file.ts'
import { focus, offCancel, onCancel } from '#@/pages/library/utils/spatial-navigation.ts'
import { attachVirtualGamepad } from '#@/pages/library/utils/virtual-gamepad.ts'
import type { loader } from '#@/pages/routes/library-platform-rom.tsx'
import { getCDNUrl } from '#@/utils/isomorphic/cdn.ts'
import { getGlobalCSSVars } from '#@/utils/isomorphic/misc.ts'
import { toRetroarchInputNames } from '#@/utils/isomorphic/retroarch-input-names.ts'
import { usePreference } from '../../../hooks/use-preference.ts'
import { useEmulatorGamepadMapping, useEmulatorLazy } from '../emulator-session-provider.tsx'

type NostalgistOption = Parameters<typeof Nostalgist.prepare>[0]
type RetroarchConfig = Partial<NostalgistOption['retroarchConfig']>

const defaultRetroarchConfig: RetroarchConfig = {
  fastforward_ratio: 10,
  input_player1_analog_dpad_mode: 1,
  input_player2_analog_dpad_mode: 1,
  input_player3_analog_dpad_mode: 1,
  input_player4_analog_dpad_mode: 1,
  // RetroArch would otherwise freeze while the page is hidden, before the game can be saved. The page pauses it then
  pause_nonactive: false,
  rewind_granularity: 4,
  rgui_menu_color_theme: 1,
  run_ahead_frames: 1,
  video_gpu_screenshot: true,
  // @ts-expect-error this option is not yet listed in types
  video_viewport_bias_y: 0.1,
}

// A game and its emulator are downloaded only when the player shows they're about to play: when the pointer reaches the
// Start button, a finger touches it, or it's pressed. Browsing past games downloads none of them
const preparations = new Map<string, Promise<Nostalgist | undefined>>()

// The on-screen controls show on touch screens; the N64's have an analog stick
function hasAnalogStickOnScreen() {
  return globalThis.matchMedia?.('(pointer: coarse)').matches ?? false
}

let noSleep: NoSleep
// One exit at a time: a double-click on the exit button would otherwise start a second exit while the first runs
let exiting = false
const originalGetUserMedia = globalThis.navigator?.mediaDevices?.getUserMedia?.bind(globalThis.navigator.mediaDevices)
export function useEmulator() {
  const rom: Rom = useRom()
  const { state } = useLoaderData<typeof loader>()
  const { preference } = usePreference()
  const emulatorGamepadMapping = useEmulatorGamepadMapping()
  const lazy = useEmulatorLazy()
  const [launched, setLaunched] = useEmulatorLaunched()
  const isDemo = useIsDemo()
  const { reload } = useRouter()
  const [isFullscreen, setIsFullscreen] = useIsFullscreen()
  const [launchButton] = useLaunchButton()
  const [, setSpatialNavigationPaused] = useSpatialNavigationPaused()

  const romUrl = isDemo
    ? // @ts-expect-error we can guarantee the platform is supported here
      getCDNUrl(`retrobrews/${{ genesis: 'md' }[rom.platform] || rom.platform}-games`, rom.fileName)
    : getFileUrl(rom.fileId) || ''
  const { core } = preference.emulator.platform[rom.platform] || {}

  const platformShader = preference.emulator.platform[rom.platform].shader
  const shader =
    platformShader === 'inherit' ? preference.emulator.shader : (platformShader ?? preference.emulator.shader)

  const romObject = useMemo(() => ({ fileContent: romUrl, fileName: rom?.fileName }), [rom, romUrl])
  const bios = preference.emulator.platform[rom.platform].bioses.map(({ fileId, fileName }) => ({
    fileContent: getFileUrl(fileId),
    fileName,
  }))
  const options: NostalgistOption = useMemo(
    () => ({
      bios,
      core,
      retroarchConfig: {
        ...defaultRetroarchConfig,
        ...toRetroarchInputNames(preference.input.keyboardMapping),
        ...toRetroarchInputNames(emulatorGamepadMapping),
        // this might be a bug of retroarch's emscripten build, y plus and y minus are swapped
        input_player1_l_y_minus: preference.input.keyboardMapping.input_player1_l_y_plus,
        input_player1_l_y_plus: preference.input.keyboardMapping.input_player1_l_y_minus,
        // Keys for inputs this emulator needs that the shared mapping leaves unbound, such as the N64's Z, C buttons and
        // separate stick and D-pad
        ...getCoreKeyboardConfig(core, preference.input.keyboardMapping, rom.platform),
        rewind_buffer_size: ['desmume2015', 'mupen64plus_next', 'pcsx_rearmed'].includes(core) ? 100 : 20,
        rewind_enable: preference.emulator.platform[rom.platform].rewindEnabled,
        run_ahead_enabled: !['desmume2015', 'mupen64plus_next', 'pcsx_rearmed'].includes(core),
        video_smooth: preference.emulator.videoSmooth,
        // A larger audio buffer keeps sound from crackling when a frame takes too long
        ...(core === 'desmume2015' ? { audio_latency: 160 } : {}),
        // On a touch screen the N64's on-screen controls have their own analog stick, so the D-pad is the D-pad again
        // Its sticks are the on-screen gamepad's axes: the left stick moves, the right stick is the C buttons
        // The ColecoVision's on-screen keypad presses 9 and 0 by pushing the left stick, which must then stay a stick
        ...(core === 'gearcoleco' && hasAnalogStickOnScreen()
          ? {
              input_player1_analog_dpad_mode: 0,
              input_player1_l_x_minus_axis: '-0',
              input_player1_l_x_plus_axis: '+0',
              input_player1_l_y_minus_axis: '-1',
              input_player1_l_y_plus_axis: '+1',
            }
          : {}),
        ...(core === 'mupen64plus_next' && hasAnalogStickOnScreen()
          ? {
              input_player1_analog_dpad_mode: 0,
              input_player1_l_x_minus_axis: '-0',
              input_player1_l_x_plus_axis: '+0',
              input_player1_l_y_minus_axis: '-1',
              input_player1_l_y_plus_axis: '+1',
              input_player1_r_x_minus_axis: '-2',
              input_player1_r_x_plus_axis: '+2',
              input_player1_r_y_minus_axis: '-3',
              input_player1_r_y_plus_axis: '+3',
            }
          : {}),
      },
      retroarchCoreConfig: preference.emulator.core[core],
      rom: romObject,
      shader,
      state: state?.fileId ? getFileUrl(state.fileId) : undefined,
    }),
    [romObject, bios, core, preference, emulatorGamepadMapping, shader, state?.fileId, rom.platform],
  )

  // Many parts of the game screen use this hook, and some appear only once the game is running. Preparing again each
  // time one appears would swap the running game for a fresh copy, which exit would then find not running and leave
  // alone. So a game is prepared on mount only when there's none yet, or the last one has been shut down
  const { cache } = useSWRConfig()
  const cached = (cache.get(unstable_serialize(options)) as undefined | { data?: Nostalgist })?.data
  const {
    data,
    error,
    isValidating,
    mutate: prepare,
  } = useSWRImmutable(options, () => Nostalgist.prepare(options), {
    revalidateOnMount: !lazy && (!cached || cached.getStatus() === 'terminated'),
  })

  const emulator = data
  // While a lazy game downloads, Start can still be pressed: it waits for the download
  const isPreparing = !rom || (isValidating && !lazy)
  const isDownloading = isValidating

  // Starts downloading the game, once however often it's asked for
  async function prepareOnce() {
    const key = unstable_serialize(options)
    let preparation = preparations.get(key)
    if (!preparation) {
      preparation = (async () => {
        try {
          return await prepare()
        } finally {
          preparations.delete(key)
        }
      })()
      preparations.set(key, preparation)
    }
    return await preparation
  }

  // Called when the player looks about to start the game
  async function warmUp() {
    if (lazy && !data) {
      await attemptAsync(prepareOnce)
    }
  }

  async function launch({ withState }: { withState?: boolean } = {}) {
    // In a lazy session nothing is downloaded until now
    const emulator = data ?? (lazy ? await prepareOnce() : undefined)
    if (!emulator || !rom) {
      return
    }

    if (!withState) {
      emulator.getEmulator().on('beforeLaunch', () => {
        try {
          //@ts-expect-error Using an undocumented API here. There should be a way to do this.
          emulator.getEmscriptenFS().unlink(`${emulator.getEmulator().stateFilePath}.auto`)
        } catch {}
      })
    }

    const canvas = emulator.getCanvas()
    canvas.setAttribute('tabindex', '-1')
    canvas.dataset.snFocusStyle = JSON.stringify({ display: 'none' })
    focus(canvas)

    setLaunched(true)

    if (!isDemo) {
      await client.launch_records.$post({ form: { core, rom: rom.id } })
    }
  }

  async function start() {
    if (!emulator || !rom) {
      return
    }
    try {
      // @ts-expect-error an ad-hoc patch for disabling request for camera access
      globalThis.navigator.mediaDevices.getUserMedia = null
    } catch {}
    await emulator.start()
    try {
      globalThis.navigator.mediaDevices.getUserMedia = originalGetUserMedia
    } catch {}
    // The on-screen controls that need more than key presses: the N64's analog stick, the ColecoVision's joystick and
    // keypad, and the arcade stick
    if (core === 'mupen64plus_next' || core === 'gearcoleco' || core === 'fbneo') {
      attachVirtualGamepad(emulator)
    }
    const canvas = emulator.getCanvas()
    if (canvas) {
      canvas.style.opacity = '1'
      const cssVars = getGlobalCSSVars(preference)
      if (cssVars['--game-saturate'] !== '100%') {
        canvas.style.filter = `saturate(var(--game-saturate))`
      }
      focus('canvas')
    }

    if (preference.emulator.fullscreen) {
      await toggleFullscreen()
    }
    onCancel(noop)
    noSleep ||= new NoSleep()
    await noSleep.enable()

    // ad-hoc patch for mupen64plus_next
    if (core === 'mupen64plus_next') {
      await delay(0)
      emulator.sendCommand('PAUSE_TOGGLE')
      await delay(0)
      emulator.sendCommand('PAUSE_TOGGLE')
    }
  }

  async function exit({ reloadAfterExit = false } = {}) {
    const status = emulator?.getStatus() || ''
    if (exiting || !['paused', 'running'].includes(status)) {
      return
    }
    exiting = true
    try {
      try {
        emulator?.exit()
      } finally {
        // The canvas covers the whole page and hides the cursor, so it has to go even if shutting down failed
        emulator?.getCanvas().remove()
        setLaunched(false)
      }
      // Otherwise the browser would keep the shut-down emulator, and the game in its memory, for as long as the page is open
      await attemptAsync(closeAudioContexts)
      noSleep.disable()
      const promises: Promise<void>[] = []
      if (document.fullscreenElement) {
        promises.push(document.exitFullscreen())
      }
      await attemptAsync(() => Promise.all(promises))
      setSpatialNavigationPaused(false)
      setIsFullscreen(false)
      focus(launchButton)
      offCancel()
      // The game is let go, to be downloaded again when it's next started
      await (lazy ? prepare(undefined, { revalidate: false }) : attemptAsync(prepare))
      if (reloadAfterExit) {
        await reload()
      }
    } finally {
      exiting = false
    }
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
        setIsFullscreen(false)
      } else {
        await document.body.requestFullscreen()
        setIsFullscreen(true)
      }
    } catch {}

    if (emulator) {
      focus(emulator.getCanvas())
    }
  }

  useEffect(() => {
    const abortController = new AbortController()
    document.body.addEventListener(
      'fullscreenchange',
      () => {
        setIsFullscreen(document.fullscreenElement === document.body)
      },
      { signal: abortController.signal },
    )
    return () => {
      abortController.abort()
    }
  })

  return {
    core,
    emulator,
    error,
    exit,
    isDownloading,
    isFullscreen,
    isPreparing,
    launch,
    launched,
    prepare,
    setLaunched,
    start,
    toggleFullscreen,
    warmUp,
  }
}
