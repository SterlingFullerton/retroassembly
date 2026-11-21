import { useTranslation } from 'react-i18next'
import type { PlatformName } from '#@/constants/platform.ts'
import { usePreference } from '#@/pages/library/hooks/use-preference.ts'
import { SettingsTitle } from '../settings-title.tsx'
import { ShaderSwitcher } from './shader-switcher.tsx'

/** A console's shader: the one for all consoles until another is picked, which Reset undoes */
export function PlatformShaderSettings({ platform }: Readonly<{ platform: PlatformName }>) {
  const { t } = useTranslation()
  const { preference, update } = usePreference()

  const own = preference.emulator.platform[platform]?.shader
  const inherited = own === 'inherit' || own === undefined

  async function updatePlatformShader(shader: string) {
    await update({ emulator: { platform: { [platform]: { shader } } } })
  }

  return (
    <ShaderSwitcher
      inherited={inherited}
      label={<SettingsTitle className='mb-0 text-base font-normal'>{t('settings.shader')}</SettingsTitle>}
      onChange={updatePlatformShader}
      onReset={() => updatePlatformShader('inherit')}
      value={inherited ? preference.emulator.shader || '' : own}
    />
  )
}
