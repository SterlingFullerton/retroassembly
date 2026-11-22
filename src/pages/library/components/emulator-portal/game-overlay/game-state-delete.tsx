import { clsx } from 'clsx'
import { useTranslation } from 'react-i18next'
import useSWRMutation from 'swr/mutation'
import { client } from '#@/api/client.ts'
import { useNotice } from '#@/pages/library/hooks/use-notice.ts'
import { useGameStates } from '../hooks/use-game-states.ts'

const { $delete } = client.states[':id']
export function GameStateDelete({ elementId, id, left }: Readonly<{ elementId: string; id: string; left: string }>) {
  const { t } = useTranslation()
  const notify = useNotice()
  const { reloadStates } = useGameStates()

  const { isMutating, trigger } = useSWRMutation(
    { endpoint: 'roms', method: 'delete', param: { id } },
    () => $delete({ param: { id } }),
    {
      onError: () => notify(t('error.deleteFailed')),
      async onSuccess() {
        await reloadStates()
      },
      throwOnError: false,
    },
  )

  async function handleClick() {
    if (confirm(`${t('dialog.confirmDeleteTitle')}?`)) {
      await trigger()
    }
  }

  return (
    <button
      aria-label={t('common.delete')}
      className='flex size-7 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black'
      data-sn-enabled
      data-sn-focus-style={JSON.stringify({ backgroundColor: 'rgba(255, 255, 255, 0.5)', borderRadius: '14px' })}
      data-sn-left={left}
      id={elementId}
      onClick={handleClick}
      title={t('common.delete')}
      type='button'
    >
      <span className={clsx('size-4', isMutating ? 'icon-[svg-spinners--180-ring]' : 'icon-[mdi--delete]')} />
    </button>
  )
}
