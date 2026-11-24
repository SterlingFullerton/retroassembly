import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router'
import { routes } from '#@/pages/routes.ts'
import { usePermissions } from './use-permissions.ts'

export function useGameActions() {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const pageType = pathname === routes.libraryHistory ? 'history' : 'library'

  // Games are selected to be deleted, which is for admins
  const { canDeleteGames } = usePermissions()

  const actionsMap = {
    history: [
      {
        color: 'red',
        confirmDescription: t('dialog.confirmDeleteHistoryMessage'),
        icon: 'icon-[mdi--delete]',
        name: 'delete',
        text: t('game.deleteFromHistory'),
        type: 'launch_records',
      },
    ],
    library: canDeleteGames
      ? [
          {
            confirmDescription: '',
            icon: 'icon-[mdi--checkbox-multiple-marked]',
            name: 'select',
            text: t('common.select'),
            type: '',
          },
          {
            color: 'red',
            confirmDescription: t('dialog.confirmDeleteRomsMessage'),
            icon: 'icon-[mdi--delete]',
            name: 'delete',
            text: t('game.deleteRom'),
            type: 'roms',
          },
        ]
      : [],
  } as const

  const actions = actionsMap[pageType]
  return { actions, pageType }
}
