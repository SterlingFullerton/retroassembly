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
  canKeepGames,
  canStoreGames,
  type GameReader,
  getStoredName,
  keepGame,
  markPlayed,
  openGameReader,
  readStoredGame,
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
import { useGamepads } from '#@/pages/library/hooks/use-gamepads.ts'
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
import { takeDeferredShaders } from '../deferred-shaders.ts'
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
// Start button, a finger touches it, or it's pressed. Browsing past games downloads none of them, and nor does anything
// else: a controller connecting, or a setting changing, never starts a download
const preparations = new Map<string, Promise<Nostalgist | undefined>>()

// How many of the screen's refreshes each frame of the game waits for. RetroArch is woken at every refresh and runs a
// frame when one is due: on a 120 Hz screen a 60 fps game then misses a wake now and then, and that frame lasts three
// refreshes (25 ms) instead of two, about one frame in eight. Waiting for every second refresh keeps each at two. A
// screen of 90 Hz or so is woken at every refresh, as one of 60 is: waiting for two would slow the game below 60
let refreshRate: Promise<number> | undefined
function measureRefreshRate() {
  return new Promise<number>((resolve) => {
    const times: number[] = []
    // A hidden page isn't woken for refreshes: it's taken as 60 Hz
    const fallback = setTimeout(() => resolve(60), 1000)
    function tick(time: number) {
      times.push(time)
      if (times.length < 25) {
        requestAnimationFrame(tick)
        return
      }
      clearTimeout(fallback)
      const gaps = times
        .slice(1)
        .map((time, index) => time - times[index])
        .toSorted((a, b) => a - b)
      const gap = gaps[Math.floor(gaps.length / 2)]
      resolve(gap > 0 ? 1000 / gap : 60)
    }
    requestAnimationFrame(tick)
  })
}
async function getSwapInterval() {
  refreshRate ??= measureRefreshRate()
  return Math.max(1, Math.floor(((await refreshRate) + 2) / 60))
}

/** Shuts down an emulator that was got ready and never launched, so its memory is let go */
function discard(emulator: Nostalgist | undefined) {
  if (emulator?.getStatus() !== 'initial') {
    return
  }
  try {
    emulator.exit()
  } catch {}
}

const remapDirectory = '/home/web_user/retroarch/userdata/config/remaps'

// A save that's one byte over and over is what an emulator writes before the game has saved anything
let drawsGames = false
/** Whether the browser can draw a game at all: WebGL can be turned off, or refused on some devices */
function canDrawGames() {
  if (drawsGames) {
    return true
  }
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
  // The test's own drawing surface is given back at once; browsers allow only so many
  context?.getExtension('WEBGL_lose_context')?.loseContext()
  drawsGames = Boolean(context)
  return drawsGames
}

function isBlank(content: Uint8Array) {
  return content.every((byte) => byte === content[0])
}

function isSame(a: Uint8Array, b: Uint8Array | undefined) {
  return a === b || (b !== undefined && a.length === b.length && a.every((byte, index) => byte === b[index]))
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

/** Leaves the fullscreen a launch that failed went into */
async function leaveFullscreen(entering: Promise<void> | undefined) {
  if (!entering) {
    return
  }
  await entering
  if (document.fullscreenElement) {
    await attemptAsync(() => document.exitFullscreen())
  }
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
}: {
  emulatorGamepadMapping: ReturnType<typeof useEmulatorGamepadMapping>
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
  // save it came from, so a newer one from another device is fetched instead. The session is one game's, with one
  // emulator (see EmulatorSessionProvider), so it's never another game's save
  const knownGameSave = useRef<{ content?: Uint8Array; from?: string }>({})
  const { preference, setPreference } = usePreference()
  // The gamepad in use, which may have buttons of its own for this console
  const gamepadId = useGamepads().gamepad?.id
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
  // A game's file, kept in the browser's storage where it can be, so it downloads once rather than every time it's
  // played: a disc image is hundreds of megabytes. Reaching for Start only makes sure it's kept (see warmUp); the
  // emulator reads it whole from there when it's got ready. Where it can't be kept, it's downloaded into memory
  const { platform } = rom
  const keepGameFile = useCallback(
    async (fileId: string, fileName: string) => {
      if (!canKeepGames()) {
        return
      }
      const name = getStoredName(fileId)
      const [error] = await attemptAsync(() =>
        keepGame(name, getFileUrl(fileId), {
          about: { fileName, platform },
          onProgress: (loaded, total) => report('game', { kind: 'game', loaded, total }),
        }),
      )
      if (error) {
        console.warn("Couldn't keep the game in the browser's storage, so it's loaded into memory", error)
        return
      }
      return name
    },
    [platform, report],
  )
  const downloadGame = useCallback(
    (fileId: string, fileName: string) => async () => {
      const name = await keepGameFile(fileId, fileName)
      if (name) {
        const [, bytes] = await attemptAsync(() => readStoredGame(name, { fileName, platform }))
        if (bytes) {
          return bytes
        }
      }
      return await download('game', 'game', getFileUrl(fileId))()
    },
    [download, keepGameFile, platform],
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

  // What the emulator is given depends on the game's files, by name and id, not on the objects the page's data holds
  // them in: the page's data is fetched afresh while a game runs (when an upload ends, say), and a game made anew
  // from the same files would take the place of the one running
  const romFileName = rom?.fileName
  const discGroup = rom?.discGroup
  const discFiles = JSON.stringify(discs.map(({ fileId, fileName }) => [fileId, fileName]))
  const romObject = useMemo(() => {
    if (multiDisc) {
      const files: [fileId: string, fileName: string][] = JSON.parse(discFiles)
      return [
        {
          fileContent: new Blob([createDiscList(files.map(([, fileName]) => fileName))]),
          fileName: `${discGroup}.m3u`,
        },
        // Only the first disc downloads at the start, so only its progress is shown
        ...files.map(([fileId, fileName], index) => ({
          fileContent: index === 0 ? downloadGame(fileId, fileName) : getFileUrl(fileId),
          fileName,
        })),
      ]
    }
    // A game read from storage as it plays is put in place at launch; until then the emulator holds a placeholder
    return launchProfile.threads
      ? { fileContent: new Uint8Array(1), fileName: romFileName }
      : { fileContent: downloadGame(rom.fileId, romFileName), fileName: romFileName }
  }, [discFiles, discGroup, downloadGame, launchProfile.threads, multiDisc, rom.fileId, romFileName])
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
          ownButtons: gamepadId ? preference.input.consoleButtons?.[rom.platform]?.[gamepadId] : undefined,
          ownKeys: preference.input.consoleKeys?.[rom.platform],
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
      gamepadId,
      shader,
      state?.fileId,
      rom.platform,
      launchProfile,
      multiDisc,
      saveFileType,
      download,
    ],
  )

  // What's got ready is known by what it downloads: the game's files, the emulator, its shader and BIOS files, and the
  // snapshot it continues from. The rest of the options, such as the keys and the controller, are read when it's got
  // ready. Nothing is got ready because these change: only reaching for Start or Continue does that (see warmUp)
  const biosFiles = JSON.stringify(bioses.map(({ fileId }) => fileId))
  const preparedState = state?.fileId && !multiDisc ? state.fileId : ''
  const key = useMemo(
    () => ['emulator', rom.id, core, shader, discFiles, biosFiles, preparedState],
    [rom.id, core, shader, discFiles, biosFiles, preparedState],
  )
  const preparedKey = unstable_serialize(key)
  const optionsRef = useRef(options)
  useEffect(() => {
    optionsRef.current = options
  })
  // The key this session shows, while it's mounted
  const currentKey = useRef<string | undefined>(preparedKey)
  const { cache, mutate: mutateCache } = useSWRConfig()
  const {
    data,
    error,
    isValidating,
    mutate: prepare,
  } = useSWRImmutable(
    key,
    async () => {
      // An emulator with threads can only start on an isolated page (a PSP game's own). Anywhere else nothing is
      // prepared, whatever asks: such a page sends the player to the game's page to play it
      if (launchProfile.threads && !globalThis.crossOriginIsolated) {
        return
      }
      const options = optionsRef.current
      const prepared = await Nostalgist.prepare({
        ...options,
        retroarchConfig: { ...options.retroarchConfig, video_swap_interval: await getSwapInterval() },
      })
      // Ready only after the player left the game, or its settings changed: let go, rather than kept for as long as the
      // tab is open
      if (currentKey.current !== preparedKey) {
        discard(prepared)
        return
      }
      return prepared
    },
    { revalidateOnMount: false },
  )

  // The game being played is held from launch to exit, whatever the page's settings or data become meanwhile: were
  // it only read from what was prepared, a change to either would leave Exit, the pause menu and saving without a game
  const [playing, setPlaying] = useState<Nostalgist>()
  const emulator = playing ?? data
  // A game that couldn't start: said where a game that couldn't be got ready is, with Retry
  const [startError, setStartError] = useState<unknown>()
  // A game got ready (by reaching for Start) and then left without being played, or whose settings changed before it
  // was, is let go, rather than held in memory for as long as the tab is open
  useEffect(() => {
    currentKey.current = preparedKey
    return () => {
      currentKey.current = undefined
      const unplayed = (cache.get(preparedKey) as undefined | { data?: Nostalgist })?.data
      if (unplayed?.getStatus() === 'initial') {
        cache.delete(preparedKey)
        discard(unplayed)
      }
    }
  }, [cache, preparedKey])
  // The key the game being played was got ready under, which the page's data changing while it runs can change. Exit
  // lets go of it
  const launchedKey = useRef<string | undefined>(undefined)
  /** Lets go of what was got ready under `key`: the next launch gets a game ready afresh */
  async function forget(key: string) {
    await attemptAsync(() => mutateCache(key, undefined, { revalidate: false }))
  }
  // So its save pictures aren't black (see keepLastFrame)
  useEffect(() => {
    keepLastFrame(launchProfile.canvasThumbnail)
    return () => keepLastFrame(false)
  }, [launchProfile.canvasThumbnail])
  // While a game downloads, Start can still be pressed: it waits for the download
  const isPreparing = !rom
  const isDownloading = isValidating

  // Starts downloading the game, once however often it's asked for
  async function prepareOnce() {
    let preparation = preparations.get(preparedKey)
    if (!preparation) {
      const preparing = preparedKey
      preparation = (async () => {
        try {
          return await prepare()
        } finally {
          preparations.delete(preparing)
        }
      })()
      preparations.set(preparedKey, preparation)
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
    gameFile.current ??= loadGameFile()
    return gameFile.current
  }
  // A launch that couldn't get the game leaves nothing behind, so the next one tries again
  async function loadGameFile() {
    try {
      return await readGameFile()
    } catch (error) {
      gameFile.current = undefined
      throw error
    }
  }
  async function readGameFile() {
    if (canStoreGames()) {
      const name = getStoredName(rom.fileId)
      try {
        await keepGame(name, romUrl, {
          about: { fileName: rom.fileName, platform: rom.platform },
          onProgress: reportGameProgress,
        })
        return { name }
      } catch (error) {
        console.warn("Couldn't keep the game in the browser's storage, so it's loaded into memory", error)
      }
    }
    return { bytes: await download('game', 'game', romUrl)() }
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
    if (!data) {
      // A game this device keeps is only made sure of: got ready whole, it would be read into memory, and read again
      // each time the pointer passed Start after the game's snapshots changed, as they do on exit
      const kept = !launchProfile.threads && canKeepGames()
      const [firstDisc] = discs
      await Promise.all([
        attemptAsync(async () => await getEmulatorFiles()),
        kept
          ? attemptAsync(() => keepGameFile(firstDisc?.fileId ?? rom.fileId, firstDisc?.fileName ?? rom.fileName ?? ''))
          : attemptAsync(prepareOnce),
        launchProfile.threads ? attemptAsync(getGameFile) : undefined,
      ])
    }
  }

  // One launch at a time: another press while a game gets ready is let pass
  const launching = useRef(false)

  /**
   * Launches the game: from the start, from the newest snapshot (`withState`), or from a snapshot picked on the game's
   * page (`from`). A launch that fails leaves nothing behind: the next one gets the game ready afresh, out of
   * fullscreen
   */
  async function launch({ from, withState }: { from?: ChosenState; withState?: boolean } = {}) {
    if (launching.current) {
      return
    }
    launching.current = true
    setStartError(undefined)
    // Fullscreen now, while the tap on Start or Continue still counts: a browser only allows it just after one, and a
    // game can take longer than that to get ready. Nothing is waited for before this
    let enteringFullscreen: Promise<void> | undefined
    if (goesFullscreen(preference.emulator.fullscreen) && !document.fullscreenElement) {
      enteringFullscreen = new Promise((resolve) => {
        queueMicrotask(() => resolve(toggleFullscreen()))
      })
    }
    const key = preparedKey
    let emulator: Nostalgist | undefined
    try {
      // Nothing is downloaded until now, unless the player reached for the button first
      const emulatorFiles = getEmulatorFiles()
      emulator = data ?? (await prepareOnce())
      if (!emulator || !rom) {
        // Couldn't be got ready: said with the game's buttons, with Retry
        await leaveFullscreen(enteringFullscreen)
        return
      }
      await setUp(emulator, { emulatorFiles, from, withState })
    } catch (error) {
      gameReader.current?.close()
      gameReader.current = undefined
      // What was put in place for this launch stays with the emulator it was put in, so it's let go: launched again,
      // the game starts from what the next launch asks for, and not what this one did
      await forget(key)
      discard(emulator)
      await leaveFullscreen(enteringFullscreen)
      throw error
    } finally {
      launching.current = false
    }

    launchedKey.current = key
    setPlaying(emulator)
    setLaunched(true)

    // Only a note that the game was played: failing to make it doesn't fail a game that has started
    await attemptAsync(() => client.launch_records.$post({ form: { core, rom: rom.id } }))
  }

  /** Puts in place what the game launches with: the snapshot it continues from, its files and its own save */
  async function setUp(
    emulator: Nostalgist,
    {
      emulatorFiles,
      from,
      withState,
    }: { emulatorFiles: ReturnType<typeof getEmulatorFiles>; from?: ChosenState; withState?: boolean },
  ) {
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
    // The game's own save is fetched and read before the game is opened from storage, which only one reader may have
    // open at a time
    const save = await getGameSave()
    let saveFiles: SaveFiles | undefined
    if (save && saveFolder) {
      const folderName = saveFolder.slice(saveFolder.lastIndexOf('/') + 1)
      // A save that can't be read stops the launch, as one that can't be fetched does (see getGameSave)
      try {
        saveFiles = await unzipSaveFiles(save, folderName)
      } catch (error) {
        throw new DownloadError('files', error)
      }
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
    if (saveFiles && saveFolder) {
      restoreGameSaveFolder(emulator, saveFolder, saveFiles)
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
  }

  /** The game's own save to put back: the latest this page knows, or the server's when it has a newer one */
  async function getGameSave() {
    const known = knownGameSave.current
    if (gameSave && gameSave.id !== known.from) {
      // The game has a save, so it isn't started without it: begun empty, its next save would replace the real one as
      // the newest. The launch fails instead, and can be tried again
      const [error, content] = await attemptAsync(async () => {
        const response = await fetch(getFileUrl(gameSave.fileId))
        if (!response.ok) {
          throw new Error(`${response.status}`)
        }
        return new Uint8Array(await response.arrayBuffer())
      })
      if (!content) {
        throw new DownloadError('files', error)
      }
      knownGameSave.current = { content, from: gameSave.id }
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

  /**
   * Starts the launched game. One that can't start (a BIOS it won't take, a broken file, no memory left) is put away
   * as an exit would, and the failure said with the game's buttons, rather than left as a black screen with no way out
   */
  async function start() {
    if (!emulator || !rom) {
      return
    }
    try {
      // Without it the game would run unseen, on a black screen
      if (!canDrawGames()) {
        throw new Error('This browser has WebGL turned off or unavailable')
      }
      await startGame(emulator)
    } catch (error) {
      // Running all the same: only something after the start failed, such as loading the save to continue from
      if (['paused', 'running'].includes(emulator.getStatus())) {
        return
      }
      await abandon(emulator, error)
    }
  }

  /** Puts away a game that was launched but couldn't start, as exit does one that ran */
  async function abandon(failed: Nostalgist, error: unknown) {
    try {
      failed.exit()
    } catch {}
    failed.getCanvas().remove()
    setLaunched(false)
    setPlaying(undefined)
    disconnectOnScreenGamepad(gamepad.current)
    gamepad.current = undefined
    gameReader.current?.close()
    gameReader.current = undefined
    await attemptAsync(closeAudioContexts)
    noSleep.current?.disable()
    if (document.fullscreenElement) {
      await attemptAsync(() => document.exitFullscreen())
    }
    setSpatialNavigationPaused(false)
    setIsFullscreen(false)
    focus(launchButton)
    offCancel()
    // The game is let go: Retry gets it ready afresh
    if (launchedKey.current) {
      await forget(launchedKey.current)
      launchedKey.current = undefined
    }
    setStartError(error ?? new Error('The game could not start'))
  }

  async function startGame(emulator: Nostalgist) {
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
        setPlaying(undefined)
      }
      // Shaders picked in the pause menu, saved already, now in the page's settings too, for the next game started
      const shaders = Object.entries(takeDeferredShaders())
      if (shaders.length > 0) {
        setPreference(
          (current) =>
            current && {
              ...current,
              emulator: {
                ...current.emulator,
                platform: {
                  ...current.emulator.platform,
                  ...Object.fromEntries(
                    shaders.map(([platform, shader]) => [platform, { ...current.emulator.platform[platform], shader }]),
                  ),
                },
              },
            },
        )
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
      // The game is let go, to be downloaded again when it's next started: what it was got ready under, which the
      // page's data or settings changing while it ran may have made other than what the page shows now
      if (launchedKey.current) {
        await forget(launchedKey.current)
        launchedKey.current = undefined
      }
      if (reloadAfterExit) {
        await keeping
        await refresh()
      }
    } finally {
      exitingRef.current = false
      setExiting(false)
    }
  }

  /** Gets the game ready again, after it couldn't be: what Retry asks for */
  async function prepareAgain() {
    setStartError(undefined)
    return await prepare()
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
    error: error ?? startError,
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
    prepare: prepareAgain,
    setLaunched,
    start,
    switchToDisc,
    toggleFullscreen,
    warmUp,
  }
}
