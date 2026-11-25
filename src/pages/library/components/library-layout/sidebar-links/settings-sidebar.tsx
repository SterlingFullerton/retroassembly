import { useTranslation } from 'react-i18next'
import { getSettingsPath, useSettingsOrigin, useSettingsSections } from '../../../settings/sections.ts'
import { SidebarLink } from './sidebar-link.tsx'

/** The sidebar while the settings are open: the way back to the library, then the settings' sections */
export function SettingsSidebar() {
  const { t } = useTranslation()
  const { sections, shown } = useSettingsSections()
  const { linkState, origin } = useSettingsOrigin()

  return (
    <>
      <div className='mb-2 w-64 border-b border-b-white/30 pb-3' data-sn-section=''>
        <SidebarLink active={false} title={t('nav.library')} to={origin}>
          <span className='icon-[mdi--arrow-left] size-5 p-0.5' />
          <span className='truncate opacity-90 group-hover:opacity-100'>{t('nav.library')}</span>
        </SidebarLink>
      </div>

      <div className='w-64' data-sn-section=''>
        <div className='mt-2 mb-3 px-1 text-xs font-semibold tracking-wider text-white/70 uppercase'>
          {t('nav.settings')}
        </div>
        <div className='flex w-full flex-col gap-y-2 overflow-hidden'>
          {sections.map(({ iconClass, label, name }) => (
            <SidebarLink
              active={name === shown.name}
              key={name}
              state={linkState}
              title={t(label)}
              to={getSettingsPath(name)}
            >
              <span className={`size-5 p-0.5 ${iconClass}`} />
              <span className='truncate'>{t(label)}</span>
            </SidebarLink>
          ))}
        </div>
      </div>
    </>
  )
}
