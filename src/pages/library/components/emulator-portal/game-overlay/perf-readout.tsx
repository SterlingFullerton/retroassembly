import { clsx } from 'clsx'
import { useEffect, useEffectEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getFrameWatch, watchFrames } from '#@/emulator/perf-monitor.ts'
import { formatMilliseconds } from '#@/emulator/perf-report.ts'
import { type FrameBar, frameBars, frameBudget, type FrameSummary, summarizeFrames } from '#@/emulator/perf.ts'
import { useEmulatorLaunched } from '#@/pages/library/atoms.ts'
import { useSession } from '#@/pages/library/components/emulator-portal/emulator-session-provider.tsx'
import { usePerfOverlay } from '#@/pages/library/hooks/use-perf-overlay.ts'
import { useGameOverlay } from '../hooks/use-game-overlay.ts'

// The performance overlay's readout: how the game is running on this device, in a corner of the screen while it's
// played. It never takes a touch or a click, so it can sit over the game. On a touch screen it sits under the top
// bar's buttons

// The numbers cover the last few seconds; the graph the last couple
const summaryWindow = 5000
const graphWindow = 2000
const barCount = 40
const refreshEvery = 500
const graphHeight = 18
const barWidth = 2
const barGap = 1

interface Reading {
  bars: FrameBar[]
  summary: FrameSummary
}

function Graph({ bars }: Readonly<{ bars: FrameBar[] }>) {
  const width = barCount * (barWidth + barGap) - barGap
  return (
    <svg
      aria-hidden
      className='mt-0.5 block'
      height={graphHeight}
      viewBox={`0 0 ${width} ${graphHeight}`}
      width={width}
    >
      {/* A full-speed frame's whole time */}
      <line
        stroke='#888'
        strokeDasharray='2 2'
        strokeWidth={0.5}
        x1={0}
        x2={width}
        y1={graphHeight / 2}
        y2={graphHeight / 2}
      />
      {bars.map((bar, index) => {
        const height = Math.max(1, bar.height * graphHeight)
        return (
          <rect
            fill={bar.late ? '#ffc46b' : '#7fe0a6'}
            height={height}
            // The bars only ever change in place, so their place is their identity
            // eslint-disable-next-line react/no-array-index-key
            key={index}
            width={barWidth}
            x={index * (barWidth + barGap)}
            y={graphHeight - height}
          />
        )
      })}
    </svg>
  )
}

export function PerfReadout() {
  const { t } = useTranslation()
  const [enabled] = usePerfOverlay()
  const [launched] = useEmulatorLaunched()
  const { emulator } = useSession()
  const { visible: paused } = useGameOverlay()
  const [reading, setReading] = useState<Reading>()

  // The log stays as the game left it while the pause menu is open, where its numbers are read
  const applyPaused = useEffectEvent(() => getFrameWatch()?.setPaused(paused))

  const watching = enabled && launched && Boolean(emulator)
  useEffect(() => {
    if (!watching || !emulator) {
      return
    }
    const started = watchFrames(emulator.getCanvas())
    applyPaused()
    const budget = frameBudget()
    const timer = setInterval(() => {
      setReading({
        bars: frameBars(started.log.latest(graphWindow), barCount, budget),
        summary: summarizeFrames(started.log.latest(summaryWindow), budget),
      })
    }, refreshEvery)
    return () => {
      clearInterval(timer)
      started.stop()
      setReading(undefined)
    }
  }, [watching, emulator])

  useEffect(() => {
    getFrameWatch()?.setPaused(paused)
  }, [paused])

  if (!watching || paused || !reading || reading.summary.frames < 2) {
    return null
  }

  const { bars, summary } = reading
  const fullSpeed = summary.fps >= 57
  return (
    <div className='pointer-events-none!'>
      <div
        className={clsx(
          'left-safe-offset-2 top-safe-offset-12 absolute rounded-md bg-black/60 px-1.5 py-1 font-mono text-[11px] leading-snug text-neutral-100',
          '[@media(pointer:fine)]:top-safe-offset-2',
        )}
        data-testid='perf-readout'
      >
        <div>
          <span className={fullSpeed ? 'text-[#7fe0a6]' : 'text-[#ffc46b]'}>{Math.round(summary.fps)} fps</span>
          {' · '}
          {formatMilliseconds(summary.typical)} ms
        </div>
        <div className='text-neutral-300'>
          {t('emulator.perfWorst', { value: formatMilliseconds(summary.worst) })}
          {' · '}
          <span className={clsx({ 'text-[#ffc46b]': summary.slow > 0 })}>
            {t('emulator.perfSlow', { count: summary.slow })}
          </span>
        </div>
        <Graph bars={bars} />
      </div>
    </div>
  )
}
