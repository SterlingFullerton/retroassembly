import { AutosaveSettings } from './autosave-settings.tsx'
import { CoresSettings } from './cores-settings.tsx'
import { ShaderSettings } from './shader-settings.tsx'

export function EmulatingSettings() {
  return (
    <div className='flex flex-col divide-y divide-(--gray-a4) *:py-5 *:first:pt-0 *:last:pb-0'>
      <AutosaveSettings />
      <ShaderSettings />
      <CoresSettings />
    </div>
  )
}
