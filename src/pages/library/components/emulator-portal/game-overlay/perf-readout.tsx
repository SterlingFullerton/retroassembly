import { clsx } from 'clsx'
import { type ReactNode, useEffect, useEffectEvent, useState } from 'react'
import { getFrameWatch, readSystem, type SystemReading, watchFrames } from '#@/emulator/perf-monitor.ts'
import { formatFps, formatMegabytes, formatMilliseconds, formatPercent } from '#@/emulator/perf-report.ts'
import { type FrameBar, frameBars, frameBudget, type FrameSummary, summarizeFrames } from '#@/emulator/perf.ts'
import { getStreamRows, type StreamStats } from '#@/emulator/stream-stats.ts'
import { useEmulatorLaunched } from '#@/pages/library/atoms.ts'
import { useSession } from '#@/pages/library/components/emulator-portal/emulator-session-provider.tsx'
import { usePerfOverlay } from '#@/pages/library/hooks/use-perf-overlay.ts'
import { useSharingConnection } from '#@/pages/library/hooks/use-play-together.ts'
import { useStreamStats } from '#@/pages/library/hooks/use-stream-stats.ts'
import { useGameOverlay } from '../hooks/use-game-overlay.ts'

// The performance overlay's readout: how the game is running on this device, in a corner of the screen while it's
// played. It's a technical readout in the terms such readouts use, so it's in English whatever the app's language. It
// never takes a touch or a click, so it can sit over the game. On a touch screen it sits under the top bar's buttons.
//
// Only what changes while the game runs is here; what doesn't (the canvas, the emulator, the shader) is in the pause
// menu's details

// The numbers cover the last few seconds; the graph the last couple
const summaryWindow = 5000
const graphWindow = 2000
const refreshEvery = 500
const barWidth = 3
const barGap = 1
const barCount = 47
const graphWidth = barCount * (barWidth + barGap) - barGap
const graphHeight = 24

const colors = { bad: '#ff8f8f', ok: '#7fe0a6', warn: '#ffc46b' }
type Level = 'bad' | 'ok' | 'warn' | undefined

interface Reading {
  bars: FrameBar[]
  summary: FrameSummary
  system: SystemReading
}

/** How a time reads against one it should stay within: fine, over it, or far over it */
function levelOf(value: number, limit: number, farOver = limit * 2): Level {
  if (value > farOver) {
    return 'bad'
  }
  return value > limit ? 'warn' : undefined
}

function Value({ children, level }: Readonly<{ children: ReactNode; level?: Level }>) {
  return <span style={level ? { color: colors[level] } : undefined}>{children}</span>
}

export function Section({ children, title }: Readonly<{ children: ReactNode; title: string }>) {
  return (
    <div className='border-white/20 not-first:mt-1.5 not-first:border-t not-first:pt-1.5'>
      <div className='font-medium text-[#6fb7ff]'>{title}</div>
      {children}
    </div>
  )
}

export function Row({ children, label }: Readonly<{ children: ReactNode; label: string }>) {
  return (
    <div className='flex justify-between gap-3'>
      <span className='text-[#aab4bf]'>{label}</span>
      <span>{children}</span>
    </div>
  )
}

function colorOf(bar: FrameBar) {
  if (bar.stalled) {
    return colors.bad
  }
  return bar.late ? colors.warn : colors.ok
}

function Graph({ bars }: Readonly<{ bars: FrameBar[] }>) {
  return (
    <svg
      aria-hidden
      className='mt-1 block'
      height={graphHeight}
      viewBox={`0 0 ${graphWidth} ${graphHeight}`}
      width={graphWidth}
    >
      {/* A full-speed frame's whole time */}
      <line
        stroke='#888'
        strokeDasharray='2 2'
        strokeWidth={0.5}
        x1={0}
        x2={graphWidth}
        y1={graphHeight / 2}
        y2={graphHeight / 2}
      />
      {bars.map((bar, index) => {
        const height = Math.max(1, bar.height * graphHeight)
        return (
          <rect
            fill={colorOf(bar)}
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

function Timing({ summary }: Readonly<{ summary: FrameSummary }>) {
  const budget = frameBudget(summary.target)
  const rows = [
    // A frame is late once a refresh has gone by without it, and a hitch after a few
    { farOver: budget * 3, label: 'frame', limit: budget * 1.5, spread: summary.interval },
    // The emulator's work is over once it takes more than the frame has
    { farOver: budget * 2, label: 'cpu', limit: budget, spread: summary.work },
  ]
  return (
    <table className='w-full border-collapse'>
      <thead>
        <tr className='text-[#7d8791]'>
          <td aria-label='Measure' />
          {['avg', 'p95', 'p99', 'max'].map((column) => (
            <th className='text-right font-normal' key={column}>
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(({ farOver, label, limit, spread }) => (
          <tr key={label}>
            <td className='text-[#aab4bf]'>{label}</td>
            {[spread.avg, spread.p95, spread.p99, spread.max].map((value, index) => (
              // The columns are always these four, in this order
              // eslint-disable-next-line react/no-array-index-key
              <td className='text-right' key={index}>
                <Value level={levelOf(value, limit, farOver)}>{formatMilliseconds(value)}</Value>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** The classes of the readout's box, wherever it's shown */
export const readoutBox = clsx(
  'left-safe-offset-2 top-safe-offset-12 absolute w-52 rounded-md bg-black/80 px-2.5 py-2 font-mono text-[11px] leading-normal text-neutral-100',
  '[@media(pointer:fine)]:top-safe-offset-2',
)

/** How the picture of a game played together is travelling, as a section of the readout: nothing until it's known */
export function StreamSection({ stats }: Readonly<{ stats: StreamStats | undefined }>) {
  const rows = stats ? getStreamRows(stats) : []
  if (rows.length === 0) {
    return null
  }
  return (
    <Section title={stats?.role === 'host' ? 'Stream, to guest' : 'Stream, from host'}>
      {rows.map(([label, value]) => (
        <Row key={label} label={label.toLowerCase()}>
          <Value level={label === 'Limited by' && value !== 'none' ? 'warn' : undefined}>{value}</Value>
        </Row>
      ))}
    </Section>
  )
}

export function PerfReadout() {
  const [enabled] = usePerfOverlay()
  const [launched] = useEmulatorLaunched()
  const { emulator } = useSession()
  const { visible: paused } = useGameOverlay()
  const [reading, setReading] = useState<Reading>()
  const stream = useStreamStats(useSharingConnection(), 'host')
  // The log stays as the game left it while the pause menu is open, where its numbers are read
  const applyPaused = useEffectEvent(() => getFrameWatch()?.setPaused(paused))

  const watching = enabled && launched && Boolean(emulator)
  useEffect(() => {
    if (!watching || !emulator) {
      return
    }
    const started = watchFrames(emulator.getCanvas())
    applyPaused()
    const timer = setInterval(() => {
      const summary = summarizeFrames(started.log.latest(summaryWindow))
      setReading({
        bars: frameBars(started.log.latest(graphWindow), barCount, frameBudget(summary.target)),
        summary,
        system: readSystem(started, emulator),
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

  const { bars, summary, system } = reading
  const { audio, browserMemory, emulatorMemory, refreshRate } = system
  return (
    <div className='pointer-events-none!'>
      <div className={readoutBox} data-testid='perf-readout'>
        <Section title='Timing, ms'>
          <Timing summary={summary} />
          <Graph bars={bars} />
        </Section>

        <Section title='Frames'>
          <Row label='fps'>
            <Value level={summary.fps >= summary.target * 0.95 ? 'ok' : 'warn'}>{formatFps(summary.fps)}</Value> of{' '}
            {summary.target}
          </Row>
          <Row label='1% low'>
            <Value level={summary.low1 < summary.target * 0.9 ? 'warn' : undefined}>
              {formatFps(summary.low1)} fps
            </Value>
          </Row>
          <Row label='load avg'>
            <Value level={levelOf(summary.loadAverage, 0.85, 1)}>{formatPercent(summary.loadAverage)}</Value>
          </Row>
          <Row label='load peak'>
            <Value level={levelOf(summary.loadPeak, 1, 2)}>{formatPercent(summary.loadPeak)}</Value>
          </Row>
          <Row label='dropped'>
            <Value level={summary.dropped > 0 ? 'warn' : undefined}>
              {summary.dropped} of {summary.frames}
            </Value>
          </Row>
          <Row label='longest stall'>{formatMilliseconds(summary.interval.max)} ms</Row>
        </Section>

        <Section title='System'>
          {refreshRate > 0 ? <Row label='screen'>{refreshRate} Hz</Row> : null}
          {summary.draws > 0 ? <Row label='draw calls'>{summary.draws.toFixed(1)} per frame</Row> : null}
          {audio?.latency === undefined ? null : <Row label='audio latency'>{Math.round(audio.latency)} ms</Row>}
          {emulatorMemory ? <Row label='emulator mem'>{formatMegabytes(emulatorMemory)}</Row> : null}
          {browserMemory ? <Row label='browser mem'>{formatMegabytes(browserMemory.used)}</Row> : null}
        </Section>

        <StreamSection stats={stream} />
      </div>
    </div>
  )
}
