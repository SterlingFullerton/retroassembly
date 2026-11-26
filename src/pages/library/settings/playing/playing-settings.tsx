import { AutosaveSettings } from './autosave-settings.tsx'
import { PerfOverlaySettings } from './perf-overlay-settings.tsx'
import { PlayTogetherSettings } from './play-together-settings.tsx'
import { ShaderSettings } from './shader-settings.tsx'

/** What holds for every console while a game runs: saving as it's played, the shader, and the performance overlay */
export function PlayingSettings() {
  return (
    <div className='flex flex-col divide-y divide-(--gray-a4) *:py-5 *:first:pt-0 *:last:pb-0'>
      <AutosaveSettings />
      <ShaderSettings />
      <PerfOverlaySettings />
      <PlayTogetherSettings />
    </div>
  )
}
