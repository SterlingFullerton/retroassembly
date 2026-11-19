import { Button } from '@radix-ui/themes'
import { clsx } from 'clsx'
import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router'

interface FavoriteButtonProps {
  isViewingFavorites: boolean
  getToggleLink: () => string
}

export function FavoriteButton({ isViewingFavorites, getToggleLink }: FavoriteButtonProps) {
  const { t } = useTranslation()

  return (
    <Button
      aria-label={t('nav.favorites')}
      asChild
      title={t('nav.favorites')}
      variant={isViewingFavorites ? 'solid' : 'soft'}
    >
      <NavLink end to={getToggleLink()} className='group'>
        {({ isPending }) => (
          <>
            {isPending ? (
              <span className='icon-[svg-spinners--180-ring] animate-spin' />
            ) : (
              <span
                className={clsx({
                  'icon-[mdi--heart-outline]': !isViewingFavorites,
                  'icon-[mdi--heart]': isViewingFavorites,
                })}
              />
            )}
            {/* On a phone's crowded line, only the heart */}
            <span className='group-data-crowded/actions:max-lg:hidden'>{t('nav.favorites')}</span>
          </>
        )}
      </NavLink>
    </Button>
  )
}
