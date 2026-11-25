import { Callout, Select } from '@radix-ui/themes'
import { useTranslation } from 'react-i18next'
import type { CoreName } from '#@/constants/core.ts'
import { usePreference } from '#@/pages/library/hooks/use-preference.ts'

export function CoreOptions({
  core,
  coreOptions,
}: Readonly<{
  core: CoreName
  coreOptions: { defaultOption?: string; name: string; options: string[]; title?: string }[]
}>) {
  const { t } = useTranslation()
  const { isLoading, preference, update } = usePreference()

  const coreOption = preference.emulator.core[core]

  async function handleValueChange(name: string, value: string) {
    await update({
      emulator: {
        core: {
          [core]: {
            [name]: value,
          },
        },
      },
    })
  }

  return (
    <div className='flex flex-col'>
      <div className='mt-3 flex w-full flex-1 flex-col gap-2'>
        <Callout.Root size='1'>
          <Callout.Icon>
            <span className='icon-[mdi--warning]' />
          </Callout.Icon>
          <Callout.Text>{t('settings.advancedOptionsWarning')}</Callout.Text>
        </Callout.Root>

        {/* A list: each option's name on the left and its choice on the right, in two columns on a computer */}
        <div className='mb-2 grid grid-cols-1 lg:grid-cols-2 lg:gap-x-8'>
          {coreOptions.map(({ defaultOption, name, options, title }) => (
            <label
              className='flex min-h-11 items-center justify-between gap-4 border-b border-(--gray-4) py-1.5'
              key={name}
            >
              <span className='min-w-0 text-sm [overflow-wrap:anywhere]'>{title || name}</span>

              <div className='shrink-0'>
                <Select.Root
                  onValueChange={(value) => handleValueChange(name, value)}
                  size='1'
                  value={coreOption?.[name] || defaultOption || options[0]}
                >
                  <Select.Trigger disabled={isLoading} />
                  <Select.Content>
                    {options.map((option) => (
                      <Select.Item key={option} value={option}>
                        {option}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              </div>
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}
