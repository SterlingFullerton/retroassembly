import { clsx } from 'clsx'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { platformMap } from '#@/constants/platform.ts'
import { getPlatformBanner, getPlatformDevicePhoto } from '#@/utils/client/library.ts'
import { useDate } from '../../hooks/use-date.ts'
import { CompanyLogo } from '../../platform/components/company-logo.tsx'

/**
 * A console's page header, on one line: its logo, and About, which opens when it came out, who made it, the description
 * and a photo. On a computer the Favorites and Sort line (`actions`) is on this line too
 */
export function DeviceInfo({ actions, platform }: Readonly<{ actions?: ReactNode; platform: string }>) {
  const { t } = useTranslation()
  const [aboutOpen, setAboutOpen] = useState(false)
  const { formatDate, formatDateRelative, isValidDate } = useDate()

  const platformData = platformMap[platform]
  if (!platformData?.info) {
    return (
      <div className='flex w-full items-center gap-4'>
        <h1 className='text-3xl font-semibold'>{t(platformData?.displayNameI18nKey || '')}</h1>
        {actions ? <div className='ml-auto hidden min-w-0 lg:block'>{actions}</div> : null}
      </div>
    )
  }

  const { info } = platformData
  const banner = getPlatformBanner(platform)
  const devicePhoto = getPlatformDevicePhoto(platform)

  let { developer, manufacturer } = info
  if (platform === 'arcade') {
    developer = t('common.variousCompanies')
    manufacturer = t('common.variousCompanies')
  }

  if (developer?.toLowerCase().includes('nintendo')) {
    developer = 'Nintendo'
  }
  if (manufacturer?.toLowerCase().includes('nintendo')) {
    manufacturer = 'Nintendo'
  }

  if (developer?.toLowerCase().includes('atari')) {
    developer = 'Atari'
  }
  if (manufacturer?.toLowerCase().includes('atari')) {
    manufacturer = 'Atari'
  }

  return (
    <div className='flex w-full min-w-0 flex-col'>
      <div className='flex items-center gap-3 lg:gap-4'>
        <h1 className='shrink-0'>
          <img
            alt={t(platformData.displayNameI18nKey)}
            className='h-8 w-auto max-w-32 object-contain object-left lg:h-10 lg:max-w-52'
            loading='lazy'
            src={banner}
          />
        </h1>
        <button
          aria-expanded={aboutOpen}
          className='flex min-h-6 shrink-0 items-center gap-0.5 text-sm font-semibold text-(--accent-11) hover:underline'
          data-sn-enabled
          onClick={() => setAboutOpen(!aboutOpen)}
          type='button'
        >
          {t('common.about')}
          <span className={clsx('size-4', aboutOpen ? 'icon-[mdi--chevron-up]' : 'icon-[mdi--chevron-down]')} />
        </button>
        {actions ? <div className='ml-auto hidden min-w-0 lg:block'>{actions}</div> : null}
      </div>

      {aboutOpen ? (
        <div className='mt-3 flex items-center gap-6 rounded bg-(--gray-a3) p-4'>
          <div className='flex min-w-0 flex-1 flex-col gap-4'>
            <div className='flex flex-wrap gap-x-8 gap-y-3 lg:*:min-w-36'>
              <div>
                <div className='flex min-h-6 items-center gap-2 font-semibold'>
                  <span className='icon-[mdi--calendar]' />
                  <span>{t('common.released')}</span>
                </div>
                <div className='mt-1 pl-6'>
                  {isValidDate(info.releaseDate) ? (
                    <>
                      {formatDate(info.releaseDate)}
                      <span className='ml-1.5 text-xs opacity-50'>{formatDateRelative(info.releaseDate)}</span>
                    </>
                  ) : (
                    <span className='opacity-40'>{t('common.unknown')}</span>
                  )}
                </div>
              </div>

              {manufacturer === developer ? (
                <div>
                  <div className='flex min-h-6 items-center gap-2 font-semibold'>
                    <span className='icon-[mdi--factory]' />
                    <span>
                      {t('common.developer')} & {t('common.manufacturer')}
                    </span>
                  </div>
                  <div className='mt-1 pl-6'>
                    <CompanyLogo className='h-5' company={manufacturer || ''} fallback={manufacturer} />
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <div className='flex min-h-6 items-center gap-2 font-semibold'>
                      <span className='icon-[mdi--factory]' />
                      <span>{t('common.developer')}</span>
                    </div>
                    <div className='mt-1 pl-6'>
                      <CompanyLogo className='h-5' company={developer || ''} fallback={developer} />
                    </div>
                  </div>
                  <div>
                    <div className='flex min-h-6 items-center gap-2 font-semibold'>
                      <span className='icon-[mdi--factory]' />
                      <span>{t('common.manufacturer')}</span>
                    </div>
                    <div className='mt-1 pl-6'>
                      <CompanyLogo className='h-5' company={manufacturer || ''} fallback={manufacturer} />
                    </div>
                  </div>
                </>
              )}
            </div>
            {info.notesI18nKey ? (
              <p className='font-serif text-sm leading-relaxed whitespace-pre-line text-(--color-text)/70'>
                {t(info.notesI18nKey)}
              </p>
            ) : null}
          </div>
          <img
            alt={t(platformData.displayNameI18nKey)}
            className='hidden aspect-video w-72 shrink-0 object-contain drop-shadow-2xl lg:block'
            loading='lazy'
            src={devicePhoto}
          />
        </div>
      ) : null}
    </div>
  )
}
