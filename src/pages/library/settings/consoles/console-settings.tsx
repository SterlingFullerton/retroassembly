import { Select } from '@radix-ui/themes'
import { clsx } from 'clsx'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { coreDisplayNameMap, type CoreName, coreOptionsMap } from '#@/constants/core.ts'
import { platformMap, type PlatformName } from '#@/constants/platform.ts'
import { usePreference } from '#@/pages/library/hooks/use-preference.ts'
import { SettingsTitle } from '../settings-title.tsx'
import { UpdateButton } from '../update-button.tsx'
import { BIOSOptions } from './bios-options.tsx'
import { ConsoleControls } from './console-controls.tsx'
import { CoreOptions } from './core-options.tsx'
import { PlatformShaderSettings } from './platform-shader-settings.tsx'
import { RewindSettings } from './rewind-settings.tsx'

/** One console's settings: its keys, its shader, rewinding, the emulator that plays it and that emulator's options, and its BIOS files */
export function ConsoleSettings({ platform }: Readonly<{ platform: PlatformName }>) {
  const { t } = useTranslation()
  const { isLoading, preference, update } = usePreference()
  const [optionsOpen, setOptionsOpen] = useState(false)

  const { core } = preference.emulator.platform[platform]
  const coreOptions = coreOptionsMap[core] || []

  async function handleValueChange(value: CoreName) {
    await update({ emulator: { platform: { [platform]: { core: value } } } })
  }

  return (
    <div className='flex flex-col divide-y divide-(--gray-a4) *:py-2.5'>
      <ConsoleControls platform={platform} />

      <PlatformShaderSettings key={platform} platform={platform} />

      <RewindSettings platform={platform} />

      <label className='flex flex-wrap items-center justify-between gap-x-2'>
        <SettingsTitle as='h4' className='mb-0 text-base font-normal'>
          {t('common.emulator')}
        </SettingsTitle>

        <Select.Root onValueChange={handleValueChange} size='2' value={core}>
          <Select.Trigger disabled={isLoading} />
          <Select.Content>
            {platformMap[platform].cores.map((core) => (
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

      {/* An emulator can have dozens of options, so they stay folded until asked for */}
      {coreOptions.length > 0 ? (
        <div>
          <button
            aria-expanded={optionsOpen}
            className='flex min-h-8 w-full items-center justify-between gap-2 rounded text-left'
            data-sn-enabled=''
            onClick={() => setOptionsOpen(!optionsOpen)}
            type='button'
          >
            <SettingsTitle as='h4' className='mb-0 text-base font-normal'>
              {t('settings.emulatorOptions')}
            </SettingsTitle>
            <span className='flex items-center gap-1 text-sm text-(--gray-11)'>
              {coreOptions.length}
              <span
                className={clsx('icon-[mdi--chevron-down] size-5 transition-transform', { 'rotate-180': optionsOpen })}
              />
            </span>
          </button>

          {optionsOpen ? (
            <>
              <CoreOptions core={core} coreOptions={coreOptions} />
              <div className='flex justify-end'>
                <UpdateButton
                  preference={{ emulator: { core: { [core]: null }, platform: { [platform]: { core: null } } } }}
                >
                  <span className='icon-[mdi--undo]' />
                  {t('emulator.resetToDefaultsDescription')}
                </UpdateButton>
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      <BIOSOptions platform={platform} />
    </div>
  )
}
