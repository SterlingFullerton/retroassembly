import { Badge, Button, IconButton, Popover } from '@radix-ui/themes'
import { fileOpen } from 'browser-fs-access'
import { Nostalgist } from 'nostalgist'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWRMutation from 'swr/mutation'
import { client, type InferRequestType, parseResponse } from '#@/api/client.ts'
import { platformMap, type PlatformName } from '#@/constants/platform.ts'
import { usePreference } from '#@/pages/library/hooks/use-preference.ts'
import { getFileMd5 } from '#@/utils/isomorphic/misc.ts'
import { SettingsTitle } from '../settings-title.tsx'

const { $delete, $post } = client.preference.bioses

export function BIOSOptions({ platform }: { readonly platform: PlatformName }) {
  const { t } = useTranslation()
  const { isLoading, preference, setPreference } = usePreference()
  const { bioses } = preference.emulator.platform[platform]

  const expectedBioses = platformMap[platform].bioses

  const { isMutating: isDeleting, trigger: handleClickDelete } = useSWRMutation(
    { endpoint: 'preference/bioses', method: 'delete' },
    (_key, { arg: fileName }: { arg: string }) => $delete({ query: { file_name: fileName, platform } }),
    {
      async onSuccess(response) {
        setPreference(await parseResponse(response))
      },
    },
  )

  const { isMutating: isUploading, trigger: upload } = useSWRMutation(
    { endpoint: 'preference/bioses', method: 'post' },
    (_key, { arg: form }: { arg: InferRequestType<typeof $post>['form'] }) => $post({ form }),
    {
      async onSuccess(response) {
        setPreference(await parseResponse(response))
      },
    },
  )

  async function handleClickUpload() {
    const { path } = Nostalgist.vendors
    const extensions = expectedBioses?.map((bios) => path.extname(bios.name)) || []
    const file = await fileOpen({ extensions })
    const expectedBios = expectedBioses?.find((bios) => bios.name === file.name)
    if (!expectedBios) {
      alert(t('bios.fileNameNotExpected'))
      return
    }
    const md5 = await getFileMd5(file)
    if (expectedBios.md5 && expectedBios.md5 !== md5) {
      const message = t(
        `The uploaded file is corrupted (MD5 mismatch).\n\nExpected MD5: {{expected}}\nActual MD5: {{actual}}`,
        { actual: md5, expected: expectedBios.md5 },
      )
      alert(message)
      return
    }
    await upload({ file, platform })
  }

  function isBiosUploaded(bios: { name: string; required?: boolean }) {
    return bioses?.some((b) => b.fileName === bios.name)
  }

  function getBiosStatusText(bios: { name: string; required?: boolean }) {
    if (isBiosUploaded(bios)) {
      return ''
    }
    if (bios.required) {
      return t('common.required')
    }
    return t('common.optional')
  }

  function getBiosClassName(bios: { name: string; required?: boolean }) {
    if (isBiosUploaded(bios)) {
      return 'text-green-700'
    }
    if (bios.required) {
      return 'text-red-700'
    }
  }

  const disabled = isLoading || isDeleting || isUploading

  // Some consoles, the arcade most of all, expect dozens of optional files. Shown are the required ones and any
  // uploaded, and the rest when asked for
  const [showAll, setShowAll] = useState(false)
  const folds = !showAll && (expectedBioses?.length ?? 0) > 6
  const shownBioses = (expectedBioses ?? []).filter((bios) => !folds || bios.required || isBiosUploaded(bios))
  const foldedCount = (expectedBioses?.length ?? 0) - shownBioses.length

  if (!expectedBioses?.length) {
    return
  }

  return (
    <div>
      <SettingsTitle as='h4'>
        <span className='icon-[mdi--chip]' />{' '}
        {t('bios.titleWithPlatform', { platform: t(platformMap[platform].displayNameI18nKey) })}
      </SettingsTitle>
      <div className='flex flex-col gap-2 px-6'>
        <div className='flex flex-wrap items-center gap-2'>
          {bioses.map(({ fileName }) => (
            <Badge key={fileName} size='3' variant='surface'>
              <span className='icon-[mdi--file]' />
              {fileName}
              <Popover.Root>
                <Popover.Trigger>
                  <IconButton disabled={disabled} size='1' title={t('common.delete')} type='button' variant='ghost'>
                    <span className='icon-[mdi--close]' />
                  </IconButton>
                </Popover.Trigger>
                <Popover.Content size='1'>
                  <Button
                    disabled={disabled}
                    loading={isDeleting}
                    onClick={() => handleClickDelete(fileName)}
                    size='1'
                    variant='soft'
                  >
                    <span className='icon-[mdi--delete]' />
                    {t('dialog.confirmDeleteTitle')}
                  </Button>
                </Popover.Content>
              </Popover.Root>
            </Badge>
          ))}
        </div>

        <div className='flex flex-col gap-1'>
          <div>
            <Button
              disabled={disabled && !isUploading}
              loading={isUploading}
              onClick={handleClickUpload}
              size='2'
              variant='soft'
            >
              <span className='icon-[mdi--upload]' />
              {t('common.upload')}
            </Button>
          </div>
          <div className='gap-1 text-xs'>
            <span className='opacity-80'>{t('bios.expectedFile', { count: expectedBioses.length })}</span>
            {shownBioses.map((bios, index) => (
              <span className='mr-1' key={bios.name}>
                <span className={getBiosClassName(bios)}>
                  <b>{bios.name}</b> {getBiosStatusText(bios)}
                </span>
                <span className='opacity-80'>{index < shownBioses.length - 1 ? ',' : ''}</span>
              </span>
            ))}
            {foldedCount ? (
              <button
                className='ml-1 font-medium text-(--accent-11) underline-offset-2 hover:underline'
                onClick={() => setShowAll(true)}
                type='button'
              >
                +{foldedCount} {t('common.optional')}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
