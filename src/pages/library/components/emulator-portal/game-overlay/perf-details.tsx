import { clsx } from 'clsx'
import { type ReactNode, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { resolveConsole } from '#@/consoles/registry.ts'
import { orderedShaders } from '#@/consoles/shaders.ts'
import { metadata } from '#@/constants/metadata.ts'
import { getFrameWatch, readSystem } from '#@/emulator/perf-monitor.ts'
import {
  describeBrowser,
  formatPerfReport,
  getPerfSections,
  getTimingRows,
  type PerfDetails as Details,
  timingColumns,
} from '#@/emulator/perf-report.ts'
import { summarizeFrames } from '#@/emulator/perf.ts'
import { useSession } from '#@/pages/library/components/emulator-portal/emulator-session-provider.tsx'
import { useSharingConnection } from '#@/pages/library/hooks/use-play-together.ts'
import { usePreference } from '#@/pages/library/hooks/use-preference.ts'
import { useRom } from '#@/pages/library/hooks/use-rom.ts'
import { useStreamStats } from '#@/pages/library/hooks/use-stream-stats.ts'
import { getRomGoodcodes } from '#@/utils/client/library.ts'
import { getShownShader } from './game-overlay-shader.tsx'

// The performance overlay's details, in the pause menu's settings under its switch: the last seconds of play in full,
// a card for each kind of thing, and a button that copies it all as text. Like the readout, it's technical and in
// English; only its button and its note are in the app's language

const seconds = 10

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

function Card({ children, className, title }: Readonly<{ children: ReactNode; className?: string; title: string }>) {
  return (
    <div className={clsx('rounded-lg border border-white/15 bg-black/50 px-3 py-2.5', className)}>
      <h4 className='mb-1 text-sm font-semibold text-[#6fb7ff]'>{title}</h4>
      {children}
    </div>
  )
}

export function PerfDetails() {
  const { t } = useTranslation()
  const { core, emulator, launchProfile } = useSession()
  const { preference } = usePreference()
  const rom = useRom()
  const [copied, setCopied] = useState(false)
  const stream = useStreamStats(useSharingConnection(), 'host')
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

  const summary = summarizeFrames(samples)
  const platformSettings = preference.emulator.platform[rom.platform]
  const ownShader = platformSettings?.shader
  const startShader = ownShader === 'inherit' || ownShader === undefined ? preference.emulator.shader || '' : ownShader
  const shaderId = getShownShader(emulator) ?? startShader
  const details: Details = {
    appVersion: metadata.version,
    browser: describeBrowser(navigator.userAgent, navigator.maxTouchPoints),
    emulator: resolveConsole(rom.platform, core).emulator?.displayName ?? core,
    exact: watch.exact,
    game: getRomGoodcodes(rom).rom,
    platform: rom.platform,
    rewind: platformSettings?.rewindEnabled ?? false,
    runAhead: launchProfile.runAhead,
    seconds,
    shader: shaderId ? (orderedShaders.find(({ id }) => id === shaderId)?.name ?? shaderId) : '',
    stream,
    summary,
    system: readSystem(watch, emulator),
    threads: launchProfile.threads,
    userAgent: navigator.userAgent,
  }

  async function handleCopy() {
    await copyText(formatPerfReport(details))
    setCopied(true)
  }

  return (
    <div className='flex w-full max-w-4xl flex-col gap-2 text-white'>
      <div className='grid grid-cols-1 gap-2 lg:grid-cols-2'>
        <Card className='lg:col-span-2' title={`Timing, ms, last ${seconds} s of play`}>
          <table className='w-full border-collapse text-sm'>
            <thead>
              <tr className='text-xs text-white/60'>
                <td aria-label='Measure' />
                {timingColumns.map((column) => (
                  <th className='text-right font-normal' key={column}>
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {getTimingRows(summary).map(({ label, values }) => (
                <tr key={label}>
                  <td className='py-0.5 text-white/70'>{label}</td>
                  {values.map((value, index) => (
                    // The columns are always the same, in the same order
                    // eslint-disable-next-line react/no-array-index-key
                    <td className='py-0.5 text-right font-mono' key={index}>
                      {value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {getPerfSections(details).map((section) => (
          <Card key={section.title} title={section.title}>
            {section.rows.map(([label, value]) => (
              <div className='flex justify-between gap-4 py-0.5 text-sm' key={label}>
                <span className='shrink-0 text-white/70'>{label}</span>
                <span className='min-w-0 text-right font-mono [overflow-wrap:anywhere]'>{value}</span>
              </div>
            ))}
          </Card>
        ))}
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
