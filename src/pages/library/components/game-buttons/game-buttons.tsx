import { Button, HoverCard } from '@radix-ui/themes'
import { clsx } from 'clsx'
import { noop } from 'es-toolkit'
import { type MouseEvent, type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { generatePath, useLoaderData, useLocation, useNavigate } from 'react-router'
import { platformMap } from '#@/constants/platform.ts'
import { goesFullscreen } from '#@/constants/preference.ts'
import { useLaunchButton } from '#@/pages/library/atoms.ts'
import { useSession } from '#@/pages/library/components/emulator-portal/emulator-session-provider.tsx'
import { useFocusIndicator } from '#@/pages/library/hooks/use-focus-indicator.ts'
import { usePreference } from '#@/pages/library/hooks/use-preference.ts'
import { DownloadError } from '#@/pages/library/utils/download.ts'
import { getFileUrl } from '#@/pages/library/utils/file.ts'
import type { LoadingProgress } from '#@/pages/library/utils/loading-progress.ts'
import { routes } from '#@/pages/routes.ts'
import { formatBytes } from '#@/utils/client/format-bytes.ts'
import { needsCrossOriginIsolation } from '#@/utils/isomorphic/cross-origin-isolation.ts'
import { InGameSave } from '../../platform/rom/components/in-game-save.tsx'
import { LaunchButton, type LaunchButtonProgress } from '../../platform/rom/components/launch-button.tsx'
import { type Snapshot, Snapshots } from '../../platform/rom/components/snapshots.tsx'
import { EmulatorPortal } from '../emulator-portal/emulator-portal.tsx'
import { EmulatorSessionProvider } from '../emulator-portal/emulator-session-provider.tsx'
import { BioseMissingMessage } from './biose-missing-message.tsx'
import { OnDeviceLine } from './on-device-line.tsx'

const isAppleMobile = /iphone|ipad|ipod/iu.test(navigator.userAgent)
const isChromeLike = /chrome/iu.test(navigator.userAgent)
const isMacLike = /macintosh/iu.test(navigator.userAgent)
const isAppleMobileDesktopMode =
  !isChromeLike && isMacLike && /safari/iu.test(navigator.userAgent) && screen.height <= 1366
const mayNeedsUserInteraction = isAppleMobile || isAppleMobileDesktopMode

function subscribeNever() {
  return noop
}

/**
 * Continue and Start for a game. On the game's page (`saves`), its snapshots and its own save follow, and a snapshot
 * picked there continues the game from it
 */
export function GameButtons({
  beforeSaves,
  compact = false,
  lazy = false,
  saves = false,
  stretch = false,
}: Readonly<{ beforeSaves?: ReactNode; compact?: boolean; lazy?: boolean; saves?: boolean; stretch?: boolean }>) {
  return (
    <EmulatorSessionProvider lazy={lazy}>
      <div>
        <GameButtonsContent beforeSaves={beforeSaves} compact={compact} saves={saves} stretch={stretch} />
      </div>
    </EmulatorSessionProvider>
  )
}

function GameButtonsContent({
  beforeSaves,
  compact,
  saves,
  stretch,
}: Readonly<{ beforeSaves?: ReactNode; compact: boolean; saves: boolean; stretch: boolean }>) {
  const { rom, state } = useLoaderData()
  const { i18n, t } = useTranslation()
  const { error: prepareError, isDownloading, isPreparing, launch, loadingProgress, prepare, warmUp } = useSession()
  // Which button was pressed, while its game loads, and whether it's taken long enough to show how far it's got.
  // Loads under half a second show nothing, so a small game doesn't flash anything up
  const [pressed, setPressed] = useState<'continue' | 'start'>()
  // Continue and Start, found again when the page goes fullscreen: each is drawn anew as it starts showing progress
  const buttonsRef = useRef<HTMLDivElement>(null)
  const [progressShown, setProgressShown] = useState(false)
  const [launchError, setLaunchError] = useState<unknown>()
  const error = prepareError ?? launchError
  useEffect(() => {
    if (!pressed) {
      return
    }
    const timer = setTimeout(() => setProgressShown(true), 500)
    return () => clearTimeout(timer)
  }, [pressed])

  async function launchFrom(button: 'continue' | 'start', withState: boolean, from?: Snapshot) {
    setPressed(button)
    setLaunchError(undefined)
    try {
      await launch({ from, withState })
    } catch (error) {
      setLaunchError(error)
    } finally {
      setPressed(undefined)
      setProgressShown(false)
    }
  }

  function describe(progress: LoadingProgress): LaunchButtonProgress {
    if (progress.step === 'starting') {
      return { detail: t('emulator.almostThere'), label: t('emulator.starting') }
    }
    const values = {
      loaded: formatBytes(progress.loaded ?? 0, i18n.language),
      total: progress.total === undefined ? '' : formatBytes(progress.total, i18n.language),
    }
    const detail =
      progress.total === undefined
        ? t(`emulator.loadingStepSoFar.${progress.step}`, values)
        : t(`emulator.loadingStep.${progress.step}`, values)
    return { detail, fraction: progress.fraction, label: t('emulator.loading') }
  }
  const progress = progressShown ? describe(loadingProgress) : undefined
  const [, setLaunchButton] = useLaunchButton()
  const { syncStyle } = useFocusIndicator()
  const { preference } = usePreference()

  const { bioses } = preference.emulator.platform[rom.platform]

  // A game whose emulator runs on several threads (the PSP's) only starts on its own page, which is cross-origin isolated.
  // From anywhere else, Start opens that page; on it, a browser that couldn't isolate it is told so
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const gamePage = generatePath(routes.libraryPlatformRom, { fileName: rom.fileName, platform: rom.platform })
  const needsIsolation = needsCrossOriginIsolation(gamePage)
  const isolated = useSyncExternalStore(
    subscribeNever,
    () => globalThis.crossOriginIsolated,
    () => true,
  )
  const awayFromGamePage = needsIsolation && !needsCrossOriginIsolation(pathname)
  const cannotIsolate = needsIsolation && !awayFromGamePage && !isolated

  const expectedBioses = platformMap[rom.platform].bioses
  const missingBioses = expectedBioses?.filter(
    (bios) => bios.required && !bioses?.some((b) => b.fileName === bios.name),
  )

  function handleClickCommon(event: MouseEvent<HTMLButtonElement>) {
    const button = event.currentTarget
    if (button) {
      setLaunchButton(button)
      button.blur()
      syncStyle()
      // The page goes fullscreen as the game starts loading, which can leave it showing the top of the page; the button,
      // with how far the download has got, is brought back into view
      if (goesFullscreen(preference.emulator.fullscreen) && !document.fullscreenElement) {
        document.addEventListener('fullscreenchange', () => buttonsRef.current?.scrollIntoView({ block: 'center' }), {
          once: true,
        })
      }
    }
  }

  // A snapshot picked on the game's page continues the game from it, as Continue does from the newest
  async function handlePickSnapshot(snapshot: Snapshot, event: MouseEvent<HTMLButtonElement>) {
    if (isPreparing || (mayNeedsUserInteraction && !event?.clientX && !event?.clientY)) {
      return
    }
    handleClickCommon(event)
    await launchFrom('continue', true, snapshot)
  }

  async function handleClickContinue(event: MouseEvent<HTMLButtonElement>) {
    if (isPreparing || (mayNeedsUserInteraction && !event?.clientX && !event?.clientY)) {
      event.preventDefault()
      event.stopPropagation()
      return
    }

    if (awayFromGamePage) {
      await navigate(gamePage)
      return
    }
    handleClickCommon(event)
    await launchFrom('continue', true)
  }

  async function handleClickStart(event: MouseEvent<HTMLButtonElement>) {
    if (isPreparing || (mayNeedsUserInteraction && !event?.clientX && !event?.clientY)) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (awayFromGamePage) {
      await navigate(gamePage)
      return
    }
    handleClickCommon(event)
    await launchFrom('start', false)
  }

  // The game starts downloading as soon as the player reaches for Start with a mouse or finger, so it's usually ready by
  // the time it's pressed. Focus doesn't count: Start is focused as soon as the page opens
  const warmUpHandlers = awayFromGamePage ? {} : { onPointerDown: warmUp, onPointerEnter: warmUp }

  async function handleClickRetry() {
    setLaunchError(undefined)
    if (!isPreparing) {
      await prepare()
    }
  }

  // The game's snapshots and own save, on its page. They stay when the game can't be played here, for downloading
  const savesShown = saves ? (
    <>
      <OnDeviceLine rom={rom} />
      {beforeSaves}
      <Snapshots
        disabled={isPreparing || Boolean(missingBioses?.length) || cannotIsolate}
        onPick={handlePickSnapshot}
      />
      <InGameSave />
    </>
  ) : null

  if (missingBioses?.length) {
    return (
      <>
        <BioseMissingMessage bioses={missingBioses} />
        {savesShown}
      </>
    )
  }

  if (cannotIsolate) {
    return (
      <>
        <div className='flex min-h-16 w-full items-center justify-center gap-2 rounded-lg bg-(--accent-3) p-3 lg:w-80'>
          <span className='icon-[mdi--warning-decagram] shrink-0' />
          <span className='text-sm opacity-60'>
            {t('error.browserCannotRunPlatform', { platform: t(platformMap[rom.platform].displayNameI18nKey) })}
          </span>
        </div>
        {savesShown}
      </>
    )
  }

  if (!isPreparing && error) {
    return (
      <>
        <div className='flex h-16 w-full items-center justify-center gap-2 rounded-lg bg-(--accent-3) lg:w-80'>
          <span className='icon-[mdi--warning-decagram]' />
          <span className='text-sm opacity-60'>
            {error instanceof DownloadError
              ? t(`error.failedToDownload.${error.kind}`)
              : t('error.failedToLoadEmulator')}
          </span>
          <Button onClick={handleClickRetry} size='1' type='button'>
            <span className='icon-[mdi--reload]' />
            {t('common.retry')}
          </Button>
        </div>
        {savesShown}
      </>
    )
  }

  const buttons = (
    <div
      ref={buttonsRef}
      className={clsx(
        'flex w-full',
        compact
          ? // Continue, with the save's picture, gets more of the row than Start; each stops at its usual width, so
            // neither runs past a narrow banner. On the smallest phones there's no room for both names, so they stack
            'flex-row gap-2 max-[359px]:flex-col lg:gap-3 [&>button:first-of-type:not(:last-of-type)]:flex-[3] [&>button:last-of-type]:flex-[2]'
          : 'flex-col gap-4 xl:flex-row',
      )}
    >
      {state ? (
        <LaunchButton
          compact={compact}
          stretch={stretch}
          disabled={isPreparing}
          onClick={handleClickContinue}
          progress={pressed === 'continue' ? progress : undefined}
          {...warmUpHandlers}
        >
          <span
            className={clsx(
              compact ? 'absolute left-3' : 'absolute left-10',
              isPreparing || isDownloading
                ? 'icon-[svg-spinners--180-ring]'
                : [
                    'size-6',
                    mayNeedsUserInteraction ? 'icon-[mdi--gesture-touch]' : 'icon-[mdi--arrow-u-right-top-bold]',
                  ],
            )}
          />
          {/* Compact, the name is centred in the room between the icon and the save's picture, so it never runs under it */}
          <span
            className={clsx('flex-1 truncate font-semibold', compact ? 'pr-8 pl-6 text-base lg:text-lg' : 'text-2xl')}
          >
            {t('common.continue')}
          </span>
          <HoverCard.Root>
            <HoverCard.Trigger>
              <img
                alt={t('common.state')}
                className={clsx(
                  'absolute rounded border-2 border-white bg-neutral-200 object-cover shadow',
                  compact ? 'right-1.5 size-7' : 'right-3 size-10',
                )}
                src={getFileUrl(state.thumbnailFileId)}
              />
            </HoverCard.Trigger>
            <HoverCard.Content align='center' hideWhenDetached side='top' size='1'>
              <img
                alt={t('common.state')}
                className='size-48 cursor-pointer rounded-lg border-2 border-white bg-neutral-200 object-cover shadow'
                src={getFileUrl(state.thumbnailFileId)}
              />
            </HoverCard.Content>
          </HoverCard.Root>
        </LaunchButton>
      ) : null}

      <LaunchButton
        compact={compact}
        stretch={stretch}
        disabled={isPreparing}
        onClick={handleClickStart}
        progress={pressed === 'start' ? progress : undefined}
        variant={state ? 'outline' : 'solid'}
        {...warmUpHandlers}
      >
        <span
          className={clsx(
            compact ? 'absolute left-3' : 'absolute left-10',
            isPreparing || isDownloading
              ? 'icon-[svg-spinners--180-ring]'
              : ['size-6', mayNeedsUserInteraction ? 'icon-[mdi--gesture-touch]' : 'icon-[mdi--play]'],
          )}
        />
        <span className={clsx('flex-1 truncate font-semibold', compact ? 'pl-6 text-base lg:text-lg' : 'text-2xl')}>
          {t('emulator.start')}
        </span>
      </LaunchButton>

      <EmulatorPortal />
    </div>
  )

  return (
    <>
      {buttons}
      {savesShown}
    </>
  )
}
