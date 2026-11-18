import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

/**
 * One of Home's sections: a heading, with what it is and "See all" where there's a page for it, and one row that
 * scrolls sideways when it's wider than the page, so Home stays short
 */
export function HomeRow({
  children,
  extra,
  link,
  note,
  title,
}: Readonly<{ children: ReactNode; extra?: ReactNode; link?: string; note?: string; title: string }>) {
  const { t } = useTranslation()
  return (
    <section className='mt-6 min-w-0 lg:mt-8' data-sn-section=''>
      <div className='mb-2 flex items-center gap-3 px-1' data-sn-heading=''>
        <h2 className='text-lg font-semibold lg:text-xl'>{title}</h2>
        {note ? <span className='hidden text-sm text-(--gray-10) sm:inline'>{note}</span> : null}
        <div className='ml-auto flex shrink-0 items-center gap-3'>
          {extra}
          {link ? (
            <Link
              className='inline-flex min-h-6 items-center text-sm font-semibold text-(--accent-11) hover:underline'
              to={link}
            >
              {t('home.seeAll')}
            </Link>
          ) : null}
        </div>
      </div>
      <div className='scrollbar-on-hover -mx-4 flex gap-3 overflow-x-auto px-4 pb-2 lg:mx-0 lg:gap-4 lg:px-0'>
        {children}
      </div>
    </section>
  )
}
