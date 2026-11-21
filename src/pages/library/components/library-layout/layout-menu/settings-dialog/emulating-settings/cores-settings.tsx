import { Select } from '@radix-ui/themes'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { coreDisplayNameMap, type CoreName, coreOptionsMap } from '#@/constants/core.ts'
import { platformMap } from '#@/constants/platform.ts'
import { usePlatform } from '#@/pages/library/hooks/use-platform.ts'
import { usePreference } from '#@/pages/library/hooks/use-preference.ts'
import { getPlatformIcon } from '#@/utils/client/library.ts'
import { SettingsTitle } from '../settings-title.tsx'
import { UpdateButton } from '../update-button.tsx'
import { BIOSOptions } from './bios-options.tsx'
import { CoreOptions } from './core-options.tsx'
import { PlatformShaderSettings } from './platform-shader-settings.tsx'
import { RewindSettings } from './rewind-settings.tsx'

export function CoresSettings() {
  const { t } = useTranslation()
  const { isLoading, preference, update } = usePreference()
  const currentPlatform = usePlatform()
  const [selectedPlatform, setSelectedPlatform] = useState(currentPlatform?.name || preference.ui.platforms?.[0])

  if (!preference.ui.platforms?.length) {
    return
  }

  const { core } = preference.emulator.platform[selectedPlatform]
  const coreOptions = coreOptionsMap[core] || []
  const showReset = platformMap[selectedPlatform].cores.length > 0 && coreOptions.length > 0

  async function handleValueChange(value: CoreName) {
    await update({
      emulator: {
        platform: {
          [selectedPlatform]: {
            core: value,
          },
        },
      },
    })
  }

  return (
    <div>
      {/* On a small phone the console picker goes under the heading, and a long console name is shortened */}
      <SettingsTitle className='flex-wrap justify-between gap-y-1'>
        <span className='whitespace-nowrap'>{t('common.emulationFor')}</span>
        <div className='flex max-w-full min-w-0 flex-col gap-2'>
          <Select.Root
            onValueChange={(value: typeof selectedPlatform) => setSelectedPlatform(value)}
            size='3'
            value={selectedPlatform}
          >
            <Select.Trigger className='max-w-full' disabled={isLoading} variant='ghost'>
              <div className='flex min-w-0 items-center gap-2'>
                <img
                  alt={t(platformMap[selectedPlatform].displayNameI18nKey)}
                  className='size-5 shrink-0 object-contain object-center'
                  loading='lazy'
                  src={getPlatformIcon(platformMap[selectedPlatform].name)}
                />
                <span className='truncate'>{t(platformMap[selectedPlatform].displayNameI18nKey)}</span>
              </div>
            </Select.Trigger>
            <Select.Content>
              {preference.ui.platforms.map((platform) => (
                <Select.Item key={platformMap[platform].name} value={platformMap[platform].name}>
                  <div className='flex items-center gap-2'>
                    <img
                      alt={t(platformMap[platform].displayNameI18nKey)}
                      className='size-5 object-contain object-center'
                      src={getPlatformIcon(platformMap[platform].name)}
                    />
                    {t(platformMap[platform].displayNameI18nKey)}
                  </div>
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </div>
      </SettingsTitle>

      <div className='flex flex-col divide-y divide-(--gray-a4) *:py-2.5'>
        <RewindSettings platform={selectedPlatform} />

        <BIOSOptions platform={selectedPlatform} />

        <PlatformShaderSettings key={selectedPlatform} platform={selectedPlatform} />

        <div>
          <label className='flex flex-wrap items-center justify-between gap-x-2'>
            <SettingsTitle as='h4' className='mb-0 text-base font-normal'>
              {t('common.emulator')}
            </SettingsTitle>

            <Select.Root onValueChange={handleValueChange} size='2' value={core}>
              <Select.Trigger disabled={isLoading} />
              <Select.Content>
                {platformMap[selectedPlatform].cores.map((core) => (
                  <Select.Item key={core} value={core}>
                    <div className='flex items-center gap-2'>
                      <div className='flex size-4 items-center justify-center'>
                        <span className='icon-[mdi--jigsaw] size-5' />
                      </div>
                      {coreDisplayNameMap[core]}
                    </div>
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </label>

          {coreOptions.length > 0 ? <CoreOptions core={core} coreOptions={coreOptions} /> : null}

          {showReset ? (
            <div className='flex justify-end'>
              <UpdateButton
                preference={{
                  emulator: {
                    core: { [core]: null },
                    platform: { [selectedPlatform]: { core: null } },
                  },
                }}
              >
                <span className='icon-[mdi--undo]' />
                {t('emulator.resetToDefaultsDescription')}
              </UpdateButton>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
