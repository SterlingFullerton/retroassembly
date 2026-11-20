import { Switch } from '@radix-ui/themes'
import { clsx } from 'clsx'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PlatformName } from '#@/constants/platform.ts'
import { usePreference } from '#@/pages/library/hooks/use-preference.ts'
import { SettingsTitle } from '../settings-title.tsx'
import { ShaderPreview } from './shader-preview.tsx'
import { ShaderSelect } from './shader-select.tsx'

export function PlatformShaderSettings({ platform }: Readonly<{ platform: PlatformName }>) {
  const { t } = useTranslation()

  const { isLoading, preference, update } = usePreference()
  const [highlighted, setHighlighted] = useState<string>()

  const platformPreference = preference.emulator.platform[platform]

  async function updatePlatformShader(shader: string) {
    await update({ emulator: { platform: { [platform]: { shader } } } })
  }

  async function handleShaderChange(shader: string) {
    await updatePlatformShader(shader === 'none' ? '' : shader)
  }

  async function handleInheritChange(checked: boolean) {
    await updatePlatformShader(checked ? '' : 'inherit')
  }

  return (
    <div>
      <SettingsTitle className='mb-0 text-base font-normal'>
        <label className='flex w-full items-center justify-between gap-2'>
          <SettingsTitle className='mb-0 text-base font-normal'>{t('settings.platformShader')}</SettingsTitle>
          <Switch
            checked={platformPreference.shader !== 'inherit'}
            disabled={isLoading}
            onCheckedChange={handleInheritChange}
          />
        </label>
      </SettingsTitle>
      <div className={clsx('mt-2', { hidden: platformPreference.shader === 'inherit' })}>
        <ShaderSelect
          disabled={isLoading}
          onHighlight={setHighlighted}
          onValueChange={handleShaderChange}
          value={platformPreference.shader || 'none'}
        />
        <ShaderPreview shader={highlighted ?? platformPreference.shader ?? ''} />
      </div>
    </div>
  )
}
