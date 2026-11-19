import { AlertDialog, Button } from '@radix-ui/themes'
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

/**
 * The box art in the edit window, with Upload and Reset. Each is kept at once, not with Save, so "Saved" shows after;
 * Reset asks first
 */
export function GameMediaBoxart() {
  const { t } = useTranslation()
  const initialRom = useRom()
  const [rom, setRom] = useState(initialRom)
  const [saved, setSaved] = useState(false)
  const [confirmingReset, setConfirmingReset] = useState(false)
  const param = { id: rom.id }
  const { isMutating: isUploadingBoxart, trigger: uploadBoxart } = useSWRMutation(
    { endpoint, method: 'post', param },
    ({ param }, { arg: form }: { arg: InferRequestType<typeof $post>['form'] }) => $post({ form, param }),
  )

  const { isMutating: isResettingingBoxart, trigger: resetBoxart } = useSWRMutation(
    { endpoint, method: 'delete', param },
    ({ param }) => $delete({ param }),
  )

  async function handleClickConfirmReset() {
    await resetBoxart()
    setRom({ ...rom, gameBoxartFileIds: null })
    setConfirmingReset(false)
    setSaved(true)
  }

  async function handleClickUploadBoxart() {
    const file = await selectImageFile()
    if (file) {
      const gameBoxartFileIds = await parseResponse(uploadBoxart({ file }))
      setRom({ ...rom, gameBoxartFileIds })
      setSaved(true)
    }
  }

  return (
    // The cover, then Upload and Reset under it: a phone shows it smaller, beside nothing else
    <div className='flex flex-col gap-2'>
      <GameCover
        className='block w-28 sm:w-full'
        imgClassName='block h-auto max-h-56 w-full rounded-lg object-contain object-left-top'
        placeholderClassName='block h-auto w-20 opacity-70'
        rom={rom}
        viewable={false}
      />
      <div className='flex flex-wrap items-center gap-2'>
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
        <AlertDialog.Root onOpenChange={setConfirmingReset} open={confirmingReset}>
          <AlertDialog.Trigger>
            <Button disabled={isUploadingBoxart || isResettingingBoxart} size='1' type='button' variant='soft'>
              <span className='icon-[mdi--restore]' />
              {t('common.reset')}
            </Button>
          </AlertDialog.Trigger>
          <AlertDialog.Content aria-describedby={undefined} maxWidth='360px'>
            <AlertDialog.Title>{t('game.resetBoxArt')}</AlertDialog.Title>
            <div className='mt-4 flex justify-end gap-3'>
              <AlertDialog.Cancel>
                <Button disabled={isResettingingBoxart} type='button' variant='soft'>
                  {t('common.cancel')}
                </Button>
              </AlertDialog.Cancel>
              <Button loading={isResettingingBoxart} onClick={handleClickConfirmReset} type='button'>
                {t('common.reset')}
              </Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Root>
        {saved ? (
          <output className='flex items-center gap-1 text-xs text-(--gray-11)'>
            <span className='icon-[mdi--check]' />
            {t('game.saved')}
          </output>
        ) : null}
      </div>
    </div>
  )
}
