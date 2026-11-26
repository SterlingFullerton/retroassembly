import { Switch } from '@radix-ui/themes'
import { useTranslation } from 'react-i18next'
import { usePerfOverlay } from '#@/pages/library/hooks/use-perf-overlay.ts'
import { SettingsTitle } from '../settings-title.tsx'

/** The performance overlay's switch. It's kept in this browser, not with the account, so it's on for this device alone */
export function PerfOverlaySettings() {
  const { t } = useTranslation()
  const [enabled, setEnabled] = usePerfOverlay()

  return (
    <div>
      <label className='flex w-full items-center justify-between gap-2'>
        <SettingsTitle className='mb-0'>{t('settings.performanceOverlay')}</SettingsTitle>
        <Switch checked={enabled} onCheckedChange={setEnabled} />
      </label>
      <div className='text-xs text-(--gray-11)'>{t('settings.performanceOverlayNote')}</div>
    </div>
  )
}
