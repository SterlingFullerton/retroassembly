import { Button, DropdownMenu } from '@radix-ui/themes'
import { clsx } from 'clsx'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { getDefaultRomsDirection, searchOrder } from '#@/constants/roms-order.ts'

export interface SortOption {
  icon: string
  label: string
  value: string
}

interface SortDropdownProps {
  /** What it sorts by, in place of the game list's orders, as the Consoles page has its own */
  options?: SortOption[]
  /** Which way each order starts, in place of the game list's */
  getDefaultDirection?: (sort: string) => string
  currentSort: string
  currentDirection: string
  buildSortLink: (params: Record<string, string>) => string
  /** Whether the list is being searched, which adds Best match */
  searching?: boolean
}

export function SortDropdown({
  currentSort,
  currentDirection,
  buildSortLink,
  getDefaultDirection = getDefaultRomsDirection,
  options,
  searching,
}: SortDropdownProps) {
  const { t } = useTranslation()

  const sortOptions = options ?? [
    ...(searching ? [{ icon: 'icon-[mdi--magnify]', label: t('common.bestMatch'), value: searchOrder }] : []),
    { icon: 'icon-[mdi--pencil]', label: t('common.name'), value: 'name' },
    { icon: 'icon-[mdi--clock]', label: t('common.dateAdded'), value: 'added' },
    { icon: 'icon-[mdi--calendar]', label: t('common.released'), value: 'released' },
    { icon: 'icon-[mdi--fire]', label: t('common.popular'), value: 'popular' },
    { icon: 'icon-[mdi--gamepad-variant]', label: t('common.mostPlayed'), value: 'played' },
  ]

  // Popular and Most played start from the top. Leaving them goes back to A to Z, oldest first and so on
  function getDirection(sort: string) {
    const direction = getDefaultDirection(sort)
    return direction === 'desc' || getDefaultDirection(currentSort) === 'desc' ? direction : currentDirection
  }

  const directionOptions = [
    { icon: 'icon-[mdi--sort-ascending]', label: t('common.ascending'), value: 'asc' },
    { icon: 'icon-[mdi--sort-descending]', label: t('common.descending'), value: 'desc' },
  ]

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <Button variant='soft'>
          <span className='icon-[mdi--sort]' />
          {searching ? (
            <>
              {/* On a phone, where the line also has Add (a console's page), only "Sort", so it all fits on one line */}
              <span className='group-data-crowded/actions:max-lg:hidden'>
                {t('common.sortCurrent', { sort: sortOptions.find(({ value }) => value === currentSort)?.label })}
              </span>
              <span className='hidden group-data-crowded/actions:max-lg:inline'>{t('common.sort')}</span>
            </>
          ) : (
            t('common.sort')
          )}
          <DropdownMenu.TriggerIcon />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content>
        <DropdownMenu.Label>{t('common.sortBy')}</DropdownMenu.Label>
        {sortOptions.map(({ icon, label, value }) => (
          <DropdownMenu.Item asChild key={value}>
            <Link
              to={buildSortLink(
                value === searchOrder ? { sort: value } : { direction: getDirection(value), sort: value },
              )}
            >
              <span className={clsx('icon-[mdi--check]', { 'opacity-0': value !== currentSort })} />
              <span className={icon} />
              {label}
            </Link>
          </DropdownMenu.Item>
        ))}

        {/* Best match is always best first */}
        {currentSort === searchOrder ? null : (
          <>
            <DropdownMenu.Separator />

            <DropdownMenu.Label>{t('common.sortDirection')}</DropdownMenu.Label>
            {directionOptions.map(({ icon, label, value }) => (
              <DropdownMenu.Item asChild key={value}>
                <Link to={buildSortLink({ direction: value, sort: currentSort })}>
                  <span className={clsx('icon-[mdi--check]', { 'opacity-0': value !== currentDirection })} />
                  <span className={icon} />
                  {label}
                </Link>
              </DropdownMenu.Item>
            ))}
          </>
        )}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  )
}
