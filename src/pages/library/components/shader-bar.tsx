import { clsx } from 'clsx'
import { useTranslation } from 'react-i18next'
import { type ShaderGroup, shaderSegments } from '#@/consoles/shaders.ts'

const groupLabels: Record<ShaderGroup, string> = {
  crt: 'settings.shaderGroupCrt',
  handheld: 'settings.shaderGroupHandheld',
  smoothing: 'settings.shaderGroupSmoothing',
}

/** The name of a shader's kind, such as "CRT" */
export function useShaderGroupLabel() {
  const { t } = useTranslation()
  return (group: ShaderGroup) => t(groupLabels[group])
}

const tones = {
  // On the pause menu, over the game
  overlay: {
    dash: { current: 'bg-white', here: 'bg-white/40', other: 'bg-white/15' },
    label: { here: 'text-white', other: 'text-white/40' },
  },
  // In the settings, in the app's colors
  theme: {
    dash: { current: 'bg-(--accent-9)', here: 'bg-(--gray-a8)', other: 'bg-(--gray-a4)' },
    label: { here: 'text-(--gray-12)', other: 'text-(--gray-a9)' },
  },
}

/**
 * Where a shader is among them all (by its place in orderedShaders): a dash for each, in segments by kind, named
 * underneath. Where the names don't all fit, only the shown one's kind is named
 */
export function ShaderBar({ index, tone }: Readonly<{ index: number; tone: keyof typeof tones }>) {
  const groupLabel = useShaderGroupLabel()
  const colors = tones[tone]
  const segments = shaderSegments.map(({ count, group, start }) => ({
    count,
    here: index >= start && index < start + count,
    label: group ? groupLabel(group) : '',
    start,
  }))

  return (
    <div aria-hidden className='flex flex-col gap-1.5'>
      <div className='flex gap-2'>
        {segments.map((segment) => (
          <div className='flex min-w-0 basis-0 gap-0.5' key={segment.start} style={{ flexGrow: segment.count }}>
            {Array.from({ length: segment.count }, (_, i) => {
              let color = colors.dash.other
              if (segment.start + i === index) {
                color = colors.dash.current
              } else if (segment.here) {
                color = colors.dash.here
              }
              return <span className={clsx('h-1 min-w-0.5 flex-1 rounded-full transition-colors', color)} key={i} />
            })}
          </div>
        ))}
      </div>
      <div className='@container flex gap-2 text-[11px] leading-none font-semibold tracking-wide uppercase'>
        {segments.map((segment) => (
          <span
            className={clsx(
              'basis-0 truncate transition-colors',
              segment.here
                ? ['min-w-max', colors.label.here]
                : ['invisible min-w-0 @md:visible @md:min-w-max', colors.label.other],
            )}
            key={segment.start}
            style={{ flexGrow: segment.count }}
          >
            {segment.label}
          </span>
        ))}
      </div>
    </div>
  )
}
