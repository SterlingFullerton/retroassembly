import { clsx } from 'clsx'
import { useAtom } from 'jotai'
import { type ReactNode, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import { platformMap } from '#@/constants/platform.ts'
import { preferenceSaveFailedAtom } from '#@/pages/atoms.ts'
import { usePreference } from '#@/pages/library/hooks/use-preference.ts'
import { getPlatformIcon } from '#@/utils/client/library.ts'
import { AccountSettings } from './accounts/account-settings.tsx'
import { AccountsSettings } from './accounts/accounts-settings.tsx'
import { AppearanceSettings } from './appearance/appearance-settings.tsx'
import { ChooseConsoles } from './consoles/choose-consoles.tsx'
import { ConsoleList } from './consoles/console-list.tsx'
import { ConsoleSettings } from './consoles/console-settings.tsx'
import { InputsSettings } from './controls/inputs-setting.tsx'
import { PlayingSettings } from './playing/playing-settings.tsx'
import { getSettingsPath, type SettingsSectionName, useSettingsOrigin, useSettingsSections } from './sections.ts'

// What each section shows, and what sits beside its heading
const contents: Record<SettingsSectionName, { actions?: () => ReactNode; content: () => ReactNode }> = {
  account: { content: AccountSettings },
  appearance: { content: AppearanceSettings },
  consoles: { actions: ChooseConsoles, content: ConsoleList },
  controls: { content: InputsSettings },
  playing: { content: PlayingSettings },
  server: { content: AccountsSettings },
}

/**
 * The settings, a page of the library. On a computer the sections are listed in the sidebar (see SettingsSidebar) and
 * one is always open; on a phone the list is the first screen and each section opens from it. Each of the library's
 * consoles has a page of its own, opened from the consoles' section
 */
export default function SettingsPage() {
  const { t } = useTranslation()
  const { current, sections, shown } = useSettingsSections()
  const { linkState } = useSettingsOrigin()
  const { actions: Actions, content: Content } = contents[shown.name]

  // A console's own settings, when the address names one the library shows
  const { preference } = usePreference()
  const params = useParams()
  const console =
    shown.name === 'consoles' ? preference.ui.platforms?.find((platform) => platform === params.console) : undefined

  // A change that didn't save is said in the note at the bottom, until one saves or the settings are left
  const [saveFailed, setSaveFailed] = useAtom(preferenceSaveFailedAtom)
  useEffect(() => () => setSaveFailed(false), [setSaveFailed])

  return (
    <div className='mx-auto flex min-h-full w-full max-w-5xl flex-col p-4 lg:px-8 lg:pt-8'>
      {/* A phone's first screen: the sections */}
      {current ? null : (
        <nav className='flex flex-col divide-y divide-(--gray-a4) lg:hidden' data-sn-section=''>
          {sections.map(({ iconClass, label, name }) => (
            <Link
              className='flex min-h-14 items-center gap-3 text-lg'
              data-sn-enabled=''
              key={name}
              state={linkState}
              to={getSettingsPath(name)}
            >
              <span className={`size-6 shrink-0 text-(--accent-9) ${iconClass}`} />
              <span className='flex-1'>{t(label)}</span>
              <span className='icon-[mdi--chevron-right] size-6 shrink-0 text-(--gray-9)' />
            </Link>
          ))}
        </nav>
      )}

      <div className={current ? undefined : 'max-lg:hidden'}>
        <div className='mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2' data-sn-section=''>
          <div className='flex min-w-0 items-center gap-1'>
            {/* From a console, back to the consoles; on a phone, from a section back to the sections */}
            <Link
              aria-label={t('common.back')}
              className={clsx('-ml-2 grid size-10 shrink-0 place-items-center rounded', { 'lg:hidden': !console })}
              data-sn-enabled=''
              state={linkState}
              title={t('common.back')}
              to={console ? getSettingsPath('consoles') : getSettingsPath()}
            >
              <span className='icon-[mdi--arrow-left] size-6' />
            </Link>
            {console ? (
              <img alt='' className='mr-2 size-8 shrink-0 object-contain lg:size-10' src={getPlatformIcon(console)} />
            ) : null}
            <h1 className='truncate text-3xl font-semibold lg:text-5xl'>
              {console ? t(platformMap[console].displayNameI18nKey) : t(shown.label)}
            </h1>
          </div>
          {Actions && !console ? <Actions /> : null}
        </div>

        <div className='motion-preset-slide-up-sm' key={console ?? shown.name}>
          {console ? <ConsoleSettings platform={console} /> : <Content />}
        </div>

        {saveFailed ? (
          <div className='mt-8 flex items-center gap-2 text-xs text-(--red-11)' role='alert'>
            <span className='icon-[mdi--alert-circle-outline] shrink-0' />
            {t('settings.saveFailed')}
          </div>
        ) : (
          <div className='mt-8 flex items-center gap-2 text-xs text-(--gray-11)'>
            <span className='icon-[mdi--content-save-check-outline] shrink-0' />
            {t('settings.immediateEffect')}
          </div>
        )}
      </div>
    </div>
  )
}
