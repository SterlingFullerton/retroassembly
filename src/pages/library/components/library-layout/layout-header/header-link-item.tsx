import { clsx } from 'clsx'
import { getPlatformShortName } from '#@/constants/platform-short-names.ts'

interface HeaderLinkItemProps {
  /** In the red bar itself: a short name on a small phone, where there is one */
  inBar?: boolean
  link?: {
    name?: string
    iconClass?: string
    iconUrl?: string
    text: string
  }
}

export function HeaderLinkItem({ inBar = false, link }: Readonly<HeaderLinkItemProps>) {
  if (link) {
    return (
      <div className='flex min-w-0 items-center gap-1'>
        {link.iconClass ? <span className={clsx('size-5 shrink-0', link.iconClass)} /> : null}
        {link.iconUrl ? <img alt={link.text} className='size-5 shrink-0' src={link.iconUrl} /> : null}
        {inBar && link.name && getPlatformShortName(link.name) ? (
          <>
            <span className='truncate max-[374px]:hidden'>{link.text}</span>
            <span className='hidden truncate max-[374px]:inline'>{getPlatformShortName(link.name)}</span>
          </>
        ) : (
          <span className='truncate'>{link.text}</span>
        )}
      </div>
    )
  }
}
