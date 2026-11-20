import { DropdownMenu } from '@radix-ui/themes'
import { useTranslation } from 'react-i18next'
import { getFileUrl } from '#@/pages/library/utils/file.ts'

interface DownloadButtonProps {
  /** A game on several discs: each one, in order */
  discs?: { fileId: string; fileName: string; number: null | number }[]
  rom: { fileId: string; fileName: string }
}

const roundButton =
  'flex size-10 shrink-0 items-center justify-center rounded-full bg-(--color-background) ring-1 md:size-auto md:p-1.5 ring-(--gray-4) hover:bg-(--accent-3) hover:ring-(--accent-3)'

/**
 * Saves the ROM file to the device, under the name it was uploaded with. A game on several discs asks which disc, from a
 * short menu
 */
const noDiscs: NonNullable<DownloadButtonProps['discs']> = []

export function DownloadButton({ discs = noDiscs, rom }: Readonly<DownloadButtonProps>) {
  const { t } = useTranslation()
  const icon = <span className='icon-[mdi--download] text-lg text-(--accent-11)' />

  if (discs.length > 1) {
    return (
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          <button
            aria-label={t('game.downloadRom')}
            className={roundButton}
            title={t('game.downloadRom')}
            type='button'
          >
            {icon}
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content>
          {discs.map((disc, index) => (
            <DropdownMenu.Item asChild key={disc.fileId}>
              <a download={disc.fileName} href={getFileUrl(disc.fileId)}>
                {t('emulator.disc', { number: disc.number ?? index + 1 })}
              </a>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    )
  }

  return (
    <a
      aria-label={t('game.downloadRom')}
      className={roundButton}
      download={rom.fileName}
      href={getFileUrl(rom.fileId)}
      title={t('game.downloadRom')}
    >
      {icon}
    </a>
  )
}
