import { useTranslation } from 'react-i18next'
import { getFileUrl } from '#@/pages/library/utils/file.ts'

interface DownloadButtonProps {
  rom: { fileId: string; fileName: string }
}

// Saves the ROM file to the device, under the name it was uploaded with
export function DownloadButton({ rom }: Readonly<DownloadButtonProps>) {
  const { t } = useTranslation()

  return (
    <a
      aria-label={t('game.downloadRom')}
      className='flex rounded-full bg-(--color-background) p-1.5 ring-1 ring-(--gray-4) hover:bg-(--accent-3) hover:ring-(--accent-3)'
      download={rom.fileName}
      href={getFileUrl(rom.fileId)}
      title={t('game.downloadRom')}
    >
      <span className='icon-[mdi--download] text-lg text-(--accent-9)' />
    </a>
  )
}
