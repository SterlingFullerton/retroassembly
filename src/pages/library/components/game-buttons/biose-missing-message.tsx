import { Button, Callout, Tooltip } from '@radix-ui/themes'
import { Trans, useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { metadata } from '#@/constants/metadata.ts'
import { usePermissions } from '#@/pages/library/hooks/use-permissions.ts'
import { usePlatform } from '#@/pages/library/hooks/use-platform.ts'
import { getSettingsPath, useSettingsOrigin } from '#@/pages/library/settings/sections.ts'

interface BioseMissingMessageProps {
  bioses: {
    md5?: string
    name: string
    required?: boolean
  }[]
}

export function BioseMissingMessage({ bioses }: Readonly<BioseMissingMessageProps>) {
  const { t } = useTranslation()
  const { canManageBioses } = usePermissions()
  const platform = usePlatform()
  const { linkState } = useSettingsOrigin()
  const tooltipContent = t(
    'A BIOS file is a copy of the operating system used by the hardware that we are emulating. Some emulators need BIOS files in order to correctly emulate hardware and/or software as needed by the content. {{title}} does not share any copyrighted system files or game content. You must provide your own BIOS and content in accordance with your local laws as applicable.',
    { title: metadata.title },
  )
  const biosList = bioses.map(({ name }) => name).join(', ')
  const tooltipTrigger = (
    <Tooltip content={tooltipContent}>
      <span className='inline-flex cursor-help items-center gap-0.5 underline decoration-dashed'>
        {t('common.bios')} <span className='icon-[mdi--question-mark-circle-outline]' />
      </span>
    </Tooltip>
  )

  return (
    <Callout.Root>
      <Callout.Icon>
        <span className='icon-[mdi--lock] size-5' />
      </Callout.Icon>
      <Callout.Text>
        <Trans
          components={{
            strong: <b />,
            tooltip: tooltipTrigger,
          }}
          i18nKey='bios.requiredForLaunch'
          values={{ biosList }}
        />{' '}
        {/* Only an admin adds BIOS files; anyone else is told who does */}
        {canManageBioses ? (
          // To the console's settings, where its BIOS files are
          <Button asChild className='-mt-1!' size='1'>
            <Link state={linkState} to={getSettingsPath('consoles', platform?.name)}>
              <span className='icon-[mdi--cog]' /> {t('upload.uploadEllipsis')}
            </Link>
          </Button>
        ) : (
          t('bios.managedByAdmin')
        )}
      </Callout.Text>
    </Callout.Root>
  )
}
