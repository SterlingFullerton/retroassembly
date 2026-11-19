import { Switch } from '@radix-ui/themes'
import { useTranslation } from 'react-i18next'
import { goesFullscreen } from '#@/constants/preference.ts'
import { usePreference } from '#@/pages/library/hooks/use-preference.ts'
import { SettingsTitle } from '../settings-title.tsx'
import { ShaderSelect } from './shader-select.tsx'

export function ShaderSettings() {
  const { t } = useTranslation()
  const { isLoading, preference, update } = usePreference()

  async function handleShaderChange(shader: string) {
    const actualShader = shader === 'none' ? '' : shader
    if (actualShader !== preference.emulator.shader) {
      await update({
        emulator: {
          shader: actualShader,
          videoSmooth: actualShader ? false : preference.emulator.videoSmooth,
        },
      })
    }
  }

  return (
    <div>
      <SettingsTitle>{t('settings.video')}</SettingsTitle>

      <div>
        <div className='flex flex-col divide-y divide-(--gray-a4) *:py-2.5'>
          <div>
            <SettingsTitle className='mb-0 justify-between text-base font-normal'>
              {t('settings.shader')}
              <ShaderSelect
                disabled={isLoading}
                onValueChange={handleShaderChange}
                value={preference.emulator.shader || 'none'}
              />
            </SettingsTitle>
          </div>

          <div>
            <label className='flex items-center justify-between gap-2'>
              <SettingsTitle className='mb-0 text-base font-normal'>{t('settings.bilinearFiltering')}</SettingsTitle>
              <Switch
                checked={preference.emulator.videoSmooth}
                disabled={isLoading}
                onCheckedChange={(checked) =>
                  update({
                    emulator: {
                      shader: '',
                      videoSmooth: checked,
                    },
                  })
                }
              />
            </label>
            <div className='text-xs text-(--gray-11)'>
              {t('settings.blurDescription')}
              <br />
              {t('settings.cannotEnableWithShaders')}
            </div>
          </div>

          <div>
            <label className='flex items-center justify-between gap-2'>
              <SettingsTitle className='mb-0 text-base font-normal'>{t('settings.goFullscreenOnLaunch')}</SettingsTitle>
              <Switch
                checked={goesFullscreen(preference.emulator.fullscreen)}
                disabled={isLoading}
                onCheckedChange={(checked) =>
                  update({
                    emulator: {
                      fullscreen: checked,
                    },
                  })
                }
              />
            </label>
            <div className='text-xs text-(--gray-11)'>{t('emulator.fullscreenNotSupported')}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
