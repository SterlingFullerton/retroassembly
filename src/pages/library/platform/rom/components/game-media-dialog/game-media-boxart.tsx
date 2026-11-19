import { Button } from '@radix-ui/themes'
import type { InferRequestType } from 'hono'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWRMutation from 'swr/mutation'
import { client, parseResponse } from '#@/api/client.ts'
import { useRom } from '#@/pages/library/hooks/use-rom.ts'
import { GameCover } from '../game-cover.tsx'
import { selectImageFile } from './utils.ts'

const endpoint = 'roms/:id/boxart'
const { $delete, $post } = client.roms[':id'].boxart

export function GameMediaBoxart() {
  const { t } = useTranslation()
  const initialRom = useRom()
  const [rom, setRom] = useState(initialRom)
  const param = { id: rom.id }
  const { isMutating: isUploadingBoxart, trigger: uploadBoxart } = useSWRMutation(
    { endpoint, method: 'post', param },
    ({ param }, { arg: form }: { arg: InferRequestType<typeof $post>['form'] }) => $post({ form, param }),
  )

  const { isMutating: isResettingingBoxart, trigger: resetBoxart } = useSWRMutation(
    { endpoint, method: 'delete', param },
    ({ param }) => $delete({ param }),
  )

  async function handleClickResetBoxart() {
    await resetBoxart()
    setRom({ ...rom, gameBoxartFileIds: null })
  }

  async function handleClickUploadBoxart() {
    const file = await selectImageFile()
    if (file) {
      const gameBoxartFileIds = await parseResponse(uploadBoxart({ file }))
      setRom({ ...rom, gameBoxartFileIds })
    }
  }

  return (
    // The cover, then Upload and Reset under it: a phone shows it smaller, beside nothing else
    <div className='flex flex-col gap-2'>
      <GameCover
        className='block w-28 sm:w-full'
        imgClassName='block h-auto max-h-56 w-full rounded object-contain object-left-top'
        rom={rom}
      />
      <div className='flex gap-2'>
        <Button
          disabled={isResettingingBoxart}
          loading={isUploadingBoxart}
          onClick={handleClickUploadBoxart}
          size='1'
          type='button'
          variant='soft'
        >
          <span className='icon-[mdi--upload]' />
          {t('common.upload')}
        </Button>
        <Button
          disabled={isUploadingBoxart}
          loading={isResettingingBoxart}
          onClick={handleClickResetBoxart}
          size='1'
          type='button'
          variant='soft'
        >
          <span className='icon-[mdi--restore]' />
          {t('common.reset')}
        </Button>
      </div>
    </div>
  )
}
