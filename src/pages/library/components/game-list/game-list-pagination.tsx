import { Button } from '@radix-ui/themes'
import { type KeyboardEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLoaderData, useLocation, useNavigate } from 'react-router'
import type { RomsPagination } from '#@/controllers/roms/get-roms.ts'
import { NavigatableLink } from '../navigatable-link.tsx'

/** The address of another page of this list, keeping its sort, order and filters */
export function usePageLink() {
  const { pathname, search } = useLocation()
  return (page: number) => {
    const params = new URLSearchParams(search)
    params.set('page', String(page))
    return `${pathname}?${params}`
  }
}

// The list's pages: first, previous, the current page as a box to type another in, next and last
export function GameListPagination() {
  const { t } = useTranslation()
  const { pagination } = useLoaderData<{ pagination: RomsPagination }>()
  const { current, pages } = pagination
  const pageLink = usePageLink()

  if (pages <= 1) {
    return
  }

  const arrows = [
    { icon: 'icon-[mdi--page-first]', label: t('pagination.first'), page: 1 },
    { icon: 'icon-[mdi--chevron-left]', label: t('pagination.previous'), page: current - 1 },
  ]
  const after = [
    { icon: 'icon-[mdi--chevron-right]', label: t('pagination.next'), page: current + 1 },
    { icon: 'icon-[mdi--page-last]', label: t('pagination.last'), page: pages },
  ]

  function renderArrow({ icon, label, page }: (typeof arrows)[number]) {
    const disabled = page < 1 || page > pages || page === current
    return (
      <Button
        aria-label={label}
        asChild={!disabled}
        disabled={disabled}
        key={label}
        size='3'
        title={label}
        variant='soft'
      >
        {disabled ? (
          <span className={`${icon} size-5`} />
        ) : (
          <NavigatableLink to={pageLink(page)}>
            <span className={`${icon} size-5`} />
          </NavigatableLink>
        )}
      </Button>
    )
  }

  return (
    <nav
      aria-label={t('pagination.pages')}
      className='mt-4 flex items-center justify-center gap-2 px-4'
      data-sn-section=''
    >
      {arrows.map((arrow) => renderArrow(arrow))}
      <PageBox current={current} key={current} pages={pages} />
      {after.map((arrow) => renderArrow(arrow))}
    </nav>
  )
}

// The current page, as a box to type another page in; Enter goes there. A number past the end goes to the last page
function PageBox({ current, pages }: Readonly<{ current: number; pages: number }>) {
  const { t } = useTranslation()
  const pageLink = usePageLink()
  const navigate = useNavigate()
  const [typed, setTyped] = useState(String(current))

  async function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') {
      return
    }
    const number = Math.trunc(Number(typed))
    if (!typed || !number) {
      setTyped(String(current))
      return
    }
    const page = Math.min(Math.max(number, 1), pages)
    setTyped(String(page))
    if (page !== current) {
      await navigate(pageLink(page))
    }
  }

  return (
    <label className='mx-1 flex h-10 items-center gap-2 rounded bg-(--accent-3) px-3 text-[15px] font-semibold text-(--accent-11)'>
      {t('pagination.page')}
      <input
        aria-label={t('pagination.page')}
        className='h-8 w-14 rounded border border-solid border-(--accent-8) bg-(--color-background) text-center font-bold text-(--gray-12) outline-none focus:border-(--accent-9) focus:ring-2 focus:ring-(--accent-6)'
        data-sn-enabled
        inputMode='numeric'
        onBlur={() => setTyped(String(current))}
        onChange={(event) => setTyped(event.currentTarget.value.replaceAll(/\D/gu, ''))}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={handleKeyDown}
        type='text'
        value={typed}
      />
      {t('pagination.of', { count: pages })}
    </label>
  )
}
