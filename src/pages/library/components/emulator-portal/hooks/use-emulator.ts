import { attemptAsync, noop } from 'es-toolkit'
import NoSleep from 'nosleep.js'
import { Nostalgist } from 'nostalgist'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLoaderData } from 'react-router'
import { unstable_serialize, useSWRConfig } from 'swr'
import useSWRImmutable from 'swr/immutable'
import { client } from '#@/api/client.ts'
import { resolveConsole } from '#@/consoles/registry.ts'
import { goesFullscreen } from '#@/constants/preference.ts'
import {
  closeAudioContexts,
  installGame,
  installSystemFiles,
  nudge,
  readGameSave,
  readGameSaveFolder,
  replaceAutoState,
  restoreGameSave,
  restoreGameSaveFolder,
  setDualShockController,
  skipAutoState,
  startWithoutCamera,
  switchDisc,
} from '#@/emulator/adapter.ts'
import {
  canStoreGames,
  type GameReader,
  getStoredName,
  hasStoredGame,
  markPlayed,
  openGameReader,
  storeGame,
} from '#@/emulator/game-storage.ts'
import { keepLastFrame } from '#@/emulator/keep-last-frame.ts'
import { connectOnScreenGamepad, disconnectOnScreenGamepad } from '#@/emulator/on-screen-gamepad.ts'
import { type SaveFiles, unzipSaveFiles } from '#@/emulator/save-folder.ts'
import { saveQueue } from '#@/emulator/save-queue.ts'
import { getSessionPhase } from '#@/emulator/session.ts'
import { buildInputConfig } from '#@/input/build-input-config.ts'
import {
  useEmulatorLaunched,
  useIsFullscreen,
  useLaunchButton,
  useSpatialNavigationPaused,
} from '#@/pages/library/atoms.ts'
import { useLibraryRefresh } from '#@/pages/library/hooks/use-library-refresh.ts'
import { useRom } from '#@/pages/library/hooks/use-rom.ts'
import type { Rom } from '#@/pages/library/types.ts'
import { bundledSystemFiles } from '#@/pages/library/utils/bundled-cores.ts'
import { DownloadError, type DownloadKind, downloadWithProgress } from '#@/pages/library/utils/download.ts'
import { getFileUrl } from '#@/pages/library/utils/file.ts'
import { type Download, getLoadingProgress } from '#@/pages/library/utils/loading-progress.ts'
import { onCoreDownloadProgress } from '#@/pages/library/utils/nostalgist.ts'
import { focus, offCancel, onCancel } from '#@/pages/library/utils/spatial-navigation.ts'
import type { clientLoader as loader } from '#@/pages/routes/library-platform-rom.tsx'
import { createDiscList } from '#@/utils/isomorphic/discs.ts'
import { getGlobalCSSVars } from '#@/utils/isomorphic/misc.ts'
import { usePreference } from '../../../hooks/use-preference.ts'
import type { useEmulatorGamepadMapping } from '../emulator-session-provider.tsx'

type NostalgistOption = Parameters<typeof Nostalgist.prepare>[0]
type RetroarchConfig = Partial<NostalgistOption['retroarchConfig']>

const defaultRetroarchConfig: RetroarchConfig = {
  fastforward_ratio: 10,
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

const remapDirectory = '/home/web_user/retroarch/userdata/config/remaps'

// A save that's one byte over and over is what an emulator writes before the game has saved anything
function isBlank(content: Uint8Array) {
  return content.every((byte) => byte === content[0])
}

function isSame(a: Uint8Array, b: Uint8Array | undefined) {
  return b !== undefined && a.length === b.length && a.every((byte, index) => byte === b[index])
}

// A core's system files, downloaded and unpacked once per page
const systemFiles = new Map<string, Promise<SaveFiles>>()

function getSystemFiles(core: string, onProgress?: (loaded: number, total: number | undefined) => void) {
  const bundled = bundledSystemFiles[core]
  if (!bundled) {
    return
  }
  let files = systemFiles.get(core)
  if (!files) {
    files = (async () => {
      try {
        const buffer = await downloadWithProgress(bundled.url, { kind: 'files', onProgress })
        const unpacked = await unzipSaveFiles(new Uint8Array(buffer), '')
        return unpacked.map(([path, content]): SaveFiles[number] => [`${bundled.folder}/${path}`, content])
      } catch (error) {
        // Tried again next time
        systemFiles.delete(core)
        throw error
      }
    })()
    systemFiles.set(core, files)
  }
  return files
}

function hasAnalogStickOnScreen() {
  return globalThis.matchMedia?.('(pointer: coarse)').matches ?? false
}

/** A snapshot to continue from: its file, and the disc it was taken on, for a game on several discs */
export interface ChosenState {
  disc?: null | number
  fileId: string
}

/**
 * Runs one game: prepares it, launches and starts it, saves and exits it. Used once per game, by the session provider
 * around it; components read it with useSession()
 */
export function useEmulatorSessionController({
  emulatorGamepadMapping,
  lazy,
}: {
  emulatorGamepadMapping: ReturnType<typeof useEmulatorGamepadMapping>
  lazy: boolean
}) {
  const rom: Rom = useRom()
  // The page the game is played from gives its discs, when it's on several: the game's page or the home page
  const { discs = [], gameSave, state } = useLoaderData<typeof loader>() as Partial<Awaited<ReturnType<typeof loader>>>
  // A game on several discs is given the emulator as a disc list and its discs; only the first downloads at start
  const multiDisc = discs.length > 1
  const [currentDisc, setCurrentDisc] = useState(discs[0]?.number ?? 1)
  // Whether the game was launched to continue from the latest save
  const withStateRef = useRef(false)
  // A snapshot other than the newest, picked on the game's page to continue from, for a game on several discs: loaded
  // once the game has started and its disc is in
  const chosenStateRef = useRef<ChosenState | undefined>(undefined)
  // The game's own save as this page last knew it: put back at launch, or read out while playing. `from` is the server's
  // save it came from, so a newer one from another device is fetched instead
  const knownGameSave = useRef<{ content?: Uint8Array; from?: string }>({})
  const { preference } = usePreference()
  // The wake lock that keeps the screen on while playing
  const noSleep = useRef<NoSleep | undefined>(undefined)
  // One exit at a time: a double-click on the exit button would otherwise start a second exit while the first runs
  const exitingRef = useRef(false)
  // This session's on-screen gamepad, while the game runs
  const gamepad = useRef<ReturnType<typeof connectOnScreenGamepad> | undefined>(undefined)
  const [exiting, setExiting] = useState(false)
  const [launched, setLaunched] = useEmulatorLaunched()
  const refresh = useLibraryRefresh()
  const [isFullscreen, setIsFullscreen] = useIsFullscreen()
  const [launchButton] = useLaunchButton()
  const [, setSpatialNavigationPaused] = useSpatialNavigationPaused()

  const romUrl = getFileUrl(rom.fileId) || ''

  // Each download this game needs, as far as it's got, for the Start button to show. Updated at most once a frame
  const downloads = useRef(new Map<string, Download>())
  const [, setDownloadsShown] = useState(0)
  const nextFrame = useRef<number | undefined>(undefined)
  const report = useCallback((key: string, progress: Download) => {
    downloads.current.set(key, progress)
    nextFrame.current ??= requestAnimationFrame(() => {
      nextFrame.current = undefined
      setDownloadsShown((count) => count + 1)
    })
  }, [])
  // A file's contents given to the player as a function, which it calls when it needs them: the download happens here,
  // so its progress can be shown. The player takes them as a Uint8Array, not a bare buffer
  const download = useCallback(
    (key: string, kind: DownloadKind, url: string) => async () => {
      const buffer = await downloadWithProgress(url, {
        kind,
        onProgress: (loaded, total) => report(key, { kind, loaded, total }),
      })
      return new Uint8Array(buffer)
    },
    [report],
  )
  const { core } = preference.emulator.platform[rom.platform] || {}
  // How this emulator is started and run, from the console registry
  const {
    launch: launchProfile,
    saveFileType,
    saveFolder,
  } = useMemo(() => resolveConsole(rom.platform, core), [rom.platform, core])

  const platformShader = preference.emulator.platform[rom.platform].shader
  const shader =
    platformShader === 'inherit' ? preference.emulator.shader : (platformShader ?? preference.emulator.shader)

  const romObject = useMemo(
    () =>
      multiDisc
        ? [
            {
              fileContent: new Blob([createDiscList(discs.map(({ fileName }) => fileName))]),
              fileName: `${rom.discGroup}.m3u`,
            },
            // Only the first disc downloads at the start, so only its progress is shown
            ...discs.map(({ fileId, fileName }, index) => ({
              fileContent: index === 0 ? download('game', 'game', getFileUrl(fileId)) : getFileUrl(fileId),
              fileName,
            })),
          ]
        : // A game read from storage as it plays is put in place at launch; until then the emulator holds a placeholder
          (launchProfile.threads
          ? { fileContent: new Uint8Array(1), fileName: rom?.fileName }
          : { fileContent: download('game', 'game', romUrl), fileName: rom?.fileName }),
    [discs, download, launchProfile.threads, multiDisc, rom, romUrl],
  )
  const { bioses } = preference.emulator.platform[rom.platform]
  const bios = useMemo(
    () =>
      bioses.map(({ fileId, fileName }) => ({
        fileContent: download(`bios:${fileName}`, 'files', getFileUrl(fileId)),
        fileName,
      })),
    [bioses, download],
  )
  const options: NostalgistOption = useMemo(
    () => ({
      bios,
      core,
      retroarchConfig: {
        ...defaultRetroarchConfig,
        // The keyboard, gamepad and on-screen gamepad, as this console's controller
        ...buildInputConfig({
          console: resolveConsole(rom.platform, core),
          gamepad: emulatorGamepadMapping,
          keyboard: preference.input.keyboardMapping,
          remapDirectory,
          touch: hasAnalogStickOnScreen(),
        }).retroarchConfig,
        rewind_buffer_size: launchProfile.rewindBufferSize,
        rewind_enable: preference.emulator.platform[rom.platform].rewindEnabled,
        run_ahead_enabled: launchProfile.runAhead,
        video_smooth: preference.emulator.videoSmooth,
        // A larger audio buffer keeps sound from crackling when a frame takes too long
        ...(launchProfile.audioLatency ? { audio_latency: launchProfile.audioLatency } : {}),
      },
      retroarchCoreConfig: preference.emulator.core[core],
      rom: romObject,
      shader,
      // The game's own save is named as this emulator names it, and put in place at launch. Nostalgist's types only list
      // srm and sav, but it takes any extension
      sramType: saveFileType as 'srm',
      // A game on several discs is continued once started, after its disc is put in
      state: state?.fileId && !multiDisc ? download('state', 'files', getFileUrl(state.fileId)) : undefined,
    }),
    [
      romObject,
      bios,
      core,
      preference,
      emulatorGamepadMapping,
      shader,
      state?.fileId,
      rom.platform,
      launchProfile,
      multiDisc,
      saveFileType,
      download,
    ],
  )

  // A game is prepared on mount only when there's none yet, or the last one has been shut down. Preparing again while
  // one runs would swap the running game for a fresh copy, which exit would then find not running and leave alone
  const { cache } = useSWRConfig()
  const cached = (cache.get(unstable_serialize(options)) as undefined | { data?: Nostalgist })?.data
  const {
    data,
    error,
    isValidating,
    mutate: prepare,
  } = useSWRImmutable(
    options,
    // An emulator with threads can only start on an isolated page (a PSP game's own). Anywhere else nothing is prepared,
    // whatever asks: such a page sends the player to the game's page to play it
    () =>
      launchProfile.threads && !globalThis.crossOriginIsolated
        ? Promise.resolve(undefined)
        : Nostalgist.prepare(options),
    {
      revalidateOnMount: !lazy && (!cached || cached.getStatus() === 'terminated'),
    },
  )

  const emulator = data
  // So its save pictures aren't black (see keepLastFrame)
  useEffect(() => {
    keepLastFrame(launchProfile.canvasThumbnail)
    return () => keepLastFrame(false)
  }, [launchProfile.canvasThumbnail])
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
  // The emulator's download, which happens in the player, is followed here too
  useEffect(
    () =>
      onCoreDownloadProgress((downloaded, loaded, total) => {
        if (downloaded === core) {
          report('emulator', { kind: 'emulator', loaded, total })
        }
      }),
    [core, report],
  )

  // The game, for an emulator that reads it as it plays (PPSSPP): kept in the browser's storage where it can be, else
  // downloaded into memory. Fetched once per launch, from the moment the player looks about to start
  const gameFile = useRef<Promise<{ bytes: Uint8Array } | { name: string }> | undefined>(undefined)
  const gameReader = useRef<GameReader | undefined>(undefined)
  function reportGameProgress(loaded: number, total: number | undefined) {
    report('game', { kind: 'game', loaded, total })
  }
  function getGameFile() {
    gameFile.current ??= (async () => {
      if (canStoreGames()) {
        const name = getStoredName(rom.fileId)
        try {
          if (!(await hasStoredGame(name, romUrl))) {
            await storeGame(name, romUrl, reportGameProgress, { fileName: rom.fileName, platform: rom.platform })
          }
          return { name }
        } catch (error) {
          console.warn("Couldn't keep the game in the browser's storage, so it's loaded into memory", error)
        }
      }
      return { bytes: await download('game', 'game', romUrl)() }
    })()
    gameFile.current.catch(() => {
      gameFile.current = undefined
    })
    return gameFile.current
  }

  // Files the emulator needs besides the game (PPSSPP's fonts), downloaded alongside it
  function getEmulatorFiles() {
    return getSystemFiles(core, (loaded, total) => report('system', { kind: 'files', loaded, total }))
  }

  async function warmUp() {
    // An emulator with threads runs only on an isolated page (a PSP game's own), and is prepared there; on any other page,
    // such as Home's Continue, preparing it ahead would only fail
    if (launchProfile.threads && !globalThis.crossOriginIsolated) {
      return
    }
    if (lazy && !data) {
      await Promise.all([
        attemptAsync(async () => await getEmulatorFiles()),
        attemptAsync(prepareOnce),
        launchProfile.threads ? attemptAsync(getGameFile) : undefined,
      ])
    }
  }

  /**
   * Launches the game: from the start, from the newest snapshot (`withState`), or from a snapshot picked on the game's
   * page (`from`)
   */
  async function launch({ from, withState }: { from?: ChosenState; withState?: boolean } = {}) {
    // Fullscreen now, while the tap on Start or Continue still counts: a browser only allows it just after one, and a
    // game can take longer than that to get ready. Nothing is waited for before this
    if (goesFullscreen(preference.emulator.fullscreen) && !document.fullscreenElement) {
      void toggleFullscreen()
    }
    // In a lazy session nothing is downloaded until now
    const emulatorFiles = getEmulatorFiles()
    const emulator = data ?? (lazy ? await prepareOnce() : undefined)
    if (!emulator || !rom) {
      return
    }

    // The newest snapshot is put in place before the game boots, and so is any other picked on the game's page. A game
    // on several discs boots without one, and has it loaded once its disc is in
    const chosen = from && from.fileId !== state?.fileId ? from : undefined
    if (!withState || (chosen && multiDisc)) {
      skipAutoState(emulator)
    }
    chosenStateRef.current = multiDisc ? chosen : undefined
    if (chosen && !multiDisc) {
      replaceAutoState(emulator, await download('state', 'files', getFileUrl(chosen.fileId))())
    }
    const files = await emulatorFiles
    if (files) {
      installSystemFiles(emulator, files)
    }
    if (launchProfile.threads) {
      const game = await getGameFile()
      // The next launch fetches it again, or finds it in storage
      gameFile.current = undefined
      if ('name' in game) {
        try {
          gameReader.current = await openGameReader(game.name)
        } catch (error) {
          throw new DownloadError('game', error)
        }
        markPlayed(game.name, { fileName: rom.fileName, platform: rom.platform })
        installGame(emulator, { reader: gameReader.current })
      } else {
        installGame(emulator, game)
      }
    }
    const save = await getGameSave()
    if (save && saveFolder) {
      const folderName = saveFolder.slice(saveFolder.lastIndexOf('/') + 1)
      const [, saveFiles] = await attemptAsync(() => unzipSaveFiles(save, folderName))
      if (saveFiles) {
        restoreGameSaveFolder(emulator, saveFolder, saveFiles)
      }
    } else if (save) {
      restoreGameSave(emulator, save)
    }
    withStateRef.current = Boolean(withState) && !chosen
    setCurrentDisc(discs[0]?.number ?? 1)

    if (launchProfile.dualShockRemap && hasAnalogStickOnScreen()) {
      setDualShockController(emulator, remapDirectory)
    }

    const canvas = emulator.getCanvas()
    canvas.setAttribute('tabindex', '-1')
    canvas.dataset.snFocusStyle = JSON.stringify({ display: 'none' })
    focus(canvas)

    setLaunched(true)

    await client.launch_records.$post({ form: { core, rom: rom.id } })
  }

  /** The game's own save to put back: the latest this page knows, or the server's when it has a newer one */
  async function getGameSave() {
    const known = knownGameSave.current
    if (gameSave && gameSave.id !== known.from) {
      const [, content] = await attemptAsync(async () => {
        const response = await fetch(getFileUrl(gameSave.fileId))
        if (!response.ok) {
          throw new Error(`${response.status}`)
        }
        return new Uint8Array(await response.arrayBuffer())
      })
      if (content) {
        knownGameSave.current = { content, from: gameSave.id }
      }
    }
    return knownGameSave.current.content
  }

  /**
   * Reads the game's own save and, when it changed, keeps it through the save queue. The save is read before this
   * returns its promise, so a page being hidden or a game being exited has it already
   */
  function keepGameSave() {
    if (!emulator || !rom || !core || !['paused', 'running'].includes(emulator.getStatus())) {
      return Promise.resolve()
    }
    const content = saveFolder ? readGameSaveFolder(emulator, saveFolder) : readGameSave(emulator)
    if (!content || isBlank(content) || isSame(content, knownGameSave.current.content)) {
      return Promise.resolve()
    }
    knownGameSave.current = { ...knownGameSave.current, content }
    return attemptAsync(() =>
      saveQueue.save({ core, file: new Blob([content]), fileType: saveFileType, rom: rom.id, type: 'game' }),
    ).then(noop)
  }

  async function start() {
    if (!emulator || !rom) {
      return
    }
    await startWithoutCamera(emulator)
    // The on-screen controls that need more than key presses: the N64's analog stick, the ColecoVision's joystick and
    // keypad, the arcade, Atari and Channel F sticks, the Atari 5200's keypad, the PlayStation's two analog sticks,
    // the Virtual Boy's right d-pad, the Disk System's flip disk button and the Odyssey²'s joystick
    if (launchProfile.attachVirtualGamepad) {
      gamepad.current = connectOnScreenGamepad(emulator)
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

    // Asked for when Start was pressed (see launch); asked again in case that was refused
    if (goesFullscreen(preference.emulator.fullscreen) && !document.fullscreenElement) {
      await toggleFullscreen()
    }
    onCancel(noop)
    noSleep.current ||= new NoSleep()
    // A browser may refuse to keep the screen on; the game goes on regardless
    await attemptAsync(() => noSleep.current?.enable() ?? Promise.resolve())

    // ad-hoc patch for mupen64plus_next
    if (launchProfile.nudgeAfterStart) {
      await nudge(emulator)
    }

    // A game on several discs is continued once started, after its disc is put in
    const chosen = chosenStateRef.current
    chosenStateRef.current = undefined
    const continueFrom = chosen ?? (multiDisc && withStateRef.current ? state : undefined)
    if (continueFrom?.fileId) {
      if (multiDisc) {
        await switchToDisc(continueFrom.disc ?? discs[0].number, discs[0].number)
      }
      await emulator.loadState(getFileUrl(continueFrom.fileId))
    }
  }

  /** Puts disc `number` of a game on several discs in the drive */
  async function switchToDisc(number: number, from = currentDisc) {
    const to = discs.findIndex((disc) => disc.number === number)
    const current = discs.findIndex((disc) => disc.number === from)
    if (!emulator || to === -1 || current === -1 || to === current) {
      return
    }
    await switchDisc(emulator, current + 1, to + 1)
    setCurrentDisc(number)
  }

  async function exit({ reloadAfterExit = false } = {}) {
    const status = emulator?.getStatus() || ''
    if (exitingRef.current || !['paused', 'running'].includes(status)) {
      return
    }
    exitingRef.current = true
    setExiting(true)
    // Read before the emulator shuts down; uploaded while the rest of the exit goes on
    const keeping = keepGameSave()
    try {
      try {
        emulator?.exit()
      } finally {
        // The canvas covers the whole page and hides the cursor, so it has to go even if shutting down failed
        emulator?.getCanvas().remove()
        setLaunched(false)
      }
      // Otherwise the browser would keep the shut-down emulator, and the game in its memory, for as long as the page is open
      disconnectOnScreenGamepad(gamepad.current)
      gamepad.current = undefined
      gameReader.current?.close()
      gameReader.current = undefined
      await attemptAsync(closeAudioContexts)
      noSleep.current?.disable()
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
        await keeping
        await refresh()
      }
    } finally {
      exitingRef.current = false
      setExiting(false)
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
    currentDisc: multiDisc ? currentDisc : undefined,
    discs: multiDisc ? discs : [],
    emulator,
    error,
    exit,
    isDownloading,
    isFullscreen,
    isPreparing,
    keepGameSave,
    launch,
    launched,
    launchProfile,
    loadingProgress: getLoadingProgress(downloads.current.values()),
    phase: getSessionPhase({ exiting, launched, preparing: isDownloading }),
    prepare,
    setLaunched,
    start,
    switchToDisc,
    toggleFullscreen,
    warmUp,
  }
}
