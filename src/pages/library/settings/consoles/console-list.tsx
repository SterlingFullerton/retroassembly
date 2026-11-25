import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { platformMap } from '#@/constants/platform.ts'
import { usePreference } from '#@/pages/library/hooks/use-preference.ts'
import { getPlatformIcon } from '#@/utils/client/library.ts'
import { getSettingsPath, useSettingsOrigin } from '../sections.ts'
import { getConsoleSummary } from './console-summary.ts'

/** The library's consoles, A to Z, each with what sets it apart from the defaults. A console opens its own settings */
export function ConsoleList() {
  const { i18n, t } = useTranslation()
  const { preference } = usePreference()
  const { linkState } = useSettingsOrigin()

  const consoles = (preference.ui.platforms ?? [])
    .map((name) => ({ name, text: t(platformMap[name].displayNameI18nKey) }))
    .toSorted((a, b) => a.text.localeCompare(b.text, i18n.language))

  return (
    <div className='flex flex-col divide-y divide-(--gray-a4)' data-sn-section=''>
      {consoles.map(({ name, text }) => {
        const { biosMissing, differences } = getConsoleSummary(preference, name)
        const summary = differences.map(({ key, text }) => (key ? t(key) : text)).join(' · ')
        return (
          <Link
            className='flex min-h-14 items-center gap-3 rounded py-2'
            data-sn-enabled=''
            key={name}
            state={linkState}
            to={getSettingsPath('consoles', name)}
          >
            <img
              alt=''
              className='size-7 shrink-0 object-contain object-center'
              loading='lazy'
              src={getPlatformIcon(name)}
            />
            <span className='min-w-0 flex-1'>
              <span className='block truncate'>{text}</span>
              <span className='block truncate text-xs text-(--gray-11)'>
                {biosMissing ? <span className='text-(--red-11)'>{t('settings.biosMissing')}</span> : null}
                {biosMissing && summary ? ' · ' : null}
                {summary || (biosMissing ? null : t('settings.defaultSettings'))}
              </span>
            </span>
            <span className='icon-[mdi--chevron-right] size-6 shrink-0 text-(--gray-9)' />
          </Link>
        )
      })}
    </div>
  )
}
