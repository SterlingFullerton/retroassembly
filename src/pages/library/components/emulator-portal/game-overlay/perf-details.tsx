import { clsx } from 'clsx'
import { type ReactNode, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { resolveConsole } from '#@/consoles/registry.ts'
import { orderedShaders } from '#@/consoles/shaders.ts'
import { metadata } from '#@/constants/metadata.ts'
import { getFrameWatch } from '#@/emulator/perf-monitor.ts'
import {
  describeBrowser,
  formatMegabytes,
  formatMilliseconds,
  formatPerfReport,
  type PerfDetails as Details,
} from '#@/emulator/perf-report.ts'
import { frameBudget, summarizeFrames } from '#@/emulator/perf.ts'
import { useSession } from '#@/pages/library/components/emulator-portal/emulator-session-provider.tsx'
import { usePreference } from '#@/pages/library/hooks/use-preference.ts'
import { useRom } from '#@/pages/library/hooks/use-rom.ts'
import { getRomGoodcodes } from '#@/utils/client/library.ts'
import { getShownShader } from './game-overlay-shader.tsx'

// The performance overlay's details, in the pause menu's settings under its switch: the numbers for the last seconds
// of play, the setup they were measured with, and a button that copies it all as text

const seconds = 10

function getEmulatorMemory(emulator: { getEmscripten: () => unknown }) {
  const { Module } = emulator.getEmscripten() as { Module?: { HEAPU8?: { length: number } } }
  return Module?.HEAPU8?.length
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch {}
  // Where the clipboard can't be written directly, a selected text box can still be copied
  const box = document.createElement('textarea')
  box.value = text
  box.style.position = 'fixed'
  box.style.opacity = '0'
  document.body.append(box)
  box.select()
  // The only way left where the clipboard itself is out of reach
  // eslint-disable-next-line typescript/no-deprecated
  document.execCommand('copy')
  box.remove()
}

function Figure({ children, label, warn }: Readonly<{ children: ReactNode; label: string; warn?: boolean }>) {
  return (
    <div className='rounded-lg bg-white/10 px-3 py-2'>
      <div className='text-xs text-white/70'>{label}</div>
      <div className={clsx('text-lg font-semibold', { 'text-[#ffc46b]': warn })}>{children}</div>
    </div>
  )
}

function Row({ children, label }: Readonly<{ children: ReactNode; label: string }>) {
  return (
    <div className='flex justify-between gap-4 py-1'>
      <span className='shrink-0 text-white/70'>{label}</span>
      <span className='min-w-0 text-right [overflow-wrap:anywhere]'>{children}</span>
    </div>
  )
}

export function PerfDetails() {
  const { t } = useTranslation()
  const { core, emulator } = useSession()
  const { preference } = usePreference()
  const rom = useRom()
  const [copied, setCopied] = useState(false)
  // The shader can change on this very page, so what's shown is read again every second
  const [, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick((tick) => tick + 1), 1000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    if (!copied) {
      return
    }
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  const watch = getFrameWatch()
  const samples = watch?.log.latest(seconds * 1000) ?? []
  if (!watch || !emulator || !rom || samples.length < 2) {
    return <div className='text-sm text-white/70'>{t('emulator.perfNoData')}</div>
  }

  const summary = summarizeFrames(samples, frameBudget())
  const platformSettings = preference.emulator.platform[rom.platform]
  const ownShader = platformSettings?.shader
  const startShader = ownShader === 'inherit' || ownShader === undefined ? preference.emulator.shader || '' : ownShader
  const shaderId = getShownShader(emulator) ?? startShader
  const shader = shaderId ? (orderedShaders.find(({ id }) => id === shaderId)?.name ?? shaderId) : ''
  const rewind = platformSettings?.rewindEnabled ?? false
  const details: Details = {
    appVersion: metadata.version,
    browser: describeBrowser(navigator.userAgent, navigator.maxTouchPoints),
    emulator: resolveConsole(rom.platform, core).emulator?.displayName ?? core,
    emulatorMemory: getEmulatorMemory(emulator),
    exact: watch.exact,
    game: getRomGoodcodes(rom).rom,
    picture: `${watch.canvas.width} × ${watch.canvas.height}`,
    platform: rom.platform,
    rewind,
    screen: `${globalThis.innerWidth} × ${globalThis.innerHeight} at ${Math.round(globalThis.devicePixelRatio * 100) / 100}×`,
    seconds,
    shader,
    summary,
    userAgent: navigator.userAgent,
  }

  async function handleCopy() {
    await copyText(formatPerfReport(details))
    setCopied(true)
  }

  return (
    <div className='flex w-full max-w-md flex-col gap-2 text-sm text-white'>
      <div className='grid grid-cols-2 gap-2'>
        <Figure label={t('emulator.perfFrameRate')}>{Math.round(summary.fps)} fps</Figure>
        <Figure label={t('emulator.perfTypicalFrame')}>{formatMilliseconds(summary.typical)} ms</Figure>
        <Figure label={t('emulator.perfWorstFrame')}>{formatMilliseconds(summary.worst)} ms</Figure>
        <Figure label={t('emulator.perfSlowFrames')} warn={summary.slow > 0}>
          {summary.slow} / {summary.frames}
        </Figure>
      </div>
      <div className='text-xs text-white/70'>{t('emulator.perfLastSeconds', { seconds })}</div>
      <div className='divide-y divide-white/15 border-t border-white/15'>
        <Row label={t('common.emulator')}>{details.emulator}</Row>
        <Row label={t('settings.shader')}>{shader || t('settings.shaderOff')}</Row>
        <Row label={t('settings.rewind')}>{rewind ? t('common.on') : t('common.off')}</Row>
        <Row label={t('emulator.perfScreen')}>{details.screen}</Row>
        {details.emulatorMemory ? (
          <Row label={t('emulator.perfMemory')}>{formatMegabytes(details.emulatorMemory)}</Row>
        ) : null}
        <Row label={t('emulator.perfBrowser')}>{details.browser}</Row>
      </div>
      <div className='flex'>
        <button
          className='flex h-12 shrink-0 items-center gap-3 rounded-full border border-solid border-white bg-black/30 px-4 text-white transition-colors hover:bg-white/15'
          data-sn-enabled
          data-sn-focus-style={JSON.stringify({ backgroundColor: 'rgba(255, 255, 255, 0.2)', borderRadius: '24px' })}
          onClick={handleCopy}
          type='button'
        >
          <span className={clsx('size-5', copied ? 'icon-[mdi--check]' : 'icon-[mdi--content-copy]')} />
          <span className='text-[15px]'>{copied ? t('emulator.perfCopied') : t('emulator.perfCopyReport')}</span>
        </button>
      </div>
    </div>
  )
}
